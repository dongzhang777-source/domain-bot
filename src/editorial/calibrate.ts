import { readFileSync } from 'node:fs'
import type { ReviewVerdict } from './reviewer.js'

/**
 * reviewer 灵敏度自检：**上线前必须先过，否则其分数不得用作任何判定**。
 *
 * 为什么这条是硬前置而不是"最好有"：本项目已经踩过一次完全同型的坑——
 * 「打分饱和 + 传送带消耗」使『噪音逐轮下降』这条验收标准**完全没有读数**
 * （既非假阳性也非假阴性，而是仪器对目标维度零灵敏度）。实测当时连续 18 条推送
 * 打分全部触顶 1.00，逐轮均值变化 +0.000/+0.000，质量在真实衰减而打分器看不见。
 *
 * reviewer 是新的打分仪器，同一个失效模式会原样重现：思考型模型给分时天然向
 * 7-8 集中（"看起来都还不错"），一旦饱和，minQualityScore 这条线就永远拦不到东西，
 * 而看板上分数一片祥和。故必须先证明**分值域对质量维度有灵敏度**，再谈用它。
 *
 * 三项自检（对应三种失效）：
 * 1. `distinctBuckets` —— 分数是否覆盖多个质量档（只落一档 = 无区分度）
 * 2. `saturationRate` —— 顶档占比是否过高（饱和 = 质量衰减不可见）
 * 3. `agreementRate` —— 与人工金标的判定一致率（不一致 = 尺子没对准）
 */

/** DB-03 的四档处置口径（0-2 / 3-4 / 5-6 / 7-10），与审计报告 §1.1 的质量分直方图一致。 */
export const SCORE_BUCKETS = [
  { id: 'trash', label: '0-2 广告/招聘/坏数据/卖课', min: 0, max: 2 },
  { id: 'low', label: '3-4 个人玩具/初级教程/情绪炒作', min: 3, max: 4 },
  { id: 'mid', label: '5-6 垂直探索/脚手架/次级媒体', min: 5, max: 6 },
  { id: 'high', label: '7-10 前沿论文/高价值工程/必读', min: 7, max: 10 },
] as const

export type BucketId = (typeof SCORE_BUCKETS)[number]['id']

export function bucketOf(score: number): BucketId {
  for (const b of SCORE_BUCKETS) if (score >= b.min && score <= b.max) return b.id
  return score < 0 ? 'trash' : 'high'
}

/**
 * 金标样本：取自 DB-03 审计报告 §1.2 的 65 条剔除清单与 §1.3 的 200 条逐条判定表。
 * `humanScore` / `humanDecision` 是 agy 全量逐条审计的人工判定，不是合成期望值——
 * 用合成样本自检等于让仪器给自己发合格证。
 */
export interface GoldSample {
  id: string
  title: string
  body?: string
  humanScore: number
  humanDecision: '保留' | '降权' | '剔除'
  humanCategory?: string
  /** DB-03 里的剔除原因归类，供不一致时定位是哪类内容判错了 */
  reason?: string
}

export interface CalibrationThresholds {
  /** 分数至少要覆盖几个质量档 */
  minDistinctBuckets: number
  /** 顶档（7-10）占比上限，超过即判饱和 */
  maxSaturationRate: number
  /** 与人工判定的一致率下限 */
  minAgreementRate: number
}

export const DEFAULT_THRESHOLDS: CalibrationThresholds = {
  minDistinctBuckets: 3,
  maxSaturationRate: 0.5,
  minAgreementRate: 0.7,
}

export interface CalibrationReport {
  sampleCount: number
  scoredCount: number
  /** 漏答数：模型没给可解析分数的条目。**漏答率高本身就是一项不合格** */
  missingCount: number
  bucketDistribution: Record<BucketId, number>
  distinctBuckets: number
  /** 顶档（7-10）占比 */
  saturationRate: number
  /** 分数标准差：0 意味着全部同分，比饱和更极端 */
  scoreStdDev: number
  agreementRate: number
  /** 一致率按人工档位拆分——只看总一致率会掩盖「高档判得准、垃圾档全放过」这种致命偏斜 */
  agreementByHumanBucket: Record<BucketId, { total: number; agreed: number }>
  disagreements: Array<{ id: string; title: string; humanScore: number; llmScore: number | null; humanDecision: string; llmDecision: string | null; reason?: string }>
  problems: string[]
}

/**
 * 评估 reviewer 对金标集的表现。
 *
 * @param verdicts 与 gold **同序**的 reviewer 判定（null = 漏答）
 */
export function assessCalibration(
  gold: GoldSample[],
  verdicts: Array<ReviewVerdict | null>,
  thresholds: CalibrationThresholds = DEFAULT_THRESHOLDS,
): CalibrationReport {
  if (gold.length !== verdicts.length) {
    throw new Error(`金标集与判定数量不一致（${gold.length} vs ${verdicts.length}），无法逐条对齐`)
  }

  const bucketDistribution: Record<BucketId, number> = { trash: 0, low: 0, mid: 0, high: 0 }
  const agreementByHumanBucket: Record<BucketId, { total: number; agreed: number }> = {
    trash: { total: 0, agreed: 0 },
    low: { total: 0, agreed: 0 },
    mid: { total: 0, agreed: 0 },
    high: { total: 0, agreed: 0 },
  }
  const disagreements: CalibrationReport['disagreements'] = []
  const scores: number[] = []
  let scoredCount = 0
  let agreed = 0

  for (let i = 0; i < gold.length; i++) {
    const g = gold[i]!
    const v = verdicts[i]
    const humanBucket = bucketOf(g.humanScore)
    agreementByHumanBucket[humanBucket].total += 1

    if (!v) {
      disagreements.push({
        id: g.id, title: g.title, humanScore: g.humanScore, llmScore: null,
        humanDecision: g.humanDecision, llmDecision: null, reason: g.reason,
      })
      continue
    }

    scoredCount += 1
    scores.push(v.score)
    bucketDistribution[bucketOf(v.score)] += 1
    if (v.decision === g.humanDecision) {
      agreed += 1
      agreementByHumanBucket[humanBucket].agreed += 1
    } else {
      disagreements.push({
        id: g.id, title: g.title, humanScore: g.humanScore, llmScore: v.score,
        humanDecision: g.humanDecision, llmDecision: v.decision, reason: g.reason,
      })
    }
  }

  const distinctBuckets = Object.values(bucketDistribution).filter((n) => n > 0).length
  const saturationRate = scoredCount === 0 ? 0 : bucketDistribution.high / scoredCount
  const agreementRate = gold.length === 0 ? 0 : agreed / gold.length
  const mean = scores.length === 0 ? 0 : scores.reduce((a, b) => a + b, 0) / scores.length
  const variance = scores.length === 0 ? 0 : scores.reduce((a, s) => a + (s - mean) ** 2, 0) / scores.length

  const problems: string[] = []
  if (distinctBuckets < thresholds.minDistinctBuckets) {
    problems.push(
      `分值域无区分度：${scoredCount} 条只落在 ${distinctBuckets} 个质量档（要求 ≥${thresholds.minDistinctBuckets}）。` +
        `分布 ${JSON.stringify(bucketDistribution)}——这样的分数不能用作任何判定。`,
    )
  }
  if (saturationRate > thresholds.maxSaturationRate) {
    problems.push(
      `打分饱和：顶档(7-10) 占比 ${(saturationRate * 100).toFixed(1)}% 超上限 ${(thresholds.maxSaturationRate * 100).toFixed(0)}%。` +
        `饱和后 minQualityScore 永远拦不到东西，质量衰减在观测上不可见（本项目已踩过同型坑）。`,
    )
  }
  if (agreementRate < thresholds.minAgreementRate) {
    problems.push(
      `与人工金标一致率 ${(agreementRate * 100).toFixed(1)}% 低于下限 ${(thresholds.minAgreementRate * 100).toFixed(0)}%（${agreed}/${gold.length}）。`,
    )
  }
  // 垃圾档的一致率单列：总一致率高但垃圾档全放过，是最致命的偏斜——
  // 那正是老张批评的场景（招聘广告与卖课视频堂而皇之进信息流）
  const trash = agreementByHumanBucket.trash
  if (trash.total > 0 && trash.agreed / trash.total < thresholds.minAgreementRate) {
    problems.push(
      `垃圾档(人工 0-2 分) 一致率仅 ${((trash.agreed / trash.total) * 100).toFixed(1)}%（${trash.agreed}/${trash.total}）：` +
        `reviewer 在放过广告/招聘/坏数据/卖课，这是最致命的偏斜，总一致率掩盖不了它。`,
    )
  }
  const missingCount = gold.length - scoredCount
  if (missingCount / Math.max(1, gold.length) > 0.2) {
    problems.push(`漏答率 ${((missingCount / gold.length) * 100).toFixed(1)}%（${missingCount}/${gold.length}）过高，端点或 prompt 有问题。`)
  }
  if (scores.length > 1 && Math.sqrt(variance) < 0.5) {
    problems.push(`分数标准差仅 ${Math.sqrt(variance).toFixed(3)}，几乎全部同分——比饱和更极端，仪器无灵敏度。`)
  }

  return {
    sampleCount: gold.length,
    scoredCount,
    missingCount,
    bucketDistribution,
    distinctBuckets,
    saturationRate,
    scoreStdDev: Math.sqrt(variance),
    agreementRate,
    agreementByHumanBucket,
    disagreements,
    problems,
  }
}

export function isCalibrated(report: CalibrationReport): boolean {
  return report.problems.length === 0
}

export function loadGoldStandard(path: string): GoldSample[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { samples?: GoldSample[] }
  if (!Array.isArray(raw.samples)) throw new Error(`金标集格式非法（缺 samples 数组）：${path}`)
  return raw.samples
}

/** 人话报告，供 CLI 与看板使用。 */
export function formatCalibration(report: CalibrationReport): string {
  const lines = [
    `reviewer 灵敏度自检：${report.scoredCount}/${report.sampleCount} 条有分，漏答 ${report.missingCount}`,
    `  档位分布：${SCORE_BUCKETS.map((b) => `${b.id}=${report.bucketDistribution[b.id]}`).join(' ')}`,
    `  区分档数：${report.distinctBuckets}｜顶档占比：${(report.saturationRate * 100).toFixed(1)}%｜标准差：${report.scoreStdDev.toFixed(2)}`,
    `  与人工金标一致率：${(report.agreementRate * 100).toFixed(1)}%`,
    `  分档一致率：${SCORE_BUCKETS.map((b) => {
      const s = report.agreementByHumanBucket[b.id]
      return `${b.id} ${s.agreed}/${s.total}`
    }).join('｜')}`,
  ]
  if (report.problems.length === 0) {
    lines.push('  ✅ 通过：分值域对质量维度有灵敏度，可用于触发递补（但仍不得作为终审闸门）')
  } else {
    lines.push('  ❌ 未通过，分数不得用于任何判定：')
    for (const p of report.problems) lines.push(`    - ${p}`)
    lines.push(`  最不一致的前 5 条：`)
    for (const d of report.disagreements.slice(0, 5)) {
      lines.push(`    - [${d.id}] ${d.title.slice(0, 50)}｜人工 ${d.humanScore}/${d.humanDecision} vs 模型 ${d.llmScore ?? '漏答'}/${d.llmDecision ?? '-'}${d.reason ? `（${d.reason}）` : ''}`)
    }
  }
  return lines.join('\n')
}
