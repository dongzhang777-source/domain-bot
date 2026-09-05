import type { DropRecord, PersonaConfig, RawItem } from '../types.js'
import { EditorialProvider, extractJsonArray, renderItemsBlock, type Usage } from './provider.js'
import type { GoldSample } from './calibrate.js'

/**
 * 宽通道召回判定（DB-08，老张 2026-09-05 批「用关键词搜索内容会限制信息渠道」整改 Phase 2）。
 *
 * 关键词积分闸门是**召回信号，不是入选标准**——78 词词表外的交叉领域内容（AI 治理、
 * 硬件、经济学、新兴术语）会被结构性屏蔽。本模块把 relevance 未过但预筛达标的条目
 * 交 reviewer 做二元判定（include/exclude），捞回词表漏网的高价值内容。
 *
 * **边界（与 DB-04 §六.4 裁决对齐，不得越界）**：
 * - reviewer 在这里只回答「值不值得进信息流」的 include/exclude，**不产生质量分数**，
 *   不参与排序，不参与终审判定——终审仍由 `src/gatekeeper/assertions.ts` 的十条客观断言独占。
 * - 漏答（模型没给出可解析判定）fail-safe 按 exclude 处理：宽通道的目的是捞回，
 *   但「不确定」时宁可不捞——宁可少召回，不可错召回。
 * - 判定口径必须先过金标校准（assessRecallCalibration，期望由 DB-03 人工审计派生：
 *   剔除→exclude、保留/降权→include），未过标则宽通道整体回退关闭。
 */

export interface RecallVerdict {
  index: number
  include: boolean
  reason: string
}

export interface RecallJudgement {
  /** include=true 的原条目，保持入池顺序 */
  included: RawItem[]
  /** include=false 或漏答的条目，带可归因 drop 记录（gate: 'recall'） */
  excluded: DropRecord[]
  /** 漏答数：无有效判定的条目（解析失败 / index 越界 / 重复） */
  missing: number
  usage: Usage[]
  error?: string
}

export function buildRecallPrompt(items: RawItem[], persona: PersonaConfig): string {
  const block = renderItemsBlock(
    items.map((it) => ({ title: it.title, body: it.body })),
  )
  return [
    `You are the recall judge for an AI/LLM news feed ("${persona.displayName}").`,
    `The items below did NOT match the feed's keyword filter, but the keyword list is only a`,
    `recall signal — your job is to decide whether each item is still worth surfacing to a`,
    `reader who follows the AI/LLM field (including cross-domain topics: AI policy and safety,`,
    `AI hardware and compute, model economics, open-source ecosystem, notable non-ML uses of AI).`,
    ``,
    `Rules:`,
    `- include=true  only if the item is genuinely about AI/LLM-adjacent matters AND a thoughtful`,
    `  reader would learn something from it (not spam, not clickbait, not a job ad, not courseware).`,
    `- include=false for everything else. When unsure, answer include=false.`,
    `- Judge ONLY from the title and excerpt given.`,
    ``,
    `Output ONLY a JSON array, one object per item, in this exact shape:`,
    `[{"index": 0, "include": true, "reason": "<= 20 words"}, ...]`,
    ``,
    `Items:`,
    block,
  ].join('\n')
}

/** 把 LLM 输出对齐回条目。解析失败 / index 越界 / 重复 index 一律记 missing（fail-safe exclude）。 */
export function parseRecallVerdicts(
  raw: string,
  items: RawItem[],
): { verdicts: Array<RecallVerdict | null>; missing: number; parseError?: string } {
  const { items: arr, parsed } = extractJsonArray(raw)
  if (!parsed) return { verdicts: items.map(() => null), missing: items.length, parseError: '响应无 JSON 数组' }

  const byIndex = new Map<number, RecallVerdict>()
  let malformed = 0
  for (const el of arr) {
    if (typeof el !== 'object' || el === null) {
      malformed += 1
      continue
    }
    const idx = (el as Record<string, unknown>).index
    const inc = (el as Record<string, unknown>).include
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= items.length) {
      malformed += 1
      continue
    }
    if (byIndex.has(idx)) {
      malformed += 1
      continue
    }
    byIndex.set(idx, {
      index: idx,
      include: inc === true,
      reason: String((el as Record<string, unknown>).reason ?? ''),
    })
  }

  const verdicts = items.map((_, i) => byIndex.get(i) ?? null)
  return { verdicts, missing: verdicts.filter((v) => v === null).length, parseError: malformed > 0 ? `${malformed} 条判定格式无效` : undefined }
}

export async function judgeRecallPool(
  provider: EditorialProvider,
  items: RawItem[],
  persona: PersonaConfig,
  opts?: { maxTokens?: number },
): Promise<RecallJudgement> {
  const prompt = buildRecallPrompt(items, persona)
  const res = await provider.chat(prompt, { maxTokens: opts?.maxTokens })
  const { verdicts, missing, parseError } = parseRecallVerdicts(res.content, items)

  const included: RawItem[] = []
  const excluded: DropRecord[] = []
  verdicts.forEach((v, i) => {
    const item = items[i]!
    if (v?.include) {
      included.push(item)
      return
    }
    excluded.push({
      itemId: item.id,
      title: item.title,
      source: item.source,
      url: item.url,
      gate: 'recall',
      ruleId: v ? 'recall:excluded' : 'recall:unanswered',
      reason: v
        ? `LLM 判定不召回：${v.reason || '(无理由)'}`
        : `LLM 漏答，fail-safe 不召回${parseError ? `（${parseError}）` : ''}`,
    })
  })

  return { included, excluded, missing, usage: [res.usage], error: res.truncated ? '响应撞 max_tokens 被截断' : undefined }
}

// ---------- 校准 ----------

export interface RecallCalibrationReport {
  sampleCount: number
  judgedCount: number
  missingCount: number
  /** include 判定与金标期望（剔除→exclude，其余→include）的一致率 */
  agreementRate: number
  passed: boolean
  minAgreementRate: number
  disagreements: Array<{ id: string; title: string; expected: boolean; got: boolean | null; reason?: string }>
  problems: string[]
}

/** 金标期望：DB-03 人工判「剔除」的 → 期望 exclude；「保留/降权」→ 期望 include。 */
export function recallExpectation(g: GoldSample): boolean {
  return g.humanDecision !== '剔除'
}

export function assessRecallCalibration(
  gold: GoldSample[],
  verdicts: Array<RecallVerdict | null>,
  minAgreementRate: number,
): RecallCalibrationReport {
  if (gold.length !== verdicts.length) {
    throw new Error(`金标集与判定数量不一致（${gold.length} vs ${verdicts.length}），无法逐条对齐`)
  }
  const problems: string[] = []
  const disagreements: RecallCalibrationReport['disagreements'] = []
  let missingCount = 0
  let agreed = 0

  gold.forEach((g, i) => {
    const v = verdicts[i] ?? null
    const expected = recallExpectation(g)
    if (!v) {
      missingCount += 1
      disagreements.push({ id: g.id, title: g.title, expected, got: null, reason: g.reason })
      return
    }
    if (v.include === expected) agreed += 1
    else disagreements.push({ id: g.id, title: g.title, expected, got: v.include, reason: v.reason || g.reason })
  })

  const judgedCount = gold.length - missingCount
  const agreementRate = judgedCount > 0 ? agreed / gold.length : 0
  if (missingCount / Math.max(1, gold.length) > 0.3) {
    problems.push(`漏答率 ${(100 * missingCount) / gold.length}% 超过 30%，判定不可用（端点或 prompt 有问题）`)
  }
  if (agreementRate < minAgreementRate) {
    problems.push(`与人工金标期望一致率 ${(agreementRate * 100).toFixed(1)}% 低于下限 ${(minAgreementRate * 100).toFixed(0)}%`)
  }

  return {
    sampleCount: gold.length,
    judgedCount,
    missingCount,
    agreementRate,
    passed: problems.length === 0,
    minAgreementRate,
    disagreements,
    problems,
  }
}

/** 跑一遍金标的 recall 判定（校准用）。与 judgeRecallPool 同一 prompt 与解析路径。 */
export async function calibrateRecall(
  provider: EditorialProvider,
  gold: GoldSample[],
  persona: PersonaConfig,
  opts?: { maxTokens?: number; batchSize?: number; minAgreementRate?: number },
): Promise<RecallCalibrationReport> {
  const batchSize = opts?.batchSize ?? 10
  const verdicts: Array<RecallVerdict | null> = []
  for (let i = 0; i < gold.length; i += batchSize) {
    const batch = gold.slice(i, i + batchSize).map((g) => ({ id: g.id, title: g.title, body: g.body ?? '', source: 'gold', url: '' }) as unknown as RawItem)
    const r = await judgeRecallPool(provider, batch, persona, opts)
    verdicts.push(...parseRecallVerdictsOf(r, batch))
  }
  return assessRecallCalibration(gold, verdicts, opts?.minAgreementRate ?? 0.7)
}

function parseRecallVerdictsOf(
  judgement: RecallJudgement,
  items: RawItem[],
): Array<RecallVerdict | null> {
  // judgeRecallPool 已把 include/exclude 分流；校准需要逐条 verdict。
  // included 的顺序即 include=true 的条目顺序——按 itemId 映射回 include=true，
  // excluded 里 recall:excluded → false、recall:unanswered → null。
  const includeIds = new Set(judgement.included.map((it) => it.id))
  const excludeReasons = new Map(judgement.excluded.map((d) => [d.itemId, d.ruleId]))
  return items.map((it) => {
    if (includeIds.has(it.id)) return { index: 0, include: true, reason: '' }
    const rule = excludeReasons.get(it.id)
    if (rule === 'recall:excluded') return { index: 0, include: false, reason: '' }
    return null
  })
}
