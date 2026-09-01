import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../src/memory/store.js'
import type { ScoredItem } from '../src/types.js'

function scored(id: string, title: string): ScoredItem {
  return { id, source: 's1', title, body: '', url: '', publishedAt: 0, valueScore: 0.8, isNew: true, reason: '' }
}

function tempStore(): MemoryStore {
  return new MemoryStore(mkdtempSync(join(tmpdir(), 'dbot-')))
}

describe('MemoryStore', () => {
  it('新颖性判定：标题近似为旧闻', () => {
    const store = tempStore()
    store.recordItems([scored('1', 'OpenAI releases new reasoning model')], 1000)
    expect(store.isNovel({ id: '2', source: 's', title: 'OpenAI releases new reasoning model!', body: '', url: '', publishedAt: 0 })).toBe(false)
    expect(store.isNovel({ id: '3', source: 's', title: 'totally different cake topic', body: '', url: '', publishedAt: 0 })).toBe(true)
  })

  it('重复入库只刷新 lastSeen/hitCount；持久化可重载', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-'))
    const s1 = new MemoryStore(dir)
    s1.recordItems([scored('a', 'title one')], 1000)
    s1.recordItems([scored('a', 'title one')], 2000)
    const s2 = new MemoryStore(dir)
    const entry = s2.export().archive.entries.find((e) => e.id === 'a')
    expect(entry?.hitCount).toBe(2)
    expect(entry?.lastSeenAt).toBe(2000)
    expect(s2.knownIds().has('a')).toBe(true)
  })

  it('反馈按源聚合，可人工修正（直接改 JSON）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-'))
    const s1 = new MemoryStore(dir)
    s1.recordFeedback({ itemId: 'x', digestId: 'd1', source: 'rss-1', signal: 'up', at: 1 })
    s1.recordFeedback({ itemId: 'y', digestId: 'd1', source: 'rss-1', signal: 'down', at: 2 })
    s1.recordFeedback({ itemId: 'z', digestId: 'd1', source: 'gh-1', signal: 'up', at: 3 })

    const raw = JSON.parse(readFileSync(join(dir, 'feedback.json'), 'utf8')) as unknown[]
    raw.shift() // 人工修正：删掉最早一条
    writeFileSync(join(dir, 'feedback.json'), JSON.stringify(raw))

    const s2 = new MemoryStore(dir)
    expect(s2.feedbackBySource()).toEqual({ 'rss-1': { up: 0, down: 1 }, 'gh-1': { up: 1, down: 0 } })
  })

  it('权重持久化：saveWeights 后新实例能读回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-w-'))
    new MemoryStore(dir).saveWeights({ s1: 0.72 }, 3)
    expect(new MemoryStore(dir).weightsState()).toEqual({ weights: { s1: 0.72 }, processedFeedback: 3 })
  })

  it('digestRef 登记/解析', () => {
    const store = tempStore()
    store.registerDigestRef('d1:0', 'd1', 'item-1', 'rss-1')
    expect(store.resolveRef('d1:0')?.itemId).toBe('item-1')
    expect(store.resolveRef('nope')).toBeUndefined()
  })

  it('归档超过上限时按最近活跃裁剪', () => {
    const store = tempStore()
    for (let i = 0; i < 2100; i++) store.recordItems([scored(`id-${i}`, `unique title ${i}`)], i)
    expect(store.export().archive.entries.length).toBeLessThanOrEqual(2000)
    expect(store.export().archive.entries.some((e) => e.id === 'id-2099')).toBe(true)
  })
})
