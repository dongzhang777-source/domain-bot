import { XMLParser } from 'fast-xml-parser'
import { contentHash } from '../dedupe.js'
import type { FetchFn, RawItem, SourceConfig } from '../../types.js'

export const defaultFetch: FetchFn = (url, init) => fetch(url, init)

function text(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o['#text'] === 'string') return o['#text']
    if (typeof o['_'] === 'string') return o['_']
  }
  return ''
}

/** Atom 的 link 可能是数组/对象，取 rel=alternate（或无 rel）的 href；RSS 直接取 link 文本。 */
function linkOf(e: Record<string, unknown>): string {
  const link = e.link
  if (typeof link === 'string') return link
  if (Array.isArray(link)) {
    const alt = link.find(
      (l) => typeof l === 'object' && l !== null && (l as Record<string, unknown>)['@_rel'] === 'alternate',
    )
    const anyLink = alt ?? link[0]
    if (typeof anyLink === 'object' && anyLink !== null) return String((anyLink as Record<string, unknown>)['@_href'] ?? '')
    return String(anyLink ?? '')
  }
  if (typeof link === 'object' && link !== null) return String((link as Record<string, unknown>)['@_href'] ?? '')
  return ''
}

/** 通用 RSS/Atom 适配器：RSS 2.0、Atom（含 arXiv）、GitHub releases.atom 都走这里。 */
export async function fetchRss(source: SourceConfig, fetchFn: FetchFn = defaultFetch): Promise<RawItem[]> {
  const res = await fetchFn(source.url, { headers: { 'user-agent': 'domain-bot/0.1' } })
  if (!res.ok) throw new Error(`rss ${source.id}: HTTP ${res.status}`)
  const xml = await res.text()
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml)
  const rawList: unknown = parsed.rss?.channel?.item ?? parsed.feed?.entry ?? []
  const list: Record<string, unknown>[] = Array.isArray(rawList) ? rawList : rawList ? [rawList] : []
  return list.map((e) => {
    const title = text(e.title)
    const body = text(e.description ?? e.summary ?? e['content:encoded'] ?? '')
    const publishedAt = Date.parse(text(e.pubDate ?? e.updated ?? e.published ?? e['dc:date'])) || 0
    return {
      id: contentHash({ title, body }),
      source: source.id,
      title,
      body,
      url: linkOf(e),
      publishedAt,
      raw: e,
    }
  })
}
