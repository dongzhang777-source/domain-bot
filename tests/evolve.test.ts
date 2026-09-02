import { describe, expect, it } from 'vitest'
import { applyNovelty, applySourceWeight, sourceValue, updateWeights } from '../src/memory/evolve.js'
import type { SourceConfig } from '../src/types.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../src/memory/store.js'
import { refreshWeights } from '../src/memory/weights.js'

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

describe('refreshWeights 闸门', () => {
  it('无新反馈时不重算（防止每轮向 0.5 先验漂移冲淡已学信号）', () => {
    const store = new MemoryStore(mkdtempSync(join(tmpdir(), 'dbot-rw-')))
    store.saveWeights({ good: 0.9, noisy: 0.1 }, 0)
    // feedbackCount()=0 == processedFeedback=0 → 闸门关闭，原样返回（off 无存档值 → 回落 config 的 0.5）
    expect(refreshWeights(store, sources)).toEqual({ good: 0.9, noisy: 0.1, off: 0.5 })
  })

  it('有新反馈时重算并落盘，processedFeedback 前移，再调一次结果不变', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-rw2-'))
    const store = new MemoryStore(dir)
    store.recordFeedback({ itemId: 'i', digestId: 'd', source: 'good', signal: 'up', at: 1 })
    const next = refreshWeights(store, sources)
    expect(next.good).toBeGreaterThan(0.6)
    expect(store.weightsState().processedFeedback).toBe(1)
    expect(refreshWeights(store, sources)).toEqual(next)
  })
})

describe('applyNovelty', () => {
  it('旧闻降权 0.75，增量信息不变；且 applySourceWeight 语义未被动过', () => {
    expect(applyNovelty(0.8, true)).toBeCloseTo(0.8, 10)
    expect(applyNovelty(0.8, false)).toBeCloseTo(0.6, 10)
    expect(applySourceWeight(0.8, 1)).toBeCloseTo(1.2, 10)
  })
})
