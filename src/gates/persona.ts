import type { DropRecord, PersonaConfig, RawItem } from '../types.js'
import { compilePattern } from './textMatch.js'

/**
 * persona 闸门：双产线彻底分离的载体。
 *
 * AI时事快线与 AI深度思想各有不可跨越的质量下限（DB-03 §3.5）：
 * - 时效硬约束：newsline ≤72h（超时无论多好绝不入选）/ deepthought ≤720h；
 * - 信源白名单：各自只采自己的源，不共享候选池；
 * - 淘汰红线：newsline 禁标题党/二手无源传闻/培训营销，deepthought 禁空洞观点/名词解释。
 *
 * 红线用 persona 特有正则叠加在全局黑名单之上——两条产线的「不可接受」不是同一件事。
 */

export interface PersonaVerdict {
  passed: boolean
  ruleId?: string
  reason?: string
}

export class PersonaGate {
  private readonly sources: Set<string>
  private readonly rejectRules: Array<{ id: string; regex: RegExp }> = []
  readonly compileErrors: Array<{ ruleId: string; error: string }> = []

  constructor(private readonly persona: PersonaConfig) {
    this.sources = new Set(persona.sources ?? [])
    for (const rule of persona.rejectRules ?? []) {
      const { regex, error } = compilePattern(rule.pattern, rule.flags ?? 'i')
      if (!regex) {
        this.compileErrors.push({ ruleId: rule.id, error: error ?? '未知错误' })
        continue
      }
      this.rejectRules.push({ id: rule.id, regex })
    }
  }

  check(item: RawItem, now: number): PersonaVerdict {
    if (!this.sources.has(item.source)) {
      return {
        passed: false,
        ruleId: 'persona:sourceNotWhitelisted',
        reason: `源 ${item.source} 不在 ${this.persona.id} 白名单内`,
      }
    }

    // publishedAt=0 表示源未提供时间（jina/bili 常态）。不按超时处理——
    // 否则这些源会被整体误杀，且「源没给时间」与「内容过期」在观测上无法区分。
    if (item.publishedAt > 0) {
      const ageHours = (now - item.publishedAt) / 3_600_000
      if (ageHours > this.persona.maxAgeHours) {
        return {
          passed: false,
          ruleId: 'persona:tooOld',
          reason: `发布距今 ${ageHours.toFixed(1)}h，超过 ${this.persona.id} 的 ${this.persona.maxAgeHours}h 硬约束`,
        }
      }
      // 未来时间戳同样是坏数据（源时区/解析错误），会绕过所有时效判定
      if (item.publishedAt > now) {
        return {
          passed: false,
          ruleId: 'persona:futureTimestamp',
          reason: `发布时间在未来（${new Date(item.publishedAt).toISOString()}），判为坏数据`,
        }
      }
    } else {
      // 源未给时间时，标题里的显式年份是唯一可用的时效线索。
      // DB-03 #193 实例：「AI 大模型周报 2024年10月 d」混进 2026 年信息流，
      // 而 bili 源恒返回 publishedAt=0，上面的时效闸对它完全无效。
      const stale = staleYearInTitle(item.title, now)
      if (stale !== null) {
        return {
          passed: false,
          ruleId: 'persona:staleYearInTitle',
          reason: `源未给发布时间，但标题里写明 ${stale} 年（当前 ${new Date(now).getUTCFullYear()} 年），判为过期旧闻`,
        }
      }
    }

    const hay = `${item.title}\n${item.body}`
    for (const rule of this.rejectRules) {
      if (rule.regex.test(hay)) {
        return {
          passed: false,
          ruleId: `persona:reject:${rule.id}`,
          reason: `命中 ${this.persona.id} 淘汰红线 ${rule.id}`,
        }
      }
    }

    return { passed: true }
  }
}

export function toDropRecord(item: RawItem, verdict: PersonaVerdict): DropRecord {
  return {
    itemId: item.id,
    title: item.title,
    source: item.source,
    url: item.url,
    gate: 'persona',
    ruleId: verdict.ruleId ?? 'persona:unknown',
    reason: verdict.reason ?? '',
  }
}

/** 标题里出现四位年份的形态（中英文日期均覆盖）。 */
const YEAR_IN_TITLE = /(19|20)\d{2}\s*年|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d{2}|\b(?:19|20)\d{2}-\d{2}\b/gi

/**
 * 标题里是否写明了早于当前年份一年以上的年份。
 *
 * 为何需要：bili/ytsearch/jina 恒返回 `publishedAt = 0`（源不给时间），
 * 时效硬约束对它们完全失效。DB-03 #193 实例：「AI 大模型周报 2024年10月 d」
 * 堂而皇之混进 2026 年的信息流，审计报告判为「时效性彻底破产」。
 *
 * 阈值取「上一年之前」而不是「不等于今年」：年底发布的「2026 年度回顾」在
 * 2027 年初仍属合法内容，按不等式判会误杀。返回命中的年份供归因，未命中返回 null。
 */
export function staleYearInTitle(title: string, now: number): number | null {
  const currentYear = new Date(now).getUTCFullYear()
  YEAR_IN_TITLE.lastIndex = 0
  for (const m of title.match(YEAR_IN_TITLE) ?? []) {
    const yearMatch = m.match(/(19|20)\d{2}/)
    if (!yearMatch) continue
    const year = Number(yearMatch[0])
    if (year < currentYear - 1) return year
  }
  return null
}
