import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { runPipeline } from '../src/pipeline.js'
import { ANYSEARCH_MCP_URL } from '../src/collector/adapters/anysearch.js'
import type { DomainConfig, GatesConfig, PersonaConfig, SourceConfig } from '../src/types.js'

// vitest 下 os.tmpdir() 可能解析为相对路径，强制绝对（工具产物零容忍，2026-09-05 实测）。
const tmpBase = (): string => (isAbsolute(tmpdir()) ? tmpdir() : '/tmp')

/**
 * P0（2026-09-07 审查）：pipeline 的 anysearch 分支曾不转发 fetchFn，
 * 单测 mock 全旁路、必打真实网络。本文件钉死：mock fetchFn 必须被调用，
 * 且调用目标正是 MCP 端点。
 */
describe('P0 anysearch 分支必须转发 fetchFn（mock 不得旁路）', () => {
  const gates = JSON.parse(readFileSync(join(process.cwd(), 'config/gates.json'), 'utf8')) as GatesConfig
  const domain: DomainConfig = { domain: 'ai-llm', keywords: ['llm'], clusterThreshold: 0.35 }
  const sources: SourceConfig[] = [
    { id: 'as-1', type: 'anysearch', url: 'llm inference news', weight: 0.7, enabled: true, numResults: 5 },
  ]
  const persona: PersonaConfig = {
    id: 'deepthought',
    displayName: 'AI深度思想',
    domain: 'ai-llm',
    sources: ['as-1'],
    maxAgeHours: 720,
    maxItems: 5,
    minQualityScore: 1,
    clusterThreshold: 0.35,
    rejectRules: [],
  }
  const markdown = [
    '## Search Results (1 results)',
    '### 1. LLM inference runtime ships',
    '- **URL**: https://example.com/llm-news',
    'A fresh llm inference benchmark release with serving numbers.',
  ].join('\n')
  const rpc = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: markdown }] } })

  it('mock fetchFn 被调用且目标为 MCP 端点，解析条目进候选', async () => {
    process.env.ANYSEARCH_API_KEY = process.env.ANYSEARCH_API_KEY || 'test-key'
    const seen: string[] = []
    const r = await runPipeline({
      persona,
      gates,
      domain,
      sources,
      memoryDir: join(mkdtempSync(join(tmpBase(), 'dbot-asff-')), 'memory'),
      fetchFn: (async (url: string) => {
        seen.push(String(url))
        return { ok: true, status: 200, text: async () => rpc }
      }) as unknown as Parameters<typeof runPipeline>[0]['fetchFn'],
      now: Date.parse('2026-09-07T12:00:00Z'),
    })
    // 转发成立：mock 命中且正是 MCP URL（修前此处为 []，并外发真实网络）
    expect(seen).toContain(ANYSEARCH_MCP_URL)
    expect(r.candidates.some((c) => c.url === 'https://example.com/llm-news')).toBe(true)
  })
})
