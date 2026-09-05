/**
 * tuna 契约的文本渲染原语。
 *
 * **本模块不再做任何"推送"**：旧的 `renderTunaBrief()` / `pushTuna()`（产
 * `outbox/tuna/brief-<id>.json`）已被 `src/publish/pack.ts` 的 `buildPack()` / `writePack()`
 * 完全取代。两套实现并存必然漂移（tuna 侧限长 `5fca284` 同步过一次，两处数字不一致
 * 就会重现 L1 第二行残字问题），故删除旧的、只保留原语。`src/push/` 目录随之退役。
 *
 * 保留的原语都是**跨模块共用的口径定义**，必须单点维护：
 * - 限长常量（tuna 侧 `packages/feeds/normalizers.ts` 与 `BriefItem.MAX_WHY_CHARS` 的对应值）
 * - 语言判定（与 tuna `feeds/sanitize.ts` 的 `detectLang` 同族）
 * - 钩子/句子的机械兜底构造（DB-05 的 LLM writer 上线后只在其降级链末端被调用）
 */
import { entityTokens } from '../gates/eventCluster.js'

/**
 * 钩子/概要限长（码点）。`src/gatekeeper/assertions.ts` 的 `gk:shapeViolation` 复用本常量——
 * **不得另立一套数字**：tuna 侧 commit `5fca284` 刚同步过 zh70/en95（两行容量），
 * 两处不一致会重现 L1 第二行残字问题。
 */
export const HOOK_LIMITS: Record<'zh' | 'en', number> = { zh: 70, en: 95 }
export const SUMMARY_MAX: Record<'zh' | 'en', number> = { zh: 300, en: 450 }
/** why 限长，对齐 tuna BriefItem.MAX_WHY_CHARS */
export const WHY_MAX = 40
/** 钩子最短码点数。DB-03 §2.4 实测 `"arXiv:2609."` 为 11 字符，故门槛取 12。 */
export const MIN_HOOK_CHARS = 12

/** 语言推断：与 tuna feeds/sanitize.ts detectLang 同族——前 400 码点 CJK 占比 >30% 判 zh。 */
export function detectLang(text: string): 'zh' | 'en' {
  const sample = Array.from(text).slice(0, 400)
  if (sample.length === 0) return 'en'
  let cjk = 0
  for (const ch of sample) {
    const code = ch.codePointAt(0) ?? 0
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) cjk += 1
  }
  return cjk / sample.length > 0.3 ? 'zh' : 'en'
}

/** 按码点截断（不是 UTF-16 长度），超限补省略号。中日韩与 emoji 都不会被切半。 */
export function truncateChars(text: string, maxChars: number): string {
  const chars = Array.from(text)
  if (chars.length <= maxChars) return text
  return `${chars.slice(0, maxChars - 1).join('')}…`
}

export function firstSentence(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length === 0) return ''
  const match = clean.match(/^[^。！？.!?]*[。！？.!?]/)
  const sentence = match ? match[0] : clean
  return truncateChars(sentence.trim(), maxChars)
}

/** 剥掉采集带回的元数据行（DB-03 §2.4：`arXiv:2609.03884v1 Announce Type: cross` 混入 summary）。 */
export function stripMetadata(text: string): string {
  return text
    .replace(/^\s*arxiv:\S+\s*/i, ' ')
    .replace(/\bAnnounce Type:\s*\S+/gi, ' ')
    .replace(/^\s*Abstract:\s*/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 按中英文句末标点切句，丢弃短于 MIN_HOOK_CHARS 的段（碎片不能当句子用）。
 *
 * 两种标点的切分条件**故意不同**：
 * - CJK 句末标点（。！？）后允许零空白——中文书写不在句号后加空格，
 *   若要求 `\s+` 则中文正文**永远切不出首句**（实测已踩：钩子只能拿到整段正文）；
 * - ASCII 句末标点（.!?）后**必须**有空白——否则 `3.14`、`e.com/1`、`arXiv:2609.03884`
 *   这类小数点与域名会被当成句子边界切碎。
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？])\s*|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => Array.from(s).length >= MIN_HOOK_CHARS)
}

/**
 * hook 是否为 title 的前缀截断。与 `gatekeeper/assertions.ts` 的 `gk:mechanicalTruncation`
 * **同判据**：去掉末尾省略号后是 title 的前缀，且长度达 title 的 0.6 以上。
 * 两处必须同源，否则渲染侧以为合法、终审侧否决，条目白白浪费一个坑。
 */
export function isTitlePrefix(hook: string, title: string): boolean {
  const bare = hook.replace(/…$/, '').trim()
  if (bare.length === 0) return false
  if (!title.startsWith(bare)) return false
  return Array.from(bare).length >= Array.from(title).length * 0.6
}

/**
 * 展示用最小停用词表。产线会传入 `config/gates.json` 的完整 `eventStopwords`；
 * 本默认值仅保证单独调用 deriveHooks（如单测）时不把 the/of/model 当实体展示。
 */
const DISPLAY_STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'of', 'for', 'and', 'is', 'are', 'with', 'from', 'into', 'a', 'an', 'to', 'in', 'on',
  'model', 'models', 'ai', 'new', 'openai', 'gpt', 'llm', 'this', 'that', 'has', 'have',
])

/**
 * 恒 3 条互异的机械钩子（兜底用）——从**三种不同素材**取，而不是把标题切三段。
 *
 * 为何重写（DB-03 §2.4 实测）：旧实现把 `truncateChars(title, maxHook)` 当第一钩子，
 * 于是产出的就是标题前缀截断；更荒谬的是第二钩子直接出现了 `"arXiv:2609."` 这种
 * 11 字符的无意义碎片（summary 被按字数硬切，把 arXiv 元数据行当成了首句）。
 * 三个钩子全由标题暴力切分而来，视角完全单一。
 *
 * 新实现的三个视角：
 *   1. **首句式**——剔掉 arXiv 元数据后的正文首句（讲内容）
 *   2. **实体式**——从标题+正文抽的实体词卡（讲主题）
 *   3. **次句式**——正文第二句，不足则回退「领域｜实体卡」（讲另一侧面）
 *
 * 三条均非标题前缀、均 ≥ MIN_HOOK_CHARS，因此能过 gatekeeper 的
 * `gk:mechanicalTruncation` / `gk:fragmentHook` 两条硬断言。
 *
 * **返回可能少于 3 条**：素材不足时宁可少给，也不用标题截断充数——
 * `gk:shapeViolation` 会否决不足 3 条的条目并由候补池递补（宁缺毋滥）。
 *
 * **这仍是机械兜底**：DB-05 的 LLM writer 上线后本函数只在其降级链末端被调用。
 */
export function deriveHooks(
  title: string,
  summary: string,
  domain: string,
  lang: 'zh' | 'en',
  stopwords: ReadonlySet<string> = DISPLAY_STOPWORDS,
): string[] {
  const maxHook = HOOK_LIMITS[lang]
  const clean = stripMetadata(summary || title)
  const sentences = splitSentences(clean)

  const entities = [...entityTokens(`${title} ${clean}`, stopwords)].slice(0, 3)
  const entityCard = entities.join(' · ')

  const candidates = [
    // 1. 首句式
    truncateChars(sentences[0] ?? '', maxHook),
    // 2. 实体式
    truncateChars(entityCard, maxHook),
    // 3. 次句式，不足则领域｜实体卡
    truncateChars(sentences[1] ?? '', maxHook),
    truncateChars(entityCard ? `${domain}｜${entityCard}` : '', maxHook),
    truncateChars(entities[0] && sentences[0] ? `${entities[0]}：${sentences[0]}` : '', maxHook),
  ]

  const hooks: string[] = []
  for (const c of candidates) {
    const cleaned = c.trim()
    // 碎片门槛：与 gk:fragmentHook 同源，不把不够长的候选当成钩子充数
    if (Array.from(cleaned).length < MIN_HOOK_CHARS) continue
    if (hooks.includes(cleaned)) continue
    // 标题前缀截断不得入选（与 gk:mechanicalTruncation 同源）
    if (isTitlePrefix(cleaned, title)) continue
    hooks.push(cleaned)
    if (hooks.length === 3) break
  }
  return hooks
}
