import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DropRecord, GateId } from '../types.js'
import type { RejectedRecord } from './index.js'

/**
 * 质量看板：机器可读的证据落盘。
 *
 * 为什么必须落盘而不是只打印：DB-03 的第一期漏斗（1396→750→703→200→172）只写在
 * `docs/newsroom-board.md` 的散文里，**无法复算**——任何人质疑都得重跑一遍人肉流程。
 * 看板 JSON 让每一跳都可对账：`funnel` 逐层绝对数 + `dropped` 按 ruleId 分布，
 * 两者相加必须等于入口条数。
 *
 * **不写 `docs/newsroom-board.md`**：老张 2026-09-04 已终止编辑部每日排期
 * （commit `68f7989`），那份看板保留为第一期审计记录，往它追加新期会违反该指令。
 */

export interface FunnelStage {
  stage: string
  count: number
}

export interface BoardInput {
  persona: string
  personaDisplay: string
  digestId: string
  generatedAt: number
  /** 逐层漏斗，顺序即执行顺序 */
  funnel: FunnelStage[]
  /** 闸门层被拦条目 */
  dropped: DropRecord[]
  /** 终审层被否决条目 */
  rejected: RejectedRecord[]
  rejectCounts: Record<string, number>
  backfilled: number
  poolExhausted: boolean
  eventTrimmed: number
  /** 独立事件数（capEvents 产出） */
  eventCount: number
  /**
   * 本轮是否处于「填充模式」：候选不足以在 maxPerEvent 约束下填满 maxItems，
   * 故放行同事件超额条目而不是发薄包。为 true 时**防刷屏能力本轮是降级的**，
   * 必须显式暴露（隐式降级正是 DB-03 的老毛病）。
   */
  eventFillMode: boolean
  /**
   * 同事件超额被**降权**的条数（不是丢弃）。
   * 词法聚类判别不可靠，故超额只降权：候选池厚时被 maxItems 自然截掉（防刷屏），
   * 候选池薄时仍进产出（不摧毁内容）。看板记这个数，才能看出降权是否吃掉了内容。
   */
  eventDemoted: number
  skippedSources: string[]
  /** 采集成功但零相关产出的源（I-3 盲区：skippedSources 口径下不可见） */
  zeroYieldSources: string[]
  /**
   * 宽通道（DB-08）本轮实况。缺省 = 未启用或无待定池。
   * poolSize=待定池条数、included=LLM 判定捞回数；排除数从 dropped 里 gate==='recall' 归算。
   * **必须在看板显式暴露**：宽通道的「捞回」与「不捞」都影响候选池构成，静默运行
   * 会重演「看板读起来像已建成的机制，实际另有来源」的 D-09 漂移。
   */
  recall?: { poolSize: number; included: number }
  publishedFingerprintCount: number
  /** 配置正则编译失败清单。非空即说明有规则实际未生效，必须显式暴露 */
  compileErrors: Array<{ gate: GateId; ruleId: string; error: string }>
  /**
   * AI 编辑部（DB-05）的实际生效情况。
   *
   * **不得省略**：静默降级正是「格式全绿 ≠ 内容合格」的老毛病——
   * 端点挂了退回机械文案，产出看起来仍然字段齐备、限长合法，但钩子已退化成
   * 实体词卡片。看板不记，下一轮就没人知道质量已塌回原点。
   */
  editorial: EditorialBoard
}

export interface EditorialBoard {
  /** 配置上是否启用 */
  enabled: boolean
  /** 是否真的产出了 LLM 文案或判定 */
  active: boolean
  /** 未生效的原因（active=false 时必填） */
  inactiveReason?: string
  /** 降级批数：端点全链失败或响应不可解析，产物走机械兜底 */
  writerDegradedBatches: number
  reviewerDegradedBatches: number
  /** 因 max_tokens 撞顶被截断的批数；>0 说明批大小或 maxTokens 配错了 */
  truncatedBatches: number
  /** reviewer 灵敏度自检是否通过。未通过时其分数一律不得用于判定 */
  calibrationPassed: boolean | null
  calibrationProblems: string[]
  /** 实际走到的端点与用量（降级链走到哪一档必须看得出来） */
  endpoints: Array<{ role: string; endpointId: string; calls: number; failures: number; reasoningTokens: number; elapsedMs: number }>
  /** 拿到 LLM 文案的条数（对比 published 总数即知机械兜底占比） */
  llmCopyCount: number
}

export interface QualityBoard extends BoardInput {
  schema: 'domain-bot-quality-board-v1'
  /**
   * 自进化是否生效。**不得硬编码**，必须由真实信号存量算出来。
   *
   * 背景：老张 2026-09-04 裁决砍掉 Telegram 改走 tuna 行为回流，而 `memory/views.json`
   * 的原唯一写入方是已退役的 `src/feedback/receiver.ts`。在 DB-06 回流通道落地前
   * 本值恒为 false（实测 `memory/weights.json` 早已是空的 `{"weights":{}}`，
   * 而文档一直宣称「自进化」）。
   *
   * 回流接通后（`src/ingest/tuna-signals.ts` 已有入账）本值自动转 true。
   * 写死 false 会在接通后变成假话，写死 true 则在断开时掩盖欠账——两头都是
   * 本项一直犯的「文档声明 > 落地」毛病。
   */
  selfEvolutionActive: boolean
  selfEvolutionNote: string
  /** 真实信号存量：看板读者能自己核对，不必信 selfEvolutionActive 这个布尔 */
  signalCounts: { views: number; engagements: number; feedback: number }
  /** 派生统计：入选比（published / collected），废除均摊配额后的主指标 */
  qualityYieldRatio: number
  /** 派生统计：各源入选条数（看渠道真实水质，不再看是否凑满配额） */
  perSourcePublished: Record<string, number>
  /** 派生统计：语言分布 */
  langDistribution: Record<string, number>
  /** 宽通道（DB-08）汇总：待定/捞回/排除与口径说明。recall 未启用时为 undefined */
  recall?: { poolSize: number; included: number; excluded: number; note: string }
}

const NOTE_INACTIVE =
  '无行为信号入账（views/engagements/feedback 全为 0）。Telegram 链路已退役（老张 2026-09-04 裁决），' +
  '回流通道见 src/ingest/tuna-signals.ts；tuna 侧的 native 持久化与信号导出属 DB-06（根仓 WS-16）。'
const NOTE_ACTIVE =
  '已有行为信号入账，interest.ts 的 Beta 后验与 weights.ts 的源权重学习已接通（由 src/ingest/tuna-signals.ts 喂入）。'

export function buildBoard(
  input: BoardInput,
  published: Array<{ source: string; lang: string }>,
  signalCounts: { views: number; engagements: number; feedback: number } = { views: 0, engagements: 0, feedback: 0 },
): QualityBoard {
  const collected = input.funnel[0]?.count ?? 0
  const perSourcePublished: Record<string, number> = {}
  const langDistribution: Record<string, number> = {}
  for (const p of published) {
    perSourcePublished[p.source] = (perSourcePublished[p.source] ?? 0) + 1
    langDistribution[p.lang] = (langDistribution[p.lang] ?? 0) + 1
  }
  const active = signalCounts.views + signalCounts.engagements + signalCounts.feedback > 0

  const recall = input.recall
    ? {
        ...input.recall,
        excluded: input.dropped.filter((d) => d.gate === 'recall' && !d.ruleId.startsWith('recall:ineligible') && !d.ruleId.startsWith('recall:poolOverflow')).length,
        note: '宽通道=DB-08 关键词漏网召回：待定池经 reviewer 二元判定，include 并入候选走同一终审链；排除/漏答计入 dropped(gate=recall)。candidates/relevant 口径含捞回条目，observations 的 recall* 字段单独存档。',
      }
    : undefined

  return {
    ...input,
    schema: 'domain-bot-quality-board-v1',
    selfEvolutionActive: active,
    selfEvolutionNote: active ? NOTE_ACTIVE : NOTE_INACTIVE,
    signalCounts,
    qualityYieldRatio: collected === 0 ? 0 : published.length / collected,
    perSourcePublished,
    langDistribution,
    recall,
  }
}

/**
 * 看板一致性自检。
 *
 * 分两级，因为两者的处置必须不同：
 * - **fatal**：漏斗不可对账、配置正则失效——说明看板或闸门本身在骗人，必须熔断。
 * - **warning**：编辑部降级、批被截断、自检未过——产线仍可发布（机械兜底仍过十条客观断言），
 *   但必须**吵**：写进看板、打到 stderr。若把降级也当 fatal，端点一抖整轮就废；
 *   若完全不报，就是 DB-03 的静默降级老毛病。两头都不能要。
 */
export interface BoardAudit {
  fatal: string[]
  warnings: string[]
}

export function auditBoard(board: QualityBoard): BoardAudit {
  const fatal: string[] = []
  const warnings: string[] = []
  const first = board.funnel[0]?.count ?? 0
  const last = board.funnel[board.funnel.length - 1]?.count ?? 0

  // 漏斗必须单调不增
  for (let i = 1; i < board.funnel.length; i++) {
    if (board.funnel[i]!.count > board.funnel[i - 1]!.count) {
      fatal.push(`漏斗非单调：${board.funnel[i - 1]!.stage}(${board.funnel[i - 1]!.count}) → ${board.funnel[i]!.stage}(${board.funnel[i]!.count})`)
    }
  }

  // 末层必须等于实际发布数
  if (last !== Object.values(board.perSourcePublished).reduce((a, b) => a + b, 0)) {
    fatal.push(`漏斗末层 ${board.funnel[board.funnel.length - 1]?.stage}=${last} 与 perSourcePublished 合计不等`)
  }

  // 被拦 + 被否决 的总数不得超过入口（超过说明有重复计账）
  const totalDropped = board.dropped.length + board.rejected.length
  if (totalDropped > first) {
    fatal.push(`dropped(${board.dropped.length}) + rejected(${board.rejected.length}) = ${totalDropped} 超过入口 ${first}`)
  }

  if (board.compileErrors.length > 0) {
    fatal.push(
      `${board.compileErrors.length} 条配置正则编译失败（实际未生效，闸门假绿）：` +
        board.compileErrors.map((e) => `${e.gate}/${e.ruleId}: ${e.error}`).join('; '),
    )
  }

  // 静默降级守：配置说启用了但实际没生效。产线仍可发布（机械兜底仍过终审），
  // 但必须吵——这是 DB-03 的核心教训：退回机械文案后产出仍字段齐备、限长合法，
  // 看上去一切正常，只有看板能暴露它。
  if (board.editorial.enabled && !board.editorial.active) {
    warnings.push(`AI 编辑部已启用但未生效，本轮全量走机械兜底：${board.editorial.inactiveReason ?? '原因未记录'}`)
  }
  // DB-14/P1-1 配套（2026-09-05 小巴审查）：运行时撞车探测——sameEndpoint 只比配置
  // 首端点，拦不住「降级后实际撞车」（17:56 轮实测 reviewer 降级到 8052 与 writer 并发）。
  // 这里看实际用量的端点交集，把配置注释里的「人工干预」升级为看板自动告警。
  {
    const wIds = new Set(board.editorial.endpoints.filter((e) => e.role === 'writer').map((e) => e.endpointId))
    const crashed = board.editorial.endpoints.filter((e) => e.role === 'reviewer' && wIds.has(e.endpointId)).map((e) => e.endpointId)
    if (crashed.length > 0) {
      warnings.push(
        `端点撞车：writer 与 reviewer 实际都用了 ${[...new Set(crashed)].join('、')}（降级链重叠，并发请求互相拖慢，建议错开降级末端或串行）`,
      )
    }
  }
  if (board.editorial.truncatedBatches > 0) {
    warnings.push(`${board.editorial.truncatedBatches} 个批因 max_tokens 撞顶被截断（批大小或 maxTokens 配错，该批产出已降级）`)
  }
  if (board.editorial.writerDegradedBatches > 0 || board.editorial.reviewerDegradedBatches > 0) {
    warnings.push(`编辑部降级批：writer ${board.editorial.writerDegradedBatches} / reviewer ${board.editorial.reviewerDegradedBatches}`)
  }
  if (board.editorial.calibrationPassed === false) {
    warnings.push(`reviewer 灵敏度自检未通过，其分数本轮不用于判定：${board.editorial.calibrationProblems.join(' / ')}`)
  }
  if (board.editorial.active && board.editorial.llmCopyCount < board.funnel[board.funnel.length - 1]!.count) {
    warnings.push(
      `仅 ${board.editorial.llmCopyCount}/${board.funnel[board.funnel.length - 1]!.count} 条拿到 LLM 文案，其余走机械兜底`,
    )
  }
  if (!board.selfEvolutionActive) {
    warnings.push(`自进化未生效：${board.selfEvolutionNote}`)
  }
  if (board.eventFillMode) {
    warnings.push(
      `填充模式：候选不足以在 maxPerEvent 约束下填满 maxItems，本轮放行同事件超额条目` +
        `（事件簇 ${board.eventCount} 个、降权 ${board.eventDemoted} 条、实发 ${board.funnel[board.funnel.length - 1]?.count ?? 0} 条），` +
        `防刷屏能力本轮降级`,
    )
  }

  return { fatal, warnings }
}

/** 落盘。路径 `evidence/feed-quality-<persona>-<ts>.json`。 */
export function writeBoard(board: QualityBoard, evidenceDir: string): string {
  mkdirSync(evidenceDir, { recursive: true })
  const safePersona = board.persona.replace(/[^a-z0-9-]/gi, '')
  const path = join(evidenceDir, `feed-quality-${safePersona}-${board.digestId}.json`)
  writeFileSync(path, JSON.stringify(board, null, 2))
  return path
}
