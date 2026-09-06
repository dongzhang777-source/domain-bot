import type { PersonaConfig } from '../types.js'
import { EditorialProvider, extractJsonArray, renderItemsBlock, type Usage } from './provider.js'

/**
 * AI 编辑部的「评」侧：独立模型审读打分 + 处置建议。
 *
 * **写与评分离**（老张 2026-09-04 裁决 4）：reviewer 必须与 writer 用**不同底座**，
 * 否则同一模型既写又评构成循环——它给自己写的文案打分，分数没有信息量。
 * 默认 writer 走云端 longcat 族、reviewer 走本地 Qwen3.8 族（异族异失效模式）。
 *
 * **reviewer 的分数只上看板，不做终审闸门**（DB-04 设计决定）。理由有两条，都是踩过的坑：
 * 1. 本项目已有「打分饱和 + 传送带消耗使『噪音逐轮下降』验收标准完全无读数」的前车之鉴
 *    （见 docs/probe-changelog.md 与总管记忆）：计数型打分器触顶后，任何基于分数时间序列
 *    的观测都得到一条恒定直线，无法区分「学习生效」与「候选池枯竭」。
 * 2. LLM 自分自用构成循环。故终审权力交给 `src/gatekeeper/` 的十条**客观可判定**断言。
 *
 * reviewer 分数唯一的合法用途：低于 persona.minQualityScore 时触发**候补递补**
 * （换一条更好的进来），而不是「判定这条内容合格」。上线前必须先过 `calibrate.ts`
 * 的灵敏度自检——分值域对质量维度没有灵敏度的打分器，用了等于没有。
 */

export type ReviewDecision = '保留' | '降权' | '剔除'
export type ReviewCategory = 'AI核心' | 'AI应用' | 'AI周边' | '无关'

export interface ReviewVerdict {
  score: number
  decision: ReviewDecision
  category: ReviewCategory
  rejectReason: string
  origin: 'llm' | 'fallback'
}

export interface ReviewerBatchResult {
  verdicts: Array<ReviewVerdict | null>
  usage?: Usage
  truncated: boolean
  error?: string
}

/**
 * 打分标尺直接搬 DB-03 审计的口径（0-10，标尺=对 AI 从业者的决策价值），
 * 这样 reviewer 的分与 agy 那份 200 条人工审计**可比**——金标样本集
 * （tests/fixtures/gold-standard.json）就是从那 65 条剔除清单 + 89 条 ≥7 分清单来的。
 */
const SYSTEM_PROMPT = `你是深耕人工智能与大语言模型领域的资深智库主编兼技术专家，为 AI 算法工程师、系统架构师及技术决策者把关。

【打分标尺（0-10 整数，标尺=对从业者的决策价值）】
- 9-10：顶尖技术突围 / 重要开源发布 / 核心基础设施重大隐患（必读）
- 7-8：扎实的前沿研究论文 / 高价值工程实践 / 关键评测反思
- 5-6：合格的垂直场景探索 / 工具脚手架 / 次级媒体报道
- 3-4：低价值个人玩具 / 初学者教程 / 自媒体情绪炒作
- 0-2：广告、招聘、完全无关泛科技、坏数据、小白卖课

【类别】AI核心（模型架构/Agent/推理加速/训练/基准/端侧轻量化）｜AI应用（垂直行业落地/权威宏观动态/政策）｜AI周边（个人练手/初级通识/学习合集/小众插件）｜无关（硬件/招聘/广告/损坏数据/完全重复/过时旧闻/社区闲聊）

【处置】保留（≥7）｜降权（5-6）｜剔除（≤4 或类别为无关）

【铁律】
- 打分必须用满值域：不得集中在 7-8（打分饱和会让质量衰减在观测上不可见）
- 个人简历仓库、学生作业、求职笔试、培训机构卖课一律 0-2 分
- 同一事件的多媒体跟风转述，只给权威首发高分，其余按同质化降权
- 不得因为标题堆砌 AI 关键词就给高分（招聘帖与中转站广告天然含最全关键词）`

export function buildReviewerPrompt(items: Array<{ title: string; body: string }>, persona: PersonaConfig): string {
  return [
    SYSTEM_PROMPT,
    ``,
    `本次为「${persona.displayName}」把关：${
      persona.id === 'newsline'
        ? '时效硬约束 72 小时，严禁炒作标题党、二手无源传闻、培训营销'
        : '允许 30 天内，重在思想的长远参考价值，严禁无实验支撑的空洞观点与泛泛名词解释'
    }。`,
    ``,
    `对下列每条输出 JSON 数组，格式严格如下（不要任何解释文字、不要 markdown 围栏）：`,
    `[{"index":0,"score":8,"decision":"保留","category":"AI核心","rejectReason":""}]`,
    ``,
    renderItemsBlock(items),
  ].join('\n')
}

interface RawVerdict {
  index?: number
  score?: unknown
  decision?: unknown
  category?: unknown
  rejectReason?: unknown
}

const DECISIONS: ReviewDecision[] = ['保留', '降权', '剔除']
const CATEGORIES: ReviewCategory[] = ['AI核心', 'AI应用', 'AI周边', '无关']

/** 单批审读。失败返回 error 由调用方降级，不抛异常拖垮整轮（理由同 writer）。 */
export async function reviewBatch(
  provider: EditorialProvider,
  items: Array<{ title: string; body: string }>,
  persona: PersonaConfig,
  opts: { maxTokens?: number } = {},
): Promise<ReviewerBatchResult> {
  if (items.length === 0) return { verdicts: [], truncated: false }
  try {
    const res = await provider.chat(buildReviewerPrompt(items, persona), {
      ...opts,
      // 形状不对视同该端点失败 → 自动落备胎，而不是整批降机械
      validate: (content) => {
        if (!extractJsonArray(content).parsed) throw new Error('JSON 数组不可解析')
      },
    })
    const { items: parsed, parsed: ok } = extractJsonArray(res.content)
    if (!ok) {
      return { verdicts: items.map(() => null), usage: res.usage, truncated: res.truncated, error: 'JSON 数组不可解析' }
    }
    const out: Array<ReviewVerdict | null> = items.map(() => null)
    for (const raw of parsed as RawVerdict[]) {
      const idx = typeof raw.index === 'number' ? raw.index : -1
      if (idx < 0 || idx >= out.length) continue
      const v = normalizeVerdict(raw)
      if (v) out[idx] = v
    }
    return { verdicts: out, usage: res.usage, truncated: res.truncated }
  } catch (err) {
    return { verdicts: items.map(() => null), truncated: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 归一化模型输出。
 *
 * **漏答不用常数填**：旧 LlmScorer 曾对漏答条目填 0.5，在观测序列里造出一个假平台
 * （矩阵 P0-6 已修）。此处返回 null，由调用方决定降级路径，绝不用中间值冒充判定。
 */
export function normalizeVerdict(raw: RawVerdict): ReviewVerdict | null {
  const score = typeof raw.score === 'number' ? raw.score : Number(raw.score)
  if (!Number.isFinite(score)) return null
  const clamped = Math.max(0, Math.min(10, Math.round(score)))

  const decision = DECISIONS.includes(raw.decision as ReviewDecision)
    ? (raw.decision as ReviewDecision)
    : // 模型没给合法 decision 时按分数推定，而不是丢弃整条（分数是主要信息）
      clamped >= 7
      ? '保留'
      : clamped >= 5
        ? '降权'
        : '剔除'

  const category = CATEGORIES.includes(raw.category as ReviewCategory) ? (raw.category as ReviewCategory) : 'AI周边'

  return {
    score: clamped,
    decision,
    category,
    rejectReason: typeof raw.rejectReason === 'string' ? raw.rejectReason.trim() : '',
    origin: 'llm',
  }
}

/** 是否达到该产线的准入分。分数只用于「换一条更好的」，不用于「判定这条合格」。 */
export function meetsQualityBar(verdict: ReviewVerdict, persona: PersonaConfig): boolean {
  return verdict.score >= persona.minQualityScore
}
