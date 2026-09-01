import type { Digest, FetchFn } from '../types.js'
import { defaultFetch } from '../collector/adapters/rss.js'

export interface TelegramOptions {
  token: string
  chatId: string
  fetchFn?: FetchFn
}

function renderDigestText(digest: Digest): string {
  const head = `📡 *${digest.domain}* 情报（${digest.clusters.length} 条趋势）\n\n`
  const body = digest.clusters
    .map((c, i) => {
      const src = c.items[0]
      return `*${i + 1}. ${c.title.slice(0, 120)}*\n${c.summary.slice(0, 300)}\n[src](${src.url}) · ${c.why}`
    })
    .join('\n\n')
  const text = head + body
  return text.length > 3900 ? text.slice(0, 3900) + '\n…（已截断）' : text
}

function inlineKeyboard(digest: Digest) {
  return {
    inline_keyboard: digest.clusters.map((c) => [
      { text: '👍 有价值', callback_data: `fb:u:${c.ref}` },
      { text: '👎 噪音', callback_data: `fb:d:${c.ref}` },
    ]),
  }
}

export function parseCallbackData(data: string): { signal: 'up' | 'down'; ref: string } | undefined {
  const m = data.match(/^fb:(u|d):(.+)$/)
  if (!m) return undefined
  return { signal: m[1] === 'u' ? 'up' : 'down', ref: m[2] }
}

export async function sendDigestTelegram(digest: Digest, opts: TelegramOptions): Promise<void> {
  const fetchFn = opts.fetchFn ?? defaultFetch
  const url = `https://api.telegram.org/bot${opts.token}/sendMessage`
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
  const res = await fetchFn(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  })
  if (!res.ok) throw new Error(`telegram answerCallbackQuery: HTTP ${res.status}`)
}
