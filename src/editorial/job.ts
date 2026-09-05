import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PersonaConfig } from '../types.js'
import type { Usage } from './provider.js'

/**
 * 长时批产作业：分批、进度落盘、断点续跑、失败降级。
 *
 * 为什么必须有断点续跑（实测数据决定，不是防御性编程）：
 * writer 批=3、单批 47.1s，200 条约 **53 分钟**；reviewer 批=10、单批 17.8s，约 6 分钟。
 * 老张已明确「可接受过夜批产（1 小时级）」。一小时级的作业中途被 Ctrl-C、被端点限流、
 * 被本机睡眠打断都是常态——没有进度落盘就得从头再跑 53 分钟。
 *
 * 为什么单批失败不拖垮整轮：沿用旧 LlmScorer 的纪律（矩阵 P0-6）——arXiv 单轮上百条，
 * 一批抛异常就断档，探针读数直接废掉。失败批标记为 degraded，由调用方走机械兜底。
 */

export interface BatchOutcome<TResult> {
  results: Array<TResult | null>
  usage?: Usage
  truncated: boolean
  error?: string
}

export interface EndpointUsageStat {
  calls: number
  promptTokens: number
  completionTokens: number
  /** 思考型模型的推理 token。实测占 completion 的 70-85%，不单独记就会把批大小估错一个量级 */
  reasoningTokens: number
  elapsedMs: number
  failures: number
}

export interface JobState<TResult> {
  schema: 'domain-bot-editorial-job-v1'
  jobId: string
  role: 'writer' | 'reviewer'
  persona: string
  createdAt: number
  updatedAt: number
  totalItems: number
  batchSize: number
  totalBatches: number
  /** 已完成的批序号（续跑时跳过） */
  completedBatches: number[]
  /** 降级批序号（端点全链失败或响应不可解析，产物由调用方走机械兜底） */
  degradedBatches: number[]
  /** 批序号 → 该批结果（null 表示该条漏答） */
  resultsByBatch: Record<string, Array<TResult | null>>
  /** 端点级用量：降级链走到哪一档、各档耗多少，看板要能看出来 */
  endpointUsage: Record<string, EndpointUsageStat>
  /** 因 max_tokens 撞顶被截断的批数（>0 说明批大小或 maxTokens 配错了） */
  truncatedBatches: number[]
}

export interface RunJobOptions<TItem, TResult> {
  jobId: string
  role: 'writer' | 'reviewer'
  persona: PersonaConfig
  items: TItem[]
  batchSize: number
  /** 绝对路径或相对仓根；进度文件落 `<stagingDir>/<jobId>.json` */
  stagingDir: string
  runBatch: (batch: TItem[], batchIndex: number) => Promise<BatchOutcome<TResult>>
  onProgress?: (state: JobState<TResult>) => void
  now?: () => number
}

export interface JobResult<TResult> {
  state: JobState<TResult>
  /** 展平后的逐条结果，长度 === items.length */
  results: Array<TResult | null>
  /** 本次运行实际执行的批数（续跑时已完成的不计） */
  batchesRun: number
  resumed: boolean
  path: string
}

export function emptyJobState<TResult>(
  opts: {
    jobId: string
    role: 'writer' | 'reviewer'
    /** persona id（字符串），不是整个 PersonaConfig——进度文件落盘不需要携带配置全文 */
    persona: string
    batchSize: number
    totalItems: number
    totalBatches: number
  },
  now: number,
): JobState<TResult> {
  return {
    schema: 'domain-bot-editorial-job-v1',
    jobId: opts.jobId,
    role: opts.role,
    persona: opts.persona,
    createdAt: now,
    updatedAt: now,
    totalItems: opts.totalItems,
    batchSize: opts.batchSize,
    totalBatches: opts.totalBatches,
    completedBatches: [],
    degradedBatches: [],
    resultsByBatch: {},
    endpointUsage: {},
    truncatedBatches: [],
  }
}

export function jobPath(stagingDir: string, jobId: string): string {
  // jobId 来自调用方（persona + 时间戳），仍必须消毒防路径穿越。
  // **点号不得保留**：只剔除非字母数字而留下 `.` 的话，`../../etc/passwd` 会变成
  // `....etcpasswd`——仍含 `..`，且部分文件系统上 `....` 会被解析为上级目录。
  const safe = jobId.replace(/[^a-zA-Z0-9_-]/g, '')
  return join(stagingDir, `${safe || 'job'}.json`)
}

export function loadJobState<TResult>(stagingDir: string, jobId: string): JobState<TResult> | null {
  const path = jobPath(stagingDir, jobId)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as JobState<TResult>
    if (raw.schema !== 'domain-bot-editorial-job-v1') return null
    if (raw.jobId !== jobId) return null
    return raw
  } catch (err) {
    // 坏进度文件不得静默当成"没有进度"（会导致整轮重跑 53 分钟且看不出原因）
    console.error(`[editorial] 进度文件解析失败 ${path}：`, err instanceof Error ? err.message : err)
    return null
  }
}

function saveState<TResult>(state: JobState<TResult>, stagingDir: string): string {
  mkdirSync(stagingDir, { recursive: true })
  const path = jobPath(stagingDir, state.jobId)
  // 原子写：中断不得留下半截 JSON，否则续跑时读不出进度只能从头再来
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, path)
  return path
}

function recordUsage<TResult>(state: JobState<TResult>, usage: Usage | undefined, failed: boolean, endpointId?: string): void {
  const id = endpointId ?? usage?.endpointId ?? 'unknown'
  const stat = (state.endpointUsage[id] ??= {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    elapsedMs: 0,
    failures: 0,
  })
  stat.calls += 1
  if (failed) stat.failures += 1
  if (usage) {
    stat.promptTokens += usage.promptTokens
    stat.completionTokens += usage.completionTokens
    stat.reasoningTokens += usage.reasoningTokens
    stat.elapsedMs += usage.elapsedMs
  }
}

/**
 * 跑（或续跑）一个批产作业。
 *
 * 续跑判据：同 jobId 的进度文件存在且 totalItems/batchSize 一致 → 跳过 completedBatches。
 * 若 items 数量变了（换了输入），**不续跑而是重开**——用旧进度拼新输入会错位，
 * 且这种错位在产物上看不出来（每条都"有"结果，只是张冠李戴）。
 */
export async function runJob<TItem, TResult>(opts: RunJobOptions<TItem, TResult>): Promise<JobResult<TResult>> {
  const now = opts.now ?? (() => Date.now())
  const totalBatches = Math.ceil(opts.items.length / opts.batchSize)
  const path = jobPath(opts.stagingDir, opts.jobId)

  const prior = loadJobState<TResult>(opts.stagingDir, opts.jobId)
  const resumable =
    prior !== null && prior.totalItems === opts.items.length && prior.batchSize === opts.batchSize && prior.role === opts.role
  const state: JobState<TResult> = resumable
    ? prior!
    : emptyJobState<TResult>(
        { jobId: opts.jobId, role: opts.role, persona: opts.persona.id, batchSize: opts.batchSize, totalItems: opts.items.length, totalBatches },
        now(),
      )
  if (!resumable && prior !== null) {
    console.error(
      `[editorial] 进度文件与本次输入不匹配（旧 ${prior.totalItems} 条/批 ${prior.batchSize}，本次 ${opts.items.length} 条/批 ${opts.batchSize}），重开作业而非续跑`,
    )
  }

  const done = new Set(state.completedBatches)
  let batchesRun = 0

  for (let b = 0; b < totalBatches; b++) {
    if (done.has(b)) continue
    const batch = opts.items.slice(b * opts.batchSize, (b + 1) * opts.batchSize)
    batchesRun += 1

    const outcome = await opts.runBatch(batch, b)
    state.resultsByBatch[String(b)] = outcome.results
    state.completedBatches.push(b)

    const failed = outcome.error !== undefined || outcome.results.every((r) => r === null)
    if (failed) state.degradedBatches.push(b)
    if (outcome.truncated) state.truncatedBatches.push(b)
    recordUsage(state, outcome.usage, failed)

    state.updatedAt = now()
    // 逐批落盘：这是断点续跑的全部意义，攒到最后一次写等于没有
    saveState(state, opts.stagingDir)
    opts.onProgress?.(state)
  }

  // 展平
  const results: Array<TResult | null> = new Array(opts.items.length).fill(null)
  for (let b = 0; b < totalBatches; b++) {
    const batchResults = state.resultsByBatch[String(b)] ?? []
    for (let i = 0; i < batchResults.length; i++) {
      results[b * opts.batchSize + i] = batchResults[i] ?? null
    }
  }

  return { state, results, batchesRun, resumed: resumable && done.size > 0, path }
}

/** 生成稳定的 jobId：同一天同一产线同一角色续跑同一个作业，而不是每次新起。 */
export function makeJobId(role: 'writer' | 'reviewer', personaId: string, dayStamp: number): string {
  const day = new Date(dayStamp).toISOString().slice(0, 10).replace(/-/g, '')
  return `${role}-${personaId}-${day}`
}
