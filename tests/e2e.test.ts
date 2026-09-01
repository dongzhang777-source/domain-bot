import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runOnce } from '../src/index.js'
import type { DomainConfig, SourceConfig } from '../src/types.js'

const RSS_XML = `<?xml version="1.0"?><rss><channel>
  <item><title>New LLM inference benchmark released</title><description>open source release, outperform SOTA</description><link>https://e.com/1</link></item>
  <item><title>Another LLM inference benchmark released</title><description>open source release, outperform SOTA</description><link>https://e.com/2</link></item>
  <item><title>chocolate cake recipe</title><description>delicious</description><link>https://e.com/3</link></item>
</channel></rss>`

const GH_JSON = JSON.stringify({
  items: [
    { id: 7, full_name: 'foo/llm-kit', description: 'local LLM inference toolkit', html_url: 'https://github.com/foo/llm-kit', created_at: '2026-08-30T00:00:00Z', stargazers_count: 50, topics: ['llm'] },
  ],
})

function mockFetch() {
  return async (url: string) => ({
    ok: true,
    status: 200,
    text: async () => (String(url).includes('api.github.com') ? GH_JSON : RSS_XML),
  })
}

const domain: DomainConfig = {
  domain: 'ai',
  keywords: ['llm', 'inference'],
  scoreThreshold: 0.45,
  maxPerDigest: 6,
  clusterThreshold: 0.35,
}

const sources: SourceConfig[] = [
  { id: 'rss-1', type: 'rss', url: 'http://e/rss', weight: 0.5, enabled: true },
  { id: 'gh-1', type: 'github', url: 'https://api.github.com/search/x', weight: 0.5, enabled: true },
]

describe('e2e: 采集 → 提炼 → 记忆 → 推送 → 反馈 → 进化', () => {
  it('第一轮：两源采集、噪音过滤、同事件聚成一簇、落盘推送', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-e2e-'))
    const outDir = join(dir, 'outbox')
    const r1 = await runOnce({ domain, sources, memoryDir: join(dir, 'memory'), outDir, fetchFn: mockFetch(), now: 1000 })

    expect(r1.stats.collected).toBe(4)
    expect(r1.stats.deduped).toBe(0)
    expect(r1.stats.relevant).toBe(3) // 蛋糕被滤掉
    expect(r1.stats.pushed).toBeGreaterThanOrEqual(2) // rss 两篇近似 → 一簇；github 一簇
    expect(existsSync(r1.pushedPaths[0]!)).toBe(true)

    const md = readFileSync(r1.pushedPaths[0]!, 'utf8')
    expect(md).toContain('LLM inference benchmark')
    expect(md).not.toContain('chocolate')

    const memory = JSON.parse(readFileSync(join(dir, 'memory', 'archive.json'), 'utf8')) as { entries: unknown[] }
    expect(memory.entries.length).toBeGreaterThan(0)
  })

  it('第二轮：同内容不再重复推送（去重 100%）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-e2e-'))
    const common = { domain, sources, memoryDir: join(dir, 'memory'), fetchFn: mockFetch() }
    await runOnce({ ...common, outDir: join(dir, 'out'), now: 1000 })
    const r2 = await runOnce({ ...common, outDir: join(dir, 'out'), now: 2000 })
    expect(r2.stats.pushed).toBe(0)
    expect(readdirSync(join(dir, 'out'))).toHaveLength(1)
  })

  it('反馈回路：👍 后源权重上升，进化可复算', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-e2e-'))
    const { MemoryStore } = await import('../src/memory/store.js')
    const { updateWeights } = await import('../src/memory/evolve.js')
    const r = await runOnce({ domain, sources, memoryDir: join(dir, 'memory'), fetchFn: mockFetch(), now: 1000 })
    const store = new MemoryStore(join(dir, 'memory'))

    // 模拟 Telegram 回调：ref → 记录反馈
    const ref = r.digest!.clusters[0]!.ref
    const resolved = store.resolveRef(ref)!
    store.recordFeedback({ itemId: resolved.itemId, digestId: resolved.digestId, source: resolved.source, signal: 'up', at: 1100 })

    const next = updateWeights(sources, store.feedbackBySource())
    const sourceOfCluster = resolved.source
    expect(next[sourceOfCluster]!).toBeGreaterThan(sources.find((s) => s.id === sourceOfCluster)!.weight)
  })

  it('每源配额：单一密集源不得霸占全部推送位', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-e2e-'))
    const rssFlood = `<?xml version="1.0"?><rss><channel>${Array.from({ length: 8 }, (_, i) =>
      `<item><title>LLM inference benchmark study number ${i} with open source release</title><description>llm inference outperform SOTA benchmark release ${i}</description><link>https://e.com/r${i}</link></item>`).join('')}</channel></rss>`
    const fetchFn = async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => (String(url).includes('api.github.com') ? GH_JSON : rssFlood),
    })
    const r = await runOnce({ domain, sources, memoryDir: join(dir, 'memory'), fetchFn, now: 3000 })
    const bySource = new Map<string, number>()
    for (const c of r.digest!.clusters) for (const it of c.items) bySource.set(it.source, (bySource.get(it.source) ?? 0) + 1)
    expect(bySource.get('rss-1')).toBeLessThanOrEqual(3)
    expect(bySource.get('gh-1')).toBeGreaterThanOrEqual(1)
  })
})
