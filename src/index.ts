import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Digest, DomainConfig, FetchFn, ScoredItem, SourceConfig } from './types.js'
import { dedupe } from './collector/dedupe.js'
import { fetchRss } from './collector/adapters/rss.js'
import { fetchGithub } from './collector/adapters/github.js'
import { filterRelevant } from './refinery/filter.js'
import { makeScorerFromEnv } from './refinery/scorer.js'
import { buildClusters } from './refinery/cluster.js'
import { MemoryStore } from './memory/store.js'
import { applySourceWeight, selectSources } from './memory/evolve.js'
import { pushFile } from './push/file.js'
import { sendDigestTelegram } from './push/telegram.js'

export interface RunOptions {
  domain: DomainConfig
  sources: SourceConfig[]
  memoryDir: string
  outDir?: string
  telegram?: { token: string; chatId: string }
  fetchFn?: FetchFn
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
  const { fetched, skipped } = selectSources(opts.sources)

  const collected: ScoredItem[] = []
  let collectedCount = 0
  for (const source of fetched) {
    try {
      const items = source.type === 'github' ? await fetchGithub(source, opts.fetchFn) : await fetchRss(source, opts.fetchFn)
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
  let scored: ScoredItem[] = relevant.map((item, i) => ({
    ...item,
    valueScore: applySourceWeight(scores[i].valueScore, weightOf.get(item.source) ?? 0.5),
    isNew: store.isNovel(item),
    reason: scores[i].reason,
  }))
  scored = scored.filter((s) => s.valueScore >= opts.domain.scoreThreshold * 0.5)
  scored.sort((a, b) => b.valueScore - a.valueScore)
  scored = scored.slice(0, opts.domain.maxPerDigest)

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
