import { itemId } from '../dedupe.js'
import type { FetchFn, RawItem, SourceConfig } from '../../types.js'
import { defaultFetch } from './rss.js'
import { TIMEOUTS, timeoutSignal, withSizeLimit } from './fetchUtil.js'

/** GitHub REST 搜索适配器（search/repositories）。url 直接放完整 API 查询串。 */
export async function fetchGithub(source: SourceConfig, fetchFn: FetchFn = defaultFetch): Promise<RawItem[]> {
  const res = await withSizeLimit(fetchFn, source.url, {
    signal: timeoutSignal(TIMEOUTS.collector),
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'domain-bot/0.1',
      'x-github-api-version': '2022-11-28',
    },
  }, { ssrfGuard: true })
  if (!res.ok) throw new Error(`github ${source.id}: HTTP ${res.status}`)
  const data = JSON.parse(await res.text()) as {
    items?: Array<{
      id: number
      full_name: string
      description?: string | null
      html_url: string
      created_at?: string
      pushed_at?: string
      stargazers_count?: number
      topics?: string[]
    }>
  }
  return (data.items ?? []).map((r) => {
    const description = (r.description ?? '').trim()
    // 标题用 `owner/repo: description` 而非光秃秃的 full_name。两个理由：
    // 1. `full_name` 常短于闸门1 的 minTitleChars（实测 `foo/llm-kit` 仅 11 码点 < 15），
    //    会被 `damaged:titleTooShort` 系统性误杀——整个 GitHub 渠道归零；
    // 2. DB-03 审计里真实入库的 GitHub 条目就是该形式
    //    （如 `ranxi2001/OfferPilot: 面向 AI Agent / LLM 工程面试的智能诊断 Agent`），
    //    且钩子/摘要需要 description 才有素材可写。
    const title = description ? `${r.full_name}: ${description}` : r.full_name
    const body = [description, r.stargazers_count ? `${r.stargazers_count} stars` : '', (r.topics ?? []).join(' ')]
      .filter(Boolean)
      .join(' · ')
    return {
      // 与其他适配器统一走规范 URL 派生：旧的 `gh-${r.id}` 虽稳定，但与 exa 抵回的同一仓库
      // （html_url）id 口径不同，跨渠道 dedupe 失效——DB-03 #158/#171 openai-agents-python 实证。
      id: itemId(r.html_url, title, body),
      source: source.id,
      title,
      body,
      url: r.html_url,
      publishedAt: Date.parse(r.created_at ?? '') || 0,
      raw: r,
    }
  })
}
