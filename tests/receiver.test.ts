import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { processTelegramUpdate, loadOffset, saveOffset, applyUpdates, type TelegramUpdate } from '../src/feedback/receiver.js'
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
    const res = await processTelegramUpdate(update, { token: 'tk', memoryDir: dir, sources, fetchFn, now: () => 1100 })

    expect(res).toBe('recorded')
    const fb = JSON.parse(readFileSync(join(dir, 'feedback.json'), 'utf8'))
    expect(fb).toHaveLength(1)
    expect(fb[0]).toMatchObject({ itemId: 'i1', digestId: 'd1', source: 's1', signal: 'up', at: 1100 })

    const w = JSON.parse(readFileSync(join(dir, 'weights.json'), 'utf8'))
    expect(w.weights.s1).toBeGreaterThan(0.5)
    expect(typeof w.feedbackHash).toBe('string')
    expect(w.feedbackHash).not.toBe('')
    expect(called.some((u) => u.includes('answerCallbackQuery'))).toBe(true)
  })

  it('无法解析 / 无对应 ref 的回调被忽略，不落盘', async () => {
    const { dir, store, fetchFn } = setup()
    void store
    const deps = { token: 't', memoryDir: dir, sources, fetchFn }
    expect(await processTelegramUpdate({ update_id: 1 }, deps)).toBe('ignored')
    expect(await processTelegramUpdate({ update_id: 2, callback_query: { id: 'c', data: 'garbage' } }, deps)).toBe('ignored')
    expect(await processTelegramUpdate({ update_id: 3, callback_query: { id: 'c', data: 'fb:u:nope' } }, deps)).toBe('ignored')
    expect(() => readFileSync(join(dir, 'feedback.json'), 'utf8')).toThrow()
  })

  it('同条同信号的重复 👍 去重不入账（C′10：重启重放/连点不得虚增 P-2 样本），改 👎 仍入账', async () => {
    const { dir, fetchFn } = setup()
    const deps = { token: 't', memoryDir: dir, sources, fetchFn, now: () => 1200 }
    const upd = (n: number): TelegramUpdate => ({ update_id: n, callback_query: { id: `c${n}`, data: 'fb:u:d1:0' } })
    await processTelegramUpdate(upd(1), deps)
    const w1 = JSON.parse(readFileSync(join(dir, 'weights.json'), 'utf8')).weights.s1
    await processTelegramUpdate(upd(2), deps)
    expect(JSON.parse(readFileSync(join(dir, 'feedback.json'), 'utf8'))).toHaveLength(1)
    const w2 = JSON.parse(readFileSync(join(dir, 'weights.json'), 'utf8')).weights.s1
    expect(w2).toBe(w1) // 重复信号零增量——旧断言「第二次 👍 继续累积」锁定的正是 §3.5① 的重复入账缺陷，随 C′10 一并解锁
    await processTelegramUpdate({ update_id: 3, callback_query: { id: 'c3', data: 'fb:d:d1:0' } }, deps)
    expect(JSON.parse(readFileSync(join(dir, 'feedback.json'), 'utf8'))).toHaveLength(2)
  })
})

describe('offset 持久化（C′10）', () => {
  it('空目录 loadOffset=0；saveOffset 后按重启语义读回', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-offset-'))
    expect(loadOffset(dir)).toBe(0)
    saveOffset(dir, 42)
    expect(loadOffset(dir)).toBe(42)
    expect(JSON.parse(readFileSync(join(dir, 'feedback-offset.json'), 'utf8'))).toEqual({ offset: 42 })
  })

  // 终审 P1-1 守卫（agy 线）：坏 offset 文件不得静默归零（会重放 24h 回调）——必须改名 .corrupt-* 留存，对齐 store.ts 的 D6 做法。
  it('坏 offset 文件：loadOffset 返回 0 且原文件被改名 .corrupt-* 留存（不静默清零）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-offset-corrupt-'))
    writeFileSync(join(dir, 'feedback-offset.json'), '{not valid json')
    expect(loadOffset(dir)).toBe(0)
    expect(existsSync(join(dir, 'feedback-offset.json'))).toBe(false) // 原路径已不存在
    const remaining = readdirSync(dir)
    expect(remaining.length).toBe(1)
    expect(remaining[0]).toMatch(/^feedback-offset\.json\.corrupt-\d+$/)
  })

  // 终审 P1-1 守卫：saveOffset 经 tmp+rename 原子写，崩溃窗口不产出截断文件（对齐 store.ts writeFileAtomic）。
  it('saveOffset 写入路径可被 loadOffset 正确读回（roundtrip）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-offset-atomic-'))
    saveOffset(dir, 99)
    expect(loadOffset(dir)).toBe(99)
    expect(readdirSync(dir)).toEqual(['feedback-offset.json']) // 无残留 .tmp
  })
})

describe('applyUpdates 逐条确认（D2，小巴 impl 审查）', () => {
  it('毒 update 重试 3 次后跳过，后续 update 仍处理；offset 逐条推进不卡队', async () => {
    const { dir, called } = setup()
    void called
    // c1 的 answerCallbackQuery 恒抛错 → update 1 是毒 update；c2 正常
    const deps = {
      token: 't', memoryDir: dir, sources, now: () => 900,
      fetchFn: async (url: string, init?: RequestInit) => {
        if (String(url).includes('answerCallbackQuery') && String(init?.body).includes('cq1')) {
          throw new Error('poison callback')
        }
        return { ok: true, status: 200, text: async () => '{}' }
      },
    }
    const errors: unknown[] = []
    const updates: TelegramUpdate[] = [
      { update_id: 1, callback_query: { id: 'cq1', data: 'fb:u:d1:0' } },
      { update_id: 2, callback_query: { id: 'cq2', data: 'vb:d9' } },
    ]
    await applyUpdates(deps, updates, { onError: (e) => errors.push(e), retryDelayMs: 1 })

    expect(errors.length).toBeGreaterThanOrEqual(3) // 毒 update 重试 3 次，每次都报错
    expect(loadOffset(dir)).toBe(3) // 两条都推进到位（毒的跳过但 offset 前移，不卡队）
    // update 1：反馈在抛错前已落盘，重试经 C′10 去重不重复入账
    expect(JSON.parse(readFileSync(join(dir, 'feedback.json'), 'utf8'))).toHaveLength(1)
    // update 2（👀）正常处理
    expect(JSON.parse(readFileSync(join(dir, 'views.json'), 'utf8'))).toHaveLength(1)
  })
})

describe('👀 已读回执路由（agy 三审 P0）', () => {
  it('vb 回调记 views.jsonl 不动权重；重复点击去重', async () => {
    const { readFileSync: rf } = await import('node:fs')
    const dir = mkdtempSync(join(tmpdir(), 'dbot-view-'))
    const deps = { token: 't', memoryDir: dir, sources, fetchFn: async () => ({ ok: true, status: 200, text: async () => '{}' }), now: () => 5000 }
    expect(await processTelegramUpdate({ update_id: 1, callback_query: { id: 'c1', data: 'vb:d9' } }, deps)).toBe('recorded')
    expect(await processTelegramUpdate({ update_id: 2, callback_query: { id: 'c2', data: 'vb:d9' } }, deps)).toBe('recorded')
    const views = JSON.parse(rf(join(dir, 'views.json'), 'utf8'))
    expect(views).toHaveLength(1)
    expect(views[0]).toEqual({ digestId: 'd9', at: 5000 })
    expect(existsSync(join(dir, 'weights.json'))).toBe(false) // 不动权重
    function existsSync(p: string) { try { rf(p) ; return true } catch { return false } }
  })
})
