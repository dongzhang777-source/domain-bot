import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  emptyState, interestOf, recordExpand, settleStaleExposures, loadState, saveState, ALPHA0, BETA0,
} from '../src/memory/interest.js'
import { MemoryStore } from '../src/memory/store.js'

describe('行为→兴趣映射（Beta 后验）', () => {
  it('新源先验 = α₀/(α₀+β₀) = 1/3：不因无数据被优待或误杀', () => {
    const s = emptyState()
    expect(interestOf(s, 'src-a')).toBeCloseTo(ALPHA0 / (ALPHA0 + BETA0))
    expect(interestOf(s, 'src-a')).toBeCloseTo(1 / 3)
  })

  it('单次曝光未展开只小幅拉低（0.25）——「没看到」不被误杀', () => {
    const s = emptyState()
    const c = (s.counts['src'] ??= { exposures: 0, expands: 0 })
    c.exposures += 1
    expect(interestOf(s, 'src')).toBeCloseTo(1 / 4)
  })

  it('连续 5 次曝光未展开显著下滑（0.125）——「多次不点击才默认不感兴趣」由后验自然涌现', () => {
    const s = emptyState()
    const c = (s.counts['src'] ??= { exposures: 0, expands: 0 })
    for (let i = 0; i < 5; i++) c.exposures += 1
    expect(interestOf(s, 'src')).toBeCloseTo(1 / 8)
  })

  it('展开是强证据：1 次曝光即展开 → interest 0.5，持续展开稳定高位（先验使逼近 1 变缓，防小样本过信）', () => {
    const s = emptyState()
    recordExpand(s, 'src')
    expect(interestOf(s, 'src')).toBeCloseTo(2 / 4)
    for (let i = 0; i < 9; i++) recordExpand(s, 'src')
    expect(interestOf(s, 'src')).toBeCloseTo(11 / 13) // (10+1)/(10+1+2) ≈ 0.846
    expect(interestOf(s, 'src')).toBeGreaterThan(0.8)
  })

  it('settleStaleExposures：过期未展开计弱负证据；已展开只补记账不重复计；幂等', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-interest-'))
    const now = 10_000_000_000
    const horizon = 24 * 60 * 60 * 1000
    const store = new MemoryStore(dir)
    const mk = (id: string, title: string, isNew: boolean, source: string) =>
      ({ id, source, title, body: '', url: 'u', publishedAt: 0, valueScore: 0.8, isNew, reason: '' })
    // 两份过期 digest：d-old1 已展开（engagement 流水），d-old2 未展开
    store.saveDigest({ id: 'dold1', generatedAt: now - 2 * horizon, clusters: [
      { ref: 'dold1:0', title: 'a', summary: 's', why: 'w', items: [mk('1', 'a', true, 'src-x')] },
    ] })
    store.saveDigest({ id: 'dold2', generatedAt: now - 2 * horizon, clusters: [
      { ref: 'dold2:0', title: 'b', summary: 's', why: 'w', items: [mk('2', 'b', false, 'src-y')] },
    ] })
    // 新 digest 未过期，不得结算
    store.saveDigest({ id: 'dnew', generatedAt: now, clusters: [
      { ref: 'dnew:0', title: 'c', summary: 's', why: 'w', items: [mk('3', 'c', false, 'src-z')] },
    ] })
    store.recordEngagement({ digestId: 'dold1', index: 0, source: 'src-x', at: now })

    const r1 = settleStaleExposures(dir, now)
    expect(r1.counted).toBe(1)              // dold2 未展开 → src-y 弱负证据
    expect(r1.alreadyExpanded).toBe(1)      // dold1 已展开 → 只补记账
    expect(loadState(dir).counts['src-y']!.exposures).toBe(1)
    expect(loadState(dir).counts['src-x']).toBeUndefined() // 展开的曝光已在 recordExpand 计，settle 不碰

    // 幂等：重复结算不再累计
    const r2 = settleStaleExposures(dir, now)
    expect(r2.counted).toBe(0)
    expect(r2.alreadyExpanded).toBe(0)
    expect(loadState(dir).counts['src-y']!.exposures).toBe(1)
  })

  it('状态落盘 roundtrip：loadState 读回 counts 与 settled（tmp+rename 原子写无残留）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-interest-io-'))
    const s = emptyState()
    s.counts['k'] = { exposures: 3, expands: 1 }
    s.settled.push('d:0')
    saveState(dir, s)
    const back = loadState(dir)
    expect(back.counts['k']).toEqual({ exposures: 3, expands: 1 })
    expect(back.settled).toEqual(['d:0'])
    expect(existsSync(join(dir, 'interest.json'))).toBe(true)
    expect(existsSync(join(dir, 'interest.json.tmp'))).toBe(false)
  })
})
