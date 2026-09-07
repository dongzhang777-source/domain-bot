import { XMLParser } from 'fast-xml-parser'
import { itemId } from '../dedupe.js'
import type { FetchFn, RawItem, SourceConfig } from '../../types.js'

import { TIMEOUTS, isSafeLinkUrl, timeoutSignal, withSizeLimit } from './fetchUtil.js'

export const defaultFetch: FetchFn = (url, init) => fetch(url, init)

function text(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o['#text'] === 'string') return o['#text']
    if (typeof o['_'] === 'string') return o['_']
    return ''
  }
  return ''
}

/** Atom 的 link 可能是数组/对象，取 rel=alternate（或无 rel）的 href；RSS 直接取 link 文本。 */
function linkOf(e: Record<string, unknown>): string {
  const link = e.link
  if (typeof link === 'string') return link
  if (Array.isArray(link)) {
    const alternate = link.find((l) => typeof l === 'object' && l !== null && (l as Record<string, unknown>)['@_rel'] === 'alternate')
    if (alternate && typeof alternate === 'object') return String((alternate as Record<string, unknown>)['@_href'] ?? '')
    const anyLink = link.find((l) => typeof l === 'string' || (typeof l === 'object' && l !== null && (l as Record<string, unknown>)['@_href']))
    if (typeof anyLink === 'string') return anyLink
    if (typeof anyLink === 'object' && anyLink !== null) return String((anyLink as Record<string, unknown>)['@_href'] ?? '')
    return String(anyLink ?? '')
  }
  if (typeof link === 'object' && link !== null) return String((link as Record<string, unknown>)['@_href'] ?? '')
  return ''
}

/** 通用 RSS/Atom 适配器：RSS 2.0、Atom（含 arXiv）、GitHub releases.atom 都走这里。 */
export async function fetchRss(source: SourceConfig, fetchFn: FetchFn = defaultFetch): Promise<RawItem[]> {
  const res = await withSizeLimit(fetchFn, source.url, {
    signal: timeoutSignal(TIMEOUTS.collector),
    headers: { 'user-agent': 'domain-bot/0.1' },
  })
  if (!res.ok) throw new Error(`rss ${source.id}: HTTP ${res.status}`)
  const xml = await res.text()
  // 实体防护保持布尔默认档（maxExpansionDepth=10 等），仅调大总展开数：
  // 默认 1000 会误伤 Simon Willison 这类实体密集的合法大 feed（实测 1012）。
  const parsed = new XMLParser({
    ignoreAttributes: false,
    processEntities: {
      enabled: true,
      maxEntitySize: 10_000,
      maxExpansionDepth: 10,
      maxTotalExpansions: 20_000,
      maxExpandedLength: 100_000,
      maxEntityCount: 1000,
    },
  }).parse(xml)
  const rawList: unknown = parsed.rss?.channel?.item ?? parsed.feed?.entry ?? []
  const list: Record<string, unknown>[] = Array.isArray(rawList) ? rawList : rawList ? [rawList] : []
  return list.map((e) => {
    const title = text(e.title)
    const body = text(e.description) || text(e.summary) || text(e['content:encoded']) || ''
    const publishedAt = Date.parse(text(e.pubDate ?? e.updated ?? e.published ?? e['dc:date'])) || 0
    const rawUrl = linkOf(e)
    // P1（2026-09-07 审查）：feed 内 link 不校验 scheme，`javascript:` 可直达 tuna。
    // 非法 scheme 置空（itemId 回退内容哈希派生）；空串本就合法（linkOf 原样）。
    const url = isSafeLinkUrl(rawUrl) ? rawUrl : ''
    return {
      // 规范 URL 派生（非内容哈希）：同一篇报道经 rss 与 exa 双渠道抓回时正文略异，
      // 内容派生会得到两个 id → dedupe 放行 → DB-03 实测 12 条完全重复。
      id: itemId(url, title, body),
      source: source.id,
      title,
      body,
      url,
      publishedAt,
      raw: e,
    }
  })
}
