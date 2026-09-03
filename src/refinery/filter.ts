import { normalizeText } from '../collector/dedupe.js'
import type { DomainConfig, RawItem } from '../types.js'

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff]/

/**
 * 判断标准化后的文本 hay（首尾带空格）是否命中关键词 k。
 * - 英文/ASCII 词/短语：执行严格词边界匹配（两端为空格，避免 storage 误命中 rag、upbeat 误命中 beat）；
 * - 包含 CJK 字符的关键词：保持子串匹配（中文连续无空格）。
 */
export function matchesKeyword(hay: string, keyword: string): boolean {
  const normK = normalizeText(keyword)
  if (!normK) return false
  if (CJK_PATTERN.test(normK)) {
    return hay.includes(normK)
  }
  return hay.includes(' ' + normK + ' ')
}

/** 相关性过滤：标题+正文命中任一领域关键词即通过（大小写/标点不敏感，英文遵循词边界）。 */
export function isRelevant(item: RawItem, domain: DomainConfig): boolean {
  const hay = ' ' + normalizeText(item.title + ' ' + item.body) + ' '
  return domain.keywords.some((k) => matchesKeyword(hay, k))
}

export function filterRelevant(items: RawItem[], domain: DomainConfig): { kept: RawItem[]; dropped: number } {
  const kept = items.filter((i) => isRelevant(i, domain))
  return { kept, dropped: items.length - kept.length }
}
