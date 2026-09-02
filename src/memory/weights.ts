import { createHash } from 'node:crypto'
import type { FeedbackRecord, SourceConfig } from '../types.js'
import { updateWeights } from './evolve.js'
import type { MemoryStore } from './store.js'

/**
 * 反馈内容哈希：闸门令牌。用内容而不用计数——计数在"手工编辑 feedback.json 修正一条"时
 * 不变，会把用户的修正静默吞掉（V 评审场景 A）；内容一变哈希必变。
 */
export function feedbackContentHash(feedback: FeedbackRecord[]): string {
  return createHash('sha256').update(JSON.stringify(feedback)).digest('hex')
}

/**
 * 权重刷新的唯一入口：反馈内容有变化才重算并持久化。
 * 无变化时原样返回当前权重（config 值作首次先验），避免每轮向 0.5 回归冲淡已学信号。
 */
export function refreshWeights(store: MemoryStore, sources: SourceConfig[]): Record<string, number> {
  const state = store.weightsState()
  const current: Record<string, number> = {}
  for (const s of sources) current[s.id] = state.weights[s.id] ?? s.weight
  const currentHash = feedbackContentHash(store.feedbackAll())
  if (state.feedbackHash === currentHash) return current

  const base = sources.map((s) => ({ ...s, weight: current[s.id]! }))
  const next = updateWeights(base, store.feedbackBySource())
  store.saveWeights(next, currentHash)
  return next
}
