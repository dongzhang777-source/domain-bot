import { itemId } from '../dedupe.js'
import type { RawItem, SourceConfig, SpawnFn } from '../../types.js'

/**
 * Twitter/X 采集适配器（扩源 T3，2026-09-06 老张授权注册小号 dongzhang585 后接线）。
 *
 * 走本机 `twitter` CLI（agent-reach 工具栈），认证经 env `TWITTER_AUTH_TOKEN`/`TWITTER_CT0`
 * （cookies 由 Safari 登录态抓取，钥匙串备份 apikey:twitter-auth-token/ct0；launchd 经
 * --env-file-if-exists=.env 注入产线）。
 *
 * 只读纪律：只调 feed（首页时间线），不 post/follow/like——follow 名单是策展决策
 * （画像提案→老张审定），自动批量操作有封号风险。feed 的价值：follow 名单即
 * 「策展白名单的 Twitter 版」，与整改方案的准入哲学一致。
 *
 * 已知限制：search 端点对新号返回 404（2026-09-06 实测），feed 正常——feed 为主路径。
 */

export const twitterSpawn: SpawnFn = (cmd, args) =>
  import('node:child_process').then(({ execFile }) =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 90_000, maxBuffer: 16 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stderr }))
        else resolve({ stdout, stderr })
      })
    }),
  )

interface TwitterTweet {
  id: string
  text: string
  author?: { id?: string; name?: string; screenName?: string }
  createdAtISO?: string
  createdAt?: string
}

/** twitter CLI JSON → RawItem。url 用作者 handle；无 handle 时用 id 兜底（x.com/i/web/status/<id>）。 */
export function parseTwitterFeed(json: string, sourceId: string): RawItem[] {
  let parsed: { ok?: boolean; data?: TwitterTweet[] }
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!parsed.ok || !Array.isArray(parsed.data)) return []
  return parsed.data
    .filter((t) => t.id && t.text)
    .map((t) => {
      const handle = t.author?.screenName
      const url = handle ? `https://x.com/${handle}/status/${t.id}` : `https://x.com/i/web/status/${t.id}`
      const text = t.text.replace(/https:\/\/t\.co\/\w+/g, '').trim()
      return {
        id: itemId(url, text, ''),
        source: sourceId,
        title: text.split(/\n/)[0].slice(0, 120),
        body: text.slice(0, 1000),
        url,
        publishedAt: (t.createdAtISO && Date.parse(t.createdAtISO)) || (t.createdAt && Date.parse(t.createdAt)) || 0,
        raw: t,
      }
    })
}

/** 拉取首页时间线。source.url 保留扩展位（未来支持 list/<id> 等）；numResults 默认 30。 */
export async function fetchTwitter(source: SourceConfig, spawnFn: SpawnFn = twitterSpawn): Promise<RawItem[]> {
  if (!process.env.TWITTER_AUTH_TOKEN || !process.env.TWITTER_CT0) {
    // key 通道纪律（2026-09-06 老张「各工具都走有 key 通道」）：cookies 缺失不静默降级到无凭据模式，
    // 跳过该源并告警——Twitter 本就要求登录态，无凭据请求必然失败。
    throw new Error('TWITTER_AUTH_TOKEN/TWITTER_CT0 未设置：跳过 twitter 源（cookies 在 domain-bot .env）')
  }
  const count = Math.min(source.numResults ?? 30, 50)
  const { stdout } = await spawnFn('twitter', ['feed', '--json', '-n', String(count)])
  return parseTwitterFeed(stdout, source.id)
}
