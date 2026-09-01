import { jaccard, tokenize } from '../collector/dedupe.js'
import type { DigestCluster, ScoredItem } from '../types.js'

/**
 * 近似重复聚类：同一事件的多源报道/改写聚成一簇，只推一条代表作。
 * 贪心：按分数降序，与已有簇代表（簇内最高分项）标题 jaccard ≥ 阈值即并入。
 */
export function clusterItems(items: ScoredItem[], threshold: number): ScoredItem[][] {
  const sorted = [...items].sort((a, b) => b.valueScore - a.valueScore)
  const clusters: { rep: Set<string>; items: ScoredItem[] }[] = []
  for (const item of sorted) {
    const tokens = tokenize(item.title)
    const target = clusters.find((c) => jaccard(c.rep, tokens) >= threshold)
    if (target) {
      target.items.push(item)
    } else {
      clusters.push({ rep: tokens, items: [item] })
    }
  }
  return clusters.map((c) => c.items)
}

export function buildClusters(items: ScoredItem[], threshold: number, digestId: string): DigestCluster[] {
  return clusterItems(items, threshold).map((group, i) => {
    const top = group[0]
    return {
      ref: `${digestId}:${i}`,
      title: top.title,
      summary:
        group.length > 1
          ? `${top.body || top.title}（另有 ${group.length - 1} 条同主题来源）`
          : top.body || top.title,
      why: top.reason,
      items: group,
    }
  })
}
