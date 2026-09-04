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

/** 单条目消息文本：首条带 digest 头。单簇必短于 4096（title 120 / summary 300 / why 200 限长），
 *  原「多簇装填 + 3880 截断」随每条目独立成消息废除——09-04 真机联调发现：单消息挂全部按钮时
 *  按钮组堆在消息尾部且无条目标识，用户无法分辨哪组按钮对应哪条条目。 */
export function renderItemMessage(digest: Digest, index: number): string {
  const c = digest.clusters[index]!
  const src = c.items[0]!
  const tag = src.isNew ? '🆕' : '♻️'
  const head = index === 0 ? `📡 *情报* · ${escMd(digest.domain)}（${digest.clusters.length} 条趋势）\n\n` : ''
  return `${head}*${index + 1}. ${tag}* ${escMd(c.title.slice(0, 120))}\n${escMd(c.summary.slice(0, 300))}\n[src](${escUrl(src.url)}) · ${escMd(c.why.slice(0, 200))}`
}

function itemKeyboard(ref: string, digestId: string) {
  return {
    inline_keyboard: [
      [
        { text: '👍 有价值', callback_data: `fb:u:${ref}` },
        { text: '👎 噪音', callback_data: `fb:d:${ref}` },
      ],
      // agy 三审：已读回执走 Telegram callback，跨端可用（原 127.0.0.1 方案手机端必失效）
      [{ text: '👀 已读', callback_data: `vb:${digestId}` }],
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

/** 每个条目独立一条消息，👍/👎/👀 按钮紧跟自己的条目。回调协议（fb:u:ref / vb:id）不变。
 *  任一条失败即抛——调用方整轮记 failed、实发分母记 0（I-2 口径：通道事故不得假判负，宁保守少计）；
 *  全部成功返回送达条数（= clusters.length）。 */
export async function sendDigestTelegram(digest: Digest, opts: TelegramOptions): Promise<number> {
  const fetchFn = opts.fetchFn ?? defaultFetch
  const url = telegramUrl(opts.token, 'sendMessage')
  let delivered = 0
  for (let i = 0; i < digest.clusters.length; i++) {
    const res = await fetchFn(url, {
      signal: timeoutSignal(TIMEOUTS.telegram),
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: opts.chatId,
        text: renderItemMessage(digest, i),
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: itemKeyboard(digest.clusters[i]!.ref, digest.id),
      }),
    })
    if (!res.ok) throw new Error(`telegram sendMessage: HTTP ${res.status}`)
    delivered++
  }
  return delivered
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
