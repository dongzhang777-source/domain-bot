import { canonicalUrl } from '../collector/canonicalUrl.js'
import { jaccard, tokenize } from '../collector/dedupe.js'
import type { DropRecord, GatesConfig, RawItem } from '../types.js'

/**
 * 门禁 3：URL 规范化指纹 + 标题指纹事件聚合。
 *
 * 两件不同的事，必须分开：
 *
 * 1. **精确去重（dedupeByCanonicalUrl）**：同一文档经多渠道抓回。旧实现只按 `item.id` 精确比对，
 *    而 id 曾是 `contentHash({title, body})` 内容派生 → 同一 URL 正文略异即算两条。
 *    DB-03 实测 200 条里 12 条一字不差的完全重复（6 组 URL 100% 重复），
 *    含 #174 microsoft/agent-framework 仅 URL 后缀带活动打点参数即被判为两条。
 *    id 已改由 itemId() 从规范 URL 派生，本层再按规范 URL 兜一次，防适配器口径漂移。
 *
 * 2. **事件聚合（capEvents）**：同一事件的多源报道/洗稿。**必须在打分之后、配额截断之前**执行——
 *    旧管线 `src/index.ts:106-115` 先按每源配额截到 6 条、`:128` 才 buildClusters，
 *    于是 15 家媒体对 GPT-6 Astra 的报道能吃满全部坑位，聚类形同虚设（DB-03 §2.5 缺失「主题编辑」）。
 */

export interface CanonicalDedupeResult {
  kept: RawItem[]
  dropped: DropRecord[]
}

/**
 * 按规范 URL 精确去重。
 * @param knownCanonical 已发布指纹库（跨产线共享），命中即一票否决——防同一事件在
 *   AI时事快线与 AI深度思想两条产线各出一条。
 */
export function dedupeByCanonicalUrl(
  items: RawItem[],
  knownCanonical: ReadonlySet<string> = new Set(),
): CanonicalDedupeResult {
  const kept: RawItem[] = []
  const dropped: DropRecord[] = []
  const seen = new Set<string>()

  for (const item of items) {
    const canon = canonicalUrl(item.url)
    // 无规范 URL（源未给 url 或 url 不可解析）不参与本层去重：
    // id 已由内容哈希派生，精确重复仍会被 dedupe() 的 id 比对拦住。
    if (!canon) {
      kept.push(item)
      continue
    }
    if (seen.has(canon)) {
      dropped.push(drop(item, 'fingerprint:duplicateUrlInBatch', `批内规范 URL 重复：${canon}`))
      continue
    }
    if (knownCanonical.has(canon)) {
      dropped.push(drop(item, 'fingerprint:alreadyPublished', `规范 URL 已在已发布指纹库中：${canon}`))
      continue
    }
    seen.add(canon)
    kept.push(item)
  }

  return { kept, dropped }
}

/** 提取本批全部规范 URL，供发布后写入共享指纹库。 */
export function collectCanonicalUrls(items: Array<{ url: string }>): string[] {
  const out: string[] = []
  for (const it of items) {
    const canon = canonicalUrl(it.url)
    if (canon) out.push(canon)
  }
  return out
}

export interface EventCapResult<T> {
  kept: T[]
  dropped: DropRecord[]
  /** 事件簇数（看板用：kept 里有多少个独立事件） */
  eventCount: number
}

/**
 * 同一事件在主信息流最多占 maxPerEvent 个坑。
 * 贪心：按 valueScore 降序，与已有事件代表（簇内最高分项）标题 jaccard ≥ 阈值即判同事件。
 *
 * 输入必须已按分数排好序或可排序——保留的是每个事件里分最高的那几条，不是先到的那几条。
 */
export function capEvents<T extends RawItem & { valueScore: number }>(
  items: T[],
  cfg: GatesConfig,
): EventCapResult<T> {
  const threshold = cfg.dedupe?.jaccardThreshold ?? 0.75
  const maxPerEvent = cfg.dedupe?.maxPerEvent ?? 2
  const sorted = [...items].sort((a, b) => b.valueScore - a.valueScore)

  const events: Array<{ tokens: Set<string>; count: number }> = []
  const kept: T[] = []
  const dropped: DropRecord[] = []

  for (const item of sorted) {
    const tokens = tokenize(item.title)
    const hit = events.find((e) => jaccard(e.tokens, tokens) >= threshold)
    if (hit) {
      if (hit.count >= maxPerEvent) {
        dropped.push(
          drop(
            item,
            `fingerprint:eventSaturated(>${maxPerEvent})`,
            `同事件报道已达上限 ${maxPerEvent} 条，本条为第 ${hit.count + 1} 条（标题 jaccard≥${threshold}）`,
          ),
        )
        continue
      }
      hit.count += 1
      kept.push(item)
      continue
    }
    events.push({ tokens, count: 1 })
    kept.push(item)
  }

  return { kept, dropped, eventCount: events.length }
}

function drop(item: RawItem, ruleId: string, reason: string): DropRecord {
  return {
    itemId: item.id,
    title: item.title,
    source: item.source,
    url: item.url,
    gate: 'fingerprint',
    ruleId,
    reason,
  }
}
