import type { Digest, FetchFn } from '../types.js'
import { defaultFetch } from '../collector/adapters/rss.js'

/** 构建 Telegram API URL。token 仅出现在 URL 路径中（Telegram 要求），但禁止被任何日志/错误路径捕获到。 */
export function telegramUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`
}

export interface TelegramOptions {
  token: string
  chatId: string
  fetchFn?: FetchFn
}

// Telegram legacy Markdown 保留字。用户文本原样插值会让 sendMessage 返回 400（Can't parse entities），
// 而 index.ts 的推送 catch 只打日志不回滚——归档/观测/outbox 全记「已推送」，用户一条没收到（诊断报告 §3.4）。
function escMd(s: string): string {
  return s.replace(/[_*[\]`\\]/g, '\\$&')
}

/** 链接 URL 里的 `)` 会提前闭合 Markdown 链接，用百分号编码消解；`\` 同理。 */
function escUrl(u: string): string {
  return u.replace(/\\/g, '%5C').replace(/\)/g, '%29')
}

export function renderDigestText(digest: Digest): string {
  const head = `📡 *${escMd(digest.domain)}* 情报（${digest.clusters.length} 条趋势）\n\n`
  const body = digest.clusters
    .map((c, i) => {
      const src = c.items[0]!
      const tag = src.isNew ? '🆕' : '♻️'
      return `*${i + 1}. ${tag} ${escMd(c.title.slice(0, 120))}*\n${escMd(c.summary.slice(0, 300))}\n[src](${escUrl(src.url)}) · ${escMd(c.why)}`
    })
    .join('\n\n')
  const text = head + body
  return text.length > 3900 ? text.slice(0, 3900) + '\n…（已截断）' : text
}

function inlineKeyboard(digest: Digest) {
  return {
    inline_keyboard: [
      ...digest.clusters.map((c) => [
        { text: '👍 有价值', callback_data: `fb:u:${c.ref}` },
        { text: '👎 噪音', callback_data: `fb:d:${c.ref}` },
      ]),
      // agy 三审：已读回执走 Telegram callback，跨端可用（原 127.0.0.1 方案手机端必失效）
      [{ text: '👀 已读', callback_data: `vb:${digest.id}` }],
    ],
  }
}

export function parseCallbackData(data: string): { signal: 'up' | 'down'; ref: string } | undefined {
  const m = data.match(/^fb:(u|d):([a-z0-9]+:\d+)$/)
  if (!m) return undefined
  return { signal: m[1] === 'u' ? 'up' : 'down', ref: m[2]! }
}

/** 👀 已读回执回调：`vb:<digestId>`。 */
export function parseViewCallbackData(data: string): { digestId: string } | undefined {
  const m = data.match(/^vb:([a-z0-9]+)$/)
  if (!m) return undefined
  return { digestId: m[1]! }
}

export async function sendDigestTelegram(digest: Digest, opts: TelegramOptions): Promise<void> {
  const fetchFn = opts.fetchFn ?? defaultFetch
  const url = telegramUrl(opts.token, 'sendMessage')
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: opts.chatId,
      text: renderDigestText(digest),
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: inlineKeyboard(digest),
    }),
  })
  if (!res.ok) throw new Error(`telegram sendMessage: HTTP ${res.status}`)
}

export async function answerCallbackQuery(token: string, callbackQueryId: string, fetchFn: FetchFn = defaultFetch): Promise<void> {
  const res = await fetchFn(telegramUrl(token, 'answerCallbackQuery'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  })
  if (!res.ok) throw new Error(`telegram answerCallbackQuery: HTTP ${res.status}`)
}
