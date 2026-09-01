import { contentHash } from '../dedupe.js'
import type { FetchFn, RawItem, SourceConfig, SpawnFn } from '../../types.js'
import { defaultFetch } from './rss.js'

/**
 * Agent-Reach（https://github.com/Panniantong/Agent-Reach）免登录通道适配器集合。
 * Agent-Reach 是能力路由层，真实读取由上游工具完成；这里把其中可编程通道接入采集管线：
 *   - exa  ：经 mcporter 的 Exa 语义搜索（url 字段 = 搜索词）
 *   - v2ex ：V2EX 热门话题 HTTP API
 *   - bili ：bili-cli 搜索（url 字段 = 搜索词）
 *   - jina ：r.jina.ai 读任意网页（url 字段 = 目标 URL，盯无 RSS 的页面）
 * Twitter/Reddit/小红书等需登录态的通道不进无人值守管线（封号风险），留待人工决策。
 */

// ---------- exa（mcporter call exa.web_search_exa） ----------

export const exaSpawn: SpawnFn = (cmd, args) =>
  import('node:child_process').then(({ execFile }) =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 90_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stderr }))
        else resolve({ stdout, stderr })
      })
    }),
  )

/** 解析 Exa 文本输出："Title:/URL:/Published:/Author:/Highlights:" 块序列。 */
export function parseExaOutput(output: string, sourceId: string): RawItem[] {
  const blocks = output.split(/^Title: /m).slice(1)
  return blocks.map((block) => {
    const title = (block.match(/^(.*)/) ?? [''])[1]?.trim() ?? ''
    const url = block.match(/^URL: (\S*)/m)?.[1] ?? ''
    const publishedRaw = block.match(/^Published: (.*)$/m)?.[1]?.trim() ?? ''
    const highlights = block.split(/^Highlights:\s*$/m)[1] ?? ''
    const body = highlights
      .replace(/^---$/gm, '')
      .replace(/\n{2,}/g, '\n')
      .trim()
      .slice(0, 1200)
    return {
      id: contentHash({ title, body: url }),
      source: sourceId,
      title,
      body,
      url,
      publishedAt: publishedRaw ? Date.parse(publishedRaw) || 0 : 0,
      raw: block,
    }
  }).filter((i) => i.title && i.url)
}

export async function fetchExa(source: SourceConfig, spawnFn: SpawnFn = exaSpawn): Promise<RawItem[]> {
  const { stdout } = await spawnFn('mcporter', [
    'call', 'exa.web_search_exa', '--args',
    JSON.stringify({ query: source.url, numResults: 8 }),
  ])
  return parseExaOutput(stdout, source.id)
}

// ---------- v2ex（热门话题 API） ----------

interface V2exTopic {
  title: string
  url: string
  content?: string
  created?: number
  member?: { username?: string }
  node?: { title?: string }
}

export async function fetchV2ex(source: SourceConfig, fetchFn: FetchFn = defaultFetch): Promise<RawItem[]> {
  const res = await fetchFn('https://www.v2ex.com/api/topics/hot.json', {
    headers: { 'user-agent': 'domain-bot/0.1' },
  })
  if (!res.ok) throw new Error(`v2ex ${source.id}: HTTP ${res.status}`)
  const topics = JSON.parse(await res.text()) as V2exTopic[]
  return topics.map((t) => ({
    id: contentHash({ title: t.title, body: t.url }),
    source: source.id,
    title: t.title,
    body: (t.content ?? '').slice(0, 600) || `节点：${t.node?.title ?? '未知'} · 作者：${t.member?.username ?? '未知'}`,
    url: t.url,
    publishedAt: t.created ? t.created * 1000 : 0,
    raw: t,
  }))
}

// ---------- bili（bili-cli 搜索，YAML 输出） ----------

export async function fetchBili(source: SourceConfig, spawnFn: SpawnFn = exaSpawn): Promise<RawItem[]> {
  const { stdout } = await spawnFn('bili', ['search', source.url, '--type', 'video', '-n', '8'])
  const items: RawItem[] = []
  const entryRe = /- id: (\S+)[\s\S]*?bvid: (BV\S+)[\s\S]*?title: (.+)[\s\S]*?author: (.+)[\s\S]*?play: (\d+)/g
  for (const m of stdout.matchAll(entryRe)) {
    const [, , bvid, title, author, play] = m
    items.push({
      id: contentHash({ title, body: bvid }),
      source: source.id,
      title: title.trim(),
      body: `${author.trim()} · ${Number(play).toLocaleString()} 播放`,
      url: `https://www.bilibili.com/video/${bvid}`,
      publishedAt: 0,
      raw: m[0],
    })
  }
  return items
}

// ---------- jina（r.jina.ai 网页阅读，盯无 RSS 的页面） ----------
// 注意：r.jina.ai 自 2025 起对匿名请求返回 401，需免费 key（DOMAIN_BOT_JINA_API_KEY）；
// 无 key 时该源优雅失败，不影响其他通道。

export async function fetchJina(source: SourceConfig, fetchFn: FetchFn = defaultFetch, apiKey?: string): Promise<RawItem[]> {
  const headers: Record<string, string> = { 'user-agent': 'domain-bot/0.1' }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  const res = await fetchFn(`https://r.jina.ai/${source.url}`, { headers })
  if (!res.ok) throw new Error(`jina ${source.id}: HTTP ${res.status}`)
  const text = await res.text()
  const title = text.match(/^Title: (.*)$/m)?.[1]?.trim() ?? source.url
  const body = text.replace(/^Title:.*$/m, '').replace(/^URL Source:.*$/m, '').trim().slice(0, 2000)
  return [
    {
      id: contentHash({ title, body: body.slice(0, 200) }),
      source: source.id,
      title,
      body,
      url: source.url,
      publishedAt: 0,
      raw: undefined,
    },
  ]
}
