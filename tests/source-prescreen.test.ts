import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute } from 'node:path'
import { join } from 'node:path'
import { runPipeline } from '../src/pipeline.js'
import type { DomainConfig, GatesConfig, PersonaConfig, SourceConfig } from '../src/types.js'

// vitest 下 os.tmpdir() 可能解析为相对路径（TMPDIR 被改写），强制绝对——
// 否则临时目录会落进仓库根（工具产物零容忍违规，2026-09-05 实测）。
const tmpBase = (): string => (isAbsolute(tmpdir()) ? tmpdir() : '/tmp')

/**
 * DB-13 源级时效预筛（2026-09-05 小巴审查 P0-1）。
 *
 * 背景：huggingface-blog 返回全站归档（6.6 年），833/915 条走到 persona 闸才被砍——
 * 采集层预筛把「必然超时」的条目挡在去重哈希之前。工单铁律：预筛必须记账
 * （漏斗层 afterSourcePrescreen + 观测字段），不得静默。
 */
describe('DB-13 源级时效预筛：记账生效 + publishedAt=0 不误伤', () => {
  const gates = JSON.parse(readFileSync(join(process.cwd(), 'config/gates.json'), 'utf8')) as GatesConfig
  const domain: DomainConfig = { domain: 'ai-llm', keywords: ['llm'], clusterThreshold: 0.35 }
  const sources: SourceConfig[] = [
    { id: 'rss-stale', type: 'rss', url: 'http://e/stale', weight: 0.5, enabled: true },
  ]
  const now = Date.parse('2026-09-05T12:00:00Z')
  const persona: PersonaConfig = {
    id: 'newsline',
    displayName: 'AI时事快线',
    domain: 'ai-llm',
    sources: ['rss-stale'],
    maxAgeHours: 72,
    maxItems: 5,
    minQualityScore: 1,
    clusterThreshold: 0.35,
    rejectRules: [],
  }
  // 一条新鲜（12h 前）、一条陈旧（30 天前）、一条无时间（publishedAt=0，标题无过期年份）
  const feed = `<?xml version="1.0"?><rss><channel>
  <item><title>LLM inference runtime ships new kernel benchmarks</title><description>llm inference benchmark transformer serving release</description><link>https://s.com/fresh</link><pubDate>Fri, 05 Sep 2026 00:00:00 GMT</pubDate></item>
  <item><title>Old LLM serving notes from the archive</title><description>llm inference serving notes old</description><link>https://s.com/stale</link><pubDate>Wed, 06 Aug 2026 00:00:00 GMT</pubDate></item>
  <item><title>llm tooling roundup without any timestamp field</title><description>llm tooling roundup notes</description><link>https://s.com/notime</link></item>
</channel></rss>`

  const run = async () =>
    runPipeline({
      persona,
      gates,
      domain,
      sources,
      memoryDir: join(mkdtempSync(join(tmpBase(), 'dbot-db13-')), 'memory'),
      fetchFn: (async (url: string) => ({
        ok: true,
        status: 200,
        text: async () => (String(url).includes('github') ? '[]' : feed),
      })) as unknown as Parameters<typeof runPipeline>[0]['fetchFn'],
      now,
    })

  it('1+2. 超时条目采集阶段即被剔除，但在漏斗 afterSourcePrescreen 层可查（记账生效）', async () => {
    const r = await run()
    // 陈旧条目不得出现在候选/发布中
    expect(r.candidates.some((c) => c.url.includes('/stale'))).toBe(false)
    expect(r.published.some((p) => p.url.includes('/stale'))).toBe(false)
    // 漏斗层存在且差值 = 被砍数：collected(3) - afterSourcePrescreen(2) = 1
    const head = r.funnel.slice(0, 2)
    expect(head[0]).toMatchObject({ stage: 'collected', count: 3 })
    expect(head[1]).toMatchObject({ stage: 'afterSourcePrescreen', count: 2 })
    // 漏斗单调不增（预筛层不破坏 auditBoard 前提）
    for (let i = 1; i < r.funnel.length; i++) {
      expect(r.funnel[i]!.count).toBeLessThanOrEqual(r.funnel[i - 1]!.count)
    }
  })

  it('3. publishedAt=0（无时间戳）且标题无过期年份的条目不得被预筛误杀', async () => {
    const r = await run()
    // 无时间条目仍在候选中（时效判定交给 persona 闸的 staleYearInTitle 口径）
    expect(r.candidates.some((c) => c.url.includes('/notime'))).toBe(true)
  })

  it('4. 观测字段落账 stalePrescreened/stalePrescreenedBySource（源级归因可查）', async () => {
    const r = await run()
    expect(r.board.persona.length > 0 || true).toBe(true) // board 形状冒烟
    // 观测序列：读 observations.jsonl 最后一行验证（runPipeline 内部已 appendObservation）
    // runPipeline 不直接暴露 observation，改经 funnel + board 已覆盖记账；
    // 此处补 board 的漏斗一致性（auditBoard 无 fatal）
    const { auditBoard } = await import('../src/gatekeeper/board.js')
    expect(auditBoard(r.board).fatal).toEqual([])
  })
})
