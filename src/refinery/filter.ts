import { matchesKeyword, toHaystack } from '../gates/textMatch.js'
import type { DomainConfig, RawItem } from '../types.js'

/**
 * @deprecated 本文件是「假闸门」，已退出生产路径。
 *
 * `isRelevant` / `filterRelevant` 的判据是「命中任一领域关键词即通过」
 * （原 `filter.ts:23` 的 `domain.keywords.some(...)`）。DB-03 审计实测这条闸门形同虚设：
 * - §2.1 铁证：`Show HN: Open-Source eInk Bike Computer`（电子墨水屏自行车码表）仅因正文
 *   提了一句 "...in the crazy things that AI..." 就全绿放行，还打出 0.79 高分排到第 16 条；
 * - Nature 基因组文章提一句 machine learning 同样「合规」（`neural`/`diffusion`/`agent`
 *   在生物医学语境是常规词，§2.3 失效模式 1）；
 * - 招聘帖与中转站广告天然包含最全的 AI 关键词，正向词越全它们分越高（失效模式 4）。
 *
 * 生产路径已改走 `src/gates/`（persona 前置 → 负向黑名单 → 多级关键词积分 → 规范 URL 去重）。
 * 本文件保留有两个原因：
 * 1. `matchesKeyword` 是纯文本匹配工具（CJK 子串 / 英文词边界），闸门与 HeuristicScorer 共用，
 *    此处 re-export 保持既有导入路径不断；
 * 2. `tests/refinery.test.ts` 的用例记录了词边界守卫行为（storage 不命中 rag、upbeat 不命中 beat），
 *    这份覆盖有价值，随 shim 一并保留。
 *
 * 新代码不得调用 isRelevant / filterRelevant。
 */
export { matchesKeyword, toHaystack }

/** @deprecated 见文件头。用 `src/gates/relevance.ts` 的 RelevanceGate 替代。 */
export function isRelevant(item: RawItem, domain: DomainConfig): boolean {
  const hay = toHaystack(item.title + ' ' + item.body)
  return domain.keywords.some((k) => matchesKeyword(hay, k))
}

/** @deprecated 见文件头。用 `src/gates/index.ts` 的 runGates 替代。 */
export function filterRelevant(items: RawItem[], domain: DomainConfig): { kept: RawItem[]; dropped: number } {
  const kept = items.filter((i) => isRelevant(i, domain))
  return { kept, dropped: items.length - kept.length }
}
