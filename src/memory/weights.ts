import type { SourceConfig } from '../types.js'
import { updateWeights } from './evolve.js'
import type { MemoryStore } from './store.js'

/**
 * 权重刷新的唯一入口：有新反馈才重算并持久化。
 * 无反馈时原样返回当前权重（config 值作首次先验），避免每轮向 0.5 回归冲淡已学信号。
 */
export function refreshWeights(store: MemoryStore, sources: SourceConfig[]): Record<string, number> {
  const state = store.weightsState()
  const current: Record<string, number> = {}
  for (const s of sources) current[s.id] = state.weights[s.id] ?? s.weight
  if (state.processedFeedback >= store.feedbackCount()) return current

  const base = sources.map((s) => ({ ...s, weight: current[s.id]! }))
  const next = updateWeights(base, store.feedbackBySource())
  store.saveWeights(next, store.feedbackCount())
  return next
}
