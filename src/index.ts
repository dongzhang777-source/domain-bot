import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Digest, DomainConfig, FetchFn, RawItem, ScoredItem, SourceConfig, SpawnFn } from './types.js'
import { dedupe } from './collector/dedupe.js'
import { fetchRss } from './collector/adapters/rss.js'
import { fetchGithub } from './collector/adapters/github.js'
import { fetchBili, fetchExa, fetchJina, fetchV2ex } from './collector/adapters/agentreach.js'
import { filterRelevant } from './refinery/filter.js'
import { makeScorerFromEnv } from './refinery/scorer.js'
import { buildClusters } from './refinery/cluster.js'
import { MemoryStore } from './memory/store.js'
import { applySourceWeight } from './memory/evolve.js'
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
      const items = await collectSource(source, opts.fetchFn, opts.spawnFn)
      collectedCount += items.length
      collected.push(...items.map((i) => ({ ...i, valueScore: 0, isNew: false, reason: '' })))
    } catch (err) {
      console.error(`[collector] ${source.id} 失败:`, err instanceof Error ? err.message : err)
    }
  }

  const known = store.knownIds()
  const { kept } = dedupe(collected, known)
  const { kept: relevant } = filterRelevant(kept, opts.domain)

  const scorer = makeScorerFromEnv()
  const scores = await scorer.score(relevant, opts.domain)
  const weightOf = new Map(opts.sources.map((s) => [s.id, s.weight]))

  // 过滤用原始分：源权重只应影响排序，不该把低权源整体挡在候选池外，
  // 否则低权源永远进不了推送 → 永远拿不到反馈 → 权重再也回不来（反馈死锁）。
  const passed: Array<{ item: RawItem; raw: number; reason: string }> = []
  for (let i = 0; i < relevant.length; i++) {
    const s = scores[i]!
    if (s.valueScore >= opts.domain.scoreThreshold) passed.push({ item: relevant[i]!, raw: s.valueScore, reason: s.reason })
  }

  // 排序用加权分（Task 8 会把 weightOf 换成持久化权重，Task 10 会在这里插入新颖性因子）
  let scored: ScoredItem[] = passed.map(({ item, raw, reason }) => ({
    ...item,
    valueScore: applySourceWeight(raw, weightOf.get(item.source) ?? 0.5),
    isNew: store.isNovel(item),
    reason,
  }))
  scored.sort((a, b) => b.valueScore - a.valueScore)
  // 每源配额：arXiv 类关键词密集源不得霸占全部推送位，保证渠道多样性
  const perSourceCap = Math.max(2, Math.ceil(opts.domain.maxPerDigest / 2))
  const perSourceCount = new Map<string, number>()
  const diversified: ScoredItem[] = []
  for (const item of scored) {
    const used = perSourceCount.get(item.source) ?? 0
    if (used >= perSourceCap) continue
    perSourceCount.set(item.source, used + 1)
    diversified.push(item)
    if (diversified.length >= opts.domain.maxPerDigest) break
  }
  scored = diversified

  const digestId = now.toString(36)
  const digest: Digest = {
    id: digestId,
    generatedAt: now,
    domain: opts.domain.domain,
    clusters: buildClusters(scored, opts.domain.clusterThreshold, digestId),
  }

  store.recordItems(scored, now)
  for (const cluster of digest.clusters) {
    store.registerDigestRef(cluster.ref, digestId, cluster.items[0].id, cluster.items[0].source)
  }

  const pushedPaths: string[] = []
  if (digest.clusters.length === 0) {
    return {
      digest,
      pushedPaths,
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
    stats: {
      collected: collectedCount,
      deduped: collectedCount - kept.length,
      relevant: relevant.length,
      pushed: digest.clusters.length,
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
  const push = loadJson<{ channel: string; outDir: string }>(join(root, 'config/push.json'))

  const once = process.argv.includes('--once')
  const telegram =
    process.env.DOMAIN_BOT_TELEGRAM_TOKEN && process.env.DOMAIN_BOT_TELEGRAM_CHAT_ID
      ? { token: process.env.DOMAIN_BOT_TELEGRAM_TOKEN, chatId: process.env.DOMAIN_BOT_TELEGRAM_CHAT_ID }
      : undefined

  const pollMs = Number(process.env.DOMAIN_BOT_POLL_MS) || 3_600_000
  do {
    const result = await runOnce({ domain, sources, memoryDir: join(root, 'memory'), outDir: push.outDir, telegram })
    console.log(
      `[run] 采集 ${result.stats.collected} → 去重删 ${result.stats.deduped} → 相关 ${result.stats.relevant} → 推送 ${result.stats.pushed} 簇`,
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
