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
  /** 事件复检裁掉的条数（填充感知裁剪下，候选充足时才会 >0） */
  eventTrimmed: number
  /**
   * 本轮是否处于「填充模式」：候选不足以在 maxPerEvent 约束下填满 maxItems，
   * 于是放行同事件超额条目而不是发一个薄包。
   *
   * **必须显式暴露**：填充模式意味着本轮的防刷屏能力是降级的。隐式降级正是
   * DB-03 的老毛病（格式全绿但质量已塌），看板与 CLI 都要能一眼看出来。
   */
  eventFillMode: boolean
}

export function gatekeep(selected: ScoredItem[], pool: ScoredItem[], opts: GatekeepOptions): GatekeepResult {
  const knownCanonical = opts.knownCanonical ?? new Set<string>()
  const rejected: RejectedRecord[] = []
  const accepted: Array<{ item: ScoredItem; from: 'selected' | 'backfill' }> = []
  const target = opts.persona.maxItems
  const maxPerEvent = opts.gates.dedupe?.maxPerEvent ?? 2

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

  const eventKeyOfItem = (item: ScoredItem): string => opts.eventKeyOf?.get(item.id) ?? item.id
  const eventSlots = new Map<string, number>()
  /**
   * 事件超额而**暂未接受**的条目（已过十条断言，只是多样性排队）。
   *
   * 为何必须单独一档而不是直接拒：词法聚类判别不可靠（见 `capEvents` 的实测说明），
   * 把超额条目当垃圾拒掉会在候选薄时静默摧毁内容。它们只是**排序靠后**，
   * 候选充足时自然被 target 截掉，候选薄时再回填（宁发重复不发薄包）。
   */
  const deferred: Array<{ item: ScoredItem; from: 'selected' | 'backfill' }> = []

  /**
   * 尝试接受一条。返回 'accepted' / 'deferred'（事件超额）/ 'rejected'（断言不过）。
   *
   * **多样性在接受时就强制**，不是事后裁：旧实现按分数序取满 target 就停，
   * 于是可能在见到其他事件之前就用同事件条目填满 quota；事后的 trim
   * 又无法补回从未被接受的条目（实测：maxItems=2 时两条同事件直接占满，多样性零作用）。
   */
  const consider = (item: ScoredItem, from: 'selected' | 'backfill'): 'accepted' | 'deferred' | 'rejected' => {
    const verdicts = judge(item)
    if (!isAccepted(verdicts)) {
      const r = rejectionOf(verdicts)!
      rejected.push({ itemId: item.id, title: item.title, url: item.url, ruleId: r.ruleId, detail: r.detail, from })
      return 'rejected'
    }
    const key = eventKeyOfItem(item)
    const used = eventSlots.get(key) ?? 0
    if (used >= maxPerEvent) {
      deferred.push({ item, from })
      return 'deferred'
    }
    eventSlots.set(key, used + 1)
    accepted.push({ item, from })
    return 'accepted'
  }

  for (const item of selected) {
    if (accepted.length >= target) break
    consider(item, 'selected')
  }

  // 回填一：事件超额但已过断言的条目（进入填充模式）
  let eventFillMode = false
  for (const entry of deferred) {
    if (accepted.length >= target) break
    accepted.push(entry)
    eventFillMode = true
  }

  // 回填二：候补池（被 maxItems 截掉的），按分递补
  const backfill = new BackfillPool(pool)
  let backfilled = 0
  while (accepted.length < target && !backfill.exhausted) {
    const item = backfill.next()
    if (!item) break
    if (consider(item, 'backfill') === 'accepted') backfilled += 1
  }
  // 候补递补后可能又有空位（候补被拒），再给事件超额条目一次机会
  if (!backfill.exhausted || accepted.length < target) {
    for (const entry of deferred) {
      if (accepted.length >= target) break
      if (accepted.some((a) => a.item.id === entry.item.id)) continue
      accepted.push(entry)
      eventFillMode = true
    }
  }

  // 重编号：id 第三段必须连续无空洞（回填与递补都改变过集合）
  const published = accepted.map((a, index) => renderOne(a.item, index, opts))

  const rejectCounts: Record<string, number> = {}
  for (const r of rejected) rejectCounts[r.ruleId] = (rejectCounts[r.ruleId] ?? 0) + 1

  return {
    published,
    rejected,
    rejectCounts,
    backfilled,
    poolExhausted: backfill.exhausted,
    // 被降权但本轮未获回填的条数（= 因 target 已满而留在 deferred 里的）
    eventTrimmed: deferred.filter((d) => !accepted.some((a) => a.item.id === d.item.id)).length,
    eventFillMode,
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

/** 供看板与测试直接复用的事件占位检查（对已渲染产出）。 */
export function eventOversubscribedOf(
  published: import('../types.js').GatekeeperInput[],
  gates: GatesConfig,
): AssertionVerdict {
  return checkEventOversubscribed(published, gates)
}
