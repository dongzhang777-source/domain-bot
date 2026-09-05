import type {
  DomainConfig,
  DropRecord,
  FetchFn,
  GateId,
  GatesConfig,
  GatekeeperInput,
  PersonaConfig,
  RawItem,
  ScoredItem,
  SourceConfig,
  SpawnFn,
} from './types.js'
import { dedupe } from './collector/dedupe.js'
import { fetchRss } from './collector/adapters/rss.js'
import { fetchGithub } from './collector/adapters/github.js'
import { fetchBili, fetchExa, fetchJina, fetchV2ex, fetchYtSearch } from './collector/adapters/agentreach.js'
import { resolveSourceUrl } from './collector/urlTemplate.js'
import { buildFunnel, capEvents, collectCanonicalUrls, entityTokens, runGates } from './gates/index.js'
import { makeScorerFromEnv } from './refinery/scorer.js'
import { MemoryStore } from './memory/store.js'
import { applyNovelty, applySourceWeight } from './memory/evolve.js'
import { appendObservation, observeRound } from './memory/observe.js'
import { refreshWeights } from './memory/weights.js'
import { settleStaleExposures } from './memory/interest.js'
import { gatekeep, type GatekeepResult } from './gatekeeper/index.js'
import { buildBoard, type EditorialBoard, type FunnelStage, type QualityBoard } from './gatekeeper/board.js'
import { runEditorial, type EditorialConfig, type EditorialOutcome } from './editorial/index.js'
import { meetsQualityBar } from './editorial/reviewer.js'
import type { WrittenCopy } from './editorial/writer.js'
import {
  assertTargetAlignment,
  editorialTargetsOf,
  restoreStage,
  type CollectStageResult,
  type CollectStageSnapshot,
} from './staging.js'

/**
 * 双产线批产编排：采集 → 精确去重 → 四层闸门 → 打分 → 事件聚合 → 截断 → 主编终审 → 归档观测。
 *
 * 取代旧 `src/index.ts` 的 `runOnce`（每日 6 条摘要 + 每源均摊配额 + Telegram 推送）。
 * 老张 2026-09-04 裁决：只保留批产线、砍掉每日摘要；双 bot 双产线彻底分离。
 *
 * **两处顺序是刻意的，不得调换**：
 *
 * 1. **事件聚合（capEvents）在 maxItems 截断之前**。旧管线先按每源配额截到 6 条、
 *    之后才 buildClusters，于是 15 家媒体对同一事件的报道能吃满全部坑位，聚类形同虚设
 *    （DB-03 §2.5「缺失主题编辑」）。本模块把聚合放在截断前，截断只在已去同事件的集合上做。
 *
 * 2. **渲染在主编终审之前**。机械截断 / 碎片钩子 / 浮点回显 三类缺陷只在渲染后存在
 *    （DB-03 §2.4），对 ScoredItem 断言无意义。
 *
 * **废除均摊配额**：`maxItems` 是上限不是配额，不设每源下限。DB-03 §2.2 已定性
 * 「每渠道 ≥50 条」的均摊指标是「应付差事」的头号制度根因——为凑数把 V2EX 水帖、
 * B 站卖课、YouTube 通识科普全盘收割。某源水质好就多占，凑不满就是凑不满。
 */

export interface PipelineOptions {
  persona: PersonaConfig
  gates: GatesConfig
  domain: DomainConfig
  /** 全量源表；persona.sources 做白名单筛选 */
  sources: SourceConfig[]
  memoryDir: string
  fetchFn?: FetchFn
  spawnFn?: SpawnFn
  now?: number
  /** 跨产线共享的已发布指纹库；命中即一票否决 */
  knownCanonical?: ReadonlySet<string>
  /**
   * AI 编辑部配置（DB-05）。缺省或 `enabled=false` 时走启发式打分 + 机械渲染兜底，
   * 产线**不停摆**，但看板必须显式记 `editorialActive=false` 与原因（不得静默降级）。
   */
  editorial?: EditorialConfig
  /** 仓根，编辑部进度文件与金标集的路径基准 */
  root?: string
  /** 测试注入点：代替真实 HTTP 请求模型端点 */
  editorialFetchFn?: FetchFn
  /**
   * 分阶段作业：给定采集快照时跳过步骤 1-7，直接从快照进入编辑部与终审。
   * `collect` / `edit` / `review` / `publish` 四段命令靠它把一次过夜批产拆成
   * 可续跑的独立进程，而不必在 cli 里复制一份产线逻辑。
   */
  staged?: CollectStageSnapshot
  /** 分阶段作业：已由 `edit` / `review` 跑好的编辑部产物（给了就不再调端点） */
  stagedEditorial?: StagedEditorial
  /**
   * 宽通道召回判定回调（DB-08）。persona.recall.enabled 且闸门产生待定池时被调用。
   * 返回 include 的条目（并入候选走统一打分/事件聚合/终审）与 exclude 的落账记录。
   * 由 cli 注入真实实现（读 editor.json 构造 reviewer provider + 金标校准落盘）；
   * 测试注入 mock。管线本体不感知 LLM 端点。判定发生在 collect 阶段内——
   * staging 快照即最终候选集，分段契约（分段跑 == 整链跑）不被破坏。
   */
  recallJudge?: (pool: RawItem[]) => Promise<{ included: RawItem[]; excluded: DropRecord[] }>
}

/** 分阶段作业传入的编辑部产物。targetIds 用于硬校验下标对齐（见 assertTargetAlignment）。 */
export interface StagedEditorial {
  outcome: EditorialOutcome
  targetIds: string[]
}

export interface PipelineResult {
  persona: string
  personaDisplay: string
  digestId: string
  /** 过闸门 + 打分后、事件聚合前的全量候选 */
  candidates: ScoredItem[]
  /** 独立事件簇数 */
  events: number
  /** 交给终审的全部候选（按「事件降权后」的顺序）。截断由 gatekeep 的 target 做 */
  selected: ScoredItem[]
  /**
   * 候补池。**当前恒为空**：截断与递补都统一由 gatekeep 的扫描循环完成
   * （见 runPipeline 第 9 步的实测说明），保留字段是为 DB-05 编辑部按批作用域留口。
   */
  backfillPool: ScoredItem[]
  /** 渲染 → 过终审 → 递补后的最终产出 */
  published: GatekeeperInput[]
  /** AI 编辑部的执行情况（未启用时 active=false 且带 inactiveReason） */
  editorial: EditorialOutcome | null
  funnel: FunnelStage[]
  dropped: DropRecord[]
  gatekeep: GatekeepResult
  board: QualityBoard
  skippedSources: string[]
  zeroYieldSources: string[]
}

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const stage = opts.staged ? restoreStage(opts.staged) : await collectStage(opts)
  return finalizeStage(stage, opts)
}

/**
 * 产线步骤 1-7：采集 → 精确去重 → 四层闸门 → 打分 → 源权重/新颖性 → 事件聚合。
 *
 * 单独导出是为了 `collect` 命令：它的产物落盘后，`edit` / `review` / `publish`
 * 可在**另外的进程**里接手（writer 实测 ≈53 分钟，一个进程跑完整链中途失败就得从头再来）。
 * 注意本函数**不写任何归档**：recordItems / markPushed / saveDigest 全在 finalizeStage，
 * 否则 collect 跑一次就会把候选记成「已消费」，publish 重跑时全被 dedupe 屏蔽。
 */
export async function collectStage(opts: PipelineOptions): Promise<CollectStageResult> {
  const now = opts.now ?? Date.now()
  const store = new MemoryStore(opts.memoryDir)
  const stopwords = new Set(opts.gates.dedupe?.eventStopwords ?? [])

  // 1. 采集：persona 白名单 ∩ enabled。单源失败不阻塞，记入 skippedSources
  const enabled = opts.sources.filter((s) => s.enabled && opts.persona.sources.includes(s.id))
  const collected: RawItem[] = []
  const skipped: SourceConfig[] = []
  const sourceFetched: Record<string, number> = {}
  for (const source of enabled) {
    try {
      const items = await collectSource({ ...source, url: resolveSourceUrl(source.url, now) }, opts.fetchFn, opts.spawnFn)
      sourceFetched[source.id] = items.length
      collected.push(...items)
    } catch (err) {
      // 必须记入 skipped：否则「源挂掉」与「内容池枯竭」在观测上无法区分
      skipped.push(source)
      console.error(`[collector] ${source.id} 失败:`, err instanceof Error ? err.message : err)
    }
  }

  // 2. 精确 id 去重（跟轮次）。id 已由 itemId() 从规范 URL 派生，跨渠道同文档必得同 id
  const { kept: afterDedupe } = dedupe(collected, store.knownIds())
  const sourceAfterDedupe: Record<string, number> = {}
  for (const it of afterDedupe) sourceAfterDedupe[it.source] = (sourceAfterDedupe[it.source] ?? 0) + 1

  // 3. 四层闸门（persona 前置 → 黑名单 → 相关性积分 → 规范 URL 去重）
  const gateOutcome = runGates(afterDedupe, {
    persona: opts.persona,
    gates: opts.gates,
    now,
    knownCanonical: opts.knownCanonical,
    recall: opts.persona.recall?.enabled ? { maxPerRound: opts.persona.recall.maxPerRound } : undefined,
  })
  // 4. 配置正则写错必须熔断，不得静默跳过——一条失效规则等于该规则不存在，闸门会假绿
  if (gateOutcome.compileErrors.length > 0) {
    throw new Error(
      `闸门配置有 ${gateOutcome.compileErrors.length} 条正则编译失败（规则实际未生效，拒绍继续）：` +
        gateOutcome.compileErrors.map((e: { gate: GateId; ruleId: string; error: string }) => `${e.gate}/${e.ruleId}: ${e.error}`).join('; '),
    )
  }
  const relevant = gateOutcome.passed
  const sourceRelevant: Record<string, number> = {}
  for (const it of relevant) sourceRelevant[it.source] = (sourceRelevant[it.source] ?? 0) + 1

  // 3.5 宽通道判定（DB-08）：词表漏网条目交 LLM 二元判定，include 的并入候选。
  // 与快通道共用同一条打分/事件聚合/终审链——质量底线不因召回加宽而放松。
  // exclude/漏答的落账记录并入 dropped（gate: 'recall'），漏斗恒可复算。
  const recallPool = gateOutcome.recallPool ?? []
  let recallIncluded = 0
  if (recallPool.length > 0 && opts.recallJudge) {
    const judged = await opts.recallJudge(recallPool)
    relevant.push(...judged.included)
    for (const it of judged.included) sourceRelevant[it.source] = (sourceRelevant[it.source] ?? 0) + 1
    gateOutcome.dropped.push(...judged.excluded)
    gateOutcome.funnel = buildFunnel(gateOutcome.dropped)
    recallIncluded = judged.included.length
  }

  // 5. 打分。env 未配 LLM 时自动走 HeuristicScorer——这是 DB-05 之前的预期行为
  const scorer = makeScorerFromEnv()
  const scores = await scorer.score(relevant, opts.domain)

  // 6. 源权重 + 新颖性。权重优先级：memory/weights.json（已学到）> config/sources.json（首次先验）
  const weights = refreshWeights(store, opts.sources)
  const weightOf = new Map(Object.entries(weights))
  // 过滤用原始分、排序用加权分：源权重只应影响排序，不该把低权源整体挡在候选池外，
  // 否则低权源永远进不了推送 → 永远拿不到反馈 → 权重再也回不来（反馈死锁）。
  const ranked: Array<{ entry: ScoredItem; raw: number }> = []
  for (let i = 0; i < relevant.length; i++) {
    const item = relevant[i]!
    const raw = scores[i]!.valueScore
    const novel = store.isNovel(item)
    const weighted = applySourceWeight(raw, weightOf.get(item.source) ?? 0.5)
    ranked.push({
      entry: { ...item, valueScore: applyNovelty(weighted, novel), isNew: novel, reason: scores[i]!.reason },
      raw,
    })
  }
  const candidates = ranked.map((r) => r.entry)
  const rawScores = ranked.map((r) => r.raw)

  // 7. 事件聚合 —— 必须在截断之前（见文件头）。
  // 背景 df 用**过滤前的全量采集**算：过滤到 AI 强相关子集后，领域词汇的相对频率被
  // 人为抬高，与真事件标识落在同一量级，任何阈值都分不开（真跑实测：126 条塌成 24 簇、
  // 最大簇 101、误杀 100 条）。全量 1184 条做分母时 language 的 df 是数百、astra 仍是 15。
  const backgroundDf = new Map<string, number>()
  for (const it of collected) {
    for (const tok of entityTokens(it.title, stopwords)) {
      backgroundDf.set(tok, (backgroundDf.get(tok) ?? 0) + 1)
    }
  }
  const capped = capEvents(candidates, opts.gates, {
    backgroundDf,
    backgroundSize: collected.length,
  })
  // 事件聚合**不产生 dropped**：超额条目是降权（排在 kept 之后），不是拒绍。
  // 词法聚类判别不可靠（见 capEvents 的实测说明），丢弃会静默摧毁内容。
  const eventOrdered = [...capped.kept, ...capped.demoted]
  const zeroYieldSources = enabled
    .filter((s) => (sourceAfterDedupe[s.id] ?? 0) > 0 && (sourceRelevant[s.id] ?? 0) === 0)
    .map((s) => s.id)

  return {
    persona: opts.persona.id,
    personaDisplay: opts.persona.displayName,
    // digestId 在采集阶段就定死：分段作业的四份产物靠它互相认，不能到 publish 才算
    digestId: sanitizeDigestId(`${opts.persona.id}${now.toString(36)}`),
    now,
    candidates,
    rawScores,
    eventOrder: eventOrdered.map((it) => it.id),
    eventOrdered,
    eventKeyOf: capped.eventKeyOf,
    eventCount: capped.eventCount,
    eventDemoted: capped.demoted.length,
    dropped: [...gateOutcome.dropped],
    weights,
    funnelPrefix: [
      { stage: 'collected', count: collected.length },
      { stage: 'afterDedupe', count: afterDedupe.length },
      { stage: 'afterGates', count: relevant.length },
      // 事件聚合是**降权**不是过滤，故本层不减量；超额数另记 eventDemoted 供看板归因
      { stage: 'afterEventCap', count: eventOrdered.length },
    ],
    skippedSources: skipped.map((s) => s.id),
    zeroYieldSources,
    // 观测口径的三项计数只在本函数内可得（分段跑时 finalizeStage 拿不到源级明细）
    observed: {
      collectedCount: collected.length,
      relevantCount: relevant.length,
      sourceFetched,
      sourceAfterDedupe,
      sourceRelevant,
      skippedSourceIds: skipped.map((s) => s.id),
      enabledSourceIds: enabled.map((s) => s.id),
      recallPoolSize: recallPool.length,
      recallIncluded,
    },
  }
}

export interface FinalizeOptions {
  persona: PersonaConfig
  gates: GatesConfig
  memoryDir: string
  /** 跨产线共享的已发布指纹库；命中即一票否决 */
  knownCanonical?: ReadonlySet<string>
  /** 缺省时不调端点（分阶段作业已由 edit/review 跑完，或本轮就是机械兜底） */
  editorial?: EditorialConfig
  root?: string
  editorialFetchFn?: FetchFn
  /** 分阶段作业：已跑好的编辑部产物。与 editorial 同时给时以本项为准（不重复调端点） */
  stagedEditorial?: StagedEditorial
}

/**
 * 产线步骤 8-12：编辑部 → 渲染 → 主编终审 → 递补 → 归档 → 观测。
 *
 * 与 `collectStage` 分开是为了让 `publish` 命令能在不重跑采集（不联网、不消耗配额）
 * 的前提下完成发布，且**走的是同一段代码**——不在 cli 里另写一份终审与归档。
 */
export async function finalizeStage(stage: CollectStageResult, opts: FinalizeOptions): Promise<PipelineResult> {
  const now = stage.now
  const store = new MemoryStore(opts.memoryDir)
  const stopwords = new Set(opts.gates.dedupe?.eventStopwords ?? [])
  const digestId = stage.digestId
  const candidates = stage.candidates
  const rawScores = stage.rawScores

  // 8. 编辑部（DB-05）+ maxItems 截断。
  //
  // 只对「主池 + 等量候补」跑编辑部，不对全量 eventOrdered 跑：后者可达数百条，
  // 按实测 writer 每条 15.7s 会把单轮拖到数小时。maxItems 两份的量级（≤240 条）
  // 对应实测的 ≈53 分钟，落在老张认可的「过夜批产 1 小时级」内。
  const editorialTargets = editorialTargetsOf(stage, opts.persona.maxItems)
  let editorial: EditorialOutcome | null = null
  let ordered = editorialTargets
  const copiesOf = new Map<string, WrittenCopy | null>()

  if (opts.stagedEditorial) {
    // 下标错位不会让任何断言变红，只会让 A 条目的文案挂到 B 条目上——格式完美、内容张冠李戴。
    // 故这里硬校验，不一致就抛错而不是错发。
    assertTargetAlignment('copy', opts.stagedEditorial.targetIds, editorialTargets.map((t) => t.id))
    editorial = opts.stagedEditorial.outcome
  } else if (opts.editorial) {
    editorial = await runEditorial({
      config: opts.editorial,
      persona: opts.persona,
      candidates: editorialTargets,
      root: opts.root ?? process.cwd(),
      now,
      fetchFn: opts.editorialFetchFn,
    })
  }

  if (editorial) {
    if (!editorial.active) {
      console.warn(`[editorial] 未生效，退回机械兜底：${editorial.inactiveReason ?? '未知原因'}`)
    }
    editorialTargets.forEach((item, i) => copiesOf.set(item.id, editorial!.copies[i] ?? null))

    // reviewer 分数只用于**递补排序**：达标的排前、不达标的排后。
    // 不用它判定合格——本项目已有「打分饱和使验收无读数」的前车之鉴，
    // 且 LLM 自分自用构成循环。合格与否由 gatekeeper 的十条客观断言定。
    // reviewer 未生效（qualifiedIndices=null）时保持原分数序，不得用空判定洗掉排序。
    if (editorial.qualifiedIndices) {
      const demoted = new Set(
        editorial.verdicts
          .map((v, i) => ({ v, item: editorialTargets[i]! }))
          .filter(({ v }) => v !== null && (v.decision === '剔除' || !meetsQualityBar(v, opts.persona)))
          .map(({ item }) => item.id),
      )
      ordered = [
        ...editorialTargets.filter((it) => !demoted.has(it.id)),
        ...editorialTargets.filter((it) => demoted.has(it.id)),
      ]
    }
  }

  // 9. 交给终审的候选集：**不在这里按 maxItems 截断**。
  //
  // 截断由 gatekeep 的 target 做，不能提前（2026-09-04 实测）：提前按分数截断会把
  // 低分的同事件条目直接挡在终审门外，于是「每事件最多 maxPerEvent 条」的多样性
  // 选择根本没有发生机会——实测 8 条 Astra + 13 条其他内容、maxItems=6 时，
  // 若 Astra 分数偏低就一条都进不了 selected，多样性约束形同虚设。
  //
  // gatekeep 的扫描循环在 accepted 达到 target 时才 break，被拒/被降权的条目不占 target，
  // 因此它会自然向候选集深处扫描，兼有「递补」与「多样性」两种作用，不需要独立候补池。
  const selected = ordered
  const backfillPool: ScoredItem[] = []

  // 10. 渲染 → 主编终审 → 递补 → 事件复检 → 重编号
  const gatekeepResult = gatekeep(selected, backfillPool, {
    persona: opts.persona,
    gates: opts.gates,
    now,
    digestId,
    knownCanonical: opts.knownCanonical ?? new Set<string>(),
    eventKeyOf: stage.eventKeyOf,
    stopwords,
    copiesOf,
  })

  // 11. 归档：全量候选入档（截断前），再 markPushed 升级实际发布的。
  // 两步分离是「解传送带」纪律：只归档推送条目的话，去重库只屏蔽推过的 N 条，
  // 同一批源内容被逐轮消费，推送质量单调衰减（本项目已踩过并修过）。
  store.recordItems(candidates, now)
  const publishedIds = publishedItemIds([...selected, ...backfillPool], gatekeepResult)
  store.markPushed(publishedIds)

  // 内容档 + ref 登记：tuna 行为回流的归因链靠它。
  // tuna 侧信号按 postId 归因，而 postId = `domain-bot-<persona>:<digestId>:<index>`，
  // 去掉首段就是 `registerDigestRef` 要求的 ref 格式 `<digestId>:<index>`（正则 ^[a-z0-9]+:\d+$）。
  // 没这一步，回流的信号无法映射回 itemId 与 source → weights/interest 仍然喂不进去。
  // 同时 settleStaleExposures 靠 saveDigest 的 clusters[].source 结算「曝光未展开」弱负证据。
  const itemIdByUrl = new Map([...selected, ...backfillPool].map((it) => [it.url, it.id]))
  store.saveDigest({
    id: digestId,
    generatedAt: now,
    clusters: gatekeepResult.published.map((p, i) => ({
      ref: `${digestId}:${i}`,
      title: p.title,
      summary: p.summary,
      why: p.why,
      items: [{ url: p.url, isNew: true, source: p.source }],
    })),
  })
  for (let i = 0; i < gatekeepResult.published.length; i++) {
    const p = gatekeepResult.published[i]!
    const itemId = itemIdByUrl.get(p.url)
    if (!itemId) continue
    store.registerDigestRef(`${digestId}:${i}`, digestId, itemId, p.source)
  }

  // 行为→兴趣映射：结算已过判定期的曝光。Telegram 退役后曝光改由 tuna 回流入账。
  settleStaleExposures(opts.memoryDir, now)

  // 12. 观测
  const funnel: FunnelStage[] = [
    ...stage.funnelPrefix,
    { stage: 'afterTruncate', count: selected.length },
    { stage: 'published', count: gatekeepResult.published.length },
  ]

  const observation = observeRound({
    candidates,
    rawScores,
    // observeRound 的 pushed 口径是 ScoredItem；终审产出是渲染后条目，
    // 这里回映到对应的 ScoredItem 以保持观测口径与旧序列可比
    pushed: [...selected, ...backfillPool].filter((s) => publishedIds.includes(s.id)),
    weights: stage.weights,
    at: now,
    collected: stage.observed.collectedCount,
    relevant: stage.observed.relevantCount,
    skippedSources: stage.observed.skippedSourceIds,
    feedbackCount: store.feedbackCount(),
    sourceFetched: stage.observed.sourceFetched,
    sourceAfterDedupe: stage.observed.sourceAfterDedupe,
    sourceRelevant: stage.observed.sourceRelevant,
    enabledSourceIds: stage.observed.enabledSourceIds,
    recallPoolSize: stage.observed.recallPoolSize,
    recallIncluded: stage.observed.recallIncluded,
    telegram: 'disabled',
    pushedDelivered: 0,
  })
  appendObservation(opts.memoryDir, observation)

  const board = buildBoard(
    {
      persona: opts.persona.id,
      personaDisplay: opts.persona.displayName,
      digestId,
      generatedAt: now,
      funnel,
      dropped: stage.dropped,
      rejected: gatekeepResult.rejected,
      rejectCounts: gatekeepResult.rejectCounts,
      backfilled: gatekeepResult.backfilled,
      poolExhausted: gatekeepResult.poolExhausted,
      eventTrimmed: gatekeepResult.eventTrimmed,
      eventCount: stage.eventCount,
      eventDemoted: stage.eventDemoted,
      eventFillMode: gatekeepResult.eventFillMode,
      skippedSources: stage.skippedSources,
      zeroYieldSources: stage.zeroYieldSources,
      recall:
        stage.observed.recallPoolSize > 0 || stage.observed.recallIncluded > 0
          ? { poolSize: stage.observed.recallPoolSize, included: stage.observed.recallIncluded }
          : undefined,
      publishedFingerprintCount: collectCanonicalUrls(gatekeepResult.published).length,
      compileErrors: [],
      editorial: editorialBoard(editorial, gatekeepResult.published, [...selected, ...backfillPool], copiesOf),
    },
    gatekeepResult.published,
    // 真实信号存量：决定看板的 selfEvolutionActive。不得硬编码——
    // 回流接通前恒 0（false），接通后自动转 true，两头都不说谎。
    { views: store.viewCount(), engagements: store.engagementAll().length, feedback: store.feedbackCount() },
  )

  return {
    persona: opts.persona.id,
    personaDisplay: opts.persona.displayName,
    digestId,
    candidates,
    events: stage.eventCount,
    selected,
    backfillPool,
    published: gatekeepResult.published,
    editorial,
    funnel,
    dropped: stage.dropped,
    gatekeep: gatekeepResult,
    board,
    skippedSources: stage.skippedSources,
    zeroYieldSources: stage.zeroYieldSources,
  }
}

/**
 * 把编辑部执行结果投成看板字段。
 *
 * `enabled` 与 `active` 必须分开记：前者是配置意图，后者是实际结果。
 * 两者不一致（启用了但未生效）就是静默降级，auditBoard 会报 warning。
 */
function editorialBoard(
  editorial: EditorialOutcome | null,
  published: GatekeeperInput[],
  pool: ScoredItem[],
  copiesOf: ReadonlyMap<string, WrittenCopy | null>,
): EditorialBoard {
  if (!editorial) {
    return {
      enabled: false,
      active: false,
      inactiveReason: '未配置编辑部（config/editor.json 未传入产线），走启发式打分 + 机械渲染兜底',
      writerDegradedBatches: 0,
      reviewerDegradedBatches: 0,
      truncatedBatches: 0,
      calibrationPassed: null,
      calibrationProblems: [],
      endpoints: [],
      llmCopyCount: 0,
    }
  }
  // 端点用量读归一化的 stats，不直接摸 job.state：分阶段作业时 job 在另一个进程里
  // 跑完，publish 阶段的 outcome 由 staging 快照重建，手上根本没有 job 对象。
  const endpoints: EditorialBoard['endpoints'] = editorial.stats.endpoints.map((s) => ({
    role: s.role,
    endpointId: s.endpointId,
    calls: s.calls,
    failures: s.failures,
    reasoningTokens: s.reasoningTokens,
    elapsedMs: s.elapsedMs,
  }))
  // 已发布条目里有多少真拿到了 LLM 文案。
  // 回映路径：published.url → pool 里的 ScoredItem.id → copiesOf。
  // 不得用「钩子数 = 3」之类的外观特征估算：机械兜底也给 3 条钩子，分不出来。
  const itemByUrl = new Map(pool.map((it) => [it.url, it.id]))
  let llmCopyCount = 0
  for (const p of published) {
    const srcId = itemByUrl.get(p.url)
    if (srcId !== undefined && copiesOf.get(srcId)) llmCopyCount += 1
  }

  return {
    enabled: editorial.enabled,
    active: editorial.active,
    inactiveReason: editorial.inactiveReason,
    writerDegradedBatches: editorial.stats.writerDegradedBatches,
    reviewerDegradedBatches: editorial.stats.reviewerDegradedBatches,
    truncatedBatches: editorial.stats.truncatedBatches,
    calibrationPassed: editorial.calibration ? editorial.calibration.problems.length === 0 : null,
    calibrationProblems: editorial.calibration?.problems ?? [],
    endpoints,
    llmCopyCount: editorial.active ? llmCopyCount : 0,
  }
}

/**
 * markPushed 需要条目 id；终审产出是渲染后条目（id 已是 tuna 格式），故按 url 回映。
 *
 * @param pool 必须含主池 **与候补池**：递补进产出的条目来自候补池，
 *   只传 selected 会漏记它们 → 下一轮 dedupe 不屏蔽 → 同一条目重复发布。
 * url 回映可靠的前提：门禁 3 已保证批内规范 URL 唯一。
 */
function publishedItemIds(pool: ScoredItem[], result: GatekeepResult): string[] {
  const urls = new Set(result.published.map((p) => p.url))
  return pool.filter((s) => urls.has(s.url)).map((s) => s.id)
}

/** digestId 只允许 [a-z0-9]：tuna 侧 id 正则 `^[a-z0-9-]+:[a-z0-9]+:\d+$` 的第二段约束。 */
export function sanitizeDigestId(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
  return cleaned || 'x'
}

/** 按源类型路由到对应适配器（与旧 runOnce 同口径）。 */
async function collectSource(source: SourceConfig, fetchFn?: FetchFn, spawnFn?: SpawnFn): Promise<RawItem[]> {
  switch (source.type) {
    case 'rss':
      return fetchRss(source, fetchFn)
    case 'github':
      return fetchGithub(source, fetchFn)
    case 'exa':
      return fetchExa(source, spawnFn)
    case 'v2ex':
      return fetchV2ex(source, fetchFn)
    case 'bili':
      return fetchBili(source, spawnFn)
    case 'ytsearch':
      return fetchYtSearch(source, spawnFn)
    case 'jina':
      return fetchJina(source, fetchFn, process.env.DOMAIN_BOT_JINA_API_KEY || undefined, spawnFn)
  }
}
