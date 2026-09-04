import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryStore } from './store.js'

/**
 * 行为→兴趣映射（2026-09-04 老张设计指令：「点击行为和用户兴趣之间的映射关系要靠高明的算法实现」）。
 *
 * 模型：每源 Beta-Bernoulli 兴趣后验
 *     interest(s) = (expands + α₀) / (exposures + α₀ + β₀)      α₀=1, β₀=2
 * - 一次推送条目 = 一次曝光；用户点 ▽ 展开 = 强证据（expands+1, exposures+1）；
 * - 曝光后 EXPOSURE_HORIZON 内未展开 = 弱负证据（仅 exposures+1）：单次不点击的拉低幅度随数据量
 *   衰减（1/(n+α₀+β₀)），持续多轮无响应后验才显著下滑——「多次不点击才默认不感兴趣」由此自然涌现，
 *   不是硬编码阈值；「没看到」与「不感兴趣」的混淆由弱负证据权重吸收；
 * - 新源先验 interest=1/3：不因无数据被优待或误杀。
 *
 * 第一版只算不放：兴趣分落盘 interest.json 供证据呈现与打磨审读，**不接入推送排序**——
 * 排序接入改变提炼管线行为（判定语义），待形态打磨收敛后定版。
 */

export const ALPHA0 = 1
export const BETA0 = 2
export const EXPOSURE_HORIZON_MS = 24 * 60 * 60 * 1000

export interface SourceEngagementCounts {
  exposures: number
  expands: number
}

export interface InterestState {
  counts: Record<string, SourceEngagementCounts>
  /** 已结算过曝光的 digestId:index——防重复结算（同一推送条目至多计一次未展开负证据） */
  settled: string[]
}

export function emptyState(): InterestState {
  return { counts: {}, settled: [] }
}

export function interestOf(state: InterestState, source: string): number {
  const c = state.counts[source]
  const exposures = c?.exposures ?? 0
  const expands = c?.expands ?? 0
  return (expands + ALPHA0) / (exposures + ALPHA0 + BETA0)
}

/** 展开动作：强证据（expands+1, exposures+1）。 */
export function recordExpand(state: InterestState, source: string): void {
  const c = (state.counts[source] ??= { exposures: 0, expands: 0 })
  c.expands += 1
  c.exposures += 1
}

export interface SettleResult {
  /** 本轮结算的「曝光未展开」条目数 */
  counted: number
  /** 其中已展开（只补记账，不计负证据）的条目数 */
  alreadyExpanded: number
}

/** 结算过期推送的曝光：generatedAt+horizon 已过且无展开 → exposures+1（弱负证据）。
 *  已展开的只补 settled 记账（recordExpand 时已计过曝光，不得重复）。幂等：settled 集合防重。 */
export function settleStaleExposures(dir: string, now: number, horizonMs = EXPOSURE_HORIZON_MS): SettleResult {
  const state = loadState(dir)
  const store = new MemoryStore(dir)
  const engaged = new Set(store.engagementAll().map((e) => `${e.digestId}:${e.index}`))
  const settled = new Set(state.settled)
  const result: SettleResult = { counted: 0, alreadyExpanded: 0 }
  for (const d of store.digestAll()) {
    if (d.generatedAt + horizonMs > now) continue
    for (let i = 0; i < d.clusters.length; i++) {
      const key = `${d.digestId}:${i}`
      if (settled.has(key)) continue
      settled.add(key)
      const src = d.clusters[i]!.source
      if (!src) continue
      if (engaged.has(key)) {
        result.alreadyExpanded++
        continue
      }
      const c = (state.counts[src] ??= { exposures: 0, expands: 0 })
      c.exposures += 1
      result.counted++
    }
  }
  state.settled = [...settled]
  saveState(dir, state)
  return result
}

const statePath = (dir: string) => join(dir, 'interest.json')

export function loadState(dir: string): InterestState {
  if (!existsSync(statePath(dir))) return emptyState()
  try {
    const raw = JSON.parse(readFileSync(statePath(dir), 'utf8')) as InterestState
    return { counts: raw.counts ?? {}, settled: raw.settled ?? [] }
  } catch {
    const bad = `${statePath(dir)}.corrupt-${Date.now()}`
    try {
      renameSync(statePath(dir), bad)
    } catch {
      /* 保留原文件，下次启动再试 */
    }
    console.error(`[interest] interest.json 解析失败，坏文件移至 ${bad}（不静默清零）`)
    return emptyState()
  }
}

export function saveState(dir: string, state: InterestState): void {
  mkdirSync(dir, { recursive: true })
  const tmp = `${statePath(dir)}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, statePath(dir))
}

export function recordExpandToDisk(dir: string, source: string): number {
  const state = loadState(dir)
  recordExpand(state, source)
  saveState(dir, state)
  return interestOf(state, source)
}
