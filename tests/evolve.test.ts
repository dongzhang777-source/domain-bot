import { describe, expect, it } from 'vitest'
import { applySourceWeight, sourceValue, updateWeights } from '../src/memory/evolve.js'
import type { SourceConfig } from '../src/types.js'

const sources: SourceConfig[] = [
  { id: 'good', type: 'rss', url: '', weight: 0.6, enabled: true },
  { id: 'noisy', type: 'rss', url: '', weight: 0.4, enabled: true },
  { id: 'off', type: 'rss', url: '', weight: 0.5, enabled: false },
]

describe('evolve', () => {
  it('Beta 平滑：1 条 👍 不会把值拉满，30 条 👍 趋近真实比例', () => {
    expect(sourceValue({ up: 1, down: 0 })).toBe(2 / 3)
    expect(sourceValue({ up: 30, down: 0 })).toBeCloseTo(31 / 32, 5)
    expect(sourceValue({ up: 0, down: 0 })).toBe(0.5)
  })

  it('权重向反馈均值缓慢移动，无反馈源缓慢回归 0.5 先验（不误杀）', () => {
    const next = updateWeights(sources, { good: { up: 9, down: 1 } }, 0.2)
    // good: target = (9+1)/(9+1+2) ≈ 0.833；w = 0.8*0.6 + 0.2*0.833 ≈ 0.647
    expect(next.good).toBeGreaterThan(0.6)
    expect(next.good).toBeLessThan(0.7)
    // 无反馈源：w = 0.8*0.4 + 0.2*0.5 = 0.42，向先验温和回归而非冻结
    expect(next.noisy).toBeCloseTo(0.42, 10)
    expect(next.off).toBeCloseTo(0.5, 10)
  })

  it('有效分随源权重放大', () => {
    expect(applySourceWeight(0.8, 1)).toBeCloseTo(1.2, 10)
    expect(applySourceWeight(0.8, 0)).toBeCloseTo(0.4, 10)
  })
})
