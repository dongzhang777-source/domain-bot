import type { DropRecord, GatesConfig, RawItem, RelevanceScore } from '../types.js'
import { matchesKeyword, toHaystack } from './textMatch.js'

/**
 * 门禁 2：多级关键词积分（取代「命中任一关键词即通过」的假闸门）。
 *
 * 旧闸门 `src/refinery/filter.ts:23` 是 `domain.keywords.some(...)`——命中任一即通过。
 * DB-03 §2.1 实测铁证：`Show HN: Open-Source eInk Bike Computer`（电子墨水屏自行车码表）
 * 仅因正文提了一句 "...in the crazy things that AI..." 就全绿放行，还打出 0.79 高分排到第 16 条。
 * Nature 基因组文章提一句 machine learning 同样「合规」。
 *
 * 本闸门的三条设计决定：
 * 1. **分档积分**：core +3 / ecosystem +1 / generic 0。泛词（ai/model/neural/tool）计 0 分，
 *    故单凭泛词永远过不了 minPoints=3 的门槛——这是击穿假闸门的关键。
 * 2. **标题加权**：只在正文命中（标题未命中）的 core 词降为 1 分、ecosystem 降为 0 分。
 *    专治 §2.3 失效模式 2「边角料 Mentions 污染」：传统硬件项目顺带提一句用 AI 辅助，
 *    正文命中三个 core 词才够 3 分，而标题命中的一个 core 词就够。
 * 3. **同词不重复计分**：一个词在标题与正文各出现一次只算一次（取标题优先）。
 */

/** 只在正文命中时的降权分：core 3→1，ecosystem 1→0，generic 恒 0。 */
const BODY_ONLY_POINTS: Record<'core' | 'ecosystem' | 'generic', number> = {
  core: 1,
  ecosystem: 0,
  generic: 0,
}

export interface RelevanceVerdict {
  passed: boolean
  score: RelevanceScore
  reason: string
}

export class RelevanceGate {
  private readonly tiers: GatesConfig['keywordTiers']

  constructor(private readonly cfg: GatesConfig) {
    this.tiers = cfg.keywordTiers ?? []
  }

  /** 逐档扫描，返回积分与命中明细（可解释字段，供看板与调试）。 */
  score(item: RawItem): RelevanceScore {
    const titleHay = toHaystack(item.title ?? '')
    const bodyHay = toHaystack(item.body ?? '')
    const hits: RelevanceScore['hits'] = []
    let points = 0

    for (const tier of this.tiers) {
      for (const word of tier.words ?? []) {
        const inTitle = matchesKeyword(titleHay, word)
        const inBody = inTitle ? false : matchesKeyword(bodyHay, word)
        if (!inTitle && !inBody) continue
        const awarded = inTitle ? tier.points : BODY_ONLY_POINTS[tier.tier]
        hits.push({ word, tier: tier.tier, points: awarded })
        points += awarded
      }
    }

    return { points, hits }
  }

  check(item: RawItem): RelevanceVerdict {
    const score = this.score(item)
    const passed = score.points >= this.cfg.minPoints
    const titleHits = score.hits.filter((h) => h.points === this.tierPoints(h.tier))
    const reason = passed
      ? `积分 ${score.points}≥${this.cfg.minPoints}（标题命中 ${titleHits.map((h) => h.word).join('/') || '无'}）`
      : `积分 ${score.points}<${this.cfg.minPoints}：${
          score.hits.length === 0
            ? '零关键词命中'
            : `仅命中 ${score.hits.map((h) => `${h.word}(${h.tier}+${h.points})`).join(' ')}`
        }`
    return { passed, score, reason }
  }

  private tierPoints(tier: 'core' | 'ecosystem' | 'generic'): number {
    return this.tiers.find((t) => t.tier === tier)?.points ?? 0
  }
}

export function toDropRecord(item: RawItem, verdict: RelevanceVerdict, minPoints: number): DropRecord {
  return {
    itemId: item.id,
    title: item.title,
    source: item.source,
    url: item.url,
    gate: 'relevance',
    ruleId: `relevance:belowMinPoints(${verdict.score.points}<${minPoints})`,
    reason: verdict.reason,
  }
}
