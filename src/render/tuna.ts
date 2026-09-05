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
// 实体词卡片用 topicTokens（大小写无关）：卡片是把主题词摊给读者看，
// 不是在做事件聚类，故不需要专有名词口径（用 entityTokens 会让小写实体全被剔掉、卡片变空）。
import { topicTokens } from '../gates/eventCluster.js'
// 词级覆盖率（titleOverlap）复用同一分词器，不另立口径（P2-2 教训：分词必须单点维护）
import { tokenize } from '../collector/dedupe.js'

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
 * 剥掉 RSS/采集正文里的裸 HTML 标签并还原常见实体（DB-11/D1）。
 *
 * 为什么必须在 domain-bot 侧剥：tuna 的 local-brief 路径**不走** RSS 的 sanitize 闸门
 * （LocalBriefNormalizer 直接采用 p.summary/p.body），裸 `<p>`/`<a href>` 会原样上屏。
 * 与其要求消费端再补一道闸（两处口径必然漂移），不如生产端交付纯文本。
 */
export function stripHtml(text: string): string {
  return text
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // DB-11 回放实测：原文可能带**转义形式的标签**（`&lt;example&gt;`），上一步实体解码
    // 会把它们还原成字面标签——解码后必须再剥一遍，否则等于亲手把标签放行。
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * why 截断：词边界优先（DB-11/D5）。
 *
 * truncateChars 是纯码点硬切，英文会在 40 码点处把 `benchmark` 切成 `benchmar…`。
 * 这里先在 max 内找最后一个词边界（空白/中英标点）切分；找不到（如超长无空格串）
 * 才退回硬切。zh 文本按码点硬切与词边界等价（CJK 逐字成词），行为不变。
 */
export function truncateWhy(text: string, maxChars: number): string {
  const chars = Array.from(text)
  if (chars.length <= maxChars) return text
  const head = chars.slice(0, maxChars - 1).join('')
  // 先剥头部尾部的悬空空白/标点（上一刀可能正好落在词尾标点前）
  const trimmed = head.replace(/[\s，。、！？·,:;!?–—"'()（）]+$/, '')
  // 再找最后一个词边界（空白）回退：`…inference, be` 这类半词就是硬切留下的——
  // 必须把残词整段退掉，而不是只修标点。回退位置不得低于预算一半（防越退越短）。
  const lastSpace = trimmed.lastIndexOf(' ')
  const min = Math.floor(maxChars / 2)
  if (lastSpace >= min) return `${trimmed.slice(0, lastSpace).replace(/[\s，。、！？·,:;!?–—"'()（）]+$/, '')}…`
  // 无可用空格（CJK 连续文本或超长单词）：码点硬切与词边界等价
  if (Array.from(trimmed).length >= min) return `${trimmed}…`
  return `${head}…`
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
 * 「首句钩子与标题高度同源」的判定阈值（DB-12/D6）。
 *
 * 取 0.8 的依据：DB-11 验机报告 §B5 用「hook[0] 与标题字符重叠 >80%」扫出主材 33 条冗余钩子
 * （例：hook[0]=「Neuronto Agentic Resource Discovery (ARD) Index.」实质是标题子串）。
 * 修复沿用同一阈值修同一批人群，但**判据从字符级换成词级**——依据见 `titleOverlap`：
 * 字符级对英文散文饱和（同一文章的两句话本就共享 >0.9 的去重字母），会把信息增量真实的
 * 次句也误杀（实测 56 条主材里 25 条如此）。
 */
export const TITLE_ECHO_OVERLAP = 0.8

/**
 * 钩子对标题的**词级覆盖率**（DB-12/D6，可复算纯函数，测试与复核都用它）。
 *
 * 分子＝钩子（去尾部省略号）经 `tokenize()` 的词元里有多少出现在标题词元中；
 * 分母＝钩子词元数。**必须复用 `tokenize()`**（`src/collector/dedupe.ts`）而不是另立分词：
 * CJK 2-gram 行为在那里，另写一套会造成中英文口径分裂（本项目已修过的 P2-2 缺陷）。
 *
 * 词级而非字符级的依据：钩子的信息增量＝它带来了多少标题没有的**词**。字符级判据在英文上
 * 饱和——"Federated search across every public ARD registry…" 与标题共享 0.92 的去重字母，
 * 却带来了 6 个新词，判它是标题复读是误杀。词级下它只有 0.14（7 个词元里 1 个来自标题），
 * 而真正的复读（首句＝标题）得 1.0，判然分开。
 *
 * 仍是粗粒度词法判据，是故意的：判据要能在测试与复核里复算，语义级归并归 DB-05 的 reviewer。
 */
export function titleOverlap(hook: string, title: string): number {
  const bare = hook.replace(/…$/, '').trim()
  if (!bare) return 0
  const hookTokens = tokenize(bare)
  if (hookTokens.size === 0) return 0
  const titleTokens = tokenize(title)
  let shared = 0
  for (const t of hookTokens) if (titleTokens.has(t)) shared += 1
  return shared / hookTokens.size
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
 * 首句/次句是**句子形状**的候选，若与标题高度同源（`titleOverlap` ≥ 0.8，DB-12/D6）
 * 会被跳过——首句复述标题时，钩子对读者是零增量（DB-11 §B5 实测主材 33 条如此）。
 * 首句被跳过时门面位由次句顶上（信息增量最高的递补），实体卡退居第二。
 *
 * 三条均非标题前缀、均 ≥ MIN_HOOK_CHARS，因此能过 gatekeeper 的
 * `gk:mechanicalTruncation` / `gk:fragmentHook` 两条硬断言。
 *
 * **返回可能少于 3 条**：素材不足时宁可少给，也不用标题截断充数——
 * `gk:shapeViolation` 会否决不足 3 条的条目并由候补池递补（宁缺毋滥）。
 * 唯一的例外放宽：非同源候选凑不满 3 条时，同源候选仍回补——少一条冗余钩子
 * 换「整条被否决 + 候补池递补」不划算，冗余钩子只损失信息增量，否决损失整条内容。
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

  const entities = [...topicTokens(`${title} ${clean}`, stopwords)].slice(0, 3)
  const entityCard = entities.join(' · ')

  const lead = truncateChars(sentences[0] ?? '', maxHook)
  const card = truncateChars(entityCard, maxHook)
  const second = truncateChars(sentences[1] ?? '', maxHook)
  const domainCard = truncateChars(entityCard ? `${domain}｜${entityCard}` : '', maxHook)
  const entityLead = truncateChars(entities[0] && sentences[0] ? `${entities[0]}：${sentences[0]}` : '', maxHook)
  // 首句是标题复读时，门面位让给次句（信息增量最高），实体卡退居第二
  const leadEchoes = !!lead && titleOverlap(lead, title) >= TITLE_ECHO_OVERLAP

  // sentence 标记：只有句子形状的候选参与「与标题同源」判定。
  // 实体卡的词元本就抽自标题（覆盖率恒接近 1），但它是第三视角（主题卡），
  // 拿「与标题同源」判它会把自己误杀——故只豁免它，句子候选一律判。
  const candidates: Array<{ text: string; sentence: boolean }> = leadEchoes
    ? [
        { text: second, sentence: true },
        { text: card, sentence: false },
        { text: domainCard, sentence: false },
        { text: entityLead, sentence: true },
      ]
    : [
        { text: lead, sentence: true },
        { text: card, sentence: false },
        { text: second, sentence: true },
        { text: domainCard, sentence: false },
        { text: entityLead, sentence: true },
      ]

  const hooks: string[] = []
  // allowEcho=false 先挑与标题不同源的；素材不足再放宽（见上「唯一例外」）
  const collect = (allowEcho: boolean): void => {
    for (const c of candidates) {
      const cleaned = c.text.trim()
      // 碎片门槛：与 gk:fragmentHook 同源，不把不够长的候选当成钩子充数
      if (Array.from(cleaned).length < MIN_HOOK_CHARS) continue
      if (hooks.includes(cleaned)) continue
      // 标题前缀截断不得入选（与 gk:mechanicalTruncation 同源）
      if (isTitlePrefix(cleaned, title)) continue
      if (!allowEcho && c.sentence && titleOverlap(cleaned, title) >= TITLE_ECHO_OVERLAP) continue
      hooks.push(cleaned)
      if (hooks.length === 3) break
    }
  }
  collect(false)
  if (hooks.length < 3) collect(true)
  return hooks
}
