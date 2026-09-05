import { canonicalUrl } from '../collector/canonicalUrl.js'
import { jaccard, tokenize } from '../collector/dedupe.js'
import type { DropRecord, GatesConfig, RawItem } from '../types.js'
import { clusterByEntity } from './eventCluster.js'

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
  /** 独立事件簇数（看板用：kept 里有多少个独立事件） */
  eventCount: number
  /**
   * 每条 kept 归属的事件簇标识（按 item.id 索引）。
   *
   * 为何必需：Task 4 的 `gk:eventOversubscribed` 跨条目断言与 `GatekeeperInput.eventKey`
   * 都靠这个信息；不携带就会在渲染阶段断数据流。
   * 用 item.id 而非数组下标做键：下游经过排序/截断/递补后下标会变，id 不会。
   */
  eventKeyOf: Map<string, string>
}

/**
 * 同一事件在主信息流最多占 maxPerEvent 个坑。
 *
 * **主判据是实体词并查集（`clusterByEntity`），不是标题 jaccard**。实测依据见
 * `src/gates/eventCluster.ts` 文件头：DB-03 里 GPT-6 Astra 同事件 10 条真实标题的
 * 45 个配对最大 jaccard 仅 0.313，≥0.75 命中 0 条——jaccard 阈值不可调成有用。
 *
 * jaccard 降为**补充判据**：同簇内若两条标题 jaccard ≥ jaccardThreshold，
 * 视为同一通稿被原样转发（而非洗稿），合并只占 1 个坑而不是 2 个。
 *
 * 必须在打分之后、配额截断之前调用：保留的是每个事件里分最高的那几条，
 * 旧管线先截断后聚类（`src/index.ts` 旧版），于是 15 家媒体对同一事件的报道
 * 能吃满全部坑位，聚类形同虚设（DB-03 §2.5 缺失「主题编辑」）。
 */
export function capEvents<T extends RawItem & { valueScore: number }>(
  items: T[],
  cfg: GatesConfig,
): EventCapResult<T> {
  const threshold = cfg.dedupe?.jaccardThreshold ?? 0.75
  const maxPerEvent = cfg.dedupe?.maxPerEvent ?? 2
  const stopwords = new Set(cfg.dedupe?.eventStopwords ?? [])

  // 先按分降序：簇内选留时自然取到高分项，且簇代表（key）就是最高分那条
  const sorted = [...items].sort((a, b) => b.valueScore - a.valueScore)
  const clusters = clusterByEntity(sorted, stopwords)

  const kept: T[] = []
  const dropped: DropRecord[] = []
  const eventKeyOf = new Map<string, string>()

  for (const cluster of clusters) {
    // 簇代表 = 最高分那条（sorted 保证 cluster.items[0] 就是它）
    const rep = cluster.items[0]!
    const repTokens = tokenize(rep.title)
    let slotsUsed = 0

    for (const item of cluster.items) {
      // 补充判据：与簇代表标题几乎逐字相同 → 同一通稿原样转发，不另占坑
      const isVerbatimRepost =
        item.id !== rep.id && jaccard(repTokens, tokenize(item.title)) >= threshold

      if (slotsUsed >= maxPerEvent || isVerbatimRepost) {
        dropped.push(
          drop(
            item,
            isVerbatimRepost
              ? 'fingerprint:verbatimRepost'
              : `fingerprint:eventSaturated(>${maxPerEvent})`,
            isVerbatimRepost
              ? `与簇代表「${rep.title.slice(0, 40)}」标题 jaccard≥${threshold}，判为同一通稿原样转发`
              : `同事件报道已达上限 ${maxPerEvent} 条（事件簇 ${cluster.key}，共 ${cluster.items.length} 条），本条被降权剔除`,
          ),
        )
        // 被剔除的也记 eventKey：看板需要知道它们归属哪个事件
        eventKeyOf.set(item.id, cluster.key)
        continue
      }
      slotsUsed += 1
      kept.push(item)
      eventKeyOf.set(item.id, cluster.key)
    }
  }

  // kept 重新按分降序：上面是按簇遍历产出的，簇间顺序不等于全局分数顺序
  kept.sort((a, b) => b.valueScore - a.valueScore)

  return { kept, dropped, eventCount: clusters.length, eventKeyOf }
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
