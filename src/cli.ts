import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DomainConfig, GatesConfig, PersonaConfig, SourceConfig } from './types.js'
import { runPipeline, type PipelineResult } from './pipeline.js'
import { appendFingerprints, buildPack, loadFingerprints, writePack } from './publish/pack.js'
import { formatSyncReport, syncPack } from './publish/sync-tuna.js'
import { ingestTunaSignals, type IngestReport } from './ingest/tuna-signals.js'
import { auditBoard, writeBoard } from './gatekeeper/board.js'
import { acquireLock, releaseLock } from './runtime/lock.js'
import type { EditorialConfig } from './editorial/provider.js'
import { EditorialProvider, assessCalibration, formatCalibration, isCalibrated, loadGoldStandard, reviewBatch } from './editorial/index.js'

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
  /**
   * 同步到 tuna 仓的内置包路径。**缺省不同步**（只产 outbox），
   * 且即使开启也先打印 dry-run 差异，需 `--sync-tuna-write` 才真写。
   * tuna 由老张督阵会话推进，本命令不越权改 tuna 仓。
   */
  tunaRoot?: string
  syncTuna?: boolean
  syncTunaWrite?: boolean
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

/**
 * 读编辑部配置。**不存在时返回 null 而不是报错**：阶段一不依赖 LLM，
 * 没配 editor.json 就走启发式打分 + 机械渲染兜底（预期行为）。
 * 但存在却解析失败时必须抛错——静默忽略配置等于静默降级。
 */
export function loadEditorConfig(root: string): EditorialConfig | null {
  const path = join(root, 'config/editor.json')
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as EditorialConfig
}

/** 打印启动横幅：口径与旧 printBootBanner 一致（LLM 三变量齐备才报 on）。 */
export function printBanner(personas: PersonaConfig[], gates: GatesConfig, io: CliIO, editorial?: EditorialConfig | null): void {
  const ed = editorial?.enabled
    ? `on (writer=${new EditorialProvider(editorial.writer).endpoints.map((e) => e.id).join('>') || '无端点'}, reviewer=${new EditorialProvider(editorial.reviewer).endpoints.map((e) => e.id).join('>') || '无端点'})`
    : 'off (机械兜底)'
  io.stdout(
    `[boot] personas=${personas.map((p) => p.id).join(',')} | gates: blacklist=${gates.blacklist.length} ` +
      `tiers=${gates.keywordTiers.length} minPoints=${gates.minPoints} maxPerEvent=${gates.dedupe.maxPerEvent} | 编辑部: ${ed}`,
  )
}

export async function runCommand(opts: RunOptions): Promise<RunOutcome> {
  const root = opts.root ?? process.cwd()
  const io = opts.io ?? defaultIO

  const domain = loadJson<DomainConfig>(join(root, 'config/domain.json'))
  const sources = loadJson<SourceConfig[]>(join(root, 'config/sources.json'))
  const gates = loadJson<GatesConfig>(join(root, 'config/gates.json'))
  const editorial = loadEditorConfig(root)

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
  printBanner(personas, gates, io, editorial)

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
        editorial: editorial ?? undefined,
        root,
      })
      results.push(result)

      const funnel = result.funnel.map((f) => `${f.stage}=${f.count}`).join(' → ')
      io.stdout(`[${persona.id}] ${funnel} | 事件 ${result.events} | 递补 ${result.gatekeep.backfilled} | 否决 ${result.gatekeep.rejected.length}`)
      if (result.skippedSources.length > 0) io.stdout(`[${persona.id}] 采集失败源: ${result.skippedSources.join(', ')}`)
      if (result.zeroYieldSources.length > 0) io.stdout(`[${persona.id}] 零相关产出源: ${result.zeroYieldSources.join(', ')}`)
      if (result.gatekeep.poolExhausted && result.published.length < persona.maxItems) {
        io.stdout(`[${persona.id}] 候补池耗尽，实发 ${result.published.length} < 上限 ${persona.maxItems}（宁缺毋滥，不凑数）`)
      }

      // 看板自检：fatal 熔断（看板或闸门在骗人），warning 必须打到 stderr 但不阻断发布。
      // 分级理由：若把「编辑部降级」也当 fatal，端点一抖整轮就废；
      // 若完全不报，就是 DB-03 的静默降级老毛病（格式全绿但质量已塌回原点）。
      const audit = auditBoard(result.board)
      for (const w of audit.warnings) io.stderr(`[${persona.id}] 看板警告: ${w}`)
      if (audit.fatal.length > 0) {
        for (const p of audit.fatal) io.stderr(`[${persona.id}] 看板不自洽(熔断): ${p}`)
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

      // 同步到 tuna：默认只算差异不落盘。人工拷贝是第三道影子工序（实测两仓文件
      // id 集合 172/172 一致），收编成命令后至少契约会被校验、差异会被看见。
      if (opts.syncTuna && opts.tunaRoot) {
        const write = opts.syncTunaWrite === true
        const sync = syncPack(pack, { tunaRoot: opts.tunaRoot, dryRun: !write })
        io.stdout(formatSyncReport(sync, persona.displayName))
        if (!write) io.stdout('[sync-tuna] 确认差异无误后加 --sync-tuna-write 才真写（tuna 侧 commit/rebuild 归督阵会话）')
      }
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

/**
 * reviewer 灵敏度自检：拿金标集跑一遍 reviewer，证明分值域对质量维度有灵敏度。
 *
 * **这是硬前置，不是可选体检**：本项目已踩过一次完全同型的坑——计数型打分器触顶后，
 * 「噪音逐轮下降」这条验收标准完全无读数（既非假阳性也非假阴性，而是仪器零灵敏度）。
 * 自检未过时非零退出，且 runEditorial 会拒绝把 reviewer 分数用于任何判定。
 */
export async function calibrateCommand(opts: {
  root?: string
  persona?: string
  io?: CliIO
  fetchFn?: Parameters<typeof runCommand>[0]['fetchFn']
}): Promise<{ exitCode: number; report?: ReturnType<typeof assessCalibration> }> {
  const root = opts.root ?? process.cwd()
  const io = opts.io ?? defaultIO
  const editorial = loadEditorConfig(root)
  if (!editorial) {
    io.stderr('[cli] config/editor.json 不存在，无法自检')
    return { exitCode: 2 }
  }
  const personaId = opts.persona ?? listPersonaIds(root)[0]!
  const persona = loadPersona(root, personaId)
  const goldPath = editorial.calibration?.goldStandardPath ?? 'tests/fixtures/gold-standard.json'
  const absGold = goldPath.startsWith('/') ? goldPath : join(root, goldPath)

  let gold
  try {
    gold = loadGoldStandard(absGold)
  } catch (err) {
    io.stderr(`[cli] 金标集读取失败 ${absGold}：${err instanceof Error ? err.message : err}`)
    return { exitCode: 2 }
  }

  const provider = new EditorialProvider(editorial.reviewer, process.env, opts.fetchFn)
  if (!provider.available) {
    io.stderr('[cli] reviewer 降级链无可解析端点（baseUrl 全空），无法自检')
    return { exitCode: 2 }
  }

  io.stdout(`[calibrate] 金标集 ${gold.length} 条（${absGold}），批大小 ${editorial.reviewer.batchSize}，端点 ${provider.endpoints.map((e) => e.id).join(' > ')}`)
  const verdicts: Array<Awaited<ReturnType<typeof reviewBatch>>['verdicts'][number]> = []
  for (let i = 0; i < gold.length; i += editorial.reviewer.batchSize) {
    const batch = gold.slice(i, i + editorial.reviewer.batchSize).map((g) => ({ title: g.title, body: g.body ?? '' }))
    const r = await reviewBatch(provider, batch, persona, { maxTokens: editorial.reviewer.maxTokens })
    verdicts.push(...r.verdicts)
    io.stdout(`[calibrate] ${Math.min(i + editorial.reviewer.batchSize, gold.length)}/${gold.length}${r.error ? ` 批失败：${r.error}` : ''}${r.truncated ? ' ⚠ 撞 max_tokens 上限被截断' : ''}`)
  }

  const report = assessCalibration(gold, verdicts, {
    minDistinctBuckets: editorial.calibration?.minDistinctBuckets ?? 3,
    maxSaturationRate: editorial.calibration?.maxSaturationRate ?? 0.5,
    minAgreementRate: editorial.calibration?.minAgreementRate ?? 0.7,
  })
  io.stdout(formatCalibration(report))
  return { exitCode: isCalibrated(report) ? 0 : 5, report }
}

export interface IngestOptions {
  root?: string
  /** tuna 导出的信号文件路径（schema tuna-signals-v1） */
  signals: string
  now?: number
  io?: CliIO
}

/**
 * 摄入 tuna 行为信号，复活自进化回路。
 *
 * 返回非零退出码的情形：文件不存在/不可解析（2）、零信号入账（4）。
 * 「零入账」必须报错而不是静默成功：那意味着自进化仍未生效，
 * 静默通过会让看板上的 selfEvolutionActive=false 无人追问。
 */
export async function ingestCommand(opts: IngestOptions): Promise<{ exitCode: number; report?: IngestReport }> {
  const root = opts.root ?? process.cwd()
  const io = opts.io ?? defaultIO
  const sources = loadJson<SourceConfig[]>(join(root, 'config/sources.json'))

  const report = ingestTunaSignals(opts.signals, {
    memoryDir: join(root, 'memory'),
    sources,
    now: opts.now,
  })

  io.stdout(
    `[ingest] 信号 ${report.totalSignals} 条 → views +${report.views}、engagements +${report.engagements}、` +
      `👍 +${report.feedbackUp}、👎 +${report.feedbackDown}、收藏 +${report.favorites}；过期曝光结算 ${report.settledExposures}`,
  )
  if (report.unparsable > 0) io.stdout(`[ingest] postId 不可解析：${report.unparsable} 条`)
  if (report.unresolved > 0) io.stdout(`[ingest] ref 查不到（内容档只留最近 30 份）：${report.unresolved} 条`)
  const weightEntries = Object.entries(report.weights)
  if (weightEntries.length > 0) {
    io.stdout(`[ingest] 源权重：${weightEntries.map(([k, v]) => `${k}=${v.toFixed(3)}`).join(' ')}`)
  }
  const interestEntries = Object.entries(report.interestBySource).filter(([, v]) => v !== undefined)
  if (interestEntries.length > 0) {
    io.stdout(`[ingest] 兴趣后验（Beta 均值，先验 1/3）：${interestEntries.map(([k, v]) => `${k}=${v.toFixed(3)}`).join(' ')}`)
  }
  for (const p of report.problems) io.stderr(`[ingest] ${p}`)

  const total = report.views + report.engagements + report.feedbackUp + report.feedbackDown + report.favorites
  if (report.totalSignals === 0) return { exitCode: 2, report }
  if (total === 0) return { exitCode: 4, report }
  return { exitCode: 0, report }
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

  if (cmd === 'calibrate') {
    const r = await calibrateCommand({ persona: flags.get('persona') })
    return r.exitCode
  }

  if (cmd === 'ingest') {
    const signals = flags.get('signals')
    if (!signals) {
      console.error('[cli] ingest 需要 --signals=<tuna 导出的信号文件路径>（schema tuna-signals-v1）')
      return 2
    }
    const r = await ingestCommand({ signals, now: flags.has('now') ? Number(flags.get('now')) : undefined })
    return r.exitCode
  }

  if (cmd === 'run') {
    const persona = flags.get('persona') ?? 'all'
    const r = await runCommand({
      persona,
      dryRun: flags.has('dry-run'),
      now: flags.has('now') ? Number(flags.get('now')) : undefined,
      tunaRoot: flags.get('tuna-root'),
      syncTuna: flags.has('sync-tuna'),
      syncTunaWrite: flags.has('sync-tuna-write'),
    })
    return r.exitCode
  }

  console.error(`[cli] 未知命令「${cmd}」；可用：run / collect / calibrate / ingest / doctor`)
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
