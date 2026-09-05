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
import { buildBoard, type FunnelStage, type QualityBoard } from './gatekeeper/board.js'

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

  // 8. maxItems 截断（上限，不是配额；无每源下限）
  const selected = capped.kept.slice(0, opts.persona.maxItems)
  const backfillPool = capped.kept.slice(opts.persona.maxItems)

  // 9. 渲染 → 主编终审 → 递补 → 事件复检 → 重编号
  const digestId = sanitizeDigestId(`${opts.persona.id}${now.toString(36)}`)
  const gatekeepResult = gatekeep(selected, backfillPool, {
    persona: opts.persona,
    gates: opts.gates,
    now,
    digestId,
    knownCanonical: opts.knownCanonical ?? new Set<string>(),
    eventKeyOf: capped.eventKeyOf,
    stopwords,
  })

  // 10. 归档：全量候选入档（截断前），再 markPushed 升级实际发布的。
  // 两步分离是「解传送带」纪律：只归档推送条目的话，去重库只屏蔽推过的 N 条，
  // 同一批源内容被逐轮消费，推送质量单调衰减（本项目已踩过并修过）。
  store.recordItems(candidates, now)
  const publishedIds = publishedItemIds([...selected, ...backfillPool], gatekeepResult)
  store.markPushed(publishedIds)
  // 行为→兴趣映射：结算已过判定期的曝光。Telegram 退役后无新曝光入账，
  // 本调用在 DB-06 回流通道落地前恒为空转——保留接线，看板明写 selfEvolutionActive=false。
  settleStaleExposures(opts.memoryDir, now)

  // 11. 观测
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
    },
    gatekeepResult.published,
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
    funnel,
    dropped,
    gatekeep: gatekeepResult,
    board,
    skippedSources: skipped.map((s) => s.id),
    zeroYieldSources,
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
