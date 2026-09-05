import { normalizeText } from '../collector/dedupe.js'
import type { DomainConfig, FetchFn, RawItem } from '../types.js'
import { defaultFetch } from '../collector/adapters/rss.js'
import { TIMEOUTS, timeoutSignal } from '../collector/adapters/fetchUtil.js'
import { matchesKeyword } from './filter.js'
import { detectLang } from '../render/tuna.js'

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
    const signals = domain.signalWords?.length ? domain.signalWords : this.signals
    return items.map((item) => {
      const hay = ' ' + normalizeText(item.title + ' ' + item.body) + ' '
      const kwHits = domain.keywords.filter((k) => matchesKeyword(hay, k))
      const sigHits = signals.filter((s) => matchesKeyword(hay, s))
      // sqrt 压缩：命中数边际递减，避免关键词密集源（arXiv 摘要长）一律触顶 1.0
      const kwPart = Math.min(1, Math.sqrt(kwHits.length) / Math.sqrt(8))
      const sigPart = Math.min(1, Math.sqrt(sigHits.length) / Math.sqrt(6))
      const valueScore = 0.25 + 0.5 * kwPart + 0.25 * sigPart
      const reason = humanizeReason(kwHits, sigHits, domain.domain, detectLang(`${item.title}\n${item.body}`))
      return { valueScore, reason }
    })
  }
}

/** 启发式打分的「为什么推给你」人话化（tuna packages/brief static-why 同思路：模板拼装、永不抛错、
 *  永不空串）。机械计数（「关键词命中 2」）对用户决策零价值，2026-09-04 老张点评为「毫无吸引力」。
 *  LLM 打分器自带一句话理由，不走此模板。
 *  语言随条目（DB-11/D2）：英文帖配中文 why = L2 中英混排，模板按 lang 双语化。 */
function humanizeReason(kwHits: string[], sigHits: string[], domain: string, lang: 'zh' | 'en'): string {
  if (lang === 'en') {
    const kw = kwHits.slice(0, 2).join(', ')
    const sig = sigHits[0]
    if (kw && sig) return `Matches your interests in ${kw}, with a strong "${sig}" signal`
    if (kw) return `Matches your interest in ${kw}`
    if (sig) return `Strong "${sig}" signal in ${domain}`
    return `Related to your ${domain} feed`
  }
  const kw = kwHits.slice(0, 2).map((k) => `「${k}」`).join('')
  const sig = sigHits[0]
  if (kw && sig) return `聚焦你的关注点 ${kw}，并出现强信号「${sig}」`
  if (kw) return `聚焦你的关注点 ${kw}`
  if (sig) return `出现领域信号「${sig}」`
  return `与「${domain}」相关`
}

/**
 * LLM 打分器（OpenAI 兼容 /chat/completions）：
 * 对每条信息问三问——对领域决策有用？相对已知是否增量？是否反常识/高杠杆？
 * 输出 0-1 分 + 理由。解析失败按 0.5 处理，不阻塞管线。
 */
export class LlmScorer implements Scorer {
  readonly name = 'llm'

  constructor(
    private opts: { baseUrl: string; apiKey: string; model: string; batchSize?: number; fetchFn?: FetchFn },
  ) {}

  async score(items: RawItem[], domain: DomainConfig): Promise<ScoreResult[]> {
    const batchSize = this.opts.batchSize ?? 20
    const fallback = new HeuristicScorer()
    const out: ScoreResult[] = []
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      try {
        out.push(...(await this.scoreBatch(batch, domain)))
      } catch (err) {
        // 矩阵 P0-6：单批失败不得拖垮整轮（arXiv 单轮 ~100 条，一旦抛异常探针就断档）。
        console.error(`[scorer] llm 第 ${i / batchSize + 1} 批失败，降级启发式:`, err instanceof Error ? err.message : err)
        out.push(...(await fallback.score(batch, domain)))
      }
    }
    return out
  }

  /** 单批调用：LLM 已答的用 LLM 分，漏答的降级启发式（常数 0.5 会在观测序列里造假平台）。 */
  private async scoreBatch(items: RawItem[], domain: DomainConfig): Promise<ScoreResult[]> {
    if (items.length === 0) return []
    const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, ' ').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
    const prompt = [
      `领域：${domain.domain}。对下列每条信息打价值分（0~1），判断依据：`,
      `1) 对该领域内的人做决策是否有用；2) 是否新信息（而非旧闻复读）；3) 是否反常识或高杠杆。`,
      `只输出 JSON 数组：[{"index":0,"score":0.8,"reason":"一句话理由"}, ...]`,
      ``,
      ...items.map((it, i) => `[${i}] ${esc(it.title)}\n${esc(it.body.slice(0, 600))}`),
    ].join('\n')

    const url = this.opts.baseUrl.replace(/\/$/, '') + '/chat/completions'
    const res = await (this.opts.fetchFn ?? defaultFetch)(url, {
      signal: timeoutSignal(TIMEOUTS.scorer),
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

    const heuristic = await new HeuristicScorer().score(items, domain)
    const results: ScoreResult[] = heuristic.map((h) => ({
      valueScore: h.valueScore,
      reason: `${h.reason}（llm 漏答，已降级启发式）`,
    }))
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
      batchSize: Number(env.DOMAIN_BOT_LLM_BATCH_SIZE) || 20,
    })
  }
  return new HeuristicScorer()
}
