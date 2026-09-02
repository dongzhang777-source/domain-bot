import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendObservation, observeRound } from '../src/memory/observe.js'
import type { ScoredItem } from '../src/types.js'

const mk = (id: string, source: string, valueScore: number, isNew = true): ScoredItem =>
  ({ id, source, title: id, body: '', url: '', publishedAt: 0, valueScore, isNew, reason: '' })

describe('observeRound', () => {
  it('记录候选池分布、原始分通道、饱和度与权重快照', () => {
    const cands = [mk('a', 's1', 1.0), mk('b', 's1', 0.9), mk('c', 's2', 0.5), mk('d', 's2', 0.3, false)]
    const raw = [0.8, 0.72, 0.4, 0.24] // 与 cands 一一对应的原始分
    const obs = observeRound({
      candidates: cands, rawScores: raw, pushed: [cands[0]!, cands[2]!], weights: { s1: 0.6, s2: 0.4 },
      at: 1000, collected: 50, relevant: 10, skippedSources: ['rss-x'], feedbackCount: 3,
    })
    expect(obs.candidates).toBe(4)
    expect(obs.pushed).toBe(2)
    expect(obs.collected).toBe(50)
    expect(obs.relevant).toBe(10)
    expect(obs.skippedSources).toEqual(['rss-x'])
    expect(obs.feedbackCount).toBe(3)
    // 加权通道
    expect(obs.candidateP50).toBe(0.9)
    expect(obs.candidateTop1).toBe(1.0)
    // 原始分通道（判定进化看这里，不是加权分）
    expect(obs.rawP50).toBe(0.72)
    expect(obs.rawP90).toBe(0.8)
    expect(obs.rawTop1).toBe(0.8)
    // 饱和度必须按原始分算（加权分会被学到的权重自己推高，误报饱和）
    expect(obs.saturationRate).toBe(0)
    expect(obs.isNewRate).toBe(0.75)
    expect(obs.pushedMean).toBe(0.75)
    expect(obs.bySource).toEqual({ s1: 1, s2: 1 })
    // B′2 未传按源数据时为空集（向后兼容）
    expect(obs.sourceYield).toEqual({})
    expect(obs.zeroYieldSources).toEqual([])
  })

  it('按源三元组与零产出源（B′2+D3）：区分源挂/纯重复(健康)/有新但零相关', () => {
    const obs = observeRound({
      candidates: [], rawScores: [], pushed: [], weights: {}, at: 1000, collected: 10, relevant: 3,
      skippedSources: ['dead-src'],
      enabledSourceIds: ['arxiv', 'v2ex', 'bili', 'dead-src', 'empty'],
      sourceFetched: { arxiv: 8, v2ex: 2, bili: 0, empty: 0 },
      sourceAfterDedupe: { arxiv: 5, v2ex: 2, bili: 0, empty: 0 },
      sourceRelevant: { arxiv: 3 },
    })
    expect(obs.sourceYield).toEqual({
      arxiv: { fetched: 8, afterDedupe: 5, afterFilter: 3 },
      v2ex: { fetched: 2, afterDedupe: 2, afterFilter: 0 },
      bili: { fetched: 0, afterDedupe: 0, afterFilter: 0 },
      empty: { fetched: 0, afterDedupe: 0, afterFilter: 0 },
    })
    // dead-src 属于 skippedSources（源挂了）；bili/empty 纯重复或返回空（afterDedupe=0）是健康状态，不进 zeroYield
    expect(obs.zeroYieldSources).toEqual(['v2ex'])
  })

  it('quantile 离散约定锁定（D7）：2 元素 P50=P90=上界', () => {
    const obs = observeRound({
      candidates: [mk('a', 's1', 0.2), mk('b', 's1', 0.9)], rawScores: [0.2, 0.9], pushed: [], weights: {},
      at: 1000, collected: 2, relevant: 2, skippedSources: [], feedbackCount: 0,
    })
    expect(obs.rawP50).toBe(0.9)
    expect(obs.rawP90).toBe(0.9)
  })

  it('空候选不炸（除零）', () => {
    const obs = observeRound({
      candidates: [], rawScores: [], pushed: [], weights: {}, at: 1000,
      collected: 0, relevant: 0, skippedSources: [], feedbackCount: 0,
    })
    expect(obs).toMatchObject({ candidates: 0, pushed: 0, saturationRate: 0, pushedMean: 0, candidateP50: 0, candidateTop1: 0, rawP50: 0, rawTop1: 0, isNewRate: 0 })
  })

  it('appendObservation 追加 JSONL，一行一轮', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-obs-'))
    appendObservation(dir, observeRound({ candidates: [mk('a', 's1', 0.8)], rawScores: [0.8], pushed: [], weights: {}, at: 1000, collected: 1, relevant: 1, skippedSources: [], feedbackCount: 0 }))
    appendObservation(dir, observeRound({ candidates: [mk('b', 's1', 0.9)], rawScores: [0.9], pushed: [], weights: {}, at: 2000, collected: 1, relevant: 1, skippedSources: [], feedbackCount: 0 }))
    const lines = readFileSync(join(dir, 'observations.jsonl'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!).at).toBe(2000)
  })
})
