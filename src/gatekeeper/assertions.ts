import { canonicalUrl } from '../collector/canonicalUrl.js'
import { BlacklistGate } from '../gates/blacklist.js'
// 钩子相关性用 topicTokens（大小写无关），**不用 entityTokens**：
// entityTokens 要求 ASCII 词首字母大写，那是事件聚类专用的专有名词口径。
// 用它判钩子会自相矛盾——机械兜底的实体词卡片本身就是小写 token 拼的，
// 永远过不了自己的断言（实测踩过，一次打红 23 个用例）。
import { topicTokens } from '../gates/eventCluster.js'
import { PersonaGate } from '../gates/persona.js'
import { HOOK_LIMITS, MIN_HOOK_CHARS, SUMMARY_MAX, SUMMARY_MIN, WHY_MAX, isTitlePrefix } from '../render/tuna.js'
import type { GatesConfig, GatekeeperInput, PersonaConfig } from '../types.js'

/**
 * 主编终审：一组硬断言（条数随判据演进，当前清单见 runAssertions 返回数组——
 * DB-11 起新增 gk:htmlLeak/gk:hollowSummary，勿在注释里写死数字），全部**客观可判定**，一票否决。
 *
 * 为什么终审只用客观断言、不用 LLM 打分做闸门：
 * 本项目已有「打分饱和 + 传送带消耗使『噪音逐轮下降』验收标准完全无读数」的前车之鉴
 * （见 docs/probe-changelog.md 2026-09-01 笔与总管记忆）。LLM 自分自用还会构成循环——
 * 写文案的模型给自己写的文案打分。故 reviewer 的分数（DB-05）**只上看板，不做闸门**，
 * 闸门权力交给这十条可复算的断言。
 *
 * 为什么需要「终审复跑上游闸门」（gk:blacklistRecheck / gk:tooOld）：
 * 渲染与（DB-05 的）LLM 编辑会**改写文本**，上游闸门的判定对改写后的文本不再成立。
 * 旧管线只预检格式（钩子限长/字段完整）而不复检内容，正是 DB-03 批评的
 * 「格式全绿 ≠ 内容合格」。
 */

export interface AssertionVerdict {
  ok: boolean
  ruleId: string
  detail: string
}

export interface AssertionInput {
  persona: PersonaConfig
  gates: GatesConfig
  now: number
  /** 跨产线共享的已发布指纹库 */
  knownCanonical: ReadonlySet<string>
  /**
   * 同批已接受的条目 + **待判条目作为最后一个元素**。
   *
   * 契约：`gk:duplicateUrl` 假定待判条目就是 `batch` 的末位，只否决「前面已有同规范 URL」
   * 的那一条，而不是把重复组全部否决——全否决会白白浪费坑位，且无法判定哪条才是权威源。
   */
  batch: ReadonlyArray<{ url: string }>
}

const OBJECT_OBJECT = /\[object Object\]/i
/** DB-03 §2.4 实测：`"arXiv:2609."` 这种元数据碎片被当成了第二钩子 */
const FRAGMENT_HOOK = /^arxiv:\d+\.?/i
/** DB-03 §2.4 实测：why 直接回显打分器浮点数 `"AI深度思想·rss：价值 0.94"` */
const SCORE_ECHO = /(价值|得分|分数|score)\s*[:：]?\s*\d+\.\d|\d\.\d{2}/
/** DB-11/D1：tuna local-brief 路径不过 sanitize，裸标签会原样上屏。
 *  不用标签白名单：LLM 会话转录混进的 `<example>`/`<user>` 这类 XML 形标签同样上屏。 */
const HTML_TAG = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?>/i
// DB-13/P2-5（2026-09-05 小巴审查）：正则源单独保存，substanceOf 内每次 new RegExp('…', 'gi')
// 局部创建——模块级带 g 正则一旦被 .test()/.exec() 调用会跨调用污染 lastIndex（replace 无此问题，
// 但禁令靠自觉不如结构上消除）。**勿直接删 g**：replace 需要全局语义（剥全部 chrome 而非首处）。
const VIEWER_CHROME_SOURCE =
  '频道\\s*·\\s*[\\d,.]+\\s*万?\\s*次观看|[\\d,.]+\\s*[KMB]?\\s*(?:views|subscribers|plays)|watch\\s+later|subscribe\\b|share\\b|阅读\\s*[\\d,.]+\\s*万?\\s*次|次观看|位订阅者'

/** 单条终审。返回全部断言结果（不是遇错即停），便于看板按 ruleId 统计否决分布。 */
export function runAssertions(item: GatekeeperInput, input: AssertionInput): AssertionVerdict[] {
  return [
    checkDamaged(item),
    checkDuplicateUrl(item, input.batch),
    checkAlreadyPublished(item, input.knownCanonical),
    checkMechanicalTruncation(item),
    checkFragmentHook(item),
    checkScoreEcho(item),
    checkBlacklistRecheck(item, input.gates),
    checkHookEntity(item, input.gates),
    checkTooOld(item, input.persona, input.now),
    checkShape(item),
    checkHtmlLeak(item),
    checkHollowSummary(item),
    // 下限闸放链尾（2026-09-06 老张「篇幅有要求，要满足」）：概要低于 SUMMARY_MIN 的
    // 薄稿拒收。渲染层 ensureSummaryFloor 已先补足，此处兜「正文也无料可补」的最后
    // 一手；放链尾让内容类违例优先报错，不抢前置断言的指名位置。
    checkSummaryFloor(item),
  ]
}

/** 概要篇幅下限：低于即薄稿，拒收（补足逻辑在渲染层 ensureSummaryFloor）。 */
function checkSummaryFloor(item: GatekeeperInput): AssertionVerdict {
  const sumMin = SUMMARY_MIN[item.lang]
  const sumN = Array.from(item.summary ?? '').length
  if (sumN < sumMin) return fail('gk:summaryBelowFloor', `summary 仅 ${sumN} 码点，低于 ${item.lang} 下限 ${sumMin}`)
  return { ok: true, ruleId: 'gk:summaryBelowFloor', detail: '' }
}

/** 全部通过才算过审。 */
export function isAccepted(verdicts: AssertionVerdict[]): boolean {
  return verdicts.every((v) => v.ok)
}

/** 否决理由（取第一条失败的断言，供 DropRecord 与看板使用）。 */
export function rejectionOf(verdicts: AssertionVerdict[]): AssertionVerdict | undefined {
  return verdicts.find((v) => !v.ok)
}

// ---------- 十条断言 ----------

/** 1. 坏数据：DB-03 实测 8 条 GitHub Issues 正文为 `[object Object]`，旧管线照推不误。 */
function checkDamaged(item: GatekeeperInput): AssertionVerdict {
  const hit = [item.title, item.summary, item.body].find((t) => OBJECT_OBJECT.test(t ?? ''))
  return hit === undefined
    ? ok('gk:damagedBody')
    : fail('gk:damagedBody', `含 [object Object]，解析已损坏（命中字段：${fieldOf(item, hit)})`)
}

/**
 * 2. 规范 URL 批内唯一。
 *
 * 只否决「前面已出现过同规范 URL」的那一条（待判条目约定为 `batch` 末位）。
 * 把重复组全否决看似更严，实际是浪费：第一条本来合法，否决它只会让坑位空着。
 */
function checkDuplicateUrl(item: GatekeeperInput, batch: ReadonlyArray<{ url: string }>): AssertionVerdict {
  const canon = canonicalUrl(item.url)
  if (!canon) return ok('gk:duplicateUrl') // 无 URL 的条目由 id 内容哈希兜底，不在此判
  const prior = batch.slice(0, -1)
  const hit = prior.find((b) => canonicalUrl(b.url) === canon)
  return hit === undefined
    ? ok('gk:duplicateUrl')
    : fail('gk:duplicateUrl', `规范 URL 与本批已接受条目重复：${canon}`)
}

/** 3. 不在已发布指纹库（跨产线共享，防同一事件两个 bot 各发一遍）。 */
function checkAlreadyPublished(item: GatekeeperInput, known: ReadonlySet<string>): AssertionVerdict {
  const canon = canonicalUrl(item.url)
  if (!canon) return ok('gk:alreadyPublished')
  return known.has(canon)
    ? fail('gk:alreadyPublished', `规范 URL 已在已发布指纹库中：${canon}`)
    : ok('gk:alreadyPublished')
}

/**
 * 4. 机械截断：hook 不得是 title 的前缀截断。
 * 判据与 `src/render/tuna.ts` 的 `isTitlePrefix` **同源**——渲染侧与终审侧判据不一致
 * 会让条目白白浪费一个坑（渲染以为合法、终审否决）。
 */
function checkMechanicalTruncation(item: GatekeeperInput): AssertionVerdict {
  const bad = item.hooks.find((h) => isTitlePrefix(h, item.title))
  return bad === undefined
    ? ok('gk:mechanicalTruncation')
    : fail('gk:mechanicalTruncation', `钩子是标题前缀截断：「${bad}」`)
}

/** 5. 碎片钩子：不得是 arXiv 元数据碎片，且不得短于 MIN_HOOK_CHARS。 */
function checkFragmentHook(item: GatekeeperInput): AssertionVerdict {
  for (const h of item.hooks) {
    if (FRAGMENT_HOOK.test(h.trim())) {
      return fail('gk:fragmentHook', `钩子是元数据碎片：「${h}」（DB-03 实测 "arXiv:2609." 即此类）`)
    }
    if (Array.from(h).length < MIN_HOOK_CHARS) {
      return fail('gk:fragmentHook', `钩子仅 ${Array.from(h).length} 码点，短于门槛 ${MIN_HOOK_CHARS}：「${h}」`)
    }
  }
  return ok('gk:fragmentHook')
}

/** 6. 浮点回显：why 不得暴露内部分数。 */
function checkScoreEcho(item: GatekeeperInput): AssertionVerdict {
  return SCORE_ECHO.test(item.why ?? '')
    ? fail('gk:scoreEcho', `why 回显了内部浮点数：「${item.why}」（把打分器调试日志搬上了 UI）`)
    : ok('gk:scoreEcho')
}

/** 7. 黑名单复跑：渲染/编辑改写文本后，上游门禁 1 的判定不再成立，必须复检。 */
function checkBlacklistRecheck(item: GatekeeperInput, gates: GatesConfig): AssertionVerdict {
  const gate = new BlacklistGate(gates)
  const v = gate.check({
    id: item.id,
    source: item.source,
    title: item.title,
    body: `${item.summary}\n${item.body}\n${item.hooks.join(' ')}\n${item.why}`,
    url: item.url,
    publishedAt: item.publishedAt,
  })
  return v.blocked
    ? fail('gk:blacklistRecheck', `渲染后文本命中负向模式 ${v.ruleId}：${v.reason}`)
    : ok('gk:blacklistRecheck')
}

/**
 * 8. 钩子实体校验：每个 hook 必须命中原文至少一个实体词。
 *
 * 借鉴 tuna commit `11477b0` 的相关性契约（老张指令「选项应严格与内容相关」）：
 * 泛化问句（`Is the data reliable?`）因不含原文实体而自然被滤除。
 * 实体集取自 `title + body`（比只取 title 宽，给正文里的实体留通道）。
 */
function checkHookEntity(item: GatekeeperInput, gates: GatesConfig): AssertionVerdict {
  const stopwords = new Set(gates.dedupe?.eventStopwords ?? [])
  const source = topicTokens(`${item.title} ${item.body}`, stopwords)
  if (source.size === 0) {
    // 原文抽不出任何实体：无法判定相关性。按「宁缺毋滥」否决，交由递补换一条。
    return fail('gk:hookEntity', '原文抽不出任何实体词，无法校验钩子相关性')
  }
  for (const h of item.hooks) {
    const hookEntities = topicTokens(h, stopwords)
    let shared = false
    for (const e of hookEntities) {
      if (source.has(e)) {
        shared = true
        break
      }
    }
    if (!shared) {
      return fail('gk:hookEntity', `钩子「${h}」不含原文任何实体词，判为泛化文案`)
    }
  }
  return ok('gk:hookEntity')
}

/** 9. 时效复跑：终审再验一次，防上游漏判（递补进来的条目尤其需要）。 */
function checkTooOld(item: GatekeeperInput, persona: PersonaConfig, now: number): AssertionVerdict {
  const gate = new PersonaGate(persona)
  const v = gate.check(
    { id: item.id, source: item.source, title: item.title, body: '', url: item.url, publishedAt: item.publishedAt },
    now,
  )
  // 只取时效相关的否决；信源白名单与淘汰红线在上游已过，此处不重复计账
  if (!v.passed && v.ruleId !== 'persona:sourceNotWhitelisted' && !v.ruleId?.startsWith('persona:reject:')) {
    return fail('gk:tooOld', `${v.ruleId ?? 'persona:unknown'}：${v.reason ?? ''}`)
  }
  return ok('gk:tooOld')
}

/**
 * 10. 形状与限长：hooks 恰 3 条互异、按语言限长；summary/why 限长。
 * 限长常量全部取自 `src/render/tuna.ts`（tuna `5fca284` 刚同步 zh70/en95），
 * **不另立一套数字**——两处不一致会重现 L1 第二行残字问题。
 */
function checkShape(item: GatekeeperInput): AssertionVerdict {
  const hooks = item.hooks ?? []
  if (hooks.length !== 3) return fail('gk:shapeViolation', `hooks 应恰 3 条，实为 ${hooks.length} 条`)
  if (new Set(hooks).size !== 3) return fail('gk:shapeViolation', 'hooks 存在重复，未做到三条互异')

  const hookMax = HOOK_LIMITS[item.lang]
  for (const h of hooks) {
    const n = Array.from(h).length
    if (n > hookMax) return fail('gk:shapeViolation', `钩子 ${n} 码点超 ${item.lang} 上限 ${hookMax}：「${h.slice(0, 30)}…」`)
  }

  const sumMax = SUMMARY_MAX[item.lang]
  const sumN = Array.from(item.summary ?? '').length
  if (sumN > sumMax) return fail('gk:shapeViolation', `summary ${sumN} 码点超 ${item.lang} 上限 ${sumMax}`)

  const whyN = Array.from(item.why ?? '').length
  if (whyN > WHY_MAX) return fail('gk:shapeViolation', `why ${whyN} 码点超上限 ${WHY_MAX}`)

  if (!item.title || Array.from(item.title).length === 0) return fail('gk:shapeViolation', 'title 为空')
  if (!item.url) return fail('gk:shapeViolation', 'url 为空，读者无法跳转原文')

  return ok('gk:shapeViolation')
}

/**
 * 11. 裸 HTML（DB-11/D1）：tuna 的 local-brief 路径不走 RSS 的 sanitize 闸门，
 * 渲染层漏剥的 `<p>`/`<a href>` 会原样上屏并构成注入面。渲染层（stripHtml）是主防线，
 * 本断言是交付前的复检——LLM 编辑改写同样可能把标签带回来。
 */
function checkHtmlLeak(item: GatekeeperInput): AssertionVerdict {
  const fields: Array<[string, string | undefined]> = [
    ['title', item.title],
    ['summary', item.summary],
    ['body', item.body],
    ['why', item.why],
    ...(item.hooks ?? []).map((h, i) => [`hooks[${i}]`, h] as [string, string]),
  ]
  const hit = fields.find(([, v]) => v !== undefined && HTML_TAG.test(v))
  return hit === undefined
    ? ok('gk:htmlLeak')
    : fail('gk:htmlLeak', `「${hit[0]}」含裸 HTML 标签（tuna local-brief 路径无 sanitize，会原样上屏）：${hit[1]?.slice(0, 60)}`)
}

/**
 * 12. 空壳内容（DB-11/D3）：视频页/落地页抓取只拿到平台 chrome（「频道 · N 次观看」、
 * 「123K views」、导航链接），码点限长达标但信息量为零——真机 L2 展开是一张空卡。
 * 剥掉 URL 与 chrome 后，实质词元（英文单词 + CJK 字符）<5 即否决（纯 chrome 页实测
 * 0–4 词元，真实最短一条 ≥5）。宁缺毋滥：坑位由候补池递补，不发空卡。
 */
function checkHollowSummary(item: GatekeeperInput): AssertionVerdict {
  const substanceOf = (t: string): number => {
    const chrome = new RegExp(VIEWER_CHROME_SOURCE, 'gi') // 每次调用局部创建（见源串上方说明）
    const text = t.replace(/https?:\/\/\S+/g, ' ').replace(chrome, ' ')
    const latin = text.match(/[A-Za-z]{2,}/g)?.length ?? 0
    const cjk = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0
    return latin + cjk
  }
  // summary 与 body 分开计、取 max：两字段装同一段 chrome 时不得互相「凑人数」；
  // 反之 summary 薄但 body 有真底料的条目不算空卡（L3 有内容可展开）。
  const substance = Math.max(substanceOf(item.summary ?? ''), substanceOf(item.body ?? ''))
  return substance >= 5
    ? ok('gk:hollowSummary')
    : fail('gk:hollowSummary', `剥除平台 chrome 后实质内容仅 ${substance} 词元（<5）：L2/L3 是空卡「${(item.summary ?? '').slice(0, 40)}」`)
}

/**
 * 跨条目断言：同一事件簇在最终产出中占位 ≤ maxPerEvent。
 *
 * 为什么终审后还要再验一次：`capEvents` 在递补之前跑，而递补会把候补池的条目补进坑，
 * 候补池里可能有与已入选条目同事件的报道——不复检就会被递补绕过。
 */
export function checkEventOversubscribed(
  published: GatekeeperInput[],
  gates: GatesConfig,
): AssertionVerdict {
  const maxPerEvent = gates.dedupe?.maxPerEvent ?? 2
  const counts = new Map<string, number>()
  for (const p of published) counts.set(p.eventKey, (counts.get(p.eventKey) ?? 0) + 1)

  const over = [...counts.entries()].filter(([, n]) => n > maxPerEvent)
  return over.length === 0
    ? ok('gk:eventOversubscribed')
    : fail(
        'gk:eventOversubscribed',
        `${over.length} 个事件簇占位超上限 ${maxPerEvent}：${over.map(([k, n]) => `${k}(${n})`).join(', ')}`,
      )
}

// ---------- 辅助 ----------

function ok(ruleId: string): AssertionVerdict {
  return { ok: true, ruleId, detail: '' }
}
function fail(ruleId: string, detail: string): AssertionVerdict {
  return { ok: false, ruleId, detail }
}
function fieldOf(item: GatekeeperInput, hit: string): string {
  if (hit === item.title) return 'title'
  if (hit === item.summary) return 'summary'
  return 'body'
}
