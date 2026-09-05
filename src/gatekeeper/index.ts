import type { GatesConfig, PersonaConfig, ScoredItem } from '../types.js'
import type { WrittenCopy } from '../editorial/writer.js'
import {
  type AssertionVerdict,
  checkEventOversubscribed,
  isAccepted,
  rejectionOf,
  runAssertions,
} from './assertions.js'
import { BackfillPool } from './backfill.js'
import { renderPost } from './render.js'

export { BackfillPool } from './backfill.js'
export {
  checkEventOversubscribed,
  isAccepted,
  rejectionOf,
  runAssertions,
  type AssertionInput,
  type AssertionVerdict,
} from './assertions.js'
export { renderPost, renderPosts, type RenderContext } from './render.js'
export { writeBoard, type BoardInput, type QualityBoard } from './board.js'

/**
 * 主编终审编排：渲染 → 十条断言 → 递补 → 跨条目事件复检 → 重编号。
 *
 * 顺序不可调换的理由：
 * - **渲染先于断言**：机械截断/碎片钩子/浮点回显 只在渲染后存在；
 * - **递补项同样先渲染再过断言**：否则候补池里的垃圾会直接补进坑（DB-03 §3.4）；
 * - **事件复检在递补之后**：递补可能把同事件报道补进来，绕过 capEvents 的上限；
 * - **重编号在最后**：id 第三段是序号，递补会改变最终集合，提前编号会出现空洞或重复。
 */

export interface GatekeepOptions {
  persona: PersonaConfig
  gates: GatesConfig
  now: number
  /** 只含 [a-z0-9] 的摘要 id */
  digestId: string
  /** 跨产线共享的已发布指纹库 */
  knownCanonical?: ReadonlySet<string>
  /** capEvents 产出的 id → 事件簇标识 */
  eventKeyOf?: ReadonlyMap<string, string>
  /** 实体词聚类的通用词表，透传给渲染做实体卡钩子 */
  stopwords?: ReadonlySet<string>
  /**
   * AI 编辑部（DB-05）的文案产出，按 item.id 索引。缺省或查不到时走机械兜底。
   * LLM 文案与机械文案走**同一套终审断言**，不享受豁免。
   */
  copiesOf?: ReadonlyMap<string, WrittenCopy | null>
}

export interface RejectedRecord {
  itemId: string
  title: string
  url: string
  ruleId: string
  detail: string
  /** 是主池条目还是递补条目（看板需要区分「主池就烂」与「候补也烂」） */
  from: 'selected' | 'backfill'
}

export interface GatekeepResult {
  published: import('../types.js').GatekeeperInput[]
  rejected: RejectedRecord[]
  /** 否决按 ruleId 的计数分布 */
  rejectCounts: Record<string, number>
  backfilled: number
  poolExhausted: boolean
  /** 事件复检是否触发裁剪（触发说明递补绕过了 capEvents，属异常路径，看板要显式记） */
  eventTrimmed: number
}

export function gatekeep(selected: ScoredItem[], pool: ScoredItem[], opts: GatekeepOptions): GatekeepResult {
  const knownCanonical = opts.knownCanonical ?? new Set<string>()
  const rejected: RejectedRecord[] = []
  const accepted: Array<{ item: ScoredItem; from: 'selected' | 'backfill' }> = []
  const target = opts.persona.maxItems

  const judge = (item: ScoredItem): AssertionVerdict[] => {
    // 断言作用于渲染后条目；batch 用「已接受条目的 URL」，使 URL 唯一性断言随集合增长生效
    const rendered = renderOne(item, accepted.length, opts)
    return runAssertions(rendered, {
      persona: opts.persona,
      gates: opts.gates,
      now: opts.now,
      knownCanonical,
      batch: [...accepted.map((a) => ({ url: a.item.url })), { url: item.url }],
    })
  }

  for (const item of selected) {
    if (accepted.length >= target) break
    const verdicts = judge(item)
    if (isAccepted(verdicts)) {
      accepted.push({ item, from: 'selected' })
      continue
    }
    const r = rejectionOf(verdicts)!
    rejected.push({ itemId: item.id, title: item.title, url: item.url, ruleId: r.ruleId, detail: r.detail, from: 'selected' })
  }

  // 递补：主池被否决留下的坑，按分数从候补池补
  const backfill = new BackfillPool(pool)
  let backfilled = 0
  while (accepted.length < target && !backfill.exhausted) {
    const item = backfill.next()
    if (!item) break
    const verdicts = judge(item)
    if (isAccepted(verdicts)) {
      accepted.push({ item, from: 'backfill' })
      backfilled += 1
      continue
    }
    const r = rejectionOf(verdicts)!
    rejected.push({ itemId: item.id, title: item.title, url: item.url, ruleId: r.ruleId, detail: r.detail, from: 'backfill' })
  }

  // 事件复检：递补可能把同事件报道补进来，绕过 capEvents 的 maxPerEvent
  const trimmed = trimOversubscribedEvents(accepted, opts)
  const eventTrimmed = accepted.length - trimmed.length
  accepted.length = 0
  accepted.push(...trimmed)

  // 重编号：id 第三段必须连续无空洞（递补与事件裁剪都改变过集合）
  const published = accepted.map((a, index) => renderOne(a.item, index, opts))

  const rejectCounts: Record<string, number> = {}
  for (const r of rejected) rejectCounts[r.ruleId] = (rejectCounts[r.ruleId] ?? 0) + 1

  return {
    published,
    rejected,
    rejectCounts,
    backfilled,
    poolExhausted: backfill.exhausted,
    eventTrimmed,
  }
}

function renderOne(item: ScoredItem, index: number, opts: GatekeepOptions) {
  return renderPost(item, {
    persona: opts.persona,
    digestId: opts.digestId,
    index,
    eventKey: opts.eventKeyOf?.get(item.id) ?? item.id,
    stopwords: opts.stopwords,
    copy: opts.copiesOf?.get(item.id) ?? null,
  })
}

/**
 * 裁掉超额事件簇里分数最低的条目。
 * 用 valueScore 决定去留：保留的是每个事件里最有价值的那几条，不是先到的那几条。
 */
function trimOversubscribedEvents(
  accepted: Array<{ item: ScoredItem; from: 'selected' | 'backfill' }>,
  opts: GatekeepOptions,
): Array<{ item: ScoredItem; from: 'selected' | 'backfill' }> {
  const maxPerEvent = opts.gates.dedupe?.maxPerEvent ?? 2
  const counts = new Map<string, number>()
  const out: Array<{ item: ScoredItem; from: 'selected' | 'backfill' }> = []

  // 按分降序遍历：高分先占坑，低分的超额者被裁
  const sorted = [...accepted].sort((a, b) => b.item.valueScore - a.item.valueScore)
  for (const entry of sorted) {
    const key = opts.eventKeyOf?.get(entry.item.id) ?? entry.item.id
    const used = counts.get(key) ?? 0
    if (used >= maxPerEvent) continue
    counts.set(key, used + 1)
    out.push(entry)
  }
  return out
}

/** 供看板与测试直接复用的事件占位检查（对已渲染产出）。 */
export function eventOversubscribedOf(
  published: import('../types.js').GatekeeperInput[],
  gates: GatesConfig,
): AssertionVerdict {
  return checkEventOversubscribed(published, gates)
}
