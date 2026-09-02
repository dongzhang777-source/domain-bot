import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ScoredItem } from '../types.js'

export interface RoundObservation {
  at: number
  /** 阈值过滤后、配额截断前的候选数 —— 传送带消耗的直接读数 */
  candidates: number
  pushed: number
  candidateP50: number
  candidateP90: number
  /**
   * 候选池最高分。top1 稳定 + candidateP50 上升 → 进化在起作用（整体质量上提）；
   * top1 与 P50 同步下滑 → 内容池在枯竭（传送带未解干净）。
   * 只看 pushedMean 区分不了这两者——它被每源配额与聚类截断扭曲。
   */
  candidateTop1: number
  pushedMean: number
  /** 候选池中 valueScore>=0.99 的比例。持续 > 0.5 说明打分器又饱和了，此时其他观测全部不可信 */
  saturationRate: number
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

export function observeRound(
  candidates: ScoredItem[],
  pushed: ScoredItem[],
  weights: Record<string, number>,
  at: number,
): RoundObservation {
  const cs = candidates.map((c) => c.valueScore).sort((a, b) => a - b)
  const bySource: Record<string, number> = {}
  for (const p of pushed) bySource[p.source] = (bySource[p.source] ?? 0) + 1
  return {
    at,
    candidates: candidates.length,
    pushed: pushed.length,
    candidateP50: round3(quantile(cs, 0.5)),
    candidateP90: round3(quantile(cs, 0.9)),
    candidateTop1: round3(cs.length ? cs[cs.length - 1]! : 0),
    pushedMean: round3(pushed.length ? pushed.reduce((s, p) => s + p.valueScore, 0) / pushed.length : 0),
    saturationRate: round3(
      candidates.length ? candidates.filter((c) => c.valueScore >= 0.99).length / candidates.length : 0,
    ),
    weights,
    bySource,
  }
}

/** 追加式 JSONL：一行一轮，不重写全文件，可直接 grep / 画图。 */
export function appendObservation(dir: string, obs: RoundObservation): void {
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, 'observations.jsonl'), JSON.stringify(obs) + '\n')
}
