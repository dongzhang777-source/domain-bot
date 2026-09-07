import { describe, expect, it } from 'vitest'
import { fetchRss } from '../src/collector/adapters/rss.js'
import { fetchGithub } from '../src/collector/adapters/github.js'
import { itemId } from '../src/collector/dedupe.js'
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

  it('Atom 空 description 标签不阻断 summary 与 content:encoded 兜底（P2-2）', async () => {
    const xml = `<?xml version="1.0"?><feed>
      <entry>
        <title>Paper with empty description tag</title>
        <description></description>
        <summary>Real summary fallback content.</summary>
        <link href="http://arxiv.org/abs/2"/>
      </entry>
    </feed>`
    const items = await fetchRss(rssSource, mockFetch(xml))
    expect(items[0].body).toBe('Real summary fallback content.')
  })

  it('P1 feed 内危险 scheme 链接置空（2026-09-07 审查），条目保留', async () => {
    const xml = `<?xml version="1.0"?><rss><channel><item>
      <title>evil link in feed</title>
      <description>body here</description>
      <link>javascript:alert(1)</link>
      <pubDate>Tue, 01 Sep 2026 00:00:00 GMT</pubDate>
    </item></channel></rss>`
    const items = await fetchRss(rssSource, mockFetch(xml))
    expect(items).toHaveLength(1)
    expect(items[0].url).toBe('')
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
    // id 契约已从 `gh-${r.id}` 改为规范 URL 派生（itemId）。
    // 根因：同一仓库经 github 与 exa 双渠道抓回时，旧口径两边 id 不同 → 跨渠道 dedupe 失效
    //（DB-03 #158/#171 openai-agents-python 实证）。故此处断言「派生自 URL」而非写死哈希值。
    expect(items[0].id).toBe(itemId('https://github.com/foo/llm-kit', items[0].title, items[0].body))
    expect(items[0].id.startsWith('u-')).toBe(true)
    // 标题是 `owner/repo: description`，不是光秃秃的 full_name。
    // 根因：`foo/llm-kit` 仅 11 码点 < 闸门1 的 minTitleChars(15)，会被
    // `damaged:titleTooShort` 系统性误杀——整个 GitHub 渠道归零（实测踩过）。
    expect(items[0].title).toBe('foo/llm-kit: Toolkit for local LLM inference')
    expect(items[0].body).toContain('120 stars')
    expect(items[0].body).toContain('inference')
  })

  it('description 为空时标题退回 full_name（不拼出 `repo: ` 尾巴）', async () => {
    const body = JSON.stringify({
      items: [{ id: 9, full_name: 'bar/empty-repo', description: null, html_url: 'https://github.com/bar/empty-repo', stargazers_count: 0, topics: [] }],
    })
    const source: SourceConfig = { id: 'gh-2', type: 'github', url: 'https://api.github.com/search', weight: 0.5, enabled: true }
    const items = await fetchGithub(source, mockFetch(body))
    expect(items[0].title).toBe('bar/empty-repo')
    expect(items[0].title).not.toContain(': ')
  })

  it('id 对跟踪参数与 www 前缀不敏感：跨渠道同一仓库必得同一 id', () => {
    // 这条是本次契约变更的真正目的，比上一条的格式断言更承重
    const a = itemId('https://github.com/foo/llm-kit', 'foo/llm-kit', 'Toolkit for local LLM inference')
    const b = itemId('https://github.com/foo/llm-kit?utm_source=newsletter&tab=readme-ov-file', 'foo/llm-kit', '完全不同的正文')
    const c = itemId('https://www.github.com/foo/llm-kit/', 'foo/llm-kit', 'yet another body')
    expect(b).toBe(a)
    expect(c).toBe(a)
  })
})
