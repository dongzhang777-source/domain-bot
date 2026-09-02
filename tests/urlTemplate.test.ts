import { describe, expect, it } from 'vitest'
import { resolveSourceUrl } from '../src/collector/urlTemplate.js'

describe('resolveSourceUrl', () => {
  it('{{since_days:N}} 解析为距今 N 天的日期', () => {
    const now = Date.parse('2026-09-02T00:00:00Z')
    expect(resolveSourceUrl('https://api.github.com/search?q=created:%3E{{since_days:7}}', now))
      .toBe('https://api.github.com/search?q=created:%3E2026-08-26')
  })

  it('无模板的 URL 原样返回', () => {
    expect(resolveSourceUrl('http://export.arxiv.org/rss/cs.AI', Date.now())).toBe('http://export.arxiv.org/rss/cs.AI')
  })
})
