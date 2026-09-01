import { describe, expect, it } from 'vitest'
import { fetchRss } from '../src/collector/adapters/rss.js'
import { fetchGithub } from '../src/collector/adapters/github.js'
import type { SourceConfig } from '../src/types.js'

const rssSource: SourceConfig = { id: 'rss-1', type: 'rss', url: 'http://example/rss', weight: 0.5, enabled: true }

function mockFetch(body: string, status = 200) {
  return async () => ({ ok: status < 400, status, text: async () => body })
}

describe('rss adapter', () => {
  it('解析 RSS 2.0', async () => {
    const xml = `<?xml version="1.0"?><rss><channel><item>
      <title>Model X beats benchmark</title>
      <description>A new model</description>
      <link>https://example.com/1</link>
      <pubDate>Tue, 01 Sep 2026 00:00:00 GMT</pubDate>
    </item></channel></rss>`
    const items = await fetchRss(rssSource, mockFetch(xml))
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Model X beats benchmark')
    expect(items[0].url).toBe('https://example.com/1')
    expect(items[0].publishedAt).toBe(Date.parse('Tue, 01 Sep 2026 00:00:00 GMT'))
    expect(items[0].source).toBe('rss-1')
  })

  it('解析 Atom（arXiv 风格，link 数组带 href 属性）', async () => {
    const xml = `<?xml version="1.0"?><feed>
      <entry>
        <title>Paper on quantization</title>
        <summary>We quantize LLMs.</summary>
        <link href="http://arxiv.org/abs/1" rel="alternate" type="text/html"/>
        <link href="http://arxiv.org/pdf/1" rel="related"/>
        <updated>2026-09-01T00:00:00Z</updated>
      </entry>
    </feed>`
    const items = await fetchRss(rssSource, mockFetch(xml))
    expect(items[0].url).toBe('http://arxiv.org/abs/1')
    expect(items[0].body).toContain('quantize')
  })

  it('HTTP 失败抛错（不吞异常，由编排层兜底）', async () => {
    await expect(fetchRss(rssSource, mockFetch('gone', 404))).rejects.toThrow('HTTP 404')
  })
})

describe('github adapter', () => {
  it('解析仓库搜索结果', async () => {
    const body = JSON.stringify({
      items: [
        {
          id: 42,
          full_name: 'foo/llm-kit',
          description: 'Toolkit for local LLM inference',
          html_url: 'https://github.com/foo/llm-kit',
          created_at: '2026-08-30T00:00:00Z',
          stargazers_count: 120,
          topics: ['llm', 'inference'],
        },
      ],
    })
    const source: SourceConfig = { id: 'gh-1', type: 'github', url: 'https://api.github.com/search', weight: 0.5, enabled: true }
    const items = await fetchGithub(source, mockFetch(body))
    expect(items[0].id).toBe('gh-42')
    expect(items[0].title).toBe('foo/llm-kit')
    expect(items[0].body).toContain('120 stars')
    expect(items[0].body).toContain('inference')
  })
})
