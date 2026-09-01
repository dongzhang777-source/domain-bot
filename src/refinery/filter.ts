import { normalizeText } from '../collector/dedupe.js'
import type { DomainConfig, RawItem } from '../types.js'

/** 相关性过滤：标题+正文命中任一领域关键词即通过（大小写/标点不敏感）。 */
export function isRelevant(item: RawItem, domain: DomainConfig): boolean {
  const hay = ' ' + normalizeText(item.title + ' ' + item.body) + ' '
  return domain.keywords.some((k) => hay.includes(normalizeText(k)))
}

export function filterRelevant(items: RawItem[], domain: DomainConfig): { kept: RawItem[]; dropped: number } {
  const kept = items.filter((i) => isRelevant(i, domain))
  return { kept, dropped: items.length - kept.length }
}
