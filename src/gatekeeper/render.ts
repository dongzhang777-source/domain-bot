import type { GatekeeperInput, PersonaConfig, ScoredItem } from '../types.js'
import {
  HOOK_LIMITS,
  SUMMARY_MAX,
  WHY_MAX,
  deriveHooks,
  detectLang,
  ensureSummaryFloor,
  stripHtml,
  stripMetadata,
  truncateChars,
  truncateWhy,
} from '../render/tuna.js'
import type { WrittenCopy } from '../editorial/writer.js'

/**
 * 渲染：把打分阶段的 ScoredItem 转成面向读者的 GatekeeperInput。
 *
 * **必须在主编终审之前**：机械截断 / 碎片钩子 / 浮点回显 这三类缺陷只在渲染后才存在，
 * 对 ScoredItem 断言无意义（DB-03 §2.4 的三类文案缺陷全部产自渲染环节）。
 *
 * 本工单阶段无 LLM，钩子/摘要/why 走 `src/render/tuna.ts` 的机械兜底；
 * DB-05 的 writer 上线后此处改为优先取编辑部产物、失败才回退机械兜底。
 */

export interface RenderContext {
  persona: PersonaConfig
  /** 只含 [a-z0-9] 的摘要 id（tuna 侧 id 正则约束第二段） */
  digestId: string
  index: number
  /** 事件簇标识，来自 capEvents 的 eventKeyOf；缺省时退化为条目自身 id */
  eventKey?: string
  /** 实体词聚类的通用词表，透传给 deriveHooks 做实体卡 */
  stopwords?: ReadonlySet<string>
  /**
   * AI 编辑部（DB-05）的产出。为 null / 缺省时走机械兜底。
   * 两者走同一条渲染路径与同一套终审断言——LLM 文案不享受豁免，
   * 否则「格式全绿 ≠ 内容合格」的老毛病会以新形式重现。
   */
  copy?: WrittenCopy | null
}

export function renderPost(item: ScoredItem, ctx: RenderContext): GatekeeperInput {
  const lang = detectLang(`${item.title}\n${item.body}`)
  // DB-11/D1：tuna local-brief 路径不过 sanitize 闸门，生产端必须交付纯文本——
  // 标题与正文先剥裸 HTML（<p>/<a href> 等）再进钩子/摘要/底料，注入面在源头拆除。
  const cleanTitle = stripHtml(item.title)
  const cleanBody = stripMetadata(stripHtml(item.body || item.title))

  // id 第一段用连字符而非冒号：tuna 侧正则 `^[a-z0-9-]+:[a-z0-9]+:\d+$` 只允许两段冒号，
  // 四段式 `domain-bot:<persona>:<digestId>:<index>` 会校验失败。
  const id = `domain-bot-${ctx.persona.id}:${ctx.digestId}:${ctx.index}`

  const copy = ctx.copy ?? null
  const hooks = copy ? copy.hooks : deriveHooks(cleanTitle, cleanBody, ctx.persona.domain, lang, ctx.stopwords)

  // L3 底料（2026-09-07 老张「L3 篇幅不够」）：亲写 body 优先——编辑部把心流层正文
  // 写足的中文稿，过同一清洗链；缺省回退清洗后的原文（采集端截断已放宽到 6000，
  // 两条路都不再是 1200 码点的断头料）。LLM 摘要仍不冒充正文（DB-02 缺口 d）。
  const cleanCopyBody = copy?.body ? stripMetadata(stripHtml(copy.body)).trim() : ''
  const body = cleanCopyBody || cleanBody || item.title
  // 交付语言重判：亲写正文落地后，交付稿（summary+body）可能与原文不同语言
  //（英文论文 + 中文亲写稿）。lang 决定篇幅上下限档（BODY_MIN/SUMMARY_MIN）与
  // App 分流，必须按交付面判，不能透传原文语言。**必须在 ensureSummaryFloor
  // 之前定稿**——否则补足用 en 档补到 300+、shape 检查用 zh 档卡 300，自相矛盾。
  const langFinal = cleanCopyBody ? detectLang(`${copy?.summary ?? ''}\n${cleanCopyBody}`) : lang

  // 篇幅达标（2026-09-06 老张指令）：低于 SUMMARY_MIN 的薄稿在渲染层自动从正文补句，
  // writer 文案与机械兜底走同一条补足路径；终审 gk:summaryBelowFloor 只兜最后防线。
  const summary = ensureSummaryFloor(
    copy ? copy.summary : cleanBody.trim(),
    body,
    langFinal,
  )

  // why 不得回显内部浮点数（DB-03 §2.4：`"AI深度思想·rss：价值 0.94"` 把打分器调试日志搬上 UI）。
  // 机械兜底期取 scorer 的人话 reason；为空时用 persona+来源模板，永不拼分数。
  // 词边界截断（DB-11/D5）：40 码点处不把 benchmark 切成 benchmar…。
  const why = truncateWhy(copy ? copy.why : fallbackWhy(item, ctx.persona, lang), WHY_MAX)

  return {
    id,
    title: truncateChars(cleanTitle.trim(), 120),
    hooks,
    summary,
    body,
    why,
    url: item.url,
    lang: langFinal,
    publishedAt: item.publishedAt,
    source: item.source,
    eventKey: ctx.eventKey ?? item.id,
    valueScore: item.valueScore,
  }
}

/**
 * why 的机械兜底。
 *
 * 铁律：**永不拼入 valueScore**。DB-03 §2.4 实测旧实现产出
 * `"AI深度思想·rss：价值 0.94"`——把后台打分器的数学结果和抓取协议渠道名直接当
 * 「为什么推给你」展示给用户，等于把系统调试日志搬上 UI。
 *
 * 优先用 scorer 给的 reason（HeuristicScorer 的 humanizeReason 已是人话模板，
 * LlmScorer 的 reason 是模型写的一句话理由）；为空才退到 persona 模板。
 * 语言随条目（DB-11/D2）：中文 why 挂英文帖 = L2 中英混排，broken 观感。
 */
function fallbackWhy(item: ScoredItem, persona: PersonaConfig, lang: 'zh' | 'en'): string {
  const reason = (item.reason ?? '').trim()
  if (reason && !/\d\.\d/.test(reason)) return reason
  if (lang === 'en') {
    return `Hand-picked from the ${persona.domain} feed by ${persona.id}`
  }
  return `${persona.displayName}为你挑的${persona.domain === 'ai-llm' ? ' AI ' : ''}${
    persona.id === 'newsline' ? '新动态' : '深度内容'
  }`
}

/**
 * 批量渲染。
 *
 * @param eventKeyOf 来自 `capEvents()` 的 id → 事件簇标识映射。**逐条查表**，
 *   不得全批共用一个值——否则 `gk:eventOversubscribed` 会把全部条目当成同一事件。
 *   查不到时退化为条目自身 id（每条自成一体，宁可不合并也不误合）。
 */
export function renderPosts(
  items: ScoredItem[],
  ctx: Omit<RenderContext, 'index' | 'eventKey' | 'copy'>,
  eventKeyOf?: ReadonlyMap<string, string>,
  copies?: ReadonlyArray<WrittenCopy | null>,
): GatekeeperInput[] {
  return items.map((item, index) =>
    renderPost(item, {
      ...ctx,
      index,
      eventKey: eventKeyOf?.get(item.id) ?? item.id,
      copy: copies?.[index] ?? null,
    }),
  )
}

/** 导出限长常量供断言复用，避免两处各写一套数字（tuna `5fca284` 刚同步过 zh70/en95）。 */
export { HOOK_LIMITS, SUMMARY_MAX, WHY_MAX }
