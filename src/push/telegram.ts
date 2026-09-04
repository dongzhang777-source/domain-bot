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

/** 相对时间（元信息行用）。publishedAt 缺失/为 0 时返回空串，调用方负责折叠分隔符。 */
export function timeAgo(publishedAt: number, now: number): string {
  if (!publishedAt || publishedAt > now) return ''
  const mins = Math.floor((now - publishedAt) / 60_000)
  if (mins < 60) return `${Math.max(1, mins)} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/** L1 钩子卡（tuna 三级瀑布流一级·钩子层）：第一行钩子（标题精简），第二行元信息（来源 · 新鲜度）。
 *  唯一出口是「展开 ▼」——浏览行为即信号，不以显式按钮打扰（2026-09-04 老张决断，workplan Phase C′）。 */
export function renderHookCard(digest: Digest, index: number, now: number): string {
  const c = digest.clusters[index]!
  const src = c.items[0]!
  const tag = src.isNew ? '🆕 ' : ''
  const meta = [src.source, timeAgo(src.publishedAt, now)].filter(Boolean).join(' · ')
  return `*${tag}${escMd(c.title.slice(0, 90))}*\n_${escMd(meta)}_`
}

/** L2 消费层（点「展开 ▼」后经 expandDigestMessage 原地编辑）：标题 + 一屏摘要 + 为什么推给你。 */
export function renderExpandedBody(digest: Digest, index: number): string {
  const c = digest.clusters[index]!
  const why = c.why && c.why !== c.title ? `\n\n💡 ${escMd(c.why.slice(0, 200))}` : ''
  return `*${c.items[0]!.isNew ? '🆕 ' : ''}${escMd(c.title.slice(0, 120))}*\n\n${escMd(c.summary.slice(0, 300))}${why}`
}

function hookKeyboard(digestId: string, index: number) {
  return {
    inline_keyboard: [
      [{ text: '展开 ▼', callback_data: `ex:${digestId}:${index}` }],
    ],
  }
}

function expandedKeyboard(ref: string, url: string) {
  return {
    inline_keyboard: [
      [{ text: '阅读原文 ↗', url }],
      [{ text: '不感兴趣 ✕', callback_data: `fb:d:${ref}` }],
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

/** L1→L2 展开回调：`ex:<digestId>:<index>`。展开即已读（recordView 由 receiver 落账）。 */
export function parseExpandCallbackData(data: string): { digestId: string; index: number } | undefined {
  const m = data.match(/^ex:([a-z0-9]+):(\d+)$/)
  if (!m) return undefined
  return { digestId: m[1]!, index: Number(m[2]) }
}

/** 每个条目独立一条消息，👍/👎/👀 按钮紧跟自己的条目。回调协议（fb:u:ref / vb:id）不变。
 *  任一条失败即抛——调用方整轮记 failed、实发分母记 0（I-2 口径：通道事故不得假判负，宁保守少计）；
 *  全部成功返回送达条数（= clusters.length）。 */
export async function sendDigestTelegram(digest: Digest, opts: TelegramOptions, now = Date.now()): Promise<number> {
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
        text: renderHookCard(digest, i, now),
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: hookKeyboard(digest.id, i),
      }),
    })
    if (!res.ok) throw new Error(`telegram sendMessage: HTTP ${res.status}`)
    delivered++
  }
  return delivered
}

/** L2 原地展开（editMessageText）：钩子卡被编辑为消费层内容 + 出口按钮（阅读原文 / 不感兴趣）。
 *  cluster 内容来自 memory 的 digests.json（saveDigest 落档）；找不到（过期/假 digest）由调用方走 ignored。
 *  chatId 用回调自带的数字对话 id（非 TelegramOptions 的字符串 chatId）——收到的点击天然携带，不必回读 .env。 */
export async function expandDigestMessage(
  opts: { token: string; fetchFn?: FetchFn; chatId: number; messageId: number },
  cluster: { ref: string; title: string; summary: string; why: string; url?: string; isNew?: boolean },
): Promise<void> {
  const fetchFn = opts.fetchFn ?? defaultFetch
  const why = cluster.why && cluster.why !== cluster.title ? `\n\n💡 ${escMd(cluster.why.slice(0, 200))}` : ''
  const text = `*${cluster.isNew ? '🆕 ' : ''}${escMd(cluster.title.slice(0, 120))}*\n\n${escMd(cluster.summary.slice(0, 300))}${why}`
  const res = await fetchFn(telegramUrl(opts.token, 'editMessageText'), {
    signal: timeoutSignal(TIMEOUTS.telegram),
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: opts.chatId,
      message_id: opts.messageId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: expandedKeyboard(cluster.ref, cluster.url ?? ''),
    }),
  })
  if (!res.ok) throw new Error(`telegram editMessageText: HTTP ${res.status}`)
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
