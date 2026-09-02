import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startBot } from '../src/index.js'
import type { DomainConfig, SourceConfig } from '../src/types.js'

const domain: DomainConfig = {
  domain: 'ai', keywords: ['llm', 'inference'], scoreThreshold: 0.45,
  maxPerDigest: 6, clusterThreshold: 0.35,
}
const sources: SourceConfig[] = [
  { id: 'rss-1', type: 'rss', url: 'http://e/rss', weight: 0.5, enabled: true },
  { id: 'gh-1', type: 'github', url: 'https://api.github.com/x', weight: 0.5, enabled: true },
]

const RSS_XML = `<?xml version="1.0"?><rss><channel><item><title>LLM inference benchmark released</title><description>open source release outperform SOTA</description><link>https://e.com/1</link></item></channel></rss>`
const GH_JSON = JSON.stringify({ items: [] })
const mockFetch = async (url: string) => ({
  ok: true, status: 200,
  text: async () => (String(url).includes('api.github.com') ? GH_JSON : RSS_XML),
})

describe('运行时可达性（hy3 条件 1）', () => {
  it('常驻 + 有 telegram 时，startBot 必须真的调用 pollFeedback（不只是文本存在）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-start-'))
    let pollCalled = false
    await startBot({
      domain, sources, memoryDir: join(dir, 'memory'), outDir: join(dir, 'out'),
      telegram: { token: 't', chatId: 'c' },
      once: false, maxRounds: 1, fetchFn: mockFetch,
      pollFeedbackFn: async () => { pollCalled = true; return new Promise(() => {}) },
    })
    expect(pollCalled).toBe(true)
  })

  it('--once 模式不启动反馈接收（与生产行为一致）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-start2-'))
    let pollCalled = false
    await startBot({
      domain, sources, memoryDir: join(dir, 'memory'), outDir: join(dir, 'out'),
      telegram: { token: 't', chatId: 'c' },
      once: true, fetchFn: mockFetch,
      pollFeedbackFn: async () => { pollCalled = true; return new Promise(() => {}) },
    })
    expect(pollCalled).toBe(false)
  })
})

describe('单实例锁（hy3 条件 2）', () => {
  it('同 memoryDir 第二次 acquire 必须抛错；持有人死后可接管', async () => {
    const { acquireLock, releaseLock } = await import('../src/runtime/lock.js')
    const { writeFileSync } = await import('node:fs')
    const dir = mkdtempSync(join(tmpdir(), 'dbot-lock-'))
    acquireLock(dir)
    expect(() => acquireLock(dir)).toThrow(/不允许并发运行/)
    releaseLock(dir)
    acquireLock(dir) // 释放后可重新持有
    releaseLock(dir)
    // 陈旧锁：写入一个几乎不可能存活的 PID，再 acquire 应接管成功
    writeFileSync(join(dir, '.lock'), '999999999')
    acquireLock(dir)
    releaseLock(dir)
  })
})
