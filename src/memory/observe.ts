import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ScoredItem } from '../types.js'

export interface RoundInput {
  /** 加权后候选（阈值过滤后、配额截断前）——candidateP50 等字段保持此口径 */
  candidates: ScoredItem[]
  /** 与 candidates 一一对应的原始分（未乘源权重、未乘新颖性因子）——进化的读数必须看它 */
  rawScores: number[]
  pushed: ScoredItem[]
  weights: Record<string, number>
  at: number
  collected: number
  relevant: number
  skippedSources: string[]
  feedbackCount: number
}

export interface RoundObservation {
  at: number
  /** 阈值过滤后、配额截断前的候选数 */
  candidates: number
  pushed: number
  collected: number
  relevant: number
  /** 本轮采集失败的源 id——源挂掉与内容池枯竭靠它区分 */
  skippedSources: string[]
  feedbackCount: number
  candidateP50: number
  candidateP90: number
  candidateTop1: number
  /** 原始分分位数。权重上升会推高加权 P50 造成"进化生效"的闭环自证——判定进化只看原始分 */
  rawP50: number
  rawTop1: number
  pushedMean: number
  /** 候选池中**原始分**>=0.99 的比例（D 指出：用加权分算时，学习越成功误报越凶） */
  saturationRate: number
  /** 候选中 isNew 的比例 */
  isNewRate: number
  weights: Record<string, number>
  bySource: Record<string, number>
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(q * sortedAsc.length))]!
}

export function observeRound(input: RoundInput): RoundObservation {
  const { candidates, rawScores, pushed, weights, at, collected, relevant, skippedSources, feedbackCount } = input
  const cs = candidates.map((c) => c.valueScore).sort((a, b) => a - b)
  const rs = [...rawScores].sort((a, b) => a - b)
  const bySource: Record<string, number> = {}
  for (const p of pushed) bySource[p.source] = (bySource[p.source] ?? 0) + 1
  return {
    at,
    candidates: candidates.length,
    pushed: pushed.length,
    collected,
    relevant,
    skippedSources,
    feedbackCount,
    candidateP50: round3(quantile(cs, 0.5)),
    candidateP90: round3(quantile(cs, 0.9)),
    candidateTop1: round3(cs.length ? cs[cs.length - 1]! : 0),
    rawP50: round3(quantile(rs, 0.5)),
    rawTop1: round3(rs.length ? rs[rs.length - 1]! : 0),
    pushedMean: round3(pushed.length ? pushed.reduce((s, p) => s + p.valueScore, 0) / pushed.length : 0),
    saturationRate: round3(
      rs.length ? rs.filter((v) => v >= 0.99).length / rs.length : 0,
    ),
    isNewRate: round3(candidates.length ? candidates.filter((c) => c.isNew).length / candidates.length : 0),
    weights,
    bySource,
  }
}

/** 追加式 JSONL：一行一轮，不重写全文件，可直接 grep / 画图。 */
export function appendObservation(dir: string, obs: RoundObservation): void {
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, 'observations.jsonl'), JSON.stringify(obs) + '\n')
}
