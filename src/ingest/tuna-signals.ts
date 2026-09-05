import { existsSync, readFileSync } from 'node:fs'
import { MemoryStore } from '../memory/store.js'
import { refreshWeights } from '../memory/weights.js'
import { interestOf, loadState, recordExpandToDisk, settleStaleExposures } from '../memory/interest.js'
import type { SourceConfig } from '../types.js'

/**
 * tuna 行为回流接收端：把 tuna 端按 postId 归因的行为信号喂回 domain-bot 的记忆库，
 * 复活 `interest.ts` 的 Beta 后验与 `weights.ts` 的源权重学习。
 *
 * 为什么必须有这一环（老张 2026-09-04 裁决 5：砍 Telegram，新建 tuna 行为回流通道）：
 * `memory/views.json` / `engagements.json` 的**唯一写入方**曾是 `src/feedback/receiver.ts`
 * （Telegram 长轮询回调），全仓 `store.recordView` / `recordEngagement` 仅在该文件被调用。
 * 砍掉 Telegram 后整条自进化回路断源——实测 `memory/weights.json` 早已是空的
 * `{"weights":{}}`，而文档一直宣称「自进化」。
 *
 * **归因链**：tuna 信号按 postId 归因，postId = `domain-bot-<persona>:<digestId>:<index>`。
 * 去掉首段即 `<digestId>:<index>`，正是 `store.registerDigestRef` 登记的 ref 格式
 * （正则 `^[a-z0-9]+:\d+$`）。`resolveRef` 由此拿回 itemId 与 source，
 * 才能把行为折算到**源权重**上——没有 source，反馈就只是一堆无法行动的数字。
 *
 * 与 tuna 侧的分工：本模块只是**接收端**（读文件、写 memory）。tuna 侧需要
 * T1 native 持久化（当前 native storage 是纯内存 Map，app 杀掉信号全丢）、
 * T2 带 postId 的信号级导出（现有 exportTelemetry 是匿名聚合、不含 postId，不可复用）。
 * 那两项属 DB-06，见根仓 COMMITMENT-LEDGER WS-16。
 */

/** tuna-signals-v1：T2 的导出契约。字段名对齐 tuna `packages/core` 的 `Signal`。 */
export const TUNA_SIGNALS_SCHEMA = 'tuna-signals-v1'

export interface TunaSignal {
  postId: string
  /** 累计停留时长（tuna 侧封顶 10min） */
  dwellMs?: number
  /** 是否读完 */
  completed?: boolean
  /** 深聊轮次（单调递增） */
  chatTurns?: number
  /** 不感兴趣（负信号） */
  dismissed?: boolean
  /** 离场情绪 */
  reaction?: 'satisfied' | 'ok' | 'stopped' | null
  /** 最后写入时间戳（ms） */
  ts?: number
}

export interface TunaSignalsFile {
  schema: string
  exportedAt?: string
  signals?: TunaSignal[]
  /** 收藏：postId → 时间戳 */
  favorites?: Array<{ postId: string; ts?: number }>
}

export interface IngestReport {
  path: string
  totalSignals: number
  /** postId 无法解析成 `<digestId>:<index>` 的条数 */
  unparsable: number
  /** ref 在 digestRefs 里查不到的条数（内容档已裁剪，或 postId 来自别的 bot） */
  unresolved: number
  views: number
  engagements: number
  feedbackUp: number
  feedbackDown: number
  favorites: number
  /** 结算的过期曝光（弱负证据） */
  settledExposures: number
  /** 回流后重算的源权重 */
  weights: Record<string, number>
  /** 每个源的兴趣后验（interest.ts 的 Beta 均值） */
  interestBySource: Record<string, number>
  problems: string[]
}

/** 从 postId 解析出 ref（`<digestId>:<index>`）。首段是 `domain-bot-<persona>`，用连字符不用冒号。 */
export function parsePostId(postId: string): { ref: string; digestId: string; index: number; persona: string } | null {
  const parts = String(postId ?? '').split(':')
  if (parts.length !== 3) return null
  const [first, digestId, indexStr] = parts as [string, string, string]
  if (!first.startsWith('domain-bot')) return null
  if (!/^[a-z0-9]+$/.test(digestId)) return null
  const index = Number(indexStr)
  if (!Number.isInteger(index) || index < 0) return null
  return { ref: `${digestId}:${index}`, digestId, index, persona: first.replace(/^domain-bot-?/, '') || 'unknown' }
}

/** 是否构成「展开/阅读」这一强证据。 */
function isExpand(s: TunaSignal): boolean {
  return (s.dwellMs ?? 0) > 0 || s.completed === true || (s.chatTurns ?? 0) > 0
}

/**
 * 摄入一份 tuna 信号导出。
 *
 * 幂等性依赖 store 层的既有去重口径，**不在本模块另立一套**：
 * - `recordView` 按 digestId 去重；
 * - `recordFeedback` 按 digestId+itemId+signal 去重（改主意 👍→👎 是不同信号，各计一次）；
 * - `recordEngagement` **不去重**（同一条展开几次算几次真实交互，这是 store.ts 的既有语义）；
 * - `settleStaleExposures` 用 `state.settled` 集合防重复结算。
 * 故同一份导出文件重复摄入不会虚增反馈计数（判定线 P-2「有效反馈 ≥20 条」正是靠这条守住的）。
 */
export function ingestTunaSignals(
  path: string,
  opts: { memoryDir: string; sources: SourceConfig[]; now?: number },
): IngestReport {
  const now = opts.now ?? Date.now()
  const problems: string[] = []

  if (!existsSync(path)) {
    return emptyReport(path, problems, [`信号文件不存在：${path}`])
  }

  let doc: TunaSignalsFile
  try {
    doc = JSON.parse(readFileSync(path, 'utf8')) as TunaSignalsFile
  } catch (err) {
    return emptyReport(path, problems, [`信号文件解析失败：${err instanceof Error ? err.message : err}`])
  }
  if (doc.schema !== TUNA_SIGNALS_SCHEMA) {
    problems.push(`schema 不是 ${TUNA_SIGNALS_SCHEMA}（实为 ${String(doc.schema)}）；仍尝试按同构解析，但契约可能已变`)
  }

  const store = new MemoryStore(opts.memoryDir)
  const report: IngestReport = {
    path,
    totalSignals: (doc.signals ?? []).length,
    unparsable: 0,
    unresolved: 0,
    views: 0,
    engagements: 0,
    feedbackUp: 0,
    feedbackDown: 0,
    favorites: 0,
    settledExposures: 0,
    weights: {},
    interestBySource: {},
    problems,
  }

  for (const s of doc.signals ?? []) {
    const parsed = parsePostId(s.postId)
    if (!parsed) {
      report.unparsable += 1
      continue
    }
    const resolved = store.resolveRef(parsed.ref)
    if (!resolved) {
      // 查不到不是错误：digests 只保留最近 30 份，老内容的信号自然无处归因。
      // 但必须计数——占比过高说明内容档裁剪太狠，或 postId 来自别的 bot。
      report.unresolved += 1
      continue
    }
    const at = typeof s.ts === 'number' && s.ts > 0 ? s.ts : now

    if (isExpand(s)) {
      // 展开即已读（对齐 L1-L3 行为范式：tuna 侧取消了 👍/👀 显式按钮，行为即信号）
      if (store.recordView(parsed.digestId, at)) report.views += 1
      store.recordEngagement({ digestId: parsed.digestId, index: parsed.index, source: resolved.source, at })
      report.engagements += 1
      // 兴趣后验的强证据：expands+1, exposures+1
      recordExpandToDisk(opts.memoryDir, resolved.source)
    }

    // 显式负信号：不感兴趣
    if (s.dismissed === true) {
      if (store.recordFeedback({ itemId: resolved.itemId, digestId: resolved.digestId, source: resolved.source, signal: 'down', at })) {
        report.feedbackDown += 1
      }
    }
    // 离场情绪折算：satisfied=正，stopped=负，ok=中性不计（中性信号进 Beta 只会稀释后验）
    if (s.reaction === 'satisfied') {
      if (store.recordFeedback({ itemId: resolved.itemId, digestId: resolved.digestId, source: resolved.source, signal: 'up', at })) {
        report.feedbackUp += 1
      }
    } else if (s.reaction === 'stopped') {
      if (store.recordFeedback({ itemId: resolved.itemId, digestId: resolved.digestId, source: resolved.source, signal: 'down', at })) {
        report.feedbackDown += 1
      }
    }
  }

  for (const f of doc.favorites ?? []) {
    const parsed = parsePostId(f.postId)
    if (!parsed) {
      report.unparsable += 1
      continue
    }
    const resolved = store.resolveRef(parsed.ref)
    if (!resolved) {
      report.unresolved += 1
      continue
    }
    report.favorites += 1
    // 收藏是最强的正信号
    store.recordFeedback({
      itemId: resolved.itemId,
      digestId: resolved.digestId,
      source: resolved.source,
      signal: 'up',
      at: typeof f.ts === 'number' && f.ts > 0 ? f.ts : now,
    })
    recordExpandToDisk(opts.memoryDir, resolved.source)
  }

  // 结算已过判定期的曝光（未展开者计弱负证据）。必须在写入本轮信号之后跑，
  // 否则本轮刚展开的条目会被误判为「曝光未展开」。
  report.settledExposures = settleStaleExposures(opts.memoryDir, now).counted

  // 源权重重算：refreshWeights 内部用反馈内容的 sha256 作闸门令牌，
  // 反馈无变化时原样返回，避免每轮向 0.5 回归冲淡已学信号。
  report.weights = refreshWeights(store, opts.sources)

  // 兴趣后验（Beta 均值）：与源权重是**两套不同的量**，不得混用。
  // weights 答「这个源历史反馈好不好」，interest 答「用户对这个源的内容到底展不展开」；
  // 后者含「曝光未展开」的弱负证据，前者只算显式反馈。
  const interestState = loadState(opts.memoryDir)
  for (const s of opts.sources) {
    report.interestBySource[s.id] = interestOf(interestState, s.id)
  }

  if (report.unparsable > 0) problems.push(`${report.unparsable} 条 postId 无法解析为 <digestId>:<index>（契约不符或来自别的 bot）`)
  if (report.unresolved > 0) {
    problems.push(
      `${report.unresolved} 条信号查不到 ref（内容档只保留最近 30 份，老内容无处归因）。` +
        `占比 ${((report.unresolved / Math.max(1, report.totalSignals)) * 100).toFixed(1)}%`,
    )
  }
  if (report.views + report.engagements + report.feedbackUp + report.feedbackDown + report.favorites === 0) {
    problems.push('本次摄入未产生任何信号入账：自进化仍未生效')
  }

  return report
}

function emptyReport(path: string, problems: string[], extra: string[]): IngestReport {
  return {
    path,
    totalSignals: 0,
    unparsable: 0,
    unresolved: 0,
    views: 0,
    engagements: 0,
    feedbackUp: 0,
    feedbackDown: 0,
    favorites: 0,
    settledExposures: 0,
    weights: {},
    interestBySource: {},
    problems: [...problems, ...extra],
  }
}
