import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Digest, DomainConfig, FetchFn, RawItem, ScoredItem, SourceConfig, SpawnFn } from './types.js'
import { dedupe } from './collector/dedupe.js'
import { fetchRss } from './collector/adapters/rss.js'
import { fetchGithub } from './collector/adapters/github.js'
import { fetchBili, fetchExa, fetchJina, fetchV2ex } from './collector/adapters/agentreach.js'
import { resolveSourceUrl } from './collector/urlTemplate.js'
import { filterRelevant } from './refinery/filter.js'
import { makeScorerFromEnv } from './refinery/scorer.js'
import { buildClusters } from './refinery/cluster.js'
import { MemoryStore } from './memory/store.js'
import { applyNovelty, applySourceWeight } from './memory/evolve.js'
import { appendObservation, observeRound, type RoundObservation } from './memory/observe.js'
import { refreshWeights } from './memory/weights.js'
import { pollFeedback } from './feedback/receiver.js'
import { pushFile } from './push/file.js'
import { sendDigestTelegram } from './push/telegram.js'

export interface RunOptions {
  domain: DomainConfig
  sources: SourceConfig[]
  memoryDir: string
  outDir?: string
  telegram?: { token: string; chatId: string }
  fetchFn?: FetchFn
  spawnFn?: SpawnFn
  now?: number
}

export interface RunResult {
  digest?: Digest
  pushedPaths: string[]
  observation: RoundObservation
  stats: {
    collected: number
    deduped: number
    relevant: number
    pushed: number
    skippedSources: string[]
  }
}

/** 单轮流水线：采集 → 去重 → 相关性 → 打分 → 源权重调节 → 聚类 → 记忆 → 推送。 */
export async function runOnce(opts: RunOptions): Promise<RunResult> {
  const now = opts.now ?? Date.now()
  const store = new MemoryStore(opts.memoryDir)
  // 全量抓取：源数量少且免登录，逐一尝试，单源失败不阻塞；权重只影响排序（applySourceWeight）
  const enabled = opts.sources.filter((s) => s.enabled)
  const skipped: SourceConfig[] = []

  const collected: ScoredItem[] = []
  let collectedCount = 0
  for (const source of enabled) {
    try {
      const items = await collectSource({ ...source, url: resolveSourceUrl(source.url, now) }, opts.fetchFn, opts.spawnFn)
      collectedCount += items.length
      collected.push(...items.map((i) => ({ ...i, valueScore: 0, isNew: false, reason: '' })))
    } catch (err) {
      // 必须记入 skipped：否则 skippedSources 恒为空，源挂掉与内容池枯竭在观测上无法区分。
      skipped.push(source)
      console.error(`[collector] ${source.id} 失败:`, err instanceof Error ? err.message : err)
    }
  }

  const known = store.knownIds()
  const { kept } = dedupe(collected, known)
  const { kept: relevant } = filterRelevant(kept, opts.domain)

  const scorer = makeScorerFromEnv()
  const scores = await scorer.score(relevant, opts.domain)
  // 权重优先级：memory/weights.json（已学到）> config/sources.json（首次先验）
  const weights = refreshWeights(store, opts.sources)
  const weightOf = new Map(Object.entries(weights))

  // 过滤用原始分：源权重只应影响排序，不该把低权源整体挡在候选池外，
  // 否则低权源永远进不了推送 → 永远拿不到反馈 → 权重再也回不来（反馈死锁）。
  const passed: Array<{ item: RawItem; raw: number; reason: string }> = []
  for (let i = 0; i < relevant.length; i++) {
    const s = scores[i]!
    if (s.valueScore >= opts.domain.scoreThreshold) passed.push({ item: relevant[i]!, raw: s.valueScore, reason: s.reason })
  }

  // 排序用加权分 + 新颖性因子；原始分并行携带，供观测（rawP50/rawTop1/saturation）使用。
  // applyNovelty 只作用于排序用的加权分，不影响过滤（原始分），防旧闻被整体挡出候选池（反馈死锁）。
  const ranked = passed.map(({ item, raw, reason }) => {
    const novel = store.isNovel(item)
    const weighted = applySourceWeight(raw, weightOf.get(item.source) ?? 0.5)
    return { entry: { ...item, valueScore: applyNovelty(weighted, novel), isNew: novel, reason } as ScoredItem, raw }
  })
  ranked.sort((a, b) => b.entry.valueScore - a.entry.valueScore)
  // 每源配额：arXiv 类关键词密集源不得霸占全部推送位，保证渠道多样性
  const perSourceCap = Math.max(2, Math.ceil(opts.domain.maxPerDigest / 2))
  const perSourceCount = new Map<string, number>()
  const pushedRanked: typeof ranked = []
  for (const r of ranked) {
    const used = perSourceCount.get(r.entry.source) ?? 0
    if (used >= perSourceCap) continue
    perSourceCount.set(r.entry.source, used + 1)
    pushedRanked.push(r)
    if (pushedRanked.length >= opts.domain.maxPerDigest) break
  }
  // 全量候选（阈值过滤后、配额截断前）= candidates；配额截断后 = pushed。
  const candidates = ranked.map((r) => r.entry)
  const rawScores = ranked.map((r) => r.raw)
  const pushed = pushedRanked.map((r) => r.entry)

  // 全量候选入归档（配额截断前），再由 markPushed 升级真正推送的那些。
  // 这样 dedupe 屏蔽的是整批已评估内容，而不是只屏蔽推过的 6 条 —— 解传送带。
  const digestId = now.toString(36)
  const digest: Digest = {
    id: digestId,
    generatedAt: now,
    domain: opts.domain.domain,
    clusters: buildClusters(pushed, opts.domain.clusterThreshold, digestId),
  }

  store.recordItems(candidates, now)
  store.markPushed(pushed.map((s) => s.id))
  for (const cluster of digest.clusters) {
    store.registerDigestRef(cluster.ref, digestId, cluster.items[0].id, cluster.items[0].source)
  }

  const observation = observeRound({
    candidates,
    rawScores,
    pushed,
    weights,
    at: now,
    collected: collectedCount,
    relevant: relevant.length,
    skippedSources: skipped.map((s) => s.id),
    feedbackCount: store.feedbackCount(),
  })
  appendObservation(opts.memoryDir, observation)

  const pushedPaths: string[] = []
  if (digest.clusters.length === 0) {
    return {
      digest,
      pushedPaths,
      observation,
      stats: { collected: collectedCount, deduped: collectedCount - kept.length, relevant: relevant.length, pushed: 0, skippedSources: skipped.map((s) => s.id) },
    }
  }
  if (opts.outDir) {
    pushedPaths.push(pushFile(digest, opts.outDir))
  }
  if (opts.telegram) {
    try {
      await sendDigestTelegram(digest, opts.telegram)
    } catch (err) {
      console.error('[push] telegram 失败:', err instanceof Error ? err.message : err)
    }
  }

  return {
    digest,
    pushedPaths,
    observation,
    stats: {
      collected: collectedCount,
      deduped: collectedCount - kept.length,
      relevant: relevant.length,
      pushed: pushed.length,
      skippedSources: skipped.map((s) => s.id),
    },
  }
}

/** 按源类型路由到对应适配器（RSS/Atom/arXiv、GitHub、Agent-Reach 免登录通道）。 */
async function collectSource(source: SourceConfig, fetchFn?: FetchFn, spawnFn?: SpawnFn) {
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
    case 'jina':
      return fetchJina(source, fetchFn, process.env.DOMAIN_BOT_JINA_API_KEY || undefined)
  }
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

async function main(): Promise<void> {
  const root = process.cwd()
  const domain = loadJson<DomainConfig>(join(root, 'config/domain.json'))
  const sources = loadJson<SourceConfig[]>(join(root, 'config/sources.json'))
  const push = loadJson<{ outDir: string }>(join(root, 'config/push.json'))
  const memoryDir = join(root, 'memory')

  const once = process.argv.includes('--once')
  const telegram =
    process.env.DOMAIN_BOT_TELEGRAM_TOKEN && process.env.DOMAIN_BOT_TELEGRAM_CHAT_ID
      ? { token: process.env.DOMAIN_BOT_TELEGRAM_TOKEN, chatId: process.env.DOMAIN_BOT_TELEGRAM_CHAT_ID }
      : undefined

  const pollMs = Number(process.env.DOMAIN_BOT_POLL_MS) || 86_400_000   // 默认每天 1 轮（裁决 R9）

  // 常驻反馈接收：Telegram 👍/👎 → feedback.json → weights.json。--once 模式不起。
  // 只传 memoryDir：接收端每次回调从盘重建 store，不持有长驻快照（V1 事故教训）。
  if (telegram && !once) {
    pollFeedback(
      { token: telegram.token, memoryDir, sources },
      { onError: (e) => console.error('[feedback] 轮询异常（5s 后重试）:', e instanceof Error ? e.message : e) },
    ).catch((e) => console.error('[feedback] 循环意外退出:', e))
  } else if (telegram) {
    console.log('[feedback] --once 模式未启动回调接收；本轮的 👍/👎 将在下次常驻运行时入账')
  }

  do {
    const result = await runOnce({ domain, sources, memoryDir, outDir: push.outDir, telegram })
    console.log(
      `[run] 采集 ${result.stats.collected} → 去重删 ${result.stats.deduped} → 相关 ${result.stats.relevant} → 推送 ${result.stats.pushed} 条`,
      result.pushedPaths,
    )
    if (once) break
    await new Promise((r) => setTimeout(r, pollMs))
  } while (!once)
}

// CLI 入口：被测试导入时不执行 main
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
