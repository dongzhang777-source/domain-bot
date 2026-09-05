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
  it('词边界守卫：英文子串不误报（storage/average 不命中 rag，upbeat 不命中 beat）', () => {
    const ragDomain: DomainConfig = { ...domain, keywords: ['rag', 'beat'] }
    // 包含 storage、average、upbeat，但不包含单独的 rag、beat
    expect(isRelevant(item('cloud storage optimization on average is upbeat'), ragDomain)).toBe(false)
    // 真实包含 rag 独立词时通过
    expect(isRelevant(item('modular RAG system architecture'), ragDomain)).toBe(true)
    // 中文关键词子串匹配正常工作
    const cnDomain: DomainConfig = { ...domain, keywords: ['大模型', '智能体'] }
    expect(isRelevant(item('新一代大模型与自主智能体发布'), cnDomain)).toBe(true)
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

  it('HeuristicScorer 词边界：storage 与 upbeat 不虚增 hits 计数', async () => {
    const scorer = new HeuristicScorer()
    const ragDomain: DomainConfig = { ...domain, keywords: ['rag'], signalWords: ['beat'] }
    const [res] = await scorer.score([item('cloud storage optimization with upbeat team')], ragDomain)
    // DB-11/D2：reason 语言随条目——英文条目产英文模板（不再是中文兜底）
    expect(res.reason).toBe('Related to your ai feed')
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
  it('解析 JSON 输出并夹紧分数；缺失项降级启发式（见下条测试）', async () => {
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

  it('LlmScorer 分批调用：25 条按 batchSize=10 切成 3 批', async () => {
    let calls = 0
    const scorer = new LlmScorer({
      baseUrl: 'http://mock/v1', apiKey: 'k', model: 'm', batchSize: 10,
      fetchFn: async () => {
        calls++
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '[]' } }] }) }
      },
    })
    const items = Array.from({ length: 25 }, (_, i) => item(`t${i} llm`))
    const res = await scorer.score(items, domain)
    expect(calls).toBe(3)
    expect(res).toHaveLength(25)          // 长度必须与输入严格对齐
  })

  it('某一批失败时降级到启发式，不影响其他批，不抛异常', async () => {
    let n = 0
    const scorer = new LlmScorer({
      baseUrl: 'http://mock/v1', apiKey: 'k', model: 'm', batchSize: 2,
      fetchFn: async () => {
        n++
        if (n === 2) return { ok: false, status: 500, text: async () => 'boom' }
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '[{"index":0,"score":0.9,"reason":"llm"},{"index":1,"score":0.9,"reason":"llm"}]' } }] }) }
      },
    })
    // ⚠️ 必须 6 条：batchSize=2 → 3 批，第 2 批失败，第 3 批必须仍正常。
    const res = await scorer.score(
      [item('a llm'), item('b llm'), item('c llm'), item('d llm'), item('e llm'), item('f llm')],
      domain,
    )
    expect(res).toHaveLength(6)
    expect(res[0]!.reason).toBe('llm')                    // 批 1 走 LLM
    expect(res[2]!.reason).toContain('Matches your interest')  // 批 2 降级到启发式（人话化模板，en 条目产英文）
    expect(res[3]!.reason).toContain('Matches your interest')  // 同批也降级（整批失败，不是单条）
    expect(res[4]!.reason).toBe('llm')                    // 批 3 仍正常 —— 这才是本测试的重点
  })

  it('LLM 返回 200 但漏答的条目降级到启发式，不再是常数 0.5（矩阵 P0-6）', async () => {
    const scorer = new LlmScorer({
      baseUrl: 'http://mock/v1', apiKey: 'k', model: 'm',
      // 只答 index 0，故意漏掉 index 1（真实 LLM 很常见的行为）
      fetchFn: async () => ({ ok: true, status: 200, text: async () =>
        JSON.stringify({ choices: [{ message: { content: '[{"index":0,"score":0.9,"reason":"llm"}]' } }] }) }),
    })
    const res = await scorer.score([item('a llm'), item('b inference benchmark release sota')], domain)
    expect(res).toHaveLength(2)
    expect(res[0]).toEqual({ valueScore: 0.9, reason: 'llm' })
    // 旧行为是 { valueScore: 0.5, reason: 'llm 输出缺失，取默认分' }。
    expect(res[1]!.valueScore).not.toBe(0.5)
    expect(res[1]!.valueScore).toBeCloseTo(0.6036, 3)   // 实跑值：kw=1, sig=3
    expect(res[1]!.reason).toContain('Matches your interest')
    expect(res[1]!.reason).toContain('llm 漏答')
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

  it('中文同事件跨源报道经 CJK 2-gram 聚成一簇（P2-2，agy-R1）', () => {
    const groups = clusterItems(
      [scored('机器之心：大模型推理优化实战发布', 0.9), scored('量子位 大模型推理优化实战 开源', 0.7), scored('美联储宣布加息 25 个基点', 0.5)],
      0.35,
    )
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveLength(2)
    expect(groups[0][0].title).toContain('机器之心')
  })
})
