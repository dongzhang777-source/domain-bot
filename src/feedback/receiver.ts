import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultFetch } from '../collector/adapters/rss.js'
import { telegramUrl } from '../push/telegram.js'
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
  const res = await fetchFn(telegramUrl(token, 'getUpdates'), {
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
