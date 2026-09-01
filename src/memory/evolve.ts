import type { SourceConfig } from '../types.js'

export interface SourceStats {
  up: number
  down: number
}

/**
 * Beta(1,1) 后验均值：信号量小时平滑（1 条 👍 不会把权重拉满），信号量大时趋近真实比例。
 * 这解决"个人每周几十次点击撑不起朴素 bandit"的抖动问题。
 */
export function sourceValue(stats: SourceStats): number {
  return (stats.up + 1) / (stats.up + stats.down + 2)
}

/** 源权重向后验均值缓慢移动（α 步长）。0 反馈的源保持在 0.5 附近，不会被误杀。 */
export function updateWeights(
  sources: SourceConfig[],
  stats: Record<string, SourceStats>,
  alpha = 0.2,
): Record<string, number> {
  const next: Record<string, number> = {}
  for (const s of sources) {
    const st = stats[s.id] ?? { up: 0, down: 0 }
    const target = sourceValue(st)
    next[s.id] = Math.min(1, Math.max(0, (1 - alpha) * s.weight + alpha * target))
  }
  return next
}

/** 有效分 = 价值分 × (0.5 + 源权重)：权重只调节放大倍数，好源/噪音源的分差温和累积。 */
export function applySourceWeight(valueScore: number, weight: number): number {
  return valueScore * (0.5 + weight)
}
