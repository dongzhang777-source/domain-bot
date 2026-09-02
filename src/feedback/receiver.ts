import { defaultFetch } from '../collector/adapters/rss.js'
import { refreshWeights } from '../memory/weights.js'
import { MemoryStore } from '../memory/store.js'
import { answerCallbackQuery, parseCallbackData, parseViewCallbackData } from '../push/telegram.js'
import type { FetchFn, SourceConfig } from '../types.js'

export interface TelegramCallbackQuery {
  id: string
  data?: string
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

/** 处理一条 Telegram update：解析回调 → 解析 ref → 落盘反馈 → 刷新权重 → 回应 callbackQuery。 */
export async function processTelegramUpdate(update: TelegramUpdate, deps: ReceiverDeps): Promise<ProcessResult> {
  const cq = update.callback_query
  if (!cq?.data) return 'ignored'
  // 👀 已读回执：不记反馈、不动权重，只记 viewed（判定线 G-1/P-1 的 viewed 唯一来源）
  const viewed = parseViewCallbackData(cq.data)
  if (viewed) {
    const store = new MemoryStore(deps.memoryDir)
    store.recordView(viewed.digestId, (deps.now ?? Date.now)())
    await answerCallbackQuery(deps.token, cq.id, deps.fetchFn)
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
  await answerCallbackQuery(deps.token, cq.id, deps.fetchFn)
  return 'recorded'
}

/** 拉取增量 update。offset 语义：Telegram 只返回 update_id >= offset 的记录。 */
export async function fetchUpdates(
  token: string,
  offset: number,
  fetchFn: FetchFn = defaultFetch,
): Promise<TelegramUpdate[]> {
  const res = await fetchFn(`https://api.telegram.org/bot${token}/getUpdates`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offset, timeout: 30, allowed_updates: ['callback_query'] }),
  })
  if (!res.ok) throw new Error(`telegram getUpdates: HTTP ${res.status}`)
  const data = JSON.parse(await res.text()) as { result?: TelegramUpdate[] }
  return data.result ?? []
}

/** 常驻长轮询：单实例，收到回调即落盘。出错退避 5s 后继续，不退出。 */
export async function pollFeedback(
  deps: ReceiverDeps,
  opts: { onError?: (err: unknown) => void } = {},
): Promise<never> {
  let offset = 0
  for (;;) {
    try {
      for (const u of await fetchUpdates(deps.token, offset, deps.fetchFn)) {
        offset = Math.max(offset, u.update_id + 1)
        await processTelegramUpdate(u, deps)
      }
    } catch (err) {
      opts.onError?.(err)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}
