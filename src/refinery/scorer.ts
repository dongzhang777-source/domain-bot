import { normalizeText } from '../collector/dedupe.js'
import type { DomainConfig, FetchFn, RawItem } from '../types.js'
import { defaultFetch } from '../collector/adapters/rss.js'

export interface ScoreResult {
  valueScore: number
  reason: string
}

export interface Scorer {
  readonly name: string
  score(items: RawItem[], domain: DomainConfig): Promise<ScoreResult[]>
}

/**
 * 启发式打分器（零成本兜底）：
 * 命中领域关键词数 + 信号词（release/benchmark/beat/SOTA/开源…）决定分数，用于冷启动和测试。
 */
export class HeuristicScorer implements Scorer {
  readonly name = 'heuristic'
  private signals = ['release', 'benchmark', 'sota', 'state-of-the-art', 'outperform', 'beat', 'open source', 'open-source', 'new model', 'breakthrough', 'surpass']

  async score(items: RawItem[], domain: DomainConfig): Promise<ScoreResult[]> {
    return items.map((item) => {
      const hay = ' ' + normalizeText(item.title + ' ' + item.body) + ' '
      const kwHits = domain.keywords.filter((k) => hay.includes(normalizeText(k))).length
      const signalHits = this.signals.filter((s) => hay.includes(s)).length
      const valueScore = Math.min(1, 0.3 + 0.15 * kwHits + 0.12 * signalHits)
      const reason = `关键词命中 ${kwHits}，信号词命中 ${signalHits}`
      return { valueScore, reason }
    })
  }
}

/**
 * LLM 打分器（OpenAI 兼容 /chat/completions）：
 * 对每条信息问三问——对领域决策有用？相对已知是否增量？是否反常识/高杠杆？
 * 输出 0-1 分 + 理由。解析失败按 0.5 处理，不阻塞管线。
 */
export class LlmScorer implements Scorer {
  readonly name = 'llm'

  constructor(
    private opts: { baseUrl: string; apiKey: string; model: string; fetchFn?: FetchFn },
  ) {}

  async score(items: RawItem[], domain: DomainConfig): Promise<ScoreResult[]> {
    if (items.length === 0) return []
    const prompt = [
      `领域：${domain.domain}。对下列每条信息打价值分（0~1），判断依据：`,
      `1) 对该领域内的人做决策是否有用；2) 是否新信息（而非旧闻复读）；3) 是否反常识或高杠杆。`,
      `只输出 JSON 数组：[{"index":0,"score":0.8,"reason":"一句话理由"}, ...]`,
      ``,
      ...items.map((it, i) => `[${i}] ${it.title}\n${it.body.slice(0, 600)}`),
    ].join('\n')

    const url = this.opts.baseUrl.replace(/\/$/, '') + '/chat/completions'
    const res = await (this.opts.fetchFn ?? defaultFetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify({
        model: this.opts.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
    })
    if (!res.ok) throw new Error(`llm scorer: HTTP ${res.status}`)
    const data = JSON.parse(await res.text()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content ?? ''
    const match = content.match(/\[[\s\S]*\]/)
    const parsed = match ? (JSON.parse(match[0]) as Array<{ index: number; score: number; reason?: string }>) : []

    const results: ScoreResult[] = items.map(() => ({ valueScore: 0.5, reason: 'llm 输出缺失，取默认分' }))
    for (const p of parsed) {
      if (typeof p.index === 'number' && p.index >= 0 && p.index < results.length) {
        results[p.index] = {
          valueScore: Math.max(0, Math.min(1, Number(p.score) || 0)),
          reason: p.reason ?? '',
        }
      }
    }
    return results
  }
}

export function makeScorerFromEnv(env: NodeJS.ProcessEnv = process.env): Scorer {
  if (env.DOMAIN_BOT_LLM_BASE_URL && env.DOMAIN_BOT_LLM_API_KEY && env.DOMAIN_BOT_LLM_MODEL) {
    return new LlmScorer({
      baseUrl: env.DOMAIN_BOT_LLM_BASE_URL,
      apiKey: env.DOMAIN_BOT_LLM_API_KEY,
      model: env.DOMAIN_BOT_LLM_MODEL,
    })
  }
  return new HeuristicScorer()
}
