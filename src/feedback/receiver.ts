import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultFetch } from '../collector/adapters/rss.js'
import { TIMEOUTS, timeoutSignal } from '../collector/adapters/fetchUtil.js'
import { telegramUrl } from '../push/telegram.js'
import { refreshWeights } from '../memory/weights.js'
import { recordExpandToDisk as interestRecordExpand } from '../memory/interest.js'
import { MemoryStore } from '../memory/store.js'
import { answerCallbackQuery, expandDigestMessage, parseCallbackData, parseExpandCallbackData, parseViewCallbackData } from '../push/telegram.js'
import type { FetchFn, SourceConfig } from '../types.js'

export interface TelegramCallbackMessage {
  message_id: number
  chat: { id: number }
}

export interface TelegramCallbackQuery {
  id: string
  data?: string
  /** 展开编辑（ex:）需要定位被点的钩子卡消息；Telegram raw update 天然携带 */
  message?: TelegramCallbackMessage
}

export interface TelegramUpdate {
  update_id: number
  callback_query?: TelegramCallbackQuery
}

export interface ReceiverDeps {
  token: string
  /** 接收端只持有目录，不持有 store——每次回调从盘重建，否则长驻快照看不见 runOnce 后续写入的 ref（V1 事故） */
  memoryDir: string
  sources: SourceConfig[]
  fetchFn?: FetchFn
  now?: () => number
}

export type ProcessResult = 'recorded' | 'ignored'

/** 应答回调只是 UX 动作（消除客户端按钮 loading），数据在此之前已落盘，因此应答失败
 *  不构成该条 update 的处理失败：真机联调实测，采集窗口内事件循环被解析阻塞时 answer
 *  会超过 Telegram 应答时效（HTTP 400 query too old），旧语义把它当整条失败重试 3 次
 *  并留痕「反馈丢失」——数据其实已入账，误报会污染值班判断。 */
async function answerQuietly(token: string, callbackQueryId: string, fetchFn?: FetchFn): Promise<void> {
  try {
    await answerCallbackQuery(token, callbackQueryId, fetchFn)
  } catch (err) {
    console.warn(`[feedback] 回调应答失败（数据已入账，不影响判定数据；通常是处理延迟超过 Telegram 应答时效）: ${err instanceof Error ? err.message : err}`)
  }
}

/** 处理一条 Telegram update：解析回调 → 解析 ref → 落盘反馈 → 刷新权重 → 回应 callbackQuery。 */
export async function processTelegramUpdate(update: TelegramUpdate, deps: ReceiverDeps): Promise<ProcessResult> {
  const cq = update.callback_query
  if (!cq?.data) return 'ignored'
  // L1→L2 展开回调（行为即信号）：展开 = 已读（recordView）+ 原地编辑为消费层。找不到内容档（过期/假
  // digest）走 ignored。deps.token 是推送同一个 bot token，editMessageText 用回调自带的 chat/message 定位。
  const expand = parseExpandCallbackData(cq.data)
  if (expand) {
    if (!cq.message) return 'ignored'
    const store = new MemoryStore(deps.memoryDir)
    const cluster = store.loadDigest(expand.digestId)?.clusters[expand.index]
    if (!cluster) return 'ignored'
    await expandDigestMessage(
      { token: deps.token, chatId: cq.message.chat.id, messageId: cq.message.message_id, fetchFn: deps.fetchFn },
      cluster,
    )
    store.recordView(expand.digestId, (deps.now ?? Date.now)())
    // 条目级行为信号（供「多次推送不展开 → 默认不感兴趣」的源级推断）
    store.recordEngagement({ digestId: expand.digestId, index: expand.index, source: cluster.source, at: (deps.now ?? Date.now)() })
    // 行为→兴趣映射（Beta 后验）：展开 = 强证据
    interestRecordExpand(deps.memoryDir, cluster.source)
    await answerQuietly(deps.token, cq.id, deps.fetchFn)
    return 'recorded'
  }
  // 👀 已读回执：不记反馈、不动权重，只记 viewed（保留兼容旧按钮消息；新形态由展开承担 viewed）
  const viewed = parseViewCallbackData(cq.data)
  if (viewed) {
    const store = new MemoryStore(deps.memoryDir)
    store.recordView(viewed.digestId, (deps.now ?? Date.now)())
    await answerQuietly(deps.token, cq.id, deps.fetchFn)
    return 'recorded'
  }
  const parsed = parseCallbackData(cq.data)
  if (!parsed) return 'ignored'
  const store = new MemoryStore(deps.memoryDir)
  const resolved = store.resolveRef(parsed.ref)
  if (!resolved) return 'ignored'

  store.recordFeedback({
    itemId: resolved.itemId,
    digestId: resolved.digestId,
    source: resolved.source,
    signal: parsed.signal,
    at: (deps.now ?? Date.now)(),
  })
  refreshWeights(store, deps.sources)
  await answerQuietly(deps.token, cq.id, deps.fetchFn)
  return 'recorded'
}

/** 拉取增量 update。offset 语义：Telegram 只返回 update_id >= offset 的记录。 */
export async function fetchUpdates(
  token: string,
  offset: number,
  fetchFn: FetchFn = defaultFetch,
): Promise<TelegramUpdate[]> {
  const res = await fetchFn(telegramUrl(token, 'getUpdates'), {
    signal: timeoutSignal(TIMEOUTS.receiver),
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offset, timeout: 30, allowed_updates: ['callback_query'] }),
  })
  if (!res.ok) throw new Error(`telegram getUpdates: HTTP ${res.status}`)
  const data = JSON.parse(await res.text()) as { result?: TelegramUpdate[] }
  return data.result ?? []
}

const offsetPath = (memoryDir: string) => join(memoryDir, 'feedback-offset.json')

/** 重启续拉位点（C′10）：offset 不持久化则每次重启从 0 重拉，Telegram 重放 24h 内回调 → 反馈重复入账（§3.5①）。 */
export function loadOffset(memoryDir: string): number {
  const path = offsetPath(memoryDir)
  // 终审 P1-1（agy 线）：坏文件不得静默归零（会重放 24h 回调）——改名 .corrupt-* 留存，对齐 store.ts 的 D6 做法。
  if (!existsSync(path)) return 0
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { offset?: number }
    return typeof raw.offset === 'number' && Number.isFinite(raw.offset) ? Math.max(0, raw.offset) : 0
  } catch {
    const bad = `${path}.corrupt-${Date.now()}`
    try {
      renameSync(path, bad)
    } catch {
      /* 改名失败则保留原文件，下次启动再试 */
    }
    console.error(`[feedback] feedback-offset.json 解析失败，坏文件移至 ${bad}（offset 归 0，不静默清零）`)
    return 0
  }
}

// 终审 P1-1（agy 线）：高频直写（每处理一条 update 一次）在崩溃窗口会产出截断文件——tmp+rename 原子替换。
export function saveOffset(memoryDir: string, offset: number): void {
  mkdirSync(memoryDir, { recursive: true })
  const finalPath = offsetPath(memoryDir)
  const tmp = `${finalPath}.tmp`
  writeFileSync(tmp, JSON.stringify({ offset }, null, 2))
  renameSync(tmp, finalPath)
}

/** D2（小巴 impl 审查）：逐条确认。offset 在该条处理完（成功；或 3 次失败留痕后跳过）才推进——此前「处理前推进」会让
 *  Telegram 把处理失败的 update 服务端确认删除，该条反馈永久丢失且去重兜底覆盖不到。失败重试 3 次（退避 1x/2x/3x）
 *  仍失败则跳过并留痕：坏 update 不得卡死整条队列，跳过即该条反馈丢失（日志留痕，宁丢一条不丢一队）。 */
export async function applyUpdates(
  deps: ReceiverDeps,
  updates: TelegramUpdate[],
  opts: { onError?: (err: unknown) => void; retryDelayMs?: number } = {},
): Promise<void> {
  const delay = opts.retryDelayMs ?? 1000
  let offset = loadOffset(deps.memoryDir)
  for (const u of updates) {
    let done = false
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        await processTelegramUpdate(u, deps)
        done = true
      } catch (err) {
        opts.onError?.(err)
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * delay))
      }
    }
    if (!done) console.error(`[feedback] update ${u.update_id} 连续 3 次处理失败，跳过（该条反馈丢失，已留痕）`)
    offset = Math.max(offset, u.update_id + 1)
    saveOffset(deps.memoryDir, offset)
  }
}

/** 常驻长轮询：单实例，收到回调即落盘。出错退避 5s 后继续，不退出。 */
export async function pollFeedback(
  deps: ReceiverDeps,
  opts: { onError?: (err: unknown) => void; retryDelayMs?: number } = {},
): Promise<never> {
  for (;;) {
    try {
      const updates = await fetchUpdates(deps.token, loadOffset(deps.memoryDir), deps.fetchFn)
      if (updates.length > 0) await applyUpdates(deps, updates, opts)
    } catch (err) {
      opts.onError?.(err)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}
