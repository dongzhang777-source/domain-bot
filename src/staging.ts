import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DropRecord, ScoredItem } from './types.js'
import type { FunnelStage } from './gatekeeper/board.js'
import type { WrittenCopy } from './editorial/writer.js'
import type { ReviewVerdict } from './editorial/reviewer.js'
import type { CalibrationReport } from './editorial/calibrate.js'
import type { EditorialOutcome, EditorialStats, Usage } from './editorial/index.js'
import { EMPTY_EDITORIAL_STATS } from './editorial/index.js'

/**
 * 分阶段批产作业的**跨进程契约**。
 *
 * 为什么必须有它：老张认可的是「过夜批产（1 小时级）」，而实测 writer 单轮 ≈53 分钟。
 * 一个进程跑完整链，中途端点抖动就得从头再来——这正是 `job.ts` 逐批落盘要解决的问题，
 * 但 job 只保住「批」粒度，采集结果与编辑部产物跨阶段的衔接仍需要一层显式契约。
 *
 * 四段落盘（`collect` → `edit` → `review` → `publish`）：
 *
 * | 阶段 | 产物 | 内容 |
 * |---|---|---|
 * | collect | `candidates-<persona>-<digestId>.json` | 采集→闸门→打分→事件聚合的全部中间态 |
 * | edit | `copy-<persona>-<digestId>.json` | writer 文案 + 端点用量 |
 * | review | `verdicts-<persona>-<digestId>.json` | reviewer 判定 + 金标自检报告 |
 * | publish | `outbox/tuna/feed-pack-*.json` | 终审后的内容包（契约见 publish/pack.ts） |
 *
 * **不在 cli 里复制产线逻辑**：四段命令全部走 `pipeline.ts` 的 `collectStage` /
 * `finalizeStage`，本模块只负责把中间态序列化与还原。两条产线逻辑必然漂移——
 * 那正是本项目要治的「影子工序」病（`/tmp/tuna-feed-run/edit.mjs` 的成因）。
 */

export const STAGE_SCHEMA = 'domain-bot-stage-v1'
export const COPY_SCHEMA = 'domain-bot-copy-v1'
export const VERDICT_SCHEMA = 'domain-bot-verdict-v1'

/**
 * 采集阶段（产线步骤 1-7）的内存态结果。
 *
 * `finalizeStage` 从这里接手，因此它必须携带步骤 8-12 所需的**全部**输入：
 * 编辑部作用域、终审的事件键映射、归档与观测的口径数据。漏一项就会让分段跑
 * 与整链跑产出不一致，而这种不一致单测很难发现（两条路径各有自己的绿）。
 */
export interface CollectStageResult {
  persona: string
  personaDisplay: string
  digestId: string
  now: number
  /** 事件聚合**前**的全量候选。归档与观测用它（解传送带纪律：只归档推送条目会让推送质量单调衰减） */
  candidates: ScoredItem[]
  /** 与 candidates 同序的原始分（未加权），observeRound 的输入 */
  rawScores: number[]
  /** 事件降权后的顺序（kept 在前、demoted 在后），以 candidates 的 id 表示 */
  eventOrder: string[]
  /** `eventOrder` 解引用后的条目序列。编辑部的作用域从它切（见 editorialTargetsOf） */
  eventOrdered: ScoredItem[]
  /** id → 事件簇键。终审的事件复检靠它（Map 形态，序列化时转 entries） */
  eventKeyOf: Map<string, string>
  eventCount: number
  eventDemoted: number
  dropped: DropRecord[]
  /** 源权重重算结果，observeRound 落盘用 */
  weights: Record<string, number>
  funnelPrefix: FunnelStage[]
  skippedSources: string[]
  zeroYieldSources: string[]
  /**
   * 观测口径的源级明细。
   *
   * 必须在采集阶段就存下来：`observeRound` 要落盘每源的
   * fetched / afterDedupe / relevant 三个计数，而这些只在采集现场可得。
   * 分段跑时 `finalizeStage` 手上只有快照，拿不到源级明细——不存就会让
   * 「分段发布」与「整链发布」的观测序列不同口径，质量随轮次的变化无法对比。
   */
  observed: StageObserved
}

/** `observeRound` 所需的源级计数。全部可 JSON 序列化。 */
export interface StageObserved {
  collectedCount: number
  relevantCount: number
  sourceFetched: Record<string, number>
  sourceAfterDedupe: Record<string, number>
  sourceRelevant: Record<string, number>
  skippedSourceIds: string[]
  /**
   * persona 白名单 ∩ enabled 的全部源 id。
   *
   * 不能用 `Object.keys(sourceFetched)` 代替：抛错的源不会进 sourceFetched，
   * 两者相差的恰好就是 skipped 源——而观测序列靠它区分「源挂掉」与「源没内容」。
   */
  enabledSourceIds: string[]
  /** 宽通道（DB-08）：本轮待定池大小与 LLM 判定 include 数（recall 关闭时双 0） */
  recallPoolSize: number
  recallIncluded: number
  /** 源级时效预筛（DB-13）：采集后、去重前被砍的超时条目数与源分布 */
  stalePrescreened: number
  stalePrescreenedBySource: Record<string, number>
}

/** `CollectStageResult` 的 JSON 形态（Map → entries，eventOrdered → id 序列）。 */
export interface CollectStageSnapshot {
  schema: typeof STAGE_SCHEMA
  persona: string
  personaDisplay: string
  digestId: string
  now: number
  candidates: ScoredItem[]
  rawScores: number[]
  eventOrder: string[]
  eventKeys: Array<[string, string]>
  eventCount: number
  eventDemoted: number
  dropped: DropRecord[]
  weights: Record<string, number>
  funnelPrefix: FunnelStage[]
  skippedSources: string[]
  zeroYieldSources: string[]
  observed: StageObserved
}

/** edit 阶段产物（writer）。 */
export interface CopyStage {
  schema: typeof COPY_SCHEMA
  persona: string
  digestId: string
  /**
   * 本文件覆盖的候选 id 序列。
   *
   * **必须存**：copies 是按下标对齐的数组，而它对齐的是
   * `eventOrdered.slice(0, maxItems * 2)`。若 persona.maxItems 在 edit 与 publish
   * 之间被改过，下标会静默错位——文案挂到别的条目上，产出看起来完全正常。
   * publish 阶段用 `assertTargetAlignment` 硬校验，错位即抛错而不是错发。
   */
  targetIds: string[]
  copies: Array<WrittenCopy | null>
  active: boolean
  inactiveReason?: string
  stats: EditorialStats
  usage: Usage | null
}

/** review 阶段产物（reviewer）。 */
export interface VerdictStage {
  schema: typeof VERDICT_SCHEMA
  persona: string
  digestId: string
  /** 同 CopyStage.targetIds 的理由 */
  targetIds: string[]
  verdicts: Array<ReviewVerdict | null>
  /** 达到 persona.minQualityScore 的下标；reviewer 未生效时为 null */
  qualifiedIndices: number[] | null
  active: boolean
  inactiveReason?: string
  /**
   * 金标自检报告。**未通过时 reviewer 分数不得用于任何判定**（见 runEditorial 的
   * calibration 前置），故必须随产物一起落盘，publish 阶段才能复核而不是盲信。
   */
  calibration?: CalibrationReport
  stats: EditorialStats
  usage: Usage | null
}

export function snapshotStage(r: CollectStageResult): CollectStageSnapshot {
  return {
    schema: STAGE_SCHEMA,
    persona: r.persona,
    personaDisplay: r.personaDisplay,
    digestId: r.digestId,
    now: r.now,
    candidates: r.candidates,
    rawScores: r.rawScores,
    eventOrder: r.eventOrder,
    eventKeys: [...r.eventKeyOf.entries()],
    eventCount: r.eventCount,
    eventDemoted: r.eventDemoted,
    dropped: r.dropped,
    weights: r.weights,
    funnelPrefix: r.funnelPrefix,
    skippedSources: r.skippedSources,
    zeroYieldSources: r.zeroYieldSources,
    observed: r.observed,
  }
}

/**
 * 从快照还原采集阶段结果。
 *
 * 校验从严：schema 不符、eventOrder 引用了不存在的 id、rawScores 与 candidates
 * 长度不一致，都直接抛错。这些都是「分段跑与整链跑口径漂移」的征兆，
 * 静默容忍会让 publish 产出看起来正常但实际错位。
 */
export function restoreStage(s: CollectStageSnapshot): CollectStageResult {
  if (!s || typeof s !== 'object') throw new Error('采集快照不是对象')
  if (s.schema !== STAGE_SCHEMA) throw new Error(`采集快照 schema 不是 ${STAGE_SCHEMA}（实为 ${String(s.schema)}）`)
  if (!Array.isArray(s.candidates)) throw new Error('采集快照 candidates 不是数组')
  if (!Array.isArray(s.rawScores) || s.rawScores.length !== s.candidates.length) {
    throw new Error(`采集快照 rawScores 长度（${s.rawScores?.length}）与 candidates（${s.candidates.length}）不一致`)
  }
  const byId = new Map(s.candidates.map((c) => [c.id, c]))
  if (byId.size !== s.candidates.length) {
    throw new Error(`采集快照 candidates 有重复 id（${s.candidates.length} 条 → ${byId.size} 个唯一 id），规范 URL 派生 id 失效`)
  }
  const eventOrdered: ScoredItem[] = []
  for (const id of s.eventOrder ?? []) {
    const item = byId.get(id)
    if (!item) throw new Error(`采集快照 eventOrder 引用了不存在的 id「${id}」`)
    eventOrdered.push(item)
  }
  return {
    persona: s.persona,
    personaDisplay: s.personaDisplay,
    digestId: s.digestId,
    now: s.now,
    candidates: s.candidates,
    rawScores: s.rawScores,
    eventOrder: s.eventOrder ?? [],
    eventOrdered,
    eventKeyOf: new Map(s.eventKeys ?? []),
    eventCount: s.eventCount,
    eventDemoted: s.eventDemoted,
    dropped: s.dropped ?? [],
    weights: s.weights ?? {},
    funnelPrefix: s.funnelPrefix ?? [],
    skippedSources: s.skippedSources ?? [],
    zeroYieldSources: s.zeroYieldSources ?? [],
    observed: {
      collectedCount: s.observed?.collectedCount ?? 0,
      relevantCount: s.observed?.relevantCount ?? 0,
      sourceFetched: s.observed?.sourceFetched ?? {},
      sourceAfterDedupe: s.observed?.sourceAfterDedupe ?? {},
      sourceRelevant: s.observed?.sourceRelevant ?? {},
      skippedSourceIds: s.observed?.skippedSourceIds ?? [],
      enabledSourceIds: s.observed?.enabledSourceIds ?? [],
      recallPoolSize: s.observed?.recallPoolSize ?? 0,
      recallIncluded: s.observed?.recallIncluded ?? 0,
      stalePrescreened: s.observed?.stalePrescreened ?? 0,
      stalePrescreenedBySource: s.observed?.stalePrescreenedBySource ?? {},
    },
  }
}

/**
 * 编辑部的作用域：事件降权序的前 `maxItems * 2` 条。
 *
 * 不对全量跑编辑部的理由是实测吞吐：writer 每条 15.7s，数百条会把单轮拖到数小时，
 * 超出老张认可的「过夜批产 1 小时级」。`maxItems` 两份（≤240 条）对应 ≈53 分钟。
 *
 * `edit` / `review` / `publish` 三段命令与整链 `run` **必须共用本函数**，
 * 否则各段的作用域口径会漂，targetIds 校验就成了摆设。
 */
export function editorialTargetsOf(stage: CollectStageResult, maxItems: number): ScoredItem[] {
  return stage.eventOrdered.slice(0, maxItems * 2)
}

/**
 * 校验分段产物与当前候选集的下标对齐。
 *
 * 不一致就抛错。这里的失败模式特别阴险：copies 与 verdicts 都是按下标对齐的数组，
 * 错位不会让任何断言变红，只会让 A 条目的文案挂到 B 条目上——产出格式完美、内容张冠李戴。
 */
export function assertTargetAlignment(kind: 'copy' | 'verdicts', stagedIds: string[], expectedIds: string[]): void {
  if (stagedIds.length !== expectedIds.length) {
    throw new Error(
      `${kind} 阶段产物覆盖 ${stagedIds.length} 条，但当前候选作用域是 ${expectedIds.length} 条` +
        `（persona.maxItems 或采集快照在两段之间被改过？请重跑 edit/review）`,
    )
  }
  for (let i = 0; i < stagedIds.length; i++) {
    if (stagedIds[i] !== expectedIds[i]) {
      throw new Error(
        `${kind} 阶段产物第 ${i} 条的 id 与当前候选作用域不符（${stagedIds[i]} ≠ ${expectedIds[i]}）；` +
          `下标错位会让文案挂到别的条目上，拒绝继续`,
      )
    }
  }
}

/** 把 edit / review 两段产物合成一个 EditorialOutcome（publish 阶段据此重建看板）。 */
export function combineStagedEditorial(
  copy: CopyStage | null,
  verdict: VerdictStage | null,
  targetCount: number,
): EditorialOutcome {
  const copies = copy?.copies ?? new Array<WrittenCopy | null>(targetCount).fill(null)
  const verdicts = verdict?.verdicts ?? new Array<ReviewVerdict | null>(targetCount).fill(null)
  const active = (copy?.active ?? false) || (verdict?.active ?? false)
  const stats: EditorialStats = {
    endpoints: [...(copy?.stats.endpoints ?? []), ...(verdict?.stats.endpoints ?? [])],
    writerDegradedBatches: copy?.stats.writerDegradedBatches ?? 0,
    reviewerDegradedBatches: verdict?.stats.reviewerDegradedBatches ?? 0,
    truncatedBatches: (copy?.stats.truncatedBatches ?? 0) + (verdict?.stats.truncatedBatches ?? 0),
  }
  const reasons = [copy?.inactiveReason, verdict?.inactiveReason].filter((r): r is string => typeof r === 'string' && r.length > 0)
  return {
    enabled: true,
    active,
    inactiveReason: active ? (reasons.length > 0 ? reasons.join('；') : undefined) : reasons.join('；') || '两段产物均未生效',
    copies,
    verdicts,
    qualifiedIndices: verdict?.qualifiedIndices ?? null,
    calibration: verdict?.calibration,
    usage: { writer: copy?.usage ?? null, reviewer: verdict?.usage ?? null },
    stats: stats.endpoints.length === 0 && stats.truncatedBatches === 0 ? { ...EMPTY_EDITORIAL_STATS } : stats,
  }
}

export type StageKind = 'candidates' | 'copy' | 'verdicts'

const STAGE_PREFIX: Record<StageKind, string> = {
  candidates: 'candidates',
  copy: 'copy',
  verdicts: 'verdicts',
}

/** 三段产物的路径。digestId 已由 collect 阶段定死，后续阶段必须沿用同一个。 */
export function stagePath(stagingDir: string, kind: StageKind, persona: string, digestId: string): string {
  return join(stagingDir, `${STAGE_PREFIX[kind]}-${persona}-${digestId}.json`)
}

export function writeStageJson(path: string, doc: unknown): string {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(doc, null, 2))
  return path
}

/**
 * 读一段产物并校验 schema。
 *
 * 文件不存在返回 null（分段命令允许跳过：没跑 edit 就走机械兜底，这是预期行为）。
 * 存在但 schema 不符或不可解析则抛错——静默忽略一份坏产物等于静默降级。
 */
export function readStageJson<T extends { schema: string }>(path: string, expected: string): T | null {
  if (!existsSync(path)) return null
  let doc: unknown
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`${path} 不可解析：${err instanceof Error ? err.message : err}`)
  }
  const schema = (doc as { schema?: unknown })?.schema
  if (schema !== expected) throw new Error(`${path} 的 schema 不是 ${expected}（实为 ${String(schema)}）`)
  return doc as T
}

/**
 * 找某 persona 最近一次的产物（按文件 mtime）。
 *
 * 分段命令允许省略 `--digest-id`：默认接手最近一次 collect 的结果。
 * 找不到返回 null，由调用方给出可操作的错误信息（而不是静默用空候选跑一遍）。
 */
export function findLatestStage(stagingDir: string, kind: StageKind, persona: string): string | null {
  if (!existsSync(stagingDir)) return null
  const prefix = `${STAGE_PREFIX[kind]}-${persona}-`
  const hits = readdirSync(stagingDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => join(stagingDir, f))
  if (hits.length === 0) return null
  hits.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return hits[0]!
}
