import type { Digest, FetchFn } from '../types.js'
import { defaultFetch } from '../collector/adapters/rss.js'
import { TIMEOUTS, timeoutSignal } from '../collector/adapters/fetchUtil.js'

/** 构建 Telegram API URL。token 仅出现在 URL 路径中（Telegram 要求），但禁止被任何日志/错误路径捕获到。 */
export function telegramUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`
}

export interface TelegramOptions {
  token: string
  chatId: string
  fetchFn?: FetchFn
}

// Telegram legacy「Markdown」官方转义规则（Bot API §Formatting options，2026-09-02 抓原文核对）：
//   "To escape characters '_', '*', '`', '[' outside of an entity, prepend the character '\'
//    before them." / "Escaping inside entities is not allowed, so entity must be closed first
//    and reopened again."
// 即：可转义集仅 4 字符 _ * ` [（']' 无前置 '[' 不构成实体边界，'\' 不可转义故直接剔除——
// arXiv 标题的反斜杠几乎都来自 LaTeX 命令）；转义只允许发生在实体外部，因此粗体只包代码
// 常量（序号/标签），用户文本一律在实体外（小巴 impl 审查 D1：此前「转义文本放进 *…* 内部」
// 违反实体内禁转义规则，且尾部 \ 会吞掉闭合星号）。
function escMd(s: string): string {
  return s.replace(/\\/g, '').replace(/([_*[`])/g, '\\$1')
}

/** 链接 URL 里的 `)` 会提前闭合 Markdown 链接，用百分号编码消解；`\` 同理。 */
function escUrl(u: string): string {
  return u.replace(/\\/g, '%5C').replace(/\)/g, '%29')
}

export function renderDigestText(digest: Digest): string {
  const head = `📡 *情报* · ${escMd(digest.domain)}（${digest.clusters.length} 条趋势）\n\n`
  // D1：why 限长 200 后单簇必然短于预算，装填只在簇边界截断——截断永不落进实体/转义对内部。
  const blocks = digest.clusters.map((c, i) => {
    const src = c.items[0]!
    const tag = src.isNew ? '🆕' : '♻️'
    return `*${i + 1}. ${tag}* ${escMd(c.title.slice(0, 120))}\n${escMd(c.summary.slice(0, 300))}\n[src](${escUrl(src.url)}) · ${escMd(c.why.slice(0, 200))}`
  })
  let text = head
  for (const b of blocks) {
    const candidate = text.length === head.length ? head + b : `${text}\n\n${b}`
    if (candidate.length > 3880) {
      text += '\n…（已截断）'
      break
    }
    text = candidate
  }
  return text
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
    signal: timeoutSignal(TIMEOUTS.telegram),
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
    signal: timeoutSignal(TIMEOUTS.telegram),
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  })
  if (!res.ok) throw new Error(`telegram answerCallbackQuery: HTTP ${res.status}`)
}
