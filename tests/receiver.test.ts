import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { processTelegramUpdate, type TelegramUpdate } from '../src/feedback/receiver.js'
import { MemoryStore } from '../src/memory/store.js'
import type { SourceConfig } from '../src/types.js'

const sources: SourceConfig[] = [
  { id: 's1', type: 'rss', url: '', weight: 0.5, enabled: true },
  { id: 's2', type: 'rss', url: '', weight: 0.5, enabled: true },
]

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'dbot-recv-'))
  const store = new MemoryStore(dir)
  store.recordItems(
    [{ id: 'i1', source: 's1', title: 't', body: '', url: 'u', publishedAt: 0, valueScore: 0.8, isNew: true, reason: '' }],
    1000,
  )
  store.registerDigestRef('d1:0', 'd1', 'i1', 's1')
  const called: string[] = []
  const fetchFn = async (url: string) => {
    called.push(String(url))
    return { ok: true, status: 200, text: async () => '{"ok":true,"result":[]}' }
  }
  return { dir, store, called, fetchFn }
}

describe('processTelegramUpdate', () => {
  it('👍 回调 → 反馈落盘 + 权重上升 + 回应 callbackQuery', async () => {
    const { dir, store, called, fetchFn } = setup()
    const update: TelegramUpdate = { update_id: 7, callback_query: { id: 'cq7', data: 'fb:u:d1:0' } }
    const res = await processTelegramUpdate(update, { token: 'tk', store, sources, fetchFn, now: () => 1100 })

    expect(res).toBe('recorded')
    const fb = JSON.parse(readFileSync(join(dir, 'feedback.json'), 'utf8'))
    expect(fb).toHaveLength(1)
    expect(fb[0]).toMatchObject({ itemId: 'i1', digestId: 'd1', source: 's1', signal: 'up', at: 1100 })

    const w = JSON.parse(readFileSync(join(dir, 'weights.json'), 'utf8'))
    expect(w.weights.s1).toBeGreaterThan(0.5)
    expect(w.processedFeedback).toBe(1)
    expect(called.some((u) => u.includes('answerCallbackQuery'))).toBe(true)
  })

  it('无法解析 / 无对应 ref 的回调被忽略，不落盘', async () => {
    const { dir, store, fetchFn } = setup()
    const deps = { token: 't', store, sources, fetchFn }
    expect(await processTelegramUpdate({ update_id: 1 }, deps)).toBe('ignored')
    expect(await processTelegramUpdate({ update_id: 2, callback_query: { id: 'c', data: 'garbage' } }, deps)).toBe('ignored')
    expect(await processTelegramUpdate({ update_id: 3, callback_query: { id: 'c', data: 'fb:u:nope' } }, deps)).toBe('ignored')
    expect(() => readFileSync(join(dir, 'feedback.json'), 'utf8')).toThrow()
  })

  it('第二次 👍 继续累积，权重单调上升', async () => {
    const { dir, store, fetchFn } = setup()
    const deps = { token: 't', store, sources, fetchFn, now: () => 1200 }
    const upd = (n: number): TelegramUpdate => ({ update_id: n, callback_query: { id: `c${n}`, data: 'fb:u:d1:0' } })
    await processTelegramUpdate(upd(1), deps)
    const w1 = JSON.parse(readFileSync(join(dir, 'weights.json'), 'utf8')).weights.s1
    await processTelegramUpdate(upd(2), deps)
    const w2 = JSON.parse(readFileSync(join(dir, 'weights.json'), 'utf8')).weights.s1
    expect(w2).toBeGreaterThan(w1)
  })
})
