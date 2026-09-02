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
  /** enabled 源 id 清单（B′2）——sourceYield/zeroYieldSources 按它展开，skippedSources 里的源不重复计入 */
  enabledSourceIds?: string[]
  /** 各源本轮实际采集到的条数（B′2） */
  sourceFetched?: Record<string, number>
  /** 各源通过相关性过滤后的条数（B′2） */
  sourceRelevant?: Record<string, number>
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
  /** 按源产出（B′2）：fetched=采集条数，afterFilter=过相关性过滤条数。区分「源挂了」（skippedSources）/
   *  「活着但零相关」（zeroYieldSources）/「活着且有产出」——I-3 盲区 v2ex/bili 类隐形死源靠它显形 */
  sourceYield: Record<string, { fetched: number; afterFilter: number }>
  /** 采集成功（未抛错）但过滤后零产出的源 id（B′2）——I-3 新口径（B′1）的分子之一 */
  zeroYieldSources: string[]
  candidateP50: number
  candidateP90: number
  candidateTop1: number
  /** 原始分分位数。权重上升会推高加权 P50 造成"进化生效"的闭环自证——判定进化只看原始分 */
  rawP50: number
  /** 原始分 P90（I-4 案 B 标定与联合标定的分布读数，2026-09-02 决策点 7） */
  rawP90: number
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
  // B′2：按源产出与零产出源。源挂了在 skippedSources 里，不重复计入 zeroYieldSources。
  const sourceYield: Record<string, { fetched: number; afterFilter: number }> = {}
  const zeroYieldSources: string[] = []
  for (const id of input.enabledSourceIds ?? []) {
    if (input.skippedSources.includes(id)) continue
    const fetched = input.sourceFetched?.[id] ?? 0
    const afterFilter = input.sourceRelevant?.[id] ?? 0
    sourceYield[id] = { fetched, afterFilter }
    if (afterFilter === 0) zeroYieldSources.push(id)
  }
  return {
    at,
    candidates: candidates.length,
    pushed: pushed.length,
    collected,
    relevant,
    skippedSources,
    feedbackCount,
    sourceYield,
    zeroYieldSources,
    candidateP50: round3(quantile(cs, 0.5)),
    candidateP90: round3(quantile(cs, 0.9)),
    candidateTop1: round3(cs.length ? cs[cs.length - 1]! : 0),
    rawP50: round3(quantile(rs, 0.5)),
    rawP90: round3(quantile(rs, 0.9)),
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
