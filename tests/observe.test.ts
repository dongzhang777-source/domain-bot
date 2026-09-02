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
    expect(obs.rawTop1).toBe(0.8)
    // 饱和度必须按原始分算（加权分会被学到的权重自己推高，误报饱和）
    expect(obs.saturationRate).toBe(0)
    expect(obs.isNewRate).toBe(0.75)
    expect(obs.pushedMean).toBe(0.75)
    expect(obs.bySource).toEqual({ s1: 1, s2: 1 })
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
