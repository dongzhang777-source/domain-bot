import { describe, expect, it } from 'vitest'
import { filterRelevant, isRelevant } from '../src/refinery/filter.js'
import { HeuristicScorer, LlmScorer } from '../src/refinery/scorer.js'
import { buildClusters, clusterItems } from '../src/refinery/cluster.js'
import type { DomainConfig, RawItem, ScoredItem } from '../src/types.js'

const domain: DomainConfig = {
  domain: 'ai',
  keywords: ['llm', 'inference'],
  scoreThreshold: 0.45,
  maxPerDigest: 6,
  clusterThreshold: 0.35,
}

function item(title: string, body = ''): RawItem {
  return { id: title, source: 's', title, body, url: '', publishedAt: 0 }
}

describe('filter', () => {
  it('命中关键词通过', () => {
    expect(isRelevant(item('New LLM inference trick'), domain)).toBe(true)
  })
  it('无关内容被滤掉', () => {
    const { kept, dropped } = filterRelevant([item('cake recipe'), item('llm serving guide')], domain)
    expect(kept).toHaveLength(1)
    expect(dropped).toBe(1)
  })
})

describe('HeuristicScorer', () => {
  it('关键词与信号词越多分越高', async () => {
    const scorer = new HeuristicScorer()
    const [weak, strong] = await scorer.score(
      [item('llm note'), item('llm inference benchmark, open source release, outperform SOTA')],
      domain,
    )
    expect(strong.valueScore).toBeGreaterThan(weak.valueScore)
    expect(strong.valueScore).toBeLessThanOrEqual(1)
  })

  it('打分不饱和：典型 arXiv 摘要不得触顶，且四个质量档位可区分', async () => {
    const scorer = new HeuristicScorer()
    const realDomain: DomainConfig = { ...domain, keywords: [
      'llm', 'large language model', 'inference', 'benchmark', 'transformer',
      'rag', 'retrieval', 'quantization', 'reasoning model', 'tokenizer',
    ] }
    const [arxiv, mid, press, weak] = await scorer.score([
      item('Attention Is All You Need Revisited: Efficient Transformer Inference',
        'We present a new benchmark for large language model inference with quantization and retrieval augmented generation. Our open source release outperforms SOTA on reasoning model tasks.'),
      item('A survey of retrieval augmented generation for llm', 'We review rag pipelines.'),
      item('New model release: open source llm beats SOTA on inference benchmark',
        'breakthrough outperform state-of-the-art open-source release benchmark'),
      item('Notes on tokenizer design', 'Some details.'),
    ], realDomain)
    // 旧公式下 arxiv 与 press 都是 1.000（零区分度）
    expect(arxiv!.valueScore).toBeLessThan(0.99)
    expect(press!.valueScore).toBeLessThan(0.99)
    expect(arxiv!.valueScore).toBeGreaterThan(press!.valueScore)
    expect(press!.valueScore).toBeGreaterThan(mid!.valueScore)
    expect(mid!.valueScore).toBeGreaterThan(weak!.valueScore)
  })

  it('饱和点上移：7 个关键词命中不得触顶 1.0', async () => {
    const scorer = new HeuristicScorer()
    const d: DomainConfig = { ...domain, keywords: ['k1','k2','k3','k4','k5','k6','k7','k8','k9'] }
    const [seven] = await scorer.score([item('k1 k2 k3 k4 k5 k6 k7 release benchmark sota outperform beat', '')], d)
    expect(seven!.valueScore).toBeLessThan(1)
  })

  it('signalWords 可从 config 覆盖（换领域不需改代码）', async () => {
    const scorer = new HeuristicScorer()
    const custom: DomainConfig = { ...domain, signalWords: ['涨价', '断供'] }
    const [hit, miss] = await scorer.score([
      item('llm 芯片涨价', ''), item('llm release benchmark sota', ''),
    ], custom)
    // 内置英文信号词已失效，自定义中文信号词生效
    expect(hit!.valueScore).toBeGreaterThan(miss!.valueScore)
  })
})

describe('LlmScorer', () => {
  it('解析 JSON 输出并夹紧分数；缺失项取默认 0.5', async () => {
    const scorer = new LlmScorer({
      baseUrl: 'http://mock/v1',
      apiKey: 'k',
      model: 'm',
      fetchFn: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: '前言 [{"index":1,"score":2.5,"reason":"强"},{"index":0,"score":-1}] 后语' } }],
          }),
      }),
    })
    const results = await scorer.score([item('a llm'), item('b llm')], domain)
    expect(results[0]).toEqual({ valueScore: 0, reason: '' })
    expect(results[1].valueScore).toBe(1)
  })
})

describe('cluster', () => {
  const scored = (title: string, value: number): ScoredItem => ({ ...item(title), valueScore: value, isNew: true, reason: '' })

  it('同事件改写聚成一簇，不同主题分开', () => {
    const groups = clusterItems(
      [scored('OpenAI releases new reasoning model', 0.9), scored('OpenAI Releases New Reasoning Model!', 0.7), scored('new cake recipe', 0.5)],
      0.35,
    )
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveLength(2)
    expect(groups[0][0].valueScore).toBeGreaterThanOrEqual(groups[0][1].valueScore)
  })

  it('buildClusters 生成 ref 和摘要', () => {
    const clusters = buildClusters([scored('llm guide', 0.8)], 0.35, 'abc')
    expect(clusters[0].ref).toBe('abc:0')
    expect(clusters[0].title).toBe('llm guide')
  })
})
