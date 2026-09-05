import type { BlacklistGroup, DropRecord, GatesConfig, RawItem } from '../types.js'
import { compilePattern, matchesKeyword, toHaystack } from './textMatch.js'

/**
 * 门禁 1：负向模式黑名单（物理阻断）。
 *
 * 为什么必须有这一层（DB-03 实证）：单靠正向关键词无法拦住垃圾——招聘帖与中转站推广文
 * **天然包含最全的 AI 关键词**（§2.3 失效模式 4），卖课视频标题堆满「大模型/AI/入门」
 * （失效模式 5），个人简历仓库堆砌 Agent/LLM/RAG（失效模式 3）。正向词越全，这些内容分越高。
 * 故必须先做负向物理拦截，再谈相关性积分。
 *
 * 65 条剔除清单里的 7 大顽疾，本层负责其中可模式化的 5 类：坏数据、广告招聘、跨学科噪音、
 * 非技术泛周边、卖课科普。完全重复与同质化刷屏归门禁 3（fingerprint），个人练手仓库的
 * 「语义低质」归 AI 编辑部 reviewer（模式匹配判不出「这是学生作业」）。
 */

export interface BlacklistVerdict {
  blocked: boolean
  ruleId?: string
  group?: BlacklistGroup
  reason?: string
}

interface CompiledBlacklistRule {
  id: string
  group: BlacklistGroup
  regex: RegExp
  scope: 'title' | 'body' | 'both'
  unlessStrongAi: boolean
}

/** 坏数据特征：不是正则能穷举的结构性损坏，单列为内置规则以便看板归因。 */
const OBJECT_OBJECT = /\[object Object\]/i

export class BlacklistGate {
  private readonly rules: CompiledBlacklistRule[] = []
  /**
   * 配置里写错的正则。**不得静默跳过**：一条失效的黑名单规则等于该规则不存在，
   * 闸门会假绿（本项目已有「打分饱和使验收无读数」的前车之鉴）。
   * 由调用方在启动时暴露给 doctor / 看板。
   */
  readonly compileErrors: Array<{ ruleId: string; error: string }> = []
  private readonly strongAiHay: string[]

  constructor(private readonly cfg: GatesConfig) {
    this.strongAiHay = cfg.strongAiWords ?? []
    for (const rule of cfg.blacklist ?? []) {
      const { regex, error } = compilePattern(rule.pattern, rule.flags ?? 'i')
      if (!regex) {
        this.compileErrors.push({ ruleId: rule.id, error: error ?? '未知错误' })
        continue
      }
      this.rules.push({
        id: rule.id,
        group: rule.group,
        regex,
        scope: rule.scope ?? 'both',
        unlessStrongAi: rule.unlessStrongAi === true,
      })
    }
  }

  /** 条目是否命中强 AI 词。crossDomain 组的豁免条件——防止误杀真正的 AI 论文。 */
  private hasStrongAi(haystack: string): boolean {
    return this.strongAiHay.some((w) => matchesKeyword(haystack, w))
  }

  check(item: RawItem): BlacklistVerdict {
    const title = item.title ?? ''
    const body = item.body ?? ''

    // 结构性损坏：优先于正则规则，因为坏数据的正文不可读，正则判定无意义
    if (OBJECT_OBJECT.test(body) || OBJECT_OBJECT.test(title)) {
      return {
        blocked: true,
        ruleId: 'damaged:objectObject',
        group: 'damaged',
        reason: '正文/标题含 [object Object]，解析已损坏，无可读内容',
      }
    }
    const titleChars = Array.from(title.trim()).length
    if (titleChars < this.cfg.minTitleChars) {
      return {
        blocked: true,
        ruleId: 'damaged:titleTooShort',
        group: 'damaged',
        reason: `标题仅 ${titleChars} 码点，短于门槛 ${this.cfg.minTitleChars}，判为无意义碎条`,
      }
    }

    const haystack = toHaystack(`${title} ${body}`)
    // 强 AI 词判定只做一次：crossDomain 组全部共用该结果
    const strongAi = this.hasStrongAi(haystack)

    for (const rule of this.rules) {
      if (rule.unlessStrongAi && strongAi) continue
      const target =
        rule.scope === 'title' ? title : rule.scope === 'body' ? body : `${title}\n${body}`
      if (rule.regex.test(target)) {
        return {
          blocked: true,
          ruleId: rule.id,
          group: rule.group,
          reason: `命中负向模式 ${rule.id}（${rule.group}）`,
        }
      }
    }

    return { blocked: false }
  }
}

/** 生成 DropRecord，供看板逐层归因。 */
export function toDropRecord(item: RawItem, verdict: BlacklistVerdict): DropRecord {
  return {
    itemId: item.id,
    title: item.title,
    source: item.source,
    url: item.url,
    gate: 'blacklist',
    ruleId: verdict.ruleId ?? 'blacklist:unknown',
    reason: verdict.reason ?? '',
  }
}
