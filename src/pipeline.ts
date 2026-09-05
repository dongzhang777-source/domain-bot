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
import { capEvents, collectCanonicalUrls, runGates } from './gates/index.js'
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
}

export interface PipelineResult {
  persona: string
  personaDisplay: string
  digestId: string
  /** 过闸门 + 打分后、事件聚合前的全量候选 */
  candidates: ScoredItem[]
  /** 独立事件簇数 */
  events: number
  /** 事件聚合 + maxItems 截断后进终审的主池 */
  selected: ScoredItem[]
  /** 被 maxItems 截掉、供终审递补的候补池 */
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

  // 2. 精确 id 去重（跨轮次）。id 已由 itemId() 从规范 URL 派生，跨渠道同文档必得同 id
  const { kept: afterDedupe } = dedupe(collected, store.knownIds())
  const sourceAfterDedupe: Record<string, number> = {}
  for (const it of afterDedupe) sourceAfterDedupe[it.source] = (sourceAfterDedupe[it.source] ?? 0) + 1

  // 3. 四层闸门（persona 前置 → 黑名单 → 相关性积分 → 规范 URL 去重）
  const gateOutcome = runGates(afterDedupe, {
    persona: opts.persona,
    gates: opts.gates,
    now,
    knownCanonical: opts.knownCanonical,
  })
  // 4. 配置正则写错必须熔断，不得静默跳过——一条失效规则等于该规则不存在，闸门会假绿
  if (gateOutcome.compileErrors.length > 0) {
    throw new Error(
      `闸门配置有 ${gateOutcome.compileErrors.length} 条正则编译失败（规则实际未生效，拒绝继续）：` +
        gateOutcome.compileErrors.map((e: { gate: GateId; ruleId: string; error: string }) => `${e.gate}/${e.ruleId}: ${e.error}`).join('; '),
    )
  }
  const relevant = gateOutcome.passed
  const sourceRelevant: Record<string, number> = {}
  for (const it of relevant) sourceRelevant[it.source] = (sourceRelevant[it.source] ?? 0) + 1

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

  // 7. 事件聚合 —— 必须在截断之前（见文件头）
  const capped = capEvents(candidates, opts.gates)
  const dropped: DropRecord[] = [...gateOutcome.dropped, ...capped.dropped]

  // 8. 编辑部（DB-05）+ maxItems 截断。
  //
  // 只对「主池 + 等量候补」跑编辑部，不对全量 capped.kept 跑：后者可达数百条，
  // 按实测 writer 每条 15.7s 会把单轮拖到数小时。maxItems 两份的量级（≤240 条）
  // 对应实测的 ≈53 分钟，落在老张认可的「过夜批产 1 小时级」内。
  const editorialTargets = capped.kept.slice(0, opts.persona.maxItems * 2)
  let editorial: EditorialOutcome | null = null
  let ordered = editorialTargets
  const copiesOf = new Map<string, WrittenCopy | null>()

  if (opts.editorial) {
    editorial = await runEditorial({
      config: opts.editorial,
      persona: opts.persona,
      candidates: editorialTargets,
      root: opts.root ?? process.cwd(),
      now,
      fetchFn: opts.editorialFetchFn,
    })
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

  // 9. maxItems 截断（上限，不是配额；无每源下限）
  const selected = ordered.slice(0, opts.persona.maxItems)
  const backfillPool = [
    ...ordered.slice(opts.persona.maxItems),
    // 未进编辑部作用域的剩余候选仍可做候补（只是没有 LLM 文案，走机械兜底）
    ...capped.kept.slice(editorialTargets.length),
  ]

  // 10. 渲染 → 主编终审 → 递补 → 事件复检 → 重编号
  const digestId = sanitizeDigestId(`${opts.persona.id}${now.toString(36)}`)
  const gatekeepResult = gatekeep(selected, backfillPool, {
    persona: opts.persona,
    gates: opts.gates,
    now,
    digestId,
    knownCanonical: opts.knownCanonical ?? new Set<string>(),
    eventKeyOf: capped.eventKeyOf,
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

  // 行为→兴趣映射：结算已过判定期的曝光。Telegram 退役后无新曝光入账，
  // 本调用在 DB-06 回流通道落地前恒为空转——保留接线，看板明写 selfEvolutionActive=false。
  settleStaleExposures(opts.memoryDir, now)

  // 12. 观测
  const funnel: FunnelStage[] = [
    { stage: 'collected', count: collected.length },
    { stage: 'afterDedupe', count: afterDedupe.length },
    { stage: 'afterGates', count: relevant.length },
    { stage: 'afterEventCap', count: capped.kept.length },
    { stage: 'afterTruncate', count: selected.length },
    { stage: 'published', count: gatekeepResult.published.length },
  ]
  const zeroYieldSources = enabled
    .filter((s) => (sourceAfterDedupe[s.id] ?? 0) > 0 && (sourceRelevant[s.id] ?? 0) === 0)
    .map((s) => s.id)

  const observation = observeRound({
    candidates,
    rawScores,
    // observeRound 的 pushed 口径是 ScoredItem；终审产出是渲染后条目，
    // 这里回映到对应的 ScoredItem 以保持观测口径与旧序列可比
    pushed: [...selected, ...backfillPool].filter((s) => publishedIds.includes(s.id)),
    weights,
    at: now,
    collected: collected.length,
    relevant: relevant.length,
    skippedSources: skipped.map((s) => s.id),
    feedbackCount: store.feedbackCount(),
    enabledSourceIds: enabled.map((s) => s.id),
    sourceFetched,
    sourceAfterDedupe,
    sourceRelevant,
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
      dropped,
      rejected: gatekeepResult.rejected,
      rejectCounts: gatekeepResult.rejectCounts,
      backfilled: gatekeepResult.backfilled,
      poolExhausted: gatekeepResult.poolExhausted,
      eventTrimmed: gatekeepResult.eventTrimmed,
      eventCount: capped.eventCount,
      skippedSources: skipped.map((s) => s.id),
      zeroYieldSources,
      publishedFingerprintCount: collectCanonicalUrls(gatekeepResult.published).length,
      compileErrors: gateOutcome.compileErrors,
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
    events: capped.eventCount,
    selected,
    backfillPool,
    published: gatekeepResult.published,
    editorial,
    funnel,
    dropped,
    gatekeep: gatekeepResult,
    board,
    skippedSources: skipped.map((s) => s.id),
    zeroYieldSources,
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
  const endpoints: EditorialBoard['endpoints'] = []
  for (const [role, job] of [
    ['writer', editorial.writerJob],
    ['reviewer', editorial.reviewerJob],
  ] as const) {
    for (const [endpointId, s] of Object.entries(job?.state.endpointUsage ?? {})) {
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
    writerDegradedBatches: editorial.writerJob?.state.degradedBatches.length ?? 0,
    reviewerDegradedBatches: editorial.reviewerJob?.state.degradedBatches.length ?? 0,
    truncatedBatches:
      (editorial.writerJob?.state.truncatedBatches.length ?? 0) +
      (editorial.reviewerJob?.state.truncatedBatches.length ?? 0),
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
