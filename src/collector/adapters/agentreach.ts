import { itemId } from '../dedupe.js'
import type { FetchFn, RawItem, SourceConfig, SpawnFn } from '../../types.js'
import { defaultFetch } from './rss.js'
import { isPublicHttpsUrl, isSafeLinkUrl, TIMEOUTS, timeoutSignal, withSizeLimit } from './fetchUtil.js'

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
      // 6000（2026-09-07 老张「L3 篇幅不够」）：同 anysearch，原 1200 截断致 L3 断头料
      .slice(0, 6000)
    return {
      id: itemId(url, title, body),
      source: sourceId,
      title,
      body,
      url,
      publishedAt: publishedRaw ? Date.parse(publishedRaw) || 0 : 0,
      raw: block,
    }
  }).filter((i) => i.title && i.url && isSafeLinkUrl(i.url))
}

export async function fetchExa(source: SourceConfig, spawnFn: SpawnFn = exaSpawn): Promise<RawItem[]> {
  const { stdout } = await spawnFn('mcporter', [
    'call', 'exa.web_search_exa', '--args',
    JSON.stringify({ query: source.url, numResults: source.numResults ?? 8 }),
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
  const res = await withSizeLimit(fetchFn, 'https://www.v2ex.com/api/topics/hot.json', {
    signal: timeoutSignal(TIMEOUTS.collector),
    headers: { 'user-agent': 'domain-bot/0.1' },
  })
  if (!res.ok) throw new Error(`v2ex ${source.id}: HTTP ${res.status}`)
  const topics = JSON.parse(await res.text()) as V2exTopic[]
  return topics.map((t) => {
    const body = (t.content ?? '').slice(0, 600) || `节点：${t.node?.title ?? '未知'} · 作者：${t.member?.username ?? '未知'}`
    // P1（2026-09-07 审查）：API 返回的 url 不校验 scheme，`javascript:` 可直达 tuna。
    // 非法 scheme 置空（itemId 回退内容哈希派生，不误杀整条）。
    const url = isSafeLinkUrl(t.url ?? '') ? (t.url as string) : ''
    return {
      id: itemId(url, t.title, body),
      source: source.id,
      title: t.title,
      body,
      url,
      publishedAt: t.created ? t.created * 1000 : 0,
      raw: t,
    }
  })
}

/** 组装一条 bili 条目；play 为空/非数字时显示 0。 */
function finalize(cur: { bvid: string; title: string; author: string; play: string }, sourceId: string): RawItem {
  const playNum = Number(cur.play)
  const title = cur.title.trim()
  const body = `${cur.author.trim()} · ${Number.isNaN(playNum) ? '0' : playNum.toLocaleString()} 播放`
  // bvid 缺失时不拼 URL：否则多条空 bvid 会规范化到同一 canonical URL 而互相误杀，
  // 留空串让 itemId 回退到内容哈希派生。
  const url = cur.bvid ? `https://www.bilibili.com/video/${cur.bvid}` : ''
  return {
    id: itemId(url, title, body),
    source: sourceId,
    title,
    body,
    url,
    publishedAt: 0,
    raw: cur,
  }
}

// ---------- bili（bili-cli 搜索，YAML 输出） ----------

export async function fetchBili(source: SourceConfig, spawnFn: SpawnFn = exaSpawn): Promise<RawItem[]> {
  const { stdout } = await spawnFn('bili', ['search', source.url, '--type', 'video', '-n', '8'])
  const items: RawItem[] = []
  // Line-based parser avoids ReDoS (the previous single mega-regex was vulnerable to
  // catastrophic backtracking on large/malformed bili-cli output).
  let cur: { bvid: string; title: string; author: string; play: string } | null = null
  for (const line of stdout.split('\n')) {
    const m = line.match(/^(\s*)- id: (\S+)/)
    if (m) {
      if (cur) items.push(finalize(cur, source.id))
      cur = { bvid: '', title: '', author: '', play: '' }
      continue
    }
    if (!cur) continue
    const kv = line.match(/^(\s+)(\w+):\s*(.*)$/)
    if (!kv) continue
    const key = kv[2]
    const val = kv[3]
    if (key === 'bvid') cur.bvid = val
    else if (key === 'title') cur.title = val
    else if (key === 'author') cur.author = val
    else if (key === 'play') cur.play = val
  }
  if (cur) items.push(finalize(cur, source.id))
  return items
}

// ---------- ytsearch（yt-dlp YouTube 搜索，零登录） ----------
// --flat-playlist 只解析搜索结果页，不做逐视频抽取：更快、更少触发 bot 校验。
// 字段按 flat 条目尽力取（不同 yt-dlp 版本字段有差异），拿不到就留空/为 0。

interface YtFlatEntry {
  id?: string
  title?: string
  url?: string
  webpage_url?: string
  channel?: string
  uploader?: string
  view_count?: number
  duration?: number
  upload_date?: string // YYYYMMDD，flat 条目可能缺
}

export async function fetchYtSearch(source: SourceConfig, spawnFn: SpawnFn = exaSpawn): Promise<RawItem[]> {
  const { stdout } = await spawnFn('yt-dlp', ['--dump-json', '--flat-playlist', `ytsearch5:${source.url}`])
  const items: RawItem[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let entry: YtFlatEntry
    try {
      entry = JSON.parse(trimmed) as YtFlatEntry
    } catch {
      continue
    }
    const title = entry.title?.trim() ?? ''
    const url = entry.webpage_url ?? entry.url ?? (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : '')
    if (!title || !url) continue
    const channel = entry.channel ?? entry.uploader ?? '未知频道'
    const views = typeof entry.view_count === 'number' ? entry.view_count.toLocaleString() : '0'
    // P2-1（agy-R1）：upload_date 只信 8 位字符串，防异常输出把 .slice 打穿
    const publishedAt = typeof entry.upload_date === 'string' && entry.upload_date.length === 8
      ? Date.parse(`${entry.upload_date.slice(0, 4)}-${entry.upload_date.slice(4, 6)}-${entry.upload_date.slice(6, 8)}`) || 0
      : 0
    const ytBody = `${channel} · ${views} 次观看`
    items.push({
      id: itemId(url, title, ytBody),
      source: source.id,
      title,
      body: ytBody,
      url,
      publishedAt,
      raw: entry,
    })
  }
  return items
}

// ---------- jina（r.jina.ai 网页阅读，盯无 RSS 的页面） ----------
// 注意：r.jina.ai 自 2025 起对匿名请求返回 401，需免费 key（DOMAIN_BOT_JINA_API_KEY）；
// 无 key/失败时按重试链走兜底：exa.web_fetch_exa（免 key，同一 mcporter 通道），
// 不再让整源优雅失败。

/** 解析 exa.web_fetch_exa 输出的 Markdown，提取首个标题行作为标题。 */
export function parseFetchedPage(markdown: string, sourceId: string, url: string): RawItem {
  const title = markdown.match(/^#{1,3} (.+)$/m)?.[1]?.trim() || url
  const body = markdown.replace(/^#{1,3} .+$/m, '').replace(/^URL:.*$/m, '').trim().slice(0, 2000)
  return {
    id: itemId(url, title, body),
    source: sourceId,
    title,
    body,
    url,
    publishedAt: 0,
    raw: undefined,
  }
}

export async function fetchJinaViaExa(source: SourceConfig, spawnFn: SpawnFn = exaSpawn): Promise<RawItem> {
  // P2-3（agy-R1）：独立导出的入口自守 SSRF，防未来被绕过 fetchJina 直接引用
  if (!isPublicHttpsUrl(source.url)) {
    throw new Error(`jina-via-exa ${source.id}: url 不是公开 HTTPS URL，已拒绝（SSRF 防护）`)
  }
  const { stdout } = await spawnFn('mcporter', [
    'call', 'exa.web_fetch_exa', '--args',
    JSON.stringify({ urls: [source.url] }),
  ])
  return parseFetchedPage(stdout, source.id, source.url)
}

export async function fetchJina(source: SourceConfig, fetchFn: FetchFn = defaultFetch, apiKey?: string, spawnFn: SpawnFn = exaSpawn): Promise<RawItem[]> {
  // SSRF 防护：source.url 必须是公开 HTTPS URL，否则拒绝，防止探测内网/元数据端点。
  // （兜底通道同样只允许公开 URL，因此检查必须先于任何抓取尝试。）
  if (!isPublicHttpsUrl(source.url)) {
    throw new Error(`jina ${source.id}: url 不是公开 HTTPS URL，已拒绝（SSRF 防护）`)
  }
  let lastErr: unknown
  try {
    const headers: Record<string, string> = { 'user-agent': 'domain-bot/0.1' }
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
    const res = await withSizeLimit(fetchFn, `https://r.jina.ai/${source.url}`, {
      signal: timeoutSignal(TIMEOUTS.jina),
      headers,
    })
    if (res.ok) {
      const text = await res.text()
      const title = text.match(/^Title: (.*)$/m)?.[1]?.trim() ?? source.url
      const body = text.replace(/^Title:.*$/m, '').replace(/^URL Source:.*$/m, '').trim().slice(0, 2000)
      return [
        {
          id: itemId(source.url, title, body),
          source: source.id,
          title,
          body,
          url: source.url,
          publishedAt: 0,
          raw: undefined,
        },
      ]
    }
    lastErr = new Error(`HTTP ${res.status}`)
  } catch (err) {
    lastErr = err
  }
  // 重试链第二跳：exa.web_fetch_exa（免 key）
  try {
    return [await fetchJinaViaExa(source, spawnFn)]
  } catch (fallbackErr) {
    throw lastErr instanceof Error
      ? new Error(`${lastErr.message}；exa 兜底也失败: ${fallbackErr instanceof Error ? fallbackErr.message : fallbackErr}`)
      : fallbackErr
  }
}
