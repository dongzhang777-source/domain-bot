import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendObservation, observeRound } from '../src/memory/observe.js'
import type { ScoredItem } from '../src/types.js'

const mk = (id: string, source: string, valueScore: number): ScoredItem =>
  ({ id, source, title: id, body: '', url: '', publishedAt: 0, valueScore, isNew: true, reason: '' })

describe('observeRound', () => {
  it('记录候选池分布、推送均值、饱和度与权重快照', () => {
    const cands = [mk('a', 's1', 1.0), mk('b', 's1', 0.9), mk('c', 's2', 0.5), mk('d', 's2', 0.3)]
    const obs = observeRound(cands, [cands[0]!, cands[2]!], { s1: 0.6, s2: 0.4 }, 1000)
    expect(obs.candidates).toBe(4)
    expect(obs.pushed).toBe(2)
    expect(obs.saturationRate).toBe(0.25)          // 1/4 条 >= 0.99
    expect(obs.pushedMean).toBe(0.75)              // (1.0 + 0.5) / 2
    expect(obs.bySource).toEqual({ s1: 1, s2: 1 })
    expect(obs.weights).toEqual({ s1: 0.6, s2: 0.4 })
    expect(obs.candidateP50).toBe(0.9)             // 升序 [0.3,0.5,0.9,1.0] 取 floor(0.5*4)=2
    expect(obs.candidateP90).toBe(1.0)
    expect(obs.candidateTop1).toBe(1.0)            // 候选池最高分
  })

  it('空候选不炸（除零）', () => {
    const obs = observeRound([], [], {}, 1000)
    expect(obs).toMatchObject({ candidates: 0, pushed: 0, saturationRate: 0, pushedMean: 0, candidateP50: 0, candidateTop1: 0 })
  })

  it('appendObservation 追加 JSONL，一行一轮', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-obs-'))
    appendObservation(dir, observeRound([mk('a', 's1', 0.8)], [], {}, 1000))
    appendObservation(dir, observeRound([mk('b', 's1', 0.9)], [], {}, 2000))
    const lines = readFileSync(join(dir, 'observations.jsonl'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!).at).toBe(2000)
  })
})
