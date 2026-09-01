import { describe, expect, it } from 'vitest'
import { contentHash, dedupe, jaccard, normalizeText, tokenize } from '../src/collector/dedupe.js'
import type { RawItem } from '../src/types.js'

function item(id: string, title: string, body = ''): RawItem {
  return { id, source: 's1', title, body, url: '', publishedAt: 0 }
}

describe('dedupe', () => {
  it('内容哈希对大小写、标点、URL 不敏感', () => {
    const a = contentHash({ title: 'New LLM Benchmark!', body: 'see https://x.com/abc' })
    const b = contentHash({ title: 'new llm benchmark', body: 'see ' })
    expect(a).toBe(b)
  })

  it('相同 id 只保留一次', () => {
    const { kept, droppedExact } = dedupe([item('a', 't1'), item('a', 't1-copy'), item('b', 't2')], new Set())
    expect(kept.map((i) => i.id)).toEqual(['a', 'b'])
    expect(droppedExact).toBe(1)
  })

  it('已归档的 id 被丢弃', () => {
    const { kept } = dedupe([item('a', 't1'), item('b', 't2')], new Set(['a']))
    expect(kept.map((i) => i.id)).toEqual(['b'])
  })

  it('近似重复不做去重（交给聚类环节）', () => {
    const a = item('a', 'OpenAI releases new reasoning model')
    const b = item('b', 'OpenAI Releases New Reasoning Model')
    expect(a.id).not.toBe(b.id)
    const { kept } = dedupe([a, b], new Set())
    expect(kept).toHaveLength(2)
  })

  it('jaccard 边界', () => {
    expect(jaccard(tokenize('hello world'), tokenize('hello world'))).toBe(1)
    expect(jaccard(tokenize('hello world'), tokenize('foo bar'))).toBe(0)
    expect(jaccard(new Set(), new Set())).toBe(0)
    expect(normalizeText('Hello, World! 123')).toBe('hello world 123')
  })
})
