import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DomainConfig, GatesConfig, PersonaConfig, SourceConfig } from './types.js'
import { runPipeline, type PipelineResult } from './pipeline.js'
import { appendFingerprints, buildPack, loadFingerprints, writePack } from './publish/pack.js'
import { auditBoard, writeBoard } from './gatekeeper/board.js'
import { acquireLock, releaseLock } from './runtime/lock.js'

/**
 * CLI 入口。取代旧 `src/index.ts` 的 `runOnce` / `startBot`（每日 6 条摘要 + 常驻 Telegram 轮询）。
 *
 * 老张 2026-09-04 裁决：只保留批产线、砍掉每日摘要，故无常驻 `loop` 语义——
 * 批产是一次性作业，用系统定时器（launchd/cron）触发本命令即可，不需要进程常驻。
 */

export interface CliIO {
  stdout: (line: string) => void
  stderr: (line: string) => void
}

const defaultIO: CliIO = {
  stdout: (l) => console.log(l),
  stderr: (l) => console.error(l),
}

export interface RunOptions {
  root?: string
  persona: string
  dryRun?: boolean
  now?: number
  fetchFn?: Parameters<typeof runPipeline>[0]['fetchFn']
  spawnFn?: Parameters<typeof runPipeline>[0]['spawnFn']
  io?: CliIO
}

export interface RunOutcome {
  results: PipelineResult[]
  packPaths: string[]
  boardPaths: string[]
  /** 两条产线产出的 id 交集；非空即说明跨产线去重失效 */
  crossPersonaOverlap: string[]
  exitCode: number
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function listPersonaIds(root: string): string[] {
  const dir = join(root, 'config/personas')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort()
}

export function loadPersona(root: string, id: string): PersonaConfig {
  return loadJson<PersonaConfig>(join(root, 'config/personas', `${id}.json`))
}

/** 打印启动横幅：口径与旧 printBootBanner 一致（LLM 三变量齐备才报 on）。 */
export function printBanner(personas: PersonaConfig[], gates: GatesConfig, io: CliIO): void {
  const llmModel = process.env.DOMAIN_BOT_LLM_MODEL
  // OPENAI_API_KEY 是其他工具的通用变量，纳入判定会误报 on（09-04 真机联调实测）
  const llm = process.env.DOMAIN_BOT_LLM_BASE_URL && process.env.DOMAIN_BOT_LLM_API_KEY && llmModel
    ? `on (model=${llmModel})`
    : 'fallback (heuristic)'
  io.stdout(
    `[boot] personas=${personas.map((p) => p.id).join(',')} | gates: blacklist=${gates.blacklist.length} ` +
      `tiers=${gates.keywordTiers.length} minPoints=${gates.minPoints} maxPerEvent=${gates.dedupe.maxPerEvent} | LLM: ${llm}`,
  )
}

export async function runCommand(opts: RunOptions): Promise<RunOutcome> {
  const root = opts.root ?? process.cwd()
  const io = opts.io ?? defaultIO

  const domain = loadJson<DomainConfig>(join(root, 'config/domain.json'))
  const sources = loadJson<SourceConfig[]>(join(root, 'config/sources.json'))
  const gates = loadJson<GatesConfig>(join(root, 'config/gates.json'))

  const available = listPersonaIds(root)
  const wanted =
    opts.persona === 'all' ? available : [opts.persona]
  for (const id of wanted) {
    if (!available.includes(id)) {
      io.stderr(`[cli] 未知 persona「${id}」；可选值：${available.join(', ')}, all`)
      return { results: [], packPaths: [], boardPaths: [], crossPersonaOverlap: [], exitCode: 2 }
    }
  }

  const personas = wanted.map((id) => loadPersona(root, id))
  printBanner(personas, gates, io)

  const memoryDir = join(root, 'memory')
  // 单实例锁：--persona=all 依次跑两条产线写同一 memoryDir，无锁会 last-writer-wins 丢归档。
  // 必须 try/finally 释放——旧实现曾把锁横跨整个长驻循环且无 finally，抛错即残留锁文件。
  acquireLock(memoryDir)
  try {
    const results: PipelineResult[] = []
    const packPaths: string[] = []
    const boardPaths: string[] = []

    for (const persona of personas) {
      // 跨产线共享指纹库：先跑的写入、后跑的读入，防同一事件两个 bot 各发一遍
      const knownCanonical = loadFingerprints(memoryDir)
      const result = await runPipeline({
        persona,
        gates,
        domain,
        sources,
        memoryDir,
        fetchFn: opts.fetchFn,
        spawnFn: opts.spawnFn,
        now: opts.now,
        knownCanonical,
      })
      results.push(result)

      const funnel = result.funnel.map((f) => `${f.stage}=${f.count}`).join(' → ')
      io.stdout(`[${persona.id}] ${funnel} | 事件 ${result.events} | 递补 ${result.gatekeep.backfilled} | 否决 ${result.gatekeep.rejected.length}`)
      if (result.skippedSources.length > 0) io.stdout(`[${persona.id}] 采集失败源: ${result.skippedSources.join(', ')}`)
      if (result.zeroYieldSources.length > 0) io.stdout(`[${persona.id}] 零相关产出源: ${result.zeroYieldSources.join(', ')}`)
      if (result.gatekeep.poolExhausted && result.published.length < persona.maxItems) {
        io.stdout(`[${persona.id}] 候补池耗尽，实发 ${result.published.length} < 上限 ${persona.maxItems}（宁缺毋滥，不凑数）`)
      }

      // 看板一致性自检：漏斗不可对账即熔断，不让「看板只是修辞」重演
      const problems = auditBoard(result.board)
      if (problems.length > 0) {
        for (const p of problems) io.stderr(`[${persona.id}] 看板不自洽: ${p}`)
        return { results, packPaths, boardPaths, crossPersonaOverlap: [], exitCode: 3 }
      }

      if (opts.dryRun) {
        io.stdout(`[${persona.id}] dry-run：不落盘 outbox / evidence / 指纹库`)
        continue
      }

      const pack = buildPack(result.published, {
        digestId: result.digestId,
        persona: persona.id,
        personaDisplay: persona.displayName,
        domain: persona.domain,
        generatedAt: opts.now ?? Date.now(),
      })
      packPaths.push(writePack(pack, join(root, 'outbox/tuna')))
      boardPaths.push(writeBoard(result.board, join(root, 'evidence')))
      const added = appendFingerprints(memoryDir, result.published)
      io.stdout(`[${persona.id}] 发布 ${result.published.length} 条 → ${packPaths[packPaths.length - 1]}（指纹库 +${added}）`)
    }

    // 跨产线 id 交集必须为空
    const idSets = results.map((r) => new Set(r.published.map((p) => p.id)))
    const overlap: string[] = []
    if (idSets.length === 2) {
      for (const id of idSets[0]!) if (idSets[1]!.has(id)) overlap.push(id)
    }
    // URL 交集同样必须为空（id 含 index，跨产线必然不同；真正会重叠的是内容本身）
    const urlSets = results.map((r) => new Set(r.published.map((p) => p.url)))
    const urlOverlap: string[] = []
    if (urlSets.length === 2) {
      for (const u of urlSets[0]!) if (urlSets[1]!.has(u)) urlOverlap.push(u)
    }
    if (overlap.length > 0 || urlOverlap.length > 0) {
      io.stderr(`[cli] 跨产线重复：id ${overlap.length} 条、url ${urlOverlap.length} 条（指纹库共享失效）`)
      return { results, packPaths, boardPaths, crossPersonaOverlap: [...overlap, ...urlOverlap], exitCode: 4 }
    }

    return { results, packPaths, boardPaths, crossPersonaOverlap: [], exitCode: 0 }
  } finally {
    releaseLock(memoryDir)
  }
}

export interface CollectOptions {
  root?: string
  persona: string
  now?: number
  fetchFn?: Parameters<typeof runPipeline>[0]['fetchFn']
  spawnFn?: Parameters<typeof runPipeline>[0]['spawnFn']
  io?: CliIO
}

/**
 * 只采集 + 过闸门，把候选落 `staging/candidates-<persona>-<ts>.json`。
 * 为 DB-05 的分阶段编辑作业（writer/reviewer 长时批产）预留落点：
 * 编辑工序读这个文件，不必重跑采集。
 */
export async function collectCommand(opts: CollectOptions): Promise<{ path: string; count: number; exitCode: number }> {
  const root = opts.root ?? process.cwd()
  const io = opts.io ?? defaultIO
  const domain = loadJson<DomainConfig>(join(root, 'config/domain.json'))
  const sources = loadJson<SourceConfig[]>(join(root, 'config/sources.json'))
  const gates = loadJson<GatesConfig>(join(root, 'config/gates.json'))

  const available = listPersonaIds(root)
  if (!available.includes(opts.persona)) {
    io.stderr(`[cli] 未知 persona「${opts.persona}」；可选值：${available.join(', ')}`)
    return { path: '', count: 0, exitCode: 2 }
  }

  const persona = loadPersona(root, opts.persona)
  const memoryDir = join(root, 'memory')
  acquireLock(memoryDir)
  try {
    // 用 maxItems 极大的副本跑闸门：collect 阶段不做截断，把全部合格候选交给编辑工序
    const result = await runPipeline({
      persona: { ...persona, maxItems: Number.MAX_SAFE_INTEGER },
      gates,
      domain,
      sources,
      memoryDir,
      fetchFn: opts.fetchFn,
      spawnFn: opts.spawnFn,
      now: opts.now,
      knownCanonical: loadFingerprints(memoryDir),
    })
    const dir = join(root, 'staging')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `candidates-${persona.id}-${result.digestId}.json`)
    writeFileSync(
      path,
      JSON.stringify(
        {
          schema: 'domain-bot-candidates-v1',
          persona: persona.id,
          digestId: result.digestId,
          generatedAt: new Date(opts.now ?? Date.now()).toISOString(),
          funnel: result.funnel,
          candidates: result.selected,
        },
        null,
        2,
      ),
    )
    io.stdout(`[cli] collect(${persona.id})：${result.selected.length} 条候选 → ${path}`)
    return { path, count: result.selected.length, exitCode: 0 }
  } finally {
    releaseLock(memoryDir)
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const cmd = argv[0] ?? 'run'
  const flags = new Map<string, string>()
  for (const a of argv.slice(1)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    if (m) flags.set(m[1]!, m[2] ?? 'true')
  }

  if (cmd === 'doctor' || flags.has('doctor')) {
    const { runDoctor, formatDoctorReport } = await import('./runtime/doctor.js')
    const result = await runDoctor(process.cwd())
    console.log(formatDoctorReport(result))
    return result.ok ? 0 : 1
  }

  if (cmd === 'collect') {
    const persona = flags.get('persona')
    if (!persona) {
      console.error('[cli] collect 需要 --persona=<id>')
      return 2
    }
    const r = await collectCommand({ persona, now: flags.has('now') ? Number(flags.get('now')) : undefined })
    return r.exitCode
  }

  if (cmd === 'run') {
    const persona = flags.get('persona') ?? 'all'
    const r = await runCommand({
      persona,
      dryRun: flags.has('dry-run'),
      now: flags.has('now') ? Number(flags.get('now')) : undefined,
    })
    return r.exitCode
  }

  console.error(`[cli] 未知命令「${cmd}」；可用：run / collect / doctor`)
  return 2
}

if (process.argv[1] && /cli\.(js|ts)$/.test(process.argv[1])) {
  main().then(
    (code) => {
      if (code !== 0) process.exitCode = code
    },
    (err) => {
      console.error(err)
      process.exitCode = 1
    },
  )
}
