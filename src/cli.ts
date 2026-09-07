import { mkdirSync, readdirSync, readFileSync, renameSync, existsSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { DomainConfig, FetchFn, GatesConfig, PersonaConfig, SourceConfig } from './types.js'
import { collectStage, runPipeline, type PipelineOptions, type PipelineResult } from './pipeline.js'
import { appendFingerprints, attachEmbeddings, buildPack, loadFingerprints, writePack } from './publish/pack.js'
import { formatSyncReport, syncPack } from './publish/sync-tuna.js'
import { ingestTunaSignals, type IngestReport } from './ingest/tuna-signals.js'
import { auditBoard, writeBoard } from './gatekeeper/board.js'
import { acquireLock, releaseLock } from './runtime/lock.js'
import type { EditorialConfig } from './editorial/provider.js'
import { calibrateRecall, judgeRecallPool } from './editorial/recall.js'
import { EditorialProvider, assessCalibration, formatCalibration, isCalibrated, loadGoldStandard, reviewBatch, runEditorial } from './editorial/index.js'
import {
  COPY_SCHEMA,
  STAGE_SCHEMA,
  VERDICT_SCHEMA,
  combineStagedEditorial,
  editorialTargetsOf,
  findLatestStage,
  readStageJson,
  restoreStage,
  snapshotStage,
  stagePath,
  writeStageJson,
  type CollectStageSnapshot,
  type CopyStage,
  type VerdictStage,
} from './staging.js'

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

const RECALL_CALIBRATION_TTL_MS = 24 * 60 * 60 * 1000

interface RecallCalibrationCache {
  /** 缓存身份（DB-10/S2-7）：persona + reviewer 降级链 + 金标内容哈希。不一致即失效重校准 */
  key: string
  calibratedAt: number
  agreementRate: number
  passed: boolean
  problems: string[]
}

/**
 * DB-08 宽通道判定回调工厂（docs/plan-recall-widening-2026-09-05.md Phase 2）。
 *
 * persona.recall 未启用、editor.json 缺失或 reviewer 端点不可解析时返回 undefined
 * （宽通道关闭，走词表闸门原语义）。校准结果落盘 `<memoryDir>/recall-calibration.json`
 * 并缓存 24h——通过与否都缓存：失败的校准每轮重跑只会重复烧钱，24h 后自然重试。
 * 校准口径与质量打分是两回事（剔除→exclude、其余→include），未过标 fail-safe 全不召回。
 */
export function makeRecallJudge(
  root: string,
  persona: PersonaConfig,
  memoryDir: string,
  io: CliIO,
  fetchFn?: FetchFn,
): NonNullable<PipelineOptions['recallJudge']> | undefined {
  if (!persona.recall?.enabled) return undefined
  const editorial = loadEditorConfig(root)
  if (!editorial) {
    io.stderr(`[${persona.id}] recall.enabled 但 config/editor.json 缺失，宽通道关闭（走词表闸门原语义）`)
    return undefined
  }
  const provider = new EditorialProvider(editorial.reviewer, process.env, fetchFn)
  if (!provider.available) {
    io.stderr(`[${persona.id}] recall.enabled 但 reviewer 降级链无端点，宽通道关闭`)
    return undefined
  }
  const goldPath = editorial.calibration?.goldStandardPath ?? 'tests/fixtures/gold-standard.json'
  const absGold = goldPath.startsWith('/') ? goldPath : join(root, goldPath)
  let gold: ReturnType<typeof loadGoldStandard>
  try {
    gold = loadGoldStandard(absGold)
  } catch (err) {
    io.stderr(`[${persona.id}] recall 金标读取失败 ${absGold}：${err instanceof Error ? err.message : err}，宽通道关闭`)
    return undefined
  }
  const minRate = persona.recall.minAgreementRate ?? 0.7
  const maxTokens = editorial.reviewer.maxTokens
  const batchSize = editorial.reviewer.batchSize
  // P1（2026-09-07 审查）：缓存曾是单文件跨 persona 共用，但 cacheKey 含 persona.id——
  // newsline 写 key-A → deepthought 读到不符判失效重校准并覆盖 → 每轮重复全量 LLM 校准。
  // 按 persona 分片，24h TTL 才能真正命中。
  const safePersona = persona.id.replace(/[^a-z0-9-]/gi, '_')
  const cachePath = join(memoryDir, `recall-calibration-${safePersona}.json`)
  // 缓存身份（DB-10/S2-7）：换 persona / 换端点链 / 改金标任一发生，旧校准结论一律失效
  const cacheKey =
    persona.id +
    '|' +
    createHash('sha1').update(JSON.stringify(editorial.reviewer)).digest('hex').slice(0, 12) +
    '|' +
    createHash('sha1').update(readFileSync(absGold)).digest('hex').slice(0, 12)

  return async (pool) => {
    try {
      let cal: RecallCalibrationCache | null = null
      try {
        if (existsSync(cachePath)) cal = JSON.parse(readFileSync(cachePath, 'utf8')) as RecallCalibrationCache
      } catch {
        cal = null // 坏缓存当作没有，重跑校准并覆盖
      }
      if (cal && cal.key !== cacheKey) cal = null // 身份不符：persona/端点/金标已变，旧结论不得沿用
      if (!cal || Date.now() - cal.calibratedAt > RECALL_CALIBRATION_TTL_MS) {
        const report = await calibrateRecall(provider, gold, persona, { maxTokens, minAgreementRate: minRate })
        cal = {
          key: cacheKey,
          calibratedAt: Date.now(),
          agreementRate: report.agreementRate,
          passed: report.passed,
          problems: report.problems,
        }
        mkdirSync(memoryDir, { recursive: true })
        const tmp = `${cachePath}.tmp-${process.pid}`
        writeFileSync(tmp, JSON.stringify(cal, null, 2))
        renameSync(tmp, cachePath)
        io.stdout(
          `[${persona.id}] [recall] 金标校准：${report.judgedCount}/${report.sampleCount} 判定、漏答 ${report.missingCount}、` +
            `一致率 ${(report.agreementRate * 100).toFixed(1)}% → ${report.passed ? '宽通道启用' : '回退关闭'}`,
        )
        for (const p of report.problems) io.stdout(`[${persona.id}] [recall] 校准问题: ${p}`)
      }
      if (!cal.passed) {
        return {
          included: [],
          excluded: pool.map((it) => ({
            itemId: it.id,
            title: it.title,
            source: it.source,
            url: it.url,
            gate: 'recall' as const,
            ruleId: 'recall:calibrationFailed',
            reason: '宽通道判定校准未通过（见 memory/recall-calibration.json），fail-safe 不召回',
          })),
        }
      }
      const judged = await judgeRecallPool(provider, pool, persona, { maxTokens, batchSize })
      io.stdout(
        `[${persona.id}] [recall] 待定 ${pool.length} 条 → 捞回 ${judged.included.length}、排除 ${judged.excluded.length}` +
          `${judged.missing > 0 ? `（漏答 ${judged.missing}）` : ''}${judged.error ? ` ⚠ ${judged.error}` : ''}`,
      )
      return judged
    } catch (err) {
      // DB-10/S2-5：判定器内任何异常（校准/判定端点全败等）不得中止整轮批产——
      // 降级为逐条落账的「不召回」，与词表原语义同向，且漏斗可复算、可观测。
      const msg = err instanceof Error ? err.message : String(err)
      io.stderr(`[${persona.id}] [recall] 宽通道异常，fail-safe 逐条不召回（不中止整轮）：${msg}`)
      return {
        included: [],
        excluded: pool.map((it) => ({
          itemId: it.id,
          title: it.title,
          source: it.source,
          url: it.url,
          gate: 'recall' as const,
          ruleId: 'recall:endpointFailed',
          reason: `宽通道端点失败，fail-safe 不召回：${msg}`,
        })),
      }
    }
  }
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
        recallJudge: makeRecallJudge(root, persona, memoryDir, io, opts.fetchFn),
      })
      results.push(result)

      const funnel = result.funnel.map((f) => `${f.stage}=${f.count}`).join(' → ')
      io.stdout(`[${persona.id}] ${funnel} | 事件 ${result.events} | 递补 ${result.gatekeep.backfilled} | 否决 ${result.gatekeep.rejected.length}`)
      if (result.skippedSources.length > 0) io.stdout(`[${persona.id}] 采集失败源: ${result.skippedSources.join(', ')}`)
      if (result.zeroYieldSources.length > 0) io.stdout(`[${persona.id}] 零相关产出源: ${result.zeroYieldSources.join(', ')}`)
      if (result.gatekeep.poolExhausted && result.published.length < persona.maxItems) {
        io.stdout(`[${persona.id}] 候补池耗尽，实发 ${result.published.length} < 上限 ${persona.maxItems}（宁缺毋滥，不凑数）`)
      }

      const emitted = await emitPublished(result, persona, {
        root,
        memoryDir,
        dryRun: opts.dryRun,
        now: opts.now,
        tunaRoot: opts.tunaRoot,
        syncTuna: opts.syncTuna,
        syncTunaWrite: opts.syncTunaWrite,
        io,
      })
      if (emitted.packPath) packPaths.push(emitted.packPath)
      if (emitted.boardPath) boardPaths.push(emitted.boardPath)
      if (emitted.exitCode !== 0) {
        return { results, packPaths, boardPaths, crossPersonaOverlap: [], exitCode: emitted.exitCode }
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

// ---------- 发布历史账（DB-22 §3 / DB-21 A-3） ----------

export const PUBLISH_LOG_FILE = 'publish-log.jsonl'

export interface PublishLogEntry {
  /**
   * 本次发布实际发生的时刻（墙钟 ISO）。**不用** `now`（那是采集时刻）：
   * 一夜积压早上 publish 时，五次重跑会共享同一个 `now`，账本就分辨不出是哪一次——
   * 而「第几次重跑」正是本账本要回答的问题。
   */
  at: string
  persona: string
  digestId: string
  packPath: string
  postIds: string[]
}

/**
 * 读发布历史账。读侧容错是本账本契约的一半：坏行/半行跳过、不阻断——
 * 账本是可观测性设施，不能反过来让读它的东西挂掉。
 */
export function readPublishLog(memoryDir: string): PublishLogEntry[] {
  const path = join(memoryDir, PUBLISH_LOG_FILE)
  if (!existsSync(path)) return []
  const rows: PublishLogEntry[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (t.length === 0) continue
    try {
      const parsed: unknown = JSON.parse(t)
      if (parsed && typeof parsed === 'object') rows.push(parsed as PublishLogEntry)
    } catch {
      /* 坏行跳过 */
    }
  }
  return rows
}

/**
 * append-only 发布历史账：每次真发布追加一行（DB-21 A-3）。
 *
 * 为什么必须有：09-07 想量化「同轮 5 次重跑各丢了哪几条」时三条路全断——
 * outbox pack 被最后一次覆盖、`digests.json` 只反映最后一次、指纹库只有 URL 无轮次归因，
 * 唯一追加式的 `observations.jsonl` 又只记数量不记条目 id。丢稿只能凭印象整改。
 *
 * 落盘纪律与 `appendFingerprints` / store 的 `writeFileAtomic` 同源（读全量 → tmp+rename
 * 原子替换）：两个调用点都在 `acquireLock` 临界区内，读改写不会被并发发布交错；
 * append-only 语义由「先读旧账再加一行」保证，绝不重写已有行。
 */
export function appendPublishLog(memoryDir: string, entry: PublishLogEntry): void {
  const rows = readPublishLog(memoryDir)
  rows.push(entry)
  const path = join(memoryDir, PUBLISH_LOG_FILE)
  mkdirSync(memoryDir, { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
  renameSync(tmp, path)
}

/**
 * 发布落盘：看板自检 → dry-run 短路 → 内容包 → 看板 → 指纹库 → 可选同步 tuna。
 *
 * `run`（整链）与 `publish`（分段）**共用本函数**。两处各写一遍必然漂移，
 * 而「发布」正是本项目三道影子工序的第三道（人工拷贝进 tuna 仓，实测两仓
 * id 集合 172/172 一致）。收编成一个函数后，契约校验与差异打印只有一份实现。
 */
export interface EmitOptions {
  root: string
  memoryDir: string
  dryRun?: boolean
  now?: number
  tunaRoot?: string
  syncTuna?: boolean
  syncTunaWrite?: boolean
  io: CliIO
}

export interface EmitOutcome {
  packPath?: string
  boardPath?: string
  exitCode: number
}

export async function emitPublished(result: PipelineResult, persona: PersonaConfig, opts: EmitOptions): Promise<EmitOutcome> {
  const io = opts.io
  // 看板自检：fatal 熔断（看板或闸门在骗人），warning 必须打到 stderr 但不阻断发布。
  // 分级理由：若把「编辑部降级」也当 fatal，端点一抖整轮就废；
  // 若完全不报，就是 DB-03 的静默降级老毛病（格式全绿但质量已塌回原点）。
  const audit = auditBoard(result.board)
  for (const w of audit.warnings) io.stderr(`[${persona.id}] 看板警告: ${w}`)
  if (audit.fatal.length > 0) {
    for (const p of audit.fatal) io.stderr(`[${persona.id}] 看板不自洽(熔断): ${p}`)
    return { exitCode: 3 }
  }

  if (opts.dryRun) {
    io.stdout(`[${persona.id}] dry-run：不落盘 outbox / evidence / 指纹库`)
    return { exitCode: 0 }
  }

  const pack = buildPack(result.published, {
    digestId: result.digestId,
    persona: persona.id,
    personaDisplay: persona.displayName,
    domain: persona.domain,
    generatedAt: opts.now ?? Date.now(),
  })
  // E3 过渡态：内容向量随包下发（失败不阻断发布，见 attachEmbeddings 失败语义）
  const embedded = await attachEmbeddings(pack, io)
  const packPath = writePack(pack, join(opts.root, 'outbox/tuna'))
  const boardPath = writeBoard(result.board, join(opts.root, 'evidence'))
  const added = appendFingerprints(opts.memoryDir, result.published)
  // 发布历史账（DB-22 §3 / DB-21 A-3）：把「这次发布到底发了哪些条」记到条目 id 粒度。
  // 触发点与指纹库完全一致（真发布才记，--dry-run 已在上方短路）。
  // 失败不阻断发布——账本是可观测性设施，不能反过来拖垮内容主链路。
  try {
    appendPublishLog(opts.memoryDir, {
      at: new Date().toISOString(),
      persona: persona.id,
      digestId: result.digestId,
      packPath,
      postIds: result.published.map((p) => p.id),
    })
  } catch (err) {
    io.stderr(`[${persona.id}] 发布账本写入失败（不阻断发布）: ${err instanceof Error ? err.message : String(err)}`)
  }
  io.stdout(`[${persona.id}] 发布 ${result.published.length} 条 → ${packPath}（指纹库 +${added}，向量 +${embedded}）`)

  // 同步到 tuna：默认只算差异不落盘。人工拷贝是第三道影子工序，
  // 收编成命令后至少契约会被校验、差异会被看见。
  if (opts.syncTuna && opts.tunaRoot) {
    const write = opts.syncTunaWrite === true
    const sync = syncPack(pack, { tunaRoot: opts.tunaRoot, dryRun: !write })
    io.stdout(formatSyncReport(sync, persona.displayName))
    if (!write) io.stdout('[sync-tuna] 确认差异无误后加 --sync-tuna-write 才真写（tuna 侧 commit/rebuild 归督阵会话）')
  }
  return { packPath, boardPath, exitCode: 0 }
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
 * 只跑产线步骤 1-7（采集 → 闸门 → 打分 → 事件聚合），把全部中间态落
 * `staging/candidates-<persona>-<digestId>.json`，供 `edit` / `review` / `publish` 接手。
 *
 * **不跑终审、不写归档、不落观测**：这些全在 `finalizeStage`（由 publish 执行）。
 * 旧版本此处调的是 `runPipeline`（整链），于是 `collect` 一次就 recordItems +
 * saveDigest + appendObservation，接着 `publish` 再跑一遍——候选已被记成「已消费」，
 * 第二轮 dedupe 把它们全屏蔽，观测序列还会多出一份重复轮次。分段命令的前提
 * 就是每段只做自己那一段的副作用。
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
    const stage = await collectStage({
      persona,
      gates,
      domain,
      sources,
      memoryDir,
      fetchFn: opts.fetchFn,
      spawnFn: opts.spawnFn,
      now: opts.now,
      knownCanonical: loadFingerprints(memoryDir),
      recallJudge: makeRecallJudge(root, persona, memoryDir, io, opts.fetchFn),
    })
    const path = stagePath(join(root, 'staging'), 'candidates', persona.id, stage.digestId)
    writeStageJson(path, snapshotStage(stage))
    const funnel = stage.funnelPrefix.map((f) => `${f.stage}=${f.count}`).join(' → ')
    io.stdout(
      `[cli] collect(${persona.id})：${funnel} | 事件 ${stage.eventCount} 簇（降权 ${stage.eventDemoted}）` +
        ` → ${stage.eventOrdered.length} 条候选 → ${path}`,
    )
    if (stage.skippedSources.length > 0) io.stdout(`[${persona.id}] 采集失败源: ${stage.skippedSources.join(', ')}`)
    return { path, count: stage.eventOrdered.length, exitCode: 0 }
  } finally {
    releaseLock(memoryDir)
  }
}

export interface StageRunOptions {
  root?: string
  persona: string
  /** 缺省接手最近一次 collect 的产物（按 mtime） */
  digestId?: string
  io?: CliIO
  /** 测试注入点：代替真实 HTTP，否则单测会去连本机模型服务 */
  fetchFn?: FetchFn
}

/**
 * 读回 collect 阶段的快照。
 *
 * 找不到时给可操作的错误信息而不是静默用空候选跑一遍：后者会产出一个
 * 完全空的内容包，看上去像是「本轮源没内容」，而不是「你忘了先跑 collect」。
 */
function loadStage(
  root: string,
  personaId: string,
  digestId: string | undefined,
  io: CliIO,
): { snapshot: CollectStageSnapshot; stagingDir: string } | null {
  const stagingDir = join(root, 'staging')
  const path = digestId
    ? stagePath(stagingDir, 'candidates', personaId, digestId)
    : findLatestStage(stagingDir, 'candidates', personaId)
  if (!path) {
    io.stderr(`[cli] 找不到 ${personaId} 的采集快照（${stagingDir}）；请先跑 collect --persona=${personaId}`)
    return null
  }
  const snapshot = readStageJson<CollectStageSnapshot>(path, STAGE_SCHEMA)
  if (!snapshot) {
    io.stderr(`[cli] 采集快照不存在：${path}；请先跑 collect --persona=${personaId}`)
    return null
  }
  return { snapshot, stagingDir }
}

/** persona 校验（与 runCommand 同口径）。不合法时已打过 stderr。 */
function resolvePersona(root: string, id: string, io: CliIO): PersonaConfig | null {
  const available = listPersonaIds(root)
  if (!available.includes(id)) {
    io.stderr(`[cli] 未知 persona「${id}」；可选值：${available.join(', ')}`)
    return null
  }
  return loadPersona(root, id)
}

/**
 * `edit` 阶段：只跑 writer，产物落 `staging/copy-<persona>-<digestId>.json`。
 *
 * 单独成段的理由是实测吞吐：writer 批=3 单批 47.1s，200 条 ≈53 分钟。
 * 跟采集或发布绑在一个进程里，中途端点抖动就得从头再来。
 *
 * **未生效时仍退 0**：降级链的设计意图就是产线不停摆（无 LLM 时走机械兜底）。
 * 若这里退非零，过夜定时作业会直接中断而永不发布——比文案机械严重得多。
 * 但必须向 stderr 吐原因，不得只写进文件里等人去挖。
 */
export async function editCommand(opts: StageRunOptions): Promise<{ exitCode: number; path?: string }> {
  const root = opts.root ?? process.cwd()
  const io = opts.io ?? defaultIO
  const editorial = loadEditorConfig(root)
  if (!editorial) {
    io.stderr('[cli] config/editor.json 不存在，edit 阶段无从执行（阶段一不依赖 LLM，可直接跑 publish 走机械兜底）')
    return { exitCode: 2 }
  }
  const persona = resolvePersona(root, opts.persona, io)
  if (!persona) return { exitCode: 2 }
  const loaded = loadStage(root, persona.id, opts.digestId, io)
  if (!loaded) return { exitCode: 2 }

  const stage = restoreStage(loaded.snapshot)
  const targets = editorialTargetsOf(stage, persona.maxItems)
  io.stdout(`[cli] edit(${persona.id})：${targets.length} 条进 writer（批=${editorial.writer.batchSize}，预计 ≈${Math.round((targets.length / editorial.writer.batchSize) * 47.1 / 60)} 分钟）`)
  const outcome = await runEditorial({
    config: editorial,
    persona,
    candidates: targets,
    root,
    now: loaded.snapshot.now,
    fetchFn: opts.fetchFn,
    roles: ['writer'],
    onProgress: (l) => io.stdout(l),
  })

  const doc: CopyStage = {
    schema: COPY_SCHEMA,
    persona: persona.id,
    digestId: loaded.snapshot.digestId,
    targetIds: targets.map((t) => t.id),
    copies: outcome.copies,
    active: outcome.active,
    inactiveReason: outcome.inactiveReason,
    stats: outcome.stats,
    usage: outcome.usage.writer,
  }
  const path = writeStageJson(stagePath(loaded.stagingDir, 'copy', persona.id, loaded.snapshot.digestId), doc)
  const written = outcome.copies.filter((c) => c !== null).length
  io.stdout(`[cli] edit(${persona.id})：${written}/${targets.length} 条拿到 LLM 文案 → ${path}`)
  if (!outcome.active) io.stderr(`[cli] edit(${persona.id}) 未生效，publish 将走机械兜底：${outcome.inactiveReason ?? '未知原因'}`)
  return { exitCode: 0, path }
}

/**
 * `review` 阶段：只跑 reviewer（含金标灵敏度自检），产物落
 * `staging/verdicts-<persona>-<digestId>.json`。
 *
 * 自检报告随产物一起落盘：`publish` 阶段才能复核而不是盲信。
 * 自检未过时 `runEditorial` 返回的 qualifiedIndices 为 null，于是 reviewer 分数
 * 不会参与任何排序与判定——这是「打分饱和使验收无读数」前车之鉴的直接防御。
 */
export async function reviewCommand(opts: StageRunOptions): Promise<{ exitCode: number; path?: string }> {
  const root = opts.root ?? process.cwd()
  const io = opts.io ?? defaultIO
  const editorial = loadEditorConfig(root)
  if (!editorial) {
    io.stderr('[cli] config/editor.json 不存在，review 阶段无从执行')
    return { exitCode: 2 }
  }
  const persona = resolvePersona(root, opts.persona, io)
  if (!persona) return { exitCode: 2 }
  const loaded = loadStage(root, persona.id, opts.digestId, io)
  if (!loaded) return { exitCode: 2 }

  const stage = restoreStage(loaded.snapshot)
  const targets = editorialTargetsOf(stage, persona.maxItems)
  io.stdout(`[cli] review(${persona.id})：${targets.length} 条进 reviewer（批=${editorial.reviewer.batchSize}，另需先跑金标自检）`)
  const outcome = await runEditorial({
    config: editorial,
    persona,
    candidates: targets,
    root,
    now: loaded.snapshot.now,
    fetchFn: opts.fetchFn,
    roles: ['reviewer'],
    onProgress: (l) => io.stdout(l),
  })

  const doc: VerdictStage = {
    schema: VERDICT_SCHEMA,
    persona: persona.id,
    digestId: loaded.snapshot.digestId,
    targetIds: targets.map((t) => t.id),
    verdicts: outcome.verdicts,
    qualifiedIndices: outcome.qualifiedIndices,
    active: outcome.active,
    inactiveReason: outcome.inactiveReason,
    calibration: outcome.calibration,
    stats: outcome.stats,
    usage: outcome.usage.reviewer,
  }
  const path = writeStageJson(stagePath(loaded.stagingDir, 'verdicts', persona.id, loaded.snapshot.digestId), doc)
  const answered = outcome.verdicts.filter((v) => v !== null).length
  io.stdout(
    `[cli] review(${persona.id})：${answered}/${targets.length} 条拿到判定，达标 ${outcome.qualifiedIndices?.length ?? 0} 条 → ${path}`,
  )
  if (outcome.calibration && outcome.calibration.problems.length > 0) {
    io.stderr(`[cli] review(${persona.id}) 金标自检未过，reviewer 分数本轮不得用于判定：${outcome.calibration.problems.join('；')}`)
  }
  if (!outcome.active) io.stderr(`[cli] review(${persona.id}) 未生效：${outcome.inactiveReason ?? '未知原因'}`)
  return { exitCode: 0, path }
}

export interface PublishOptions extends StageRunOptions {
  dryRun?: boolean
  tunaRoot?: string
  syncTuna?: boolean
  syncTunaWrite?: boolean
}

/**
 * `publish` 阶段：读回采集快照 + edit/review 产物，跑终审与归档，落内容包。
 *
 * **不重跑采集、不调模型端点**：走的是 `runPipeline({ staged, stagedEditorial })`，
 * 与整链 `run` 共用同一段 `finalizeStage`。不在本函数里另写一份终审与归档——
 * 两条发布路径必然漂移，那就是影子工序的开端。
 *
 * edit/review 产物缺失时不报错，走机械兜底（阶段一的预期行为），但会打到 stderr。
 */
export async function publishCommand(opts: PublishOptions): Promise<{ exitCode: number; packPath?: string }> {
  const root = opts.root ?? process.cwd()
  const io = opts.io ?? defaultIO
  const domain = loadJson<DomainConfig>(join(root, 'config/domain.json'))
  const sources = loadJson<SourceConfig[]>(join(root, 'config/sources.json'))
  const gates = loadJson<GatesConfig>(join(root, 'config/gates.json'))
  const persona = resolvePersona(root, opts.persona, io)
  if (!persona) return { exitCode: 2 }
  const loaded = loadStage(root, persona.id, opts.digestId, io)
  if (!loaded) return { exitCode: 2 }

  const { snapshot, stagingDir } = loaded
  const stage = restoreStage(snapshot)
  const copyPath = stagePath(stagingDir, 'copy', persona.id, snapshot.digestId)
  const verdictPath = stagePath(stagingDir, 'verdicts', persona.id, snapshot.digestId)
  const copy = readStageJson<CopyStage>(copyPath, COPY_SCHEMA)
  const verdict = readStageJson<VerdictStage>(verdictPath, VERDICT_SCHEMA)
  if (!copy) io.stderr(`[cli] publish(${persona.id})：无 edit 产物（${copyPath}），文案走机械兜底`)
  if (!verdict) io.stderr(`[cli] publish(${persona.id})：无 review 产物（${verdictPath}），不做质量排序`)

  // targetIds 传**产物里存的那份**，不是当前重算的：两者不一致时
  // finalizeStage 的 assertTargetAlignment 才能发现错位。传重算的就等于自己校自己，永不会红。
  const stagedIds = copy?.targetIds ?? verdict?.targetIds
  const stagedEditorial =
    copy || verdict
      ? {
          outcome: combineStagedEditorial(copy, verdict, editorialTargetsOf(stage, persona.maxItems).length),
          targetIds: stagedIds ?? [],
        }
      : undefined

  const memoryDir = join(root, 'memory')
  acquireLock(memoryDir)
  try {
    const result = await runPipeline({
      persona,
      gates,
      domain,
      sources,
      memoryDir,
      now: snapshot.now,
      knownCanonical: loadFingerprints(memoryDir),
      staged: snapshot,
      stagedEditorial,
      root,
    })
    const funnel = result.funnel.map((f) => `${f.stage}=${f.count}`).join(' → ')
    io.stdout(`[${persona.id}] ${funnel} | 事件 ${result.events} | 递补 ${result.gatekeep.backfilled} | 否决 ${result.gatekeep.rejected.length}`)
    if (result.gatekeep.poolExhausted && result.published.length < persona.maxItems) {
      io.stdout(`[${persona.id}] 候补池耗尽，实发 ${result.published.length} < 上限 ${persona.maxItems}（宁缺毋滥，不凑数）`)
    }
    const emitted = await emitPublished(result, persona, {
      root,
      memoryDir,
      dryRun: opts.dryRun,
      // 内容包盖采集时的时间戳而不是发布时：一夜跑完后早上 publish，
      // 本期内容属于昨晚那一轮，盖今朝的戳会让时效断言与观测序列对不上。
      now: snapshot.now,
      tunaRoot: opts.tunaRoot,
      syncTuna: opts.syncTuna,
      syncTunaWrite: opts.syncTunaWrite,
      io,
    })
    return { exitCode: emitted.exitCode, packPath: emitted.packPath }
  } catch (err) {
    // 快照/产物不自洽（下标错位、schema 不符、悬空 id）时给可用退出码而不是抛栈：
    // 分段作业是夜里跑的，早上六点面对一屏堆栈无法处置，而错误文本里已写了该重跑哪一段。
    const msg = err instanceof Error ? err.message : String(err)
    io.stderr(`[cli] publish(${persona.id}) 拒绝发布：${msg}`)
    return { exitCode: 6 }
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
    const r = await collectCommand({
      persona,
      now: flags.has('now') ? Number(flags.get('now')) : undefined,
    })
    return r.exitCode
  }

  // edit / review / publish 三段共用同一组旗标：--persona 必填，--digest-id 可选
  // （缺省接手最近一次 collect）。分段跑的意义就在于可以分开排：
  // 例 collect+review 晚上十点跑，edit（≈53 分钟）夜里跑，publish 早上跑。
  if (cmd === 'edit' || cmd === 'review' || cmd === 'publish') {
    const persona = flags.get('persona')
    if (!persona) {
      console.error(`[cli] ${cmd} 需要 --persona=<id>`)
      return 2
    }
    const stageOpts = {
      persona,
      digestId: flags.get('digest-id'),
      dryRun: flags.has('dry-run'),
      tunaRoot: flags.get('tuna-root'),
      syncTuna: flags.has('sync-tuna'),
      syncTunaWrite: flags.has('sync-tuna-write'),
    }
    const r =
      cmd === 'edit'
        ? await editCommand(stageOpts)
        : cmd === 'review'
          ? await reviewCommand(stageOpts)
          : await publishCommand(stageOpts)
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

  console.error(
    `[cli] 未知命令「${cmd}」；可用：run / collect / edit / review / publish / calibrate / ingest / doctor\n` +
      '  run       整链批产（采集→闸门→编辑部→终审→发布），--persona=all 跑双产线\n' +
      '  collect   只跑采集+闸门+事件聚合，落 staging 快照（不写归档）\n' +
      '  edit      只跑 writer（≈每分钟 1.3 条），产物落 staging\n' +
      '  review    只跑 reviewer + 金标自检，产物落 staging\n' +
      '  publish   读 staging 产物跑终审与发布（不重跑采集、不调端点）\n' +
      '  calibrate 单独跑 reviewer 灵敏度自检\n' +
      '  ingest    摄入 tuna 导出的行为信号（--signals=<path>）\n' +
      '  doctor    环境与配置体检',
  )
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
