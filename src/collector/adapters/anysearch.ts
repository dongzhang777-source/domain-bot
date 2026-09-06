import { itemId } from '../dedupe.js'
import type { RawItem, SourceConfig } from '../../types.js'
import { isPublicHttpsUrl, TIMEOUTS, timeoutSignal } from './fetchUtil.js'

/**
 * anysearch 采集适配器（扩源 T1，2026-09-06 老张拍板「已给 key，各工具都走有 key 通道」）。
 *
 * anysearch 是 HTTP 直连的 MCP server（https://api.anysearch.com/mcp），bot 零本地依赖直接
 * POST JSON-RPC：tools/call → search。key 强制（`ANYSEARCH_API_KEY` env；钥匙串
 * apikey:anysearch）：服务端对无效 Authorization 直接拒绝不回退匿名——正好符合「有 key 通道」
 * 纪律，缺 key 时跳过该源并告警，不静默降级。
 *
 * 主动搜索的定位（整改方案 Phase 1.5）：增量三问之首「他大概率还不知道吗」只有主动搜索
 * 能答——挖还没刷屏但该被知道的内容。source.url 字段 = 查询词（与 exa 同构），查询词应随
 * 读者画像迭代（画像卡 Phase 2 落地后由画像生成）。
 *
 * 响应形态（2026-09-06 实测）：JSON-RPC result.content[0].text 为 Markdown：
 * `## Search Results (N results, ...)` 下接 `### 1. Title` + `- **URL**: ...` + 描述行。
 */

export const ANYSEARCH_MCP_URL = 'https://api.anysearch.com/mcp'

export interface AnysearchFetch {
  (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }): Promise<{
    ok: boolean
    status: number
    text: () => Promise<string>
  }>
}

/** 解析 anysearch search 的 Markdown 结果块 → RawItem。无发布时间（搜索结果不带）→ publishedAt=0。 */
export function parseAnysearchOutput(output: string, sourceId: string): RawItem[] {
  const blocks = output.split(/^### \d+\. /m).slice(1)
  const out: RawItem[] = []
  for (const block of blocks) {
      const title = (block.match(/^(.*)/) ?? [''])[1]?.trim() ?? ''
      const url = block.match(/\*\*URL\*\*: (\S*)/)?.[1] ?? ''
      const body = block
        .replace(/^- \*\*URL\*\*: .*\n?/gm, '')
        .replace(/\n{2,}/g, '\n')
        .trim()
        .slice(0, 1200)
      if (!title || !isPublicHttpsUrl(url)) continue
      out.push({
        id: itemId(url, title, body),
        source: sourceId,
        title,
        body,
        url,
        publishedAt: 0,
        raw: block,
      })
    }
    return out
}

/** 从 MCP JSON-RPC 响应提取 search 的 Markdown 文本。 */
export function extractMarkdown(rpcText: string): string {
  let parsed: {
    result?: { content?: Array<{ type?: string; text?: string }> }
    error?: { message?: string }
  }
  try {
    parsed = JSON.parse(rpcText)
  } catch {
    return ''
  }
  if (parsed.error) throw new Error(`anysearch MCP error: ${parsed.error.message ?? 'unknown'}`)
  const first = parsed.result?.content?.find((c) => c.type === 'text')
  return first?.text ?? ''
}

/** 单查询搜索。缺 key 直接抛错（调用方按源粒度降级，不中断整轮）。 */
export async function fetchAnysearch(
  source: SourceConfig,
  fetchFn?: AnysearchFetch,
): Promise<RawItem[]> {
  const key = process.env.ANYSEARCH_API_KEY
  if (!key) {
    throw new Error('ANYSEARCH_API_KEY 未设置：跳过 anysearch 源（key 在 macOS 钥匙串 apikey:anysearch，老张 09-06 已录入）')
  }
  const maxResults = Math.min(source.numResults ?? 10, 10)
  const doFetch: AnysearchFetch =
    fetchFn ??
    (async (url, init) => {
      const res = await fetch(url, { ...init, signal: timeoutSignal(TIMEOUTS.collector) })
      return { ok: res.ok, status: res.status, text: () => res.text() }
    })
  const res = await doFetch(ANYSEARCH_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: source.url, max_results: maxResults } },
    }),
    signal: timeoutSignal(TIMEOUTS.collector),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`anysearch HTTP ${res.status}: ${text.slice(0, 200)}`)
  const markdown = extractMarkdown(text)
  const items = parseAnysearchOutput(markdown, source.id)
  if (items.length === 0 && !markdown.includes('Search Results')) {
    throw new Error(`anysearch 响应无可解析结果: ${markdown.slice(0, 120)}`)
  }
  return items
}
