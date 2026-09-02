import { describe, expect, it } from 'vitest'
import { fetchBili, fetchExa, fetchJina, fetchJinaViaExa, fetchV2ex, fetchYtSearch, parseExaOutput, parseFetchedPage } from '../src/collector/adapters/agentreach.js'
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

describe('ytsearch adapter（Agent-Reach YouTube 通道，yt-dlp 零登录）', () => {
  const YT_LINES = [
    '{"id":"dQw4w9WgXcQ","title":"LLM Inference Explained","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","channel":"AI Channel","view_count":123456,"duration":600}',
    '{"id":"abc123","title":"RAG 从零搭建","webpage_url":"https://www.youtube.com/watch?v=abc123","uploader":"某up主"}',
    'not json at all',
    '{"title":"没有 url 的条目应被丢弃"}',
  ].join('\n')

  it('解析 yt-dlp --dump-json 行并做字段兜底', async () => {
    const items = await fetchYtSearch(src('ytsearch', 'llm inference'), async (cmd, args) => {
      expect(cmd).toBe('yt-dlp')
      expect(args.join(' ')).toContain('ytsearch5:llm inference')
      expect(args).toContain('--flat-playlist')
      return { stdout: YT_LINES, stderr: '' }
    })
    expect(items).toHaveLength(2)
    expect(items[0]!.title).toBe('LLM Inference Explained')
    expect(items[0]!.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(items[0]!.body).toContain('AI Channel')
    expect(items[0]!.body).toContain('123,456')
    expect(items[1]!.body).toContain('某up主')
    expect(items[1]!.body).toContain('0 次观看')
  })

  it('id 存在但 url 缺失时用 watch URL 兜底', async () => {
    const items = await fetchYtSearch(src('ytsearch'), async () => ({
      stdout: '{"id":"xyz","title":"只有 id"}',
      stderr: '',
    }))
    expect(items[0]!.url).toBe('https://www.youtube.com/watch?v=xyz')
  })
})

describe('jina adapter 失败重试链（exa.web_fetch_exa 兜底）', () => {
  const EXA_FETCH_OUTPUT = `# Anthropic Research
URL: https://www.anthropic.com/research

Interpretability research updates. New scaling law findings.`

  it('r.jina.ai 非 2xx 时走 exa 兜底并解析 Markdown', async () => {
    let spawned: { cmd: string; args: string[] } | undefined
    const items = await fetchJina(
      src('jina', 'https://www.anthropic.com/research'),
      async () => ({ ok: false, status: 401, text: async () => '' }),
      undefined,
      async (cmd, args) => {
        spawned = { cmd, args }
        return { stdout: EXA_FETCH_OUTPUT, stderr: '' }
      },
    )
    expect(spawned!.cmd).toBe('mcporter')
    expect(spawned!.args.join(' ')).toContain('exa.web_fetch_exa')
    expect(spawned!.args.join(' ')).toContain('anthropic.com')
    expect(items).toHaveLength(1)
    expect(items[0]!.title).toBe('Anthropic Research')
    expect(items[0]!.url).toBe('https://www.anthropic.com/research')
    expect(items[0]!.body).toContain('Interpretability')
  })

  it('r.jina.ai 网络异常时同样走兜底', async () => {
    const items = await fetchJina(
      src('jina', 'https://example.com/page'),
      async () => { throw new Error('network down') },
      undefined,
      async () => ({ stdout: '# Example Page\n\nBody here.', stderr: '' }),
    )
    expect(items[0]!.title).toBe('Example Page')
  })

  it('两条链都失败时报聚合错误', async () => {
    await expect(
      fetchJina(
        src('jina', 'https://example.com/page'),
        async () => ({ ok: false, status: 401, text: async () => '' }),
        undefined,
        async () => { throw new Error('spawn failed') },
      ),
    ).rejects.toThrow('exa 兜底也失败')
  })

  it('兜底不绕过 SSRF 防护', async () => {
    await expect(
      fetchJina(
        src('jina', 'https://169.254.169.254/meta'),
        async () => ({ ok: false, status: 401, text: async () => '' }),
        undefined,
        async () => ({ stdout: '# pwned', stderr: '' }),
      ),
    ).rejects.toThrow('SSRF')
  })
})

describe('parseFetchedPage', () => {
  it('无标题行时回落到 url', () => {
    const item = parseFetchedPage('plain text no heading', 's1', 'https://example.com')
    expect(item.title).toBe('https://example.com')
  })
})

describe('P2 修复回归（agy-R1）', () => {
  it('P2-1：upload_date 为数字等异常类型时不抛错，publishedAt 落 0', async () => {
    const items = await fetchYtSearch(src('ytsearch'), async () => ({
      stdout: '{"id":"x1","title":"异常日期类型","upload_date":20260902}',
      stderr: '',
    }))
    expect(items[0]!.publishedAt).toBe(0)
    expect(items[0]!.title).toBe('异常日期类型')
  })

  it('P2-1：合法 8 位 upload_date 正常解析', async () => {
    const items = await fetchYtSearch(src('ytsearch'), async () => ({
      stdout: '{"id":"x2","title":"正常日期","upload_date":"20260902"}',
      stderr: '',
    }))
    expect(items[0]!.publishedAt).toBe(Date.parse('2026-09-02'))
  })

  it('P2-3：fetchJinaViaExa 独立调用时自守 SSRF', async () => {
    await expect(
      fetchJinaViaExa(src('jina', 'https://192.168.1.1/admin'), async () => ({ stdout: '# pwned', stderr: '' })),
    ).rejects.toThrow('SSRF')
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
