import { join } from 'node:path'
import type { FetchFn, PersonaConfig, ScoredItem } from '../types.js'
import { EditorialProvider, type EditorialConfig, type Usage } from './provider.js'
import { makeJobId, runJob, type JobResult, type EndpointUsageStat } from './job.js'
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
  /**
   * 只跑指定角色（缺省两者都跑）。
   *
   * 分阶段命令 `edit` / `review` 靠它把一次过夜批产拆成两个独立进程：
   * writer 实测 ≈53 分钟、reviewer ≈6 分钟，合成一个进程时中途失败就得从头再来。
   *
   * **roles=['writer'] 仍会先跑 reviewer 的金标自检**：写与评分离，评分侧不可信时
   * 写作侧的产出无从验收（见下方 calibration 前置的说明）。自检成本 ≈90 秒，
   * 相对 53 分钟的写作可忽略，换的是「writer 产物一定可被验收」这条不变量。
   */
  roles?: Array<'writer' | 'reviewer'>
}

/** 单个端点的用量。看板与 staging 快照共用此形态。 */
export interface EditorialEndpointStat {
  role: 'writer' | 'reviewer'
  endpointId: string
  calls: number
  failures: number
  reasoningTokens: number
  elapsedMs: number
}

/**
 * 归一化的编辑部执行统计。
 *
 * 为什么不直接读 `writerJob.state`：分阶段作业时 job 在**另一个进程**里跑完，
 * `publish` 阶段的 outcome 由 staging 快照重建，手上没有 job 对象。
 * 看板只读本字段，两条路径（整链 run / 分段 publish）的看板口径才不会漂。
 */
export interface EditorialStats {
  endpoints: EditorialEndpointStat[]
  writerDegradedBatches: number
  reviewerDegradedBatches: number
  truncatedBatches: number
}

export const EMPTY_EDITORIAL_STATS: EditorialStats = {
  endpoints: [],
  writerDegradedBatches: 0,
  reviewerDegradedBatches: 0,
  truncatedBatches: 0,
}

/** 从 job 结果提取归一化统计（job 为 null 表示该角色本轮未跑）。 */
export function statsFromJobs(
  writerJob?: JobResult<WrittenCopy> | null,
  reviewerJob?: JobResult<ReviewVerdict> | null,
): EditorialStats {
  const endpoints: EditorialEndpointStat[] = []
  for (const [role, job] of [
    ['writer', writerJob],
    ['reviewer', reviewerJob],
  ] as const) {
    for (const [endpointId, s] of Object.entries(job?.state.endpointUsage ?? {} as Record<string, EndpointUsageStat>)) {
      endpoints.push({
        role,
        endpointId,
        calls: s.calls,
        failures: s.failures,
        reasoningTokens: s.reasoningTokens,
        elapsedMs: s.elapsedMs,
      })
    }
  }
  return {
    endpoints,
    writerDegradedBatches: writerJob?.state.degradedBatches.length ?? 0,
    reviewerDegradedBatches: reviewerJob?.state.degradedBatches.length ?? 0,
    truncatedBatches:
      (writerJob?.state.truncatedBatches.length ?? 0) + (reviewerJob?.state.truncatedBatches.length ?? 0),
  }
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
  /** 归一化统计（见 EditorialStats 的说明）。未启用/未生效时为空值而非缺字段 */
  stats: EditorialStats
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
    stats: EMPTY_EDITORIAL_STATS,
  }

  if (!opts.config.enabled) {
    return { ...empty, inactiveReason: 'config/editor.json 的 enabled=false（走启发式打分 + 机械渲染兜底）' }
  }
  if (opts.candidates.length === 0) {
    return { ...empty, inactiveReason: '候选为空，无需编辑' }
  }

  const writerProvider = new EditorialProvider(opts.config.writer, env, opts.fetchFn)
  const reviewerProvider = new EditorialProvider(opts.config.reviewer, env, opts.fetchFn)
  const wantWriter = opts.roles?.includes('writer') ?? true
  const wantReviewer = opts.roles?.includes('reviewer') ?? true
  const writerUsable = wantWriter && writerProvider.available
  const reviewerUsable = wantReviewer && reviewerProvider.available
  if (!writerUsable && !reviewerUsable) {
    return {
      ...empty,
      inactiveReason: `本次请求的角色（${opts.roles?.join('+') ?? 'writer+reviewer'}）在降级链上均无可解析端点（baseUrl 全空）`,
    }
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

  const writerJobPromise = writerUsable
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

  const reviewerJobPromise = reviewerUsable
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
    stats: statsFromJobs(writerJob, reviewerJob),
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
