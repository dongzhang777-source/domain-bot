import { join } from 'node:path'
import type { FetchFn, PersonaConfig, ScoredItem } from '../types.js'
import { EditorialProvider, type EditorialConfig, type Usage } from './provider.js'
import { makeJobId, runJob, type JobResult } from './job.js'
import { toWriterInput, writeBatch, type WrittenCopy } from './writer.js'
import { reviewBatch, meetsQualityBar, type ReviewVerdict } from './reviewer.js'
import { assessCalibration, isCalibrated, loadGoldStandard, type CalibrationReport, type CalibrationThresholds, type GoldSample } from './calibrate.js'

export { EditorialProvider, resolveChain, resolveEndpoint, extractJsonArray, AllEndpointsFailedError } from './provider.js'
export type { EditorialConfig, EndpointConfig, ResolvedEndpoint, RoleConfig, Usage } from './provider.js'
export { makeJobId, runJob, jobPath, loadJobState } from './job.js'
export type { JobState, JobResult, BatchOutcome, EndpointUsageStat } from './job.js'
export { buildWriterPrompt, normalizeCopy, toWriterInput, writeBatch } from './writer.js'
export type { WrittenCopy, WriterBatchResult } from './writer.js'
export { buildReviewerPrompt, meetsQualityBar, normalizeVerdict, reviewBatch } from './reviewer.js'
export type { ReviewVerdict, ReviewDecision, ReviewCategory, ReviewerBatchResult } from './reviewer.js'
export {
  DEFAULT_THRESHOLDS,
  SCORE_BUCKETS,
  assessCalibration,
  bucketOf,
  formatCalibration,
  isCalibrated,
  loadGoldStandard,
} from './calibrate.js'
export type { CalibrationReport, CalibrationThresholds, GoldSample } from './calibrate.js'

/**
 * AI 编辑部编排：writer 与 reviewer **并行**跑（不同端点），产物合并进渲染与递补。
 *
 * 并行的依据是实测吞吐：writer 批=3 单批 47.1s（200 条约 53 分钟），reviewer 批=10
 * 单批 17.8s（约 6 分钟）。两者走不同端点（writer 默认云端 8052、reviewer 默认本地 8080）
 * 互不抢资源，墙钟由 writer 决定 ≈53 分钟，落在老张认可的「过夜批产 1 小时级」内。
 * 若两者配成同一端点则**串行更安全**（llama-server 单槽位默认串行，并发会互相拖慢），
 * 由 `sameEndpoint` 判定自动切换。
 *
 * **降级语义（关键）**：编辑部不可用（enabled=false / 端点全链失败 / 校准未过）时，
 * 产线**不得停摆**，而是退回阶段一行为——启发式打分 + 机械渲染兜底，
 * 且看板必须显式记 `editorialActive=false` 与原因。静默降级正是「格式全绿≠内容合格」
 * 的老毛病：质量塌回原点却没人看得见。
 */

export interface EditorialRunOptions {
  config: EditorialConfig
  persona: PersonaConfig
  candidates: ScoredItem[]
  root: string
  now?: number
  env?: NodeJS.ProcessEnv
  /** 测试注入点：代替真实 HTTP，否则单测会去连本机模型服务 */
  fetchFn?: FetchFn
  /** 金标集路径（缺省取 config.calibration.goldStandardPath） */
  goldStandardPath?: string
  calibrationThresholds?: CalibrationThresholds
  onProgress?: (line: string) => void
}

export interface EditorialOutcome {
  enabled: boolean
  /** 编辑部是否真的产出了 LLM 文案（false = 全程走机械兜底） */
  active: boolean
  /** 未生效的原因，看板必须落盘（不得静默降级） */
  inactiveReason?: string
  copies: Array<WrittenCopy | null>
  verdicts: Array<ReviewVerdict | null>
  /** 达到 persona.minQualityScore 的下标；reviewer 未生效时为 null（表示"未做质量排序"） */
  qualifiedIndices: number[] | null
  writerJob?: JobResult<WrittenCopy>
  reviewerJob?: JobResult<ReviewVerdict>
  calibration?: CalibrationReport
  usage: { writer: Usage | null; reviewer: Usage | null }
}

export async function runEditorial(opts: EditorialRunOptions): Promise<EditorialOutcome> {
  const log = opts.onProgress ?? (() => {})
  const now = opts.now ?? Date.now()
  const env = opts.env ?? process.env
  const empty: EditorialOutcome = {
    enabled: opts.config.enabled,
    active: false,
    copies: opts.candidates.map(() => null),
    verdicts: opts.candidates.map(() => null),
    qualifiedIndices: null,
    usage: { writer: null, reviewer: null },
  }

  if (!opts.config.enabled) {
    return { ...empty, inactiveReason: 'config/editor.json 的 enabled=false（走启发式打分 + 机械渲染兜底）' }
  }
  if (opts.candidates.length === 0) {
    return { ...empty, inactiveReason: '候选为空，无需编辑' }
  }

  const writerProvider = new EditorialProvider(opts.config.writer, env, opts.fetchFn)
  const reviewerProvider = new EditorialProvider(opts.config.reviewer, env, opts.fetchFn)
  if (!writerProvider.available && !reviewerProvider.available) {
    return { ...empty, inactiveReason: 'writer 与 reviewer 的降级链均无可解析端点（baseUrl 全空）' }
  }

  // 校准前置于生产：reviewer 分数没通过灵敏度自检就不得参与递补决策。
  // 这不是形式主义——本项目已有「打分饱和使验收标准完全无读数」的前车之鉴。
  let calibration: CalibrationReport | undefined
  const goldPath = opts.goldStandardPath ?? opts.config.calibration?.goldStandardPath
  if (reviewerProvider.available && goldPath) {
    const absGold = goldPath.startsWith('/') ? goldPath : join(opts.root, goldPath)
    try {
      const gold = loadGoldStandard(absGold)
      const verdicts = await reviewGold(reviewerProvider, gold, opts.persona, opts.config)
      calibration = assessCalibration(gold, verdicts, opts.calibrationThresholds ?? thresholdsFrom(opts.config))
      log(formatForLog(calibration))
      if (!isCalibrated(calibration)) {
        return {
          ...empty,
          calibration,
          inactiveReason:
            'reviewer 灵敏度自检未通过，其分数不得用于判定（详见 calibration.problems）；' +
            '本轮退回机械兜底，writer 也不启用——写与评分离，评分侧不可信时写作侧的产出无从验收',
        }
      }
    } catch (err) {
      return {
        ...empty,
        inactiveReason: `金标集自检无法执行：${err instanceof Error ? err.message : err}`,
      }
    }
  }

  const inputs = opts.candidates.map(toWriterInput)
  const sameEndpoint =
    writerProvider.endpoints[0]?.baseUrl === reviewerProvider.endpoints[0]?.baseUrl

  const writerJobPromise = writerProvider.available
    ? runJob<ReturnType<typeof toWriterInput>, WrittenCopy>({
        jobId: makeJobId('writer', opts.persona.id, now),
        role: 'writer',
        persona: opts.persona,
        items: inputs,
        batchSize: opts.config.writer.batchSize,
        stagingDir: join(opts.root, opts.config.stagingDir),
        runBatch: async (batch) => {
          const r = await writeBatch(writerProvider, batch, opts.persona, { maxTokens: opts.config.writer.maxTokens })
          return { results: r.copies, usage: r.usage, truncated: r.truncated, error: r.error }
        },
        onProgress: (s) => log(`[writer] ${s.completedBatches.length}/${s.totalBatches} 批完成，降级 ${s.degradedBatches.length}`),
      })
    : Promise.resolve(null)

  const reviewerJobPromise = reviewerProvider.available
    ? runJob<ReturnType<typeof toWriterInput>, ReviewVerdict>({
        jobId: makeJobId('reviewer', opts.persona.id, now),
        role: 'reviewer',
        persona: opts.persona,
        items: inputs,
        batchSize: opts.config.reviewer.batchSize,
        stagingDir: join(opts.root, opts.config.stagingDir),
        runBatch: async (batch) => {
          const r = await reviewBatch(reviewerProvider, batch, opts.persona, { maxTokens: opts.config.reviewer.maxTokens })
          return { results: r.verdicts, usage: r.usage, truncated: r.truncated, error: r.error }
        },
        onProgress: (s) => log(`[reviewer] ${s.completedBatches.length}/${s.totalBatches} 批完成，降级 ${s.degradedBatches.length}`),
      })
    : Promise.resolve(null)

  // 同端点时串行（llama-server 单槽位，并发会互相拖慢甚至排队超时）；异端点并行
  let writerJob: JobResult<WrittenCopy> | null
  let reviewerJob: JobResult<ReviewVerdict> | null
  if (sameEndpoint) {
    log('[editorial] writer 与 reviewer 同端点，改串执行（避免单槽位互相拖慢）')
    writerJob = await writerJobPromise
    reviewerJob = await reviewerJobPromise
  } else {
    ;[writerJob, reviewerJob] = await Promise.all([writerJobPromise, reviewerJobPromise])
  }

  const copies = writerJob?.results ?? opts.candidates.map(() => null)
  const verdicts = reviewerJob?.results ?? opts.candidates.map(() => null)

  const qualifiedIndices = reviewerJob
    ? verdicts
        .map((v, i) => ({ v, i }))
        .filter(({ v }) => v !== null && meetsQualityBar(v, opts.persona))
        .map(({ i }) => i)
    : null

  const active = copies.some((c) => c !== null) || verdicts.some((v) => v !== null)
  return {
    enabled: true,
    active,
    inactiveReason: active ? undefined : '两端点均失败，全部批次降级（详见 job 的 degradedBatches）',
    copies,
    verdicts,
    qualifiedIndices,
    writerJob: writerJob ?? undefined,
    reviewerJob: reviewerJob ?? undefined,
    calibration,
    usage: {
      writer: writerJob ? lastUsage(writerJob.state.endpointUsage) : null,
      reviewer: reviewerJob ? lastUsage(reviewerJob.state.endpointUsage) : null,
    },
  }
}

function lastUsage(endpointUsage: Record<string, { promptTokens: number; completionTokens: number; reasoningTokens: number; elapsedMs: number; calls: number; failures: number }>): Usage | null {
  const entries = Object.entries(endpointUsage)
  if (entries.length === 0) return null
  const [endpointId, s] = entries.reduce((a, b) => (b[1].calls > a[1].calls ? b : a))
  return {
    endpointId,
    model: '',
    promptTokens: s.promptTokens,
    completionTokens: s.completionTokens,
    reasoningTokens: s.reasoningTokens,
    elapsedMs: s.elapsedMs,
  }
}

function thresholdsFrom(config: EditorialConfig): CalibrationThresholds {
  const c = config.calibration ?? {}
  return {
    minDistinctBuckets: c.minDistinctBuckets ?? 3,
    maxSaturationRate: c.maxSaturationRate ?? 0.5,
    minAgreementRate: c.minAgreementRate ?? 0.7,
  }
}

/** 用金标集跑一遍 reviewer，得到与 gold 同序的判定（null = 漏答）。 */
async function reviewGold(
  provider: EditorialProvider,
  gold: GoldSample[],
  persona: PersonaConfig,
  config: EditorialConfig,
): Promise<Array<ReviewVerdict | null>> {
  const inputs = gold.map((g) => ({ title: g.title, body: g.body ?? '' }))
  const job = await runJob<{ title: string; body: string }, ReviewVerdict>({
    jobId: `calibrate-${persona.id}`,
    role: 'reviewer',
    persona,
    items: inputs,
    batchSize: config.reviewer.batchSize,
    // 校准作业不落进度文件：它是自检而非生产，续跑语义在此无意义且会污染 staging
    stagingDir: join(process.cwd(), '.tmp-calibration'),
    runBatch: async (batch) => {
      const r = await reviewBatch(provider, batch, persona, { maxTokens: config.reviewer.maxTokens })
      return { results: r.verdicts, usage: r.usage, truncated: r.truncated, error: r.error }
    },
  })
  return job.results
}

function formatForLog(report: CalibrationReport): string {
  return `[calibrate] 一致率 ${(report.agreementRate * 100).toFixed(1)}%｜区分档 ${report.distinctBuckets}｜顶档 ${(report.saturationRate * 100).toFixed(1)}%｜问题 ${report.problems.length}`
}
