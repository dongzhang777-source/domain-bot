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
  skippedSources: string[]
  /** 采集成功但零相关产出的源（I-3 盲区：skippedSources 口径下不可见） */
  zeroYieldSources: string[]
  publishedFingerprintCount: number
  /** 配置正则编译失败清单。非空即说明有规则实际未生效，必须显式暴露 */
  compileErrors: Array<{ gate: GateId; ruleId: string; error: string }>
}

export interface QualityBoard extends BoardInput {
  schema: 'domain-bot-quality-board-v1'
  /**
   * 自进化是否生效。**当前恒为 false 且不得省略**：
   * 老张 2026-09-04 裁决砍掉 Telegram 改走 tuna 行为回流，而 `memory/views.json` 的
   * 唯一写入方是已退役的 `src/feedback/receiver.ts`（全仓 `store.recordView` /
   * `recordEngagement` 仅在该文件被调用），故 `interest.ts` 的 Beta 后验与
   * `weights.ts` 的源权重学习**无信号流入**。
   * 看板若不明写，读者会以为「自进化」在跑——那正是本项一直犯的
   * 「文档声明 > 落地」毛病。待 DB-06 回流通道落地后由 ingest 侧置真。
   */
  selfEvolutionActive: boolean
  selfEvolutionNote: string
  /** 派生统计：入选比（published / collected），废除均摊配额后的主指标 */
  qualityYieldRatio: number
  /** 派生统计：各源入选条数（看渠道真实水质，不再看是否凑满配额） */
  perSourcePublished: Record<string, number>
  /** 派生统计：语言分布 */
  langDistribution: Record<string, number>
}

const SELF_EVOLUTION_NOTE =
  'Telegram 链路已退役（老张 2026-09-04 裁决），views/engagements 失去唯一写入方，' +
  'interest.ts 的 Beta 后验与 weights.ts 的源权重学习无信号流入。待 DB-06 tuna 行为回流通道落地。'

export function buildBoard(
  input: BoardInput,
  published: Array<{ source: string; lang: string }>,
): QualityBoard {
  const collected = input.funnel[0]?.count ?? 0
  const perSourcePublished: Record<string, number> = {}
  const langDistribution: Record<string, number> = {}
  for (const p of published) {
    perSourcePublished[p.source] = (perSourcePublished[p.source] ?? 0) + 1
    langDistribution[p.lang] = (langDistribution[p.lang] ?? 0) + 1
  }

  return {
    ...input,
    schema: 'domain-bot-quality-board-v1',
    selfEvolutionActive: false,
    selfEvolutionNote: SELF_EVOLUTION_NOTE,
    qualityYieldRatio: collected === 0 ? 0 : published.length / collected,
    perSourcePublished,
    langDistribution,
  }
}

/**
 * 看板一致性自检：漏斗必须可对账。
 *
 * 这是防「看板只是修辞」的硬检查——DB-03 的第一期漏斗就无人能复算。
 * 返回不一致清单，调用方（CLI / 测试）据此熔断或断言。
 */
export function auditBoard(board: QualityBoard): string[] {
  const problems: string[] = []
  const first = board.funnel[0]?.count ?? 0
  const last = board.funnel[board.funnel.length - 1]?.count ?? 0

  // 漏斗必须单调不增
  for (let i = 1; i < board.funnel.length; i++) {
    if (board.funnel[i]!.count > board.funnel[i - 1]!.count) {
      problems.push(`漏斗非单调：${board.funnel[i - 1]!.stage}(${board.funnel[i - 1]!.count}) → ${board.funnel[i]!.stage}(${board.funnel[i]!.count})`)
    }
  }

  // 末层必须等于实际发布数
  if (last !== Object.values(board.perSourcePublished).reduce((a, b) => a + b, 0)) {
    problems.push(`漏斗末层 ${board.funnel[board.funnel.length - 1]?.stage}=${last} 与 perSourcePublished 合计不等`)
  }

  // 被拦 + 被否决 的总数不得超过入口（超过说明有重复计账）
  const totalDropped = board.dropped.length + board.rejected.length
  if (totalDropped > first) {
    problems.push(`dropped(${board.dropped.length}) + rejected(${board.rejected.length}) = ${totalDropped} 超过入口 ${first}`)
  }

  if (board.compileErrors.length > 0) {
    problems.push(
      `${board.compileErrors.length} 条配置正则编译失败（实际未生效，闸门假绿）：` +
        board.compileErrors.map((e) => `${e.gate}/${e.ruleId}: ${e.error}`).join('; '),
    )
  }

  return problems
}

/** 落盘。路径 `evidence/feed-quality-<persona>-<ts>.json`。 */
export function writeBoard(board: QualityBoard, evidenceDir: string): string {
  mkdirSync(evidenceDir, { recursive: true })
  const safePersona = board.persona.replace(/[^a-z0-9-]/gi, '')
  const path = join(evidenceDir, `feed-quality-${safePersona}-${board.digestId}.json`)
  writeFileSync(path, JSON.stringify(board, null, 2))
  return path
}
