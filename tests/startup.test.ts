import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectCommand, listPersonaIds, loadPersona, main, printBanner, runCommand, type CliIO } from '../src/cli.js'
import { acquireLock } from '../src/runtime/lock.js'
import type { GatesConfig } from '../src/types.js'

/**
 * CLI 与运行时守卫。
 *
 * 旧版本文件测的是 `startBot`（常驻循环 + Telegram 长轮询 + printBootBanner 的
 * Telegram 通道状态），已随老张 2026-09-04 裁决退役。本文件改测批产 CLI。
 *
 * 保留并强化的两条原纪律：
 * 1. **单实例锁必须包在 try/finally 里**——旧实现曾把锁横跨整个长驻循环且无 finally，
 *    runOnce 一抛错锁文件就残留，只能等下次启动靠 PID 判活自愈，期间还会撞 PID 复用误判。
 * 2. **配置错误必须非零退出**，不得静默降级——闸门假绿的根源。
 */

function captureIO(): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { io: { stdout: (l) => out.push(l), stderr: (l) => err.push(l) }, out, err }
}

/** 造一个最小可跑的仓根：config 四件套 + personas 两份 + sources 白名单对齐。 */
function fakeRoot(personaOverrides: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'dbot-cli-'))
  const gates = JSON.parse(readFileSync(join(process.cwd(), 'config/gates.json'), 'utf8')) as GatesConfig
  const cfg = join(root, 'config')
  mkdirSync(join(cfg, 'personas'), { recursive: true })
  writeFileSync(join(cfg, 'domain.json'), JSON.stringify({ domain: 'ai-llm', keywords: ['llm'], clusterThreshold: 0.35 }))
  writeFileSync(join(cfg, 'push.json'), JSON.stringify({ outDir: 'outbox' }))
  writeFileSync(join(cfg, 'gates.json'), JSON.stringify(gates))
  writeFileSync(
    join(cfg, 'sources.json'),
    JSON.stringify([{ id: 'rss-1', type: 'rss', url: 'http://e/rss', weight: 0.5, enabled: true }]),
  )
  const base = {
    id: 'newsline',
    displayName: 'AI时事快线',
    domain: 'ai-llm',
    sources: ['rss-1'],
    maxAgeHours: 72,
    maxItems: 10,
    minQualityScore: 6,
    clusterThreshold: 0.35,
    rejectRules: [],
  }
  writeFileSync(join(cfg, 'personas', 'newsline.json'), JSON.stringify({ ...base, ...personaOverrides }))
  writeFileSync(join(cfg, 'personas', 'deepthought.json'), JSON.stringify({ ...base, id: 'deepthought', displayName: 'AI深度思想', maxAgeHours: 720 }))
  return root
}

const RSS_XML = `<?xml version="1.0"?><rss><channel>
  <item><title>New LLM inference benchmark released by the lab</title><description>open source release outperform SOTA transformer serving</description><link>https://e.com/1</link></item>
</channel></rss>`
const okFetch = async () => ({ ok: true, status: 200, text: async () => RSS_XML })

describe('CLI：persona 发现与加载', () => {
  it('listPersonaIds 列出 config/personas 下的全部 id（排序稳定）', () => {
    expect(listPersonaIds(process.cwd())).toEqual(['deepthought', 'newsline'])
  })

  it('loadPersona 读到的配置字段齐备且时效窗符合双 bot 质量下限表', () => {
    const root = process.cwd()
    expect(loadPersona(root, 'newsline').maxAgeHours).toBe(72)
    expect(loadPersona(root, 'deepthought').maxAgeHours).toBe(720)
    // 双产线彻底分离：信源白名单交集必须为空
    const a = new Set(loadPersona(root, 'newsline').sources)
    const b = loadPersona(root, 'deepthought').sources
    expect(b.filter((s) => a.has(s))).toEqual([])
  })

  it('未知 persona 报错并列出可选值，非零退出', async () => {
    const { io, err } = captureIO()
    const r = await runCommand({ root: process.cwd(), persona: 'nonexistent', io, fetchFn: okFetch })
    expect(r.exitCode).toBe(2)
    expect(err.join('\n')).toContain('未知 persona')
    expect(err.join('\n')).toContain('newsline')
  })
})

describe('CLI：配置错误必须熔断，不得静默', () => {
  it('gates.json 含非法正则时非零退出且 stderr 点名出错 ruleId', async () => {
    const root = fakeRoot()
    const gatesPath = join(root, 'config/gates.json')
    const gates = JSON.parse(readFileSync(gatesPath, 'utf8')) as GatesConfig
    gates.blacklist.push({ id: 'broken:demo', group: 'nonTech', pattern: '(unclosed', scope: 'title' })
    writeFileSync(gatesPath, JSON.stringify(gates))

    const { io, err } = captureIO()
    // runPipeline 对 compileErrors 抛错 → main 层面必须转成非零退出码
    const code = await runCatching(() => runCommand({ root, persona: 'newsline', io, fetchFn: okFetch }))
    expect(code).not.toBe(0)
    expect(err.join('\n') + code.toString()).toContain('broken:demo')
  })

  it('doctor 增检 gates/personas 存在性与正则可编译性', async () => {
    const { runDoctor } = await import('../src/runtime/doctor.js')
    const okRoot = process.cwd()
    const res = await runDoctor(okRoot, async (cmd) => ({ stdout: `${cmd} v1`, stderr: '' }))
    expect(res.configs.gates).toBe(true)
    expect(res.configs.personas).toEqual(['deepthought', 'newsline'])
    expect(res.patternErrors).toEqual([])
    // Telegram 已退役，keys 里不得再有 telegram 字段
    expect('telegram' in res.keys).toBe(false)

    const badRoot = fakeRoot()
    const gatesPath = join(badRoot, 'config/gates.json')
    const gates = JSON.parse(readFileSync(gatesPath, 'utf8')) as GatesConfig
    gates.blacklist.push({ id: 'broken:doc', group: 'nonTech', pattern: '[a-', scope: 'title' })
    writeFileSync(gatesPath, JSON.stringify(gates))
    const bad = await runDoctor(badRoot, async (cmd) => ({ stdout: `${cmd} v1`, stderr: '' }))
    expect(bad.ok).toBe(false)
    expect(bad.patternErrors.some((e) => e.includes('broken:doc'))).toBe(true)
  })
})

describe('CLI：dry-run 不得污染持久状态', () => {
  it('--dry-run 不写 outbox、不写 evidence、不写指纹库', async () => {
    const root = fakeRoot()
    const { io } = captureIO()
    const r = await runCommand({ root, persona: 'newsline', dryRun: true, io, fetchFn: okFetch })
    expect(r.exitCode).toBe(0)
    expect(r.packPaths).toEqual([])
    expect(r.boardPaths).toEqual([])
    expect(existsSync(join(root, 'outbox'))).toBe(false)
    expect(existsSync(join(root, 'evidence'))).toBe(false)
    expect(existsSync(join(root, 'memory', 'published-fingerprints.json'))).toBe(false)
  })

  it('非 dry-run 落盘内容包 + 看板 + 指纹库，且 id 过 tuna 契约正则', async () => {
    const root = fakeRoot()
    const { io } = captureIO()
    const r = await runCommand({ root, persona: 'newsline', io, fetchFn: okFetch })
    expect(r.exitCode).toBe(0)
    expect(r.packPaths).toHaveLength(1)
    expect(existsSync(r.packPaths[0]!)).toBe(true)

    const pack = JSON.parse(readFileSync(r.packPaths[0]!, 'utf8')) as {
      schema: string
      persona: string
      posts: Array<{ id: string; hooks: string[]; sourceUrl: string }>
      brief: { items: Array<{ postId: string; why: string }> }
    }
    expect(pack.schema).toBe('tuna-brief-v1')
    expect(pack.persona).toBe('newsline')
    // tuna 侧只允许两段冒号：`domain-bot-<persona>:<digestId>:<index>`
    const TUNA_POST_ID = /^[a-z0-9-]+:[a-z0-9]+:\d+$/
    for (const p of pack.posts) {
      expect(TUNA_POST_ID.test(p.id), `id 不合 tuna 契约：${p.id}`).toBe(true)
      expect(p.hooks).toHaveLength(3)
      // 钩子不得是标题前缀截断，也不得是 arXiv 碎片（DB-03 §2.4 实测的两类缺陷）
      for (const h of p.hooks) {
        expect(h).not.toMatch(/^arxiv:\d+\.?/i)
        expect(Array.from(h).length).toBeGreaterThanOrEqual(12)
      }
    }
    // why 在 brief.items 里（不在 posts）；浮点回显是 DB-03 实测缺陷
    //（"AI深度思想·rss：价值 0.94"），必须为 0
    expect(pack.brief.items).toHaveLength(pack.posts.length)
    for (const it of pack.brief.items) {
      expect(it.why.length).toBeGreaterThan(0)
      expect(it.why).not.toMatch(/\d\.\d{2}/)
      expect(it.why).not.toContain('价值')
    }
    expect(existsSync(join(root, 'memory', 'published-fingerprints.json'))).toBe(true)
  })
})

describe('CLI：单实例锁', () => {
  it('runCommand 正常结束后释放锁（后续 acquireLock 可成功）', async () => {
    const root = fakeRoot()
    const { io } = captureIO()
    await runCommand({ root, persona: 'newsline', dryRun: true, io, fetchFn: okFetch })
    expect(() => acquireLock(join(root, 'memory'))).not.toThrow()
  })

  it('runCommand 抛错后也必须释放锁（try/finally 回归护栏，B3 教训）', async () => {
    const root = fakeRoot()
    const gatesPath = join(root, 'config/gates.json')
    const gates = JSON.parse(readFileSync(gatesPath, 'utf8')) as GatesConfig
    gates.blacklist.push({ id: 'broken:lock', group: 'nonTech', pattern: '(unclosed', scope: 'title' })
    writeFileSync(gatesPath, JSON.stringify(gates))

    const { io } = captureIO()
    await runCatching(() => runCommand({ root, persona: 'newsline', io, fetchFn: okFetch }))
    // 锁残留会让后续所有运行直接报错（File exists），且只能靠 PID 判活自愈
    expect(() => acquireLock(join(root, 'memory'))).not.toThrow()
  })
})

describe('CLI：collect 分阶段落点（为 DB-05 编辑作业预留）', () => {
  it('collect 只写 staging 候选包，不写 outbox / evidence', async () => {
    const root = fakeRoot()
    const { io } = captureIO()
    const r = await collectCommand({ root, persona: 'newsline', io, fetchFn: okFetch })
    expect(r.exitCode).toBe(0)
    expect(existsSync(r.path)).toBe(true)
    expect(existsSync(join(root, 'outbox'))).toBe(false)

    const staging = JSON.parse(readFileSync(r.path, 'utf8')) as { schema: string; candidates: unknown[]; funnel: unknown[] }
    expect(staging.schema).toBe('domain-bot-candidates-v1')
    expect(staging.candidates.length).toBeGreaterThan(0)
    expect(staging.funnel.length).toBeGreaterThan(0)
  })
})

describe('CLI：启动横幅', () => {
  it('打印 persona、闸门规则数与编辑部状态；未启用时报 off', () => {
    const { io, out } = captureIO()
    const root = process.cwd()
    const gates = JSON.parse(readFileSync(join(root, 'config/gates.json'), 'utf8')) as GatesConfig
    printBanner([loadPersona(root, 'newsline')], gates, io)
    const line = out.join('\n')
    expect(line).toContain('personas=newsline')
    expect(line).toContain(`blacklist=${gates.blacklist.length}`)
    expect(line).toContain(`minPoints=${gates.minPoints}`)
    expect(line).toContain(`maxPerEvent=${gates.dedupe.maxPerEvent}`)
    expect(line).toMatch(/编辑部: (on|off)/)
  })

  it('编辑部启用时横幅必须点名 writer 与 reviewer 各自的端点（写与评分离要看得见）', () => {
    const { io, out } = captureIO()
    const root = process.cwd()
    const gates = JSON.parse(readFileSync(join(root, 'config/gates.json'), 'utf8')) as GatesConfig
    const cfg = JSON.parse(readFileSync(join(root, 'config/editor.json'), 'utf8'))
    printBanner([loadPersona(root, 'newsline')], gates, io, { ...cfg, enabled: true })
    const line = out.join('\n')
    expect(line).toContain('编辑部: on')
    expect(line).toContain('writer=')
    expect(line).toContain('reviewer=')
    // 两端点必须不同：同一模型既写又评构成循环（老张裁决 4）
    const w = line.match(/writer=([^,)]+)/)![1]
    const r = line.match(/reviewer=([^)]+)\)/)![1]
    expect(w).not.toBe(r)
  })

  it('编辑部启用但端点全不可解析时，横幅必须显示"无端点"而不是假装 on', () => {
    const { io, out } = captureIO()
    const root = process.cwd()
    const gates = JSON.parse(readFileSync(join(root, 'config/gates.json'), 'utf8')) as GatesConfig
    const cfg = JSON.parse(readFileSync(join(root, 'config/editor.json'), 'utf8'))
    const empty = { ...cfg, enabled: true, writer: { ...cfg.writer, chain: [] }, reviewer: { ...cfg.reviewer, chain: [] } }
    printBanner([loadPersona(root, 'newsline')], gates, io, empty)
    expect(out.join('\n')).toContain('writer=无端点')
  })
})

describe('CLI：main 命令分派', () => {
  it('未知命令非零退出并列出可用命令', async () => {
    const code = await main(['bogus'])
    expect(code).toBe(2)
  })

  it('run 缺 persona 时默认 all（两条产线依次跑）', async () => {
    const root = fakeRoot()
    const { io } = captureIO()
    // 只验分派与退出码：真实采集由 fetchFn 提供，dry-run 避免污染 fakeRoot 之外的目录
    const r = await runCommand({ root, persona: 'all', dryRun: true, io, fetchFn: okFetch })
    expect(r.exitCode).toBe(0)
    expect(r.results.map((x) => x.persona).sort()).toEqual(['deepthought', 'newsline'])
    expect(r.crossPersonaOverlap).toEqual([])
  })
})

/** 把「抛错」转成可断言的退出码/错误信息，避免测试里散落 try/catch。 */
async function runCatching(fn: () => Promise<{ exitCode: number }>): Promise<number | string> {
  try {
    const r = await fn()
    return r.exitCode
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
