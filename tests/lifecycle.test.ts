import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { processTelegramUpdate, type TelegramUpdate } from '../src/feedback/receiver.js'
import { MemoryStore } from '../src/memory/store.js'
import type { SourceConfig } from '../src/types.js'

const sources: SourceConfig[] = [{ id: 's1', type: 'rss', url: '', weight: 0.5, enabled: true }]

describe('进程生命周期（V1 回归守卫）', () => {
  it('长驻轮询器必须看见后续 runOnce 写入的 ref——store 不许跨进程存活', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-lc-'))
    // 模拟进程启动时创建的长驻 store（旧实现：pollFeedback 持有它整个进程）
    const staleStore = new MemoryStore(dir)

    // runOnce 用自己的实例把 ref 写进盘上 archive.json
    const runOnceStore = new MemoryStore(dir)
    runOnceStore.recordItems(
      [{ id: 'i1', source: 's1', title: 't', body: '', url: 'u', publishedAt: 0, valueScore: 0.8, isNew: true, reason: '' }],
      1000,
    )
    runOnceStore.registerDigestRef('d1:0', 'd1', 'i1', 's1')

    // 真实回调到达。接收端必须从盘上重读，而不是用长驻快照
    const res = await processTelegramUpdate(
      { update_id: 1, callback_query: { id: 'c', data: 'fb:u:d1:0' } },
      { token: 't', memoryDir: dir, sources, fetchFn: async () => ({ ok: true, status: 200, text: async () => '{}' }), now: () => 1100 },
    )
    expect(res).toBe('recorded')
    void staleStore
    const fb = JSON.parse(readFileSync(join(dir, 'feedback.json'), 'utf8'))
    expect(fb).toHaveLength(1)
    expect(fb[0]).toMatchObject({ itemId: 'i1', source: 's1', signal: 'up' })
    expect(JSON.parse(readFileSync(join(dir, 'weights.json'), 'utf8')).weights.s1).toBeGreaterThan(0.5)
  })
})
