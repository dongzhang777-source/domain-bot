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
  /** 每个事件簇内排名靠前（≤maxPerEvent）的条目，按分降序 */
  kept: T[]
  /**
   * 同事件超额条目：**降权而非丢弃**，排在 kept 之后。
   *
   * 为何改成降权（2026-09-04 真跑实测，三轮迭代后的结论）：
   * 词法单链接聚类无法可靠区分「同一新闻事件」与「同一研究领域」——真事件名
   * （Astra）天然被 15 条共享，领域词汇（language/multi/learning）也天然被 8-11 条共享，
   * 任何 df / 大写 / jaccard 阈值都分不开（实测扫 maxEntityDf：2→68 簇真事件也散、
   * 3→46 簇最大簇 66、20→24 簇最大簇 101）。
   *
   * 在判别不可靠的前提下，「丢弃」是危险的：真跑一轮 126 条候选被误杀 90-100 篇
   * 彼此独立的论文，而候选池薄时这些内容再也回不来（静默的内容贫困）。
   * 「降权」则两头都对：候选池厚时超额条目排在后面、被 maxItems 自然截掉（刷屏照样防住）；
   * 候选池薄时它们仍在产出里，不摧毁内容。
   *
   * 语义事件的精确归并交给 DB-05 的 LLM reviewer（它拿得到正文与全批上下文）。
   */
  demoted: T[]
  /** 独立事件簇数（看板用） */
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
export interface CapEventsOptions {
  /**
   * 背景文档频率表（token → 在全量采集里出现的条目数）与背景批大小。
   * 由 pipeline 从**过滤前**的 collected 算出后传入；分母口径的理由见
   * `src/gates/eventCluster.ts` 的 `ClusterOptions.backgroundDf`（真跑实测）。
   */
  backgroundDf?: ReadonlyMap<string, number>
  backgroundSize?: number
}

export function capEvents<T extends RawItem & { valueScore: number }>(
  items: T[],
  cfg: GatesConfig,
  opts: CapEventsOptions = {},
): EventCapResult<T> {
  const threshold = cfg.dedupe?.jaccardThreshold ?? 0.75
  const maxPerEvent = cfg.dedupe?.maxPerEvent ?? 2
  const stopwords = new Set(cfg.dedupe?.eventStopwords ?? [])

  // 先按分降序：簇内选留时自然取到高分项，且簇代表（key）就是最高分那条
  const sorted = [...items].sort((a, b) => b.valueScore - a.valueScore)
  const clusters = clusterByEntity(sorted, stopwords, {
    // 文档频率上限：防单链接传递闭包在千条级同质语料上塌缩
    //（真跑实测：126 条被塌成 24 簇、最大簇 101、误杀 100 条）
    maxEntityDf: cfg.dedupe?.maxEntityDf,
    maxEntityDfRatio: cfg.dedupe?.maxEntityDfRatio,
    backgroundDf: opts.backgroundDf,
    backgroundSize: opts.backgroundSize,
  })

  const kept: T[] = []
  const demoted: T[] = []
  const eventKeyOf = new Map<string, string>()

  for (const cluster of clusters) {
    // 簇代表 = 最高分那条（sorted 保证 cluster.items[0] 就是它）
    const rep = cluster.items[0]!
    const repTokens = tokenize(rep.title)
    let slotsUsed = 0

    for (const item of cluster.items) {
      eventKeyOf.set(item.id, cluster.key)
      // 补充判据：与簇代表标题几乎逐字相同 → 同一通稿原样转发，不另占坑。
      // 这一条是**高置信**的（jaccard≥0.75 意味着标题基本一样），保留降权处理。
      const isVerbatimRepost =
        item.id !== rep.id && jaccard(repTokens, tokenize(item.title)) >= threshold

      if (slotsUsed >= maxPerEvent || isVerbatimRepost) {
        demoted.push(item) // 降权，不丢弃
        continue
      }
      slotsUsed += 1
      kept.push(item)
    }
  }

  // 各自按分降序：上面是按簇遍历产出的，簇间顺序不等于全局分数顺序
  kept.sort((a, b) => b.valueScore - a.valueScore)
  demoted.sort((a, b) => b.valueScore - a.valueScore)

  return { kept, demoted, eventCount: clusters.length, eventKeyOf }
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
