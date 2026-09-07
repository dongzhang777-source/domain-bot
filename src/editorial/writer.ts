import type { PersonaConfig, ScoredItem } from '../types.js'
import { HOOK_LIMITS, SUMMARY_MAX, SUMMARY_MIN, WHY_MAX, truncateChars } from '../render/tuna.js'
import { EditorialProvider, extractJsonArray, renderItemsBlock, type Usage } from './provider.js'

/**
 * AI 编辑部的「写」侧：三档差异化钩子 + 精炼摘要 + 人话 why。
 *
 * 取代的三处机械缺陷（DB-03 §2.4 实测）：
 * 1. **Hooks 机械截断**——旧 `deriveHooks` 把标题切三段，第二钩子直接产出 `"arXiv:2609."`
 *    这种 11 字符碎片；
 * 2. **Summary 元数据垃圾**——旧实现 `truncate(body, 300)` 把 `arXiv:2609.03884v1
 *    Announce Type: cross` 原样留在摘要开头；
 * 3. **Why 回显内部浮点数**——旧实现产出 `"AI深度思想·rss：价值 0.94"`，把打分器的
 *    数学结果和抓取协议渠道名当「为什么推给你」展示给用户。
 *
 * 实测批参数（2026-09-04，不是拍的）：批=3 / max_tokens=6000 单批 47.1s，
 * completion 2500 里 reasoning 占 1739（70%）。批再大就会撞 token 上限被截断——
 * 曾按「10 条/批」估算，实测只写完约 1 条就 finish_reason=length。
 */

export interface WrittenCopy {
  hooks: string[]
  summary: string
  why: string
  /**
   * 亲写 L3 正文（可选，2026-09-07 老张「L3 篇幅不够」）：编辑部模式下小智把心流层
   * 正文一起写足（基于原文素材的中文稿），渲染层优先采用；缺省仍用清洗后的原文底料。
   * 过 stripHtml/stripMetadata 同一清洗链，篇幅由终审 gk:bodyBelowFloor 把关。
   */
  body?: string
  /** 产出来源：llm=模型写的；fallback=降级到机械兜底（看板必须能区分，否则质量塌回原点不可见） */
  origin: 'llm' | 'fallback'
  /** 模型给的分数（若有），仅供看板，**不参与任何判定** */
  note?: string
}

export interface WriterBatchResult {
  copies: Array<WrittenCopy | null>
  usage?: Usage
  truncated: boolean
  error?: string
}

const SYSTEM_PROMPT = `你是深耕人工智能与大语言模型领域的资深智库主编。为 AI 算法工程师、系统架构师与技术决策者写作。

【三档钩子要求】三条视角必须各异，不得是同一句话的改写：
1. 技术结论与数据反差（给出了什么可量化的结果）
2. 系统痛点与风险悬念（解决了什么工程难题，或暴露了什么风险）
3. 对从业者的实践启示（读者能拿它做什么决策）

【铁律】
- 钩子不得是标题的前缀截断，不得是 "arXiv:2609." 这类元数据碎片
- 摘要必须剥离 arXiv 编号、Announce Type、Abstract: 等元数据，直接给结论与架构
- 「为什么推给你」必须是站在读者视角的人话，**严禁出现任何数字分数**（如「价值 0.94」）
- 不得编造原文没有的数据、机构名或结论
- 语言与原文一致：中文条目写中文，英文条目写英文`

export function buildWriterPrompt(items: Array<{ title: string; body: string }>, persona: PersonaConfig): string {
  const hl = HOOK_LIMITS
  return [
    SYSTEM_PROMPT,
    ``,
    `目标读者画像：${persona.displayName}（${persona.id === 'newsline' ? '72 小时内的重大发布、突破与突发风险' : '模型机理、系统架构、评测反思、范式演进'}）`,
    ``,
    `对下列每条输出 JSON 数组，格式严格如下（不要任何解释文字、不要 markdown 围栏）：`,
    `[{"index":0,"hooks":["钩子1","钩子2","钩子3"],"summary":"篇幅达标的摘要","why":"≤${WHY_MAX}字推荐理由"}]`,
    ``,
    // 篇幅区间双约束（2026-09-06 老张「篇幅有要求，要满足」）：下限不达标会被终审
    // gk:summaryBelowFloor 拒收（薄稿直接不发布），prompt 不写区间=白烧一轮。
    `长度（码点，硬性区间）：钩子 zh≤${hl.zh} / en≤${hl.en}；摘要 zh ${SUMMARY_MIN.zh}–${SUMMARY_MAX.zh}、en ${SUMMARY_MIN.en}–${SUMMARY_MAX.en}（低于下限直接作废）；why≤${WHY_MAX}。`,
    ``,
    renderItemsBlock(items),
  ].join('\n')
}

interface RawCopy {
  index?: number
  hooks?: unknown
  summary?: unknown
  why?: unknown
}

/**
 * 单批写作。失败（超时/非 2xx/JSON 不可解析/截断）返回 error，由调用方降级——
 * **不得抛异常拖垮整轮**：writer 单轮 200 条约 53 分钟，一批失败不该让整轮报废
 * （沿用旧 LlmScorer 的「单批失败降级启发式」纪律）。
 */
export async function writeBatch(
  provider: EditorialProvider,
  items: Array<{ title: string; body: string }>,
  persona: PersonaConfig,
  opts: { maxTokens?: number } = {},
): Promise<WriterBatchResult> {
  if (items.length === 0) return { copies: [], truncated: false }
  try {
    const res = await provider.chat(buildWriterPrompt(items, persona), {
      ...opts,
      // 形状不对视同该端点失败 → 自动落备胎，而不是整批降机械
      validate: (content) => {
        if (!extractJsonArray(content).parsed) throw new Error('JSON 数组不可解析')
      },
    })
    const { items: parsed, parsed: ok } = extractJsonArray(res.content)
    if (!ok) {
      return { copies: items.map(() => null), usage: res.usage, truncated: res.truncated, error: 'JSON 数组不可解析' }
    }
    const out: Array<WrittenCopy | null> = items.map(() => null)
    for (const raw of parsed as RawCopy[]) {
      const idx = typeof raw.index === 'number' ? raw.index : -1
      if (idx < 0 || idx >= out.length) continue
      const copy = normalizeCopy(raw, items[idx]!, persona)
      if (copy) out[idx] = copy
    }
    return { copies: out, usage: res.usage, truncated: res.truncated }
  } catch (err) {
    return {
      copies: items.map(() => null),
      truncated: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * 归一化模型输出：限长、去重、剔除不合规钩子。
 *
 * **不信任模型遵守长度约束**：实测思考型模型会把 reasoning 算进 completion，
 * 可见输出长度不可预期。故一律按码点截断，并剔除条数不足/重复的结果返回 null
 * （交由调用方降级到机械兜底），而不是硬凑三条。
 */
export function normalizeCopy(raw: RawCopy, item: { title: string; body: string }, persona: PersonaConfig): WrittenCopy | null {
  const lang = detectLangOf(item)
  const hookMax = HOOK_LIMITS[lang]

  const hooks: string[] = []
  if (Array.isArray(raw.hooks)) {
    for (const h of raw.hooks) {
      if (typeof h !== 'string') continue
      const cleaned = h.replace(/\s+/g, ' ').trim()
      if (cleaned.length === 0) continue
      const truncatedHook = truncateChars(cleaned, hookMax)
      if (hooks.includes(truncatedHook)) continue
      // 标题前缀截断不得入选：这是 DB-03 的头号文案缺陷，模型也会犯
      if (isPrefixOf(truncatedHook, item.title)) continue
      hooks.push(truncatedHook)
      if (hooks.length === 3) break
    }
  }
  if (hooks.length !== 3) return null

  const summary = typeof raw.summary === 'string' ? truncateChars(stripMeta(raw.summary), SUMMARY_MAX[lang]) : ''
  if (summary.length === 0) return null

  const whyRaw = typeof raw.why === 'string' ? raw.why.trim() : ''
  // 浮点回显铁律：模型若写出「价值 0.94」这类内容，直接判为不合格而不是悄悄改掉——
  // 悄悄改会让「模型没学会要求」这件事在看板上不可见
  if (/\d\.\d/.test(whyRaw)) return null
  const why = truncateChars(whyRaw, WHY_MAX)
  if (why.length === 0) return null

  return { hooks, summary, why, origin: 'llm' }
}

function isPrefixOf(hook: string, title: string): boolean {
  const bare = hook.replace(/…$/, '').trim()
  if (bare.length === 0 || !title.startsWith(bare)) return false
  return Array.from(bare).length >= Array.from(title).length * 0.6
}

function stripMeta(text: string): string {
  return text
    .replace(/^\s*arxiv:\S+\s*/i, ' ')
    .replace(/\bAnnounce Type:\s*\S+/gi, ' ')
    .replace(/^\s*Abstract:\s*/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectLangOf(item: { title: string; body: string }): 'zh' | 'en' {
  const sample = Array.from(`${item.title}\n${item.body}`).slice(0, 400)
  if (sample.length === 0) return 'en'
  let cjk = 0
  for (const ch of sample) {
    const code = ch.codePointAt(0) ?? 0
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) cjk += 1
  }
  return cjk / sample.length > 0.3 ? 'zh' : 'en'
}

/** 供 job 层使用：把 ScoredItem 投成 writer 需要的最小形状（不泄露内部字段给模型）。 */
export function toWriterInput(item: ScoredItem): { title: string; body: string } {
  return { title: item.title, body: item.body ?? '' }
}
