import { contentHash } from '../dedupe.js'
import type { FetchFn, RawItem, SourceConfig } from '../../types.js'
import { defaultFetch } from './rss.js'
import { withSizeLimit } from './fetchUtil.js'

/** GitHub REST 搜索适配器（search/repositories）。url 直接放完整 API 查询串。 */
export async function fetchGithub(source: SourceConfig, fetchFn: FetchFn = defaultFetch): Promise<RawItem[]> {
  const res = await withSizeLimit(fetchFn, source.url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'domain-bot/0.1',
      'x-github-api-version': '2022-11-28',
    },
  })
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
    const title = r.full_name
    const body = [r.description ?? '', r.stargazers_count ? `${r.stargazers_count} stars` : '', (r.topics ?? []).join(' ')]
      .filter(Boolean)
      .join(' · ')
    return {
      id: `gh-${r.id}`,
      source: source.id,
      title,
      body,
      url: r.html_url,
      publishedAt: Date.parse(r.created_at ?? '') || 0,
      raw: r,
    }
  })
}
