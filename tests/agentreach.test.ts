import { describe, expect, it } from 'vitest'
import { fetchBili, fetchExa, fetchJina, fetchV2ex, parseExaOutput } from '../src/collector/adapters/agentreach.js'
import type { SourceConfig } from '../src/types.js'

const src = (type: SourceConfig['type'], url = 'x'): SourceConfig => ({ id: `t-${type}`, type, url, weight: 0.5, enabled: true })

const EXA_OUTPUT = `Title: vLLM v0.28.0 Released | AIToolly
URL: https://aitoolly.com/vllm-v0280
Published: 2026-08-29T18:22:00.000Z
Author: N/A
Highlights:
The vLLM project announced a massive update.

- TTFT improved by approximately 60%.
---
Title: Another story
URL: https://example.com/2
Published: N/A
Author: N/A
Highlights:
Short body.
---`

describe('exa adapter（Agent-Reach 搜索通道）', () => {
  it('解析 Title/URL/Published/Highlights 块', () => {
    const items = parseExaOutput(EXA_OUTPUT, 'exa-1')
    expect(items).toHaveLength(2)
    expect(items[0]!.title).toContain('vLLM v0.28.0')
    expect(items[0]!.url).toBe('https://aitoolly.com/vllm-v0280')
    expect(items[0]!.publishedAt).toBe(Date.parse('2026-08-29T18:22:00.000Z'))
    expect(items[0]!.body).toContain('60%')
    expect(items[1]!.publishedAt).toBe(0)
  })

  it('经 spawnFn 调用 mcporter', async () => {
    let captured: { cmd: string; args: string[] } | undefined
    const items = await fetchExa(src('exa', 'llm news'), async (cmd, args) => {
      captured = { cmd, args }
      return { stdout: EXA_OUTPUT, stderr: '' }
    })
    expect(captured!.cmd).toBe('mcporter')
    expect(captured!.args.join(' ')).toContain('exa.web_search_exa')
    expect(captured!.args.join(' ')).toContain('llm news')
    expect(items).toHaveLength(2)
  })
})

describe('v2ex adapter（Agent-Reach 社区通道）', () => {
  it('解析热门话题 JSON', async () => {
    const body = JSON.stringify([
      { title: '有人用本地 LLM 搭知识库吗', url: 'https://v2ex.com/t/1', content: 'RAG 实践', created: 1790000000, member: { username: 'bob' }, node: { title: '程序员' } },
    ])
    const items = await fetchV2ex(src('v2ex'), async () => ({ ok: true, status: 200, text: async () => body }))
    expect(items[0]!.title).toContain('本地 LLM')
    expect(items[0]!.url).toBe('https://v2ex.com/t/1')
    expect(items[0]!.publishedAt).toBe(1790000000 * 1000)
    expect(items[0]!.body).toContain('RAG')
  })
})

describe('bili adapter（Agent-Reach 视频通道）', () => {
  it('解析 YAML 搜索结果', async () => {
    const yaml = `ok: true
schema_version: '1'
data:
- id: BV1uNk1YxEJQ
  bvid: BV1uNk1YxEJQ
  title: 大模型推理优化实战
  author: 某up主
  play: 3787277
  duration: '931:47'
- id: BV1HM7C6BEnF
  bvid: BV1HM7C6BEnF
  title: RAG 从入门到精通
  author: 另一位up主
  play: 42
  duration: '2420:45'`
    const items = await fetchBili(src('bili', '大模型'), async () => ({ stdout: yaml, stderr: '' }))
    expect(items).toHaveLength(2)
    expect(items[0]!.url).toBe('https://www.bilibili.com/video/BV1uNk1YxEJQ')
    expect(items[0]!.body).toContain('3,787,277')
    expect(items[1]!.title).toBe('RAG 从入门到精通')
  })
})

describe('jina adapter（Agent-Reach 网页阅读通道）', () => {
  it('读无 RSS 页面并提取标题/正文', async () => {
    const text = `Title: Daily Papers
URL Source: https://huggingface.co/papers
Markdown Content:
Top trending papers of the day. LLM agents everywhere.`
    const items = await fetchJina(src('jina', 'https://huggingface.co/papers'), async (url) => {
      expect(String(url)).toContain('r.jina.ai/https://huggingface.co/papers')
      return { ok: true, status: 200, text: async () => text }
    })
    expect(items[0]!.title).toBe('Daily Papers')
    expect(items[0]!.body).toContain('trending papers')
    expect(items[0]!.url).toBe('https://huggingface.co/papers')
  })
})

describe('jina adapter SSRF 防护', () => {
  it('拒绝非公开 HTTPS URL', async () => {
    await expect(fetchJina(src('jina', 'http://169.254.169.254/latest/meta-data/'), async () => ({ ok: true, status: 200, text: async () => '' }))).rejects.toThrow('SSRF')
    await expect(fetchJina(src('jina', 'https://127.0.0.1/x'), async () => ({ ok: true, status: 200, text: async () => '' }))).rejects.toThrow('SSRF')
    await expect(fetchJina(src('jina', 'ftp://example.com'), async () => ({ ok: true, status: 200, text: async () => '' }))).rejects.toThrow('SSRF')
    await expect(fetchJina(src('jina', 'https://10.0.0.5/secret'), async () => ({ ok: true, status: 200, text: async () => '' }))).rejects.toThrow('SSRF')
    await expect(fetchJina(src('jina', 'https://192.168.1.1/admin'), async () => ({ ok: true, status: 200, text: async () => '' }))).rejects.toThrow('SSRF')
    await expect(fetchJina(src('jina', 'https://user:pass@example.com/'), async () => ({ ok: true, status: 200, text: async () => '' }))).rejects.toThrow('SSRF')
  })
})
