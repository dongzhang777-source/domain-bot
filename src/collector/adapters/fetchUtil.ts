import type { FetchFn } from '../../types.js'

/** 统一响应体大小上限（2 MiB）：防御巨响应 DoS，裁剪前就中止。
 * 256 KiB 曾误伤 arXiv cs.AI 这类合法大 feed（单文件 1~2 MB），放宽后仍有界。 */
export const MAX_BODY_BYTES = 2 * 1024 * 1024

/** 统一网络出口默认超时常量（ms） */
export const TIMEOUTS = {
  collector: 25_000,
  jina: 30_000,
  scorer: 120_000,
  telegram: 20_000,
  receiver: 70_000,
} as const

/** 创建指定超时的 AbortSignal */
export function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms)
}

/** 流式读取器类型（兼容 FetchFn 抽象与原生 fetch）。 */
interface SizedReader {
  read: () => Promise<{ done: boolean; value: Uint8Array }>
  releaseLock?: () => void
}

/** 包装 fetchFn，用 AbortController 计数字节并在超过上限时中止，避免把整响应读入内存。
 * 若底层返回无 body 流（如测试 mock），则在 text() 包装层做长度校验，确保上限仍生效。
 * 同时与传入的外部 signal（如超时）安全合并，防止覆盖。 */
export async function withSizeLimit(
  fetchFn: FetchFn,
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status?: number; text: () => Promise<string> }> {
  const controller = new AbortController()
  const signal = init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal
  const res = await fetchFn(url, { ...init, signal })
  const reader = (res as { body?: { getReader?: () => SizedReader } }).body?.getReader?.()
  if (!reader) {
    const origText = res.text.bind(res)
    return {
      ok: res.ok,
      status: res.status,
      text: async () => {
        const t = await origText()
        if (Buffer.byteLength(t, 'utf8') > MAX_BODY_BYTES) {
          throw new Error(`响应体超过 ${MAX_BODY_BYTES} 字节，已中止（sizeLimit）`)
        }
        return t
      },
    }
  }
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        controller.abort()
        throw new Error(`响应体超过 ${MAX_BODY_BYTES} 字节，已中止（sizeLimit）`)
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock?.()
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return { ok: res.ok, status: res.status, text: async () => text }
}

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = nums as [number, number, number, number]
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function isLoopbackOrPrivateHost(host: string): boolean {
  const lower = host.toLowerCase()
  if (lower === 'localhost' || lower === 'localhost.' || lower === 'ip6-localhost' || lower === 'ip6-loopback') return true
  if (lower === '::1' || lower === '[::1]') return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && isPrivateIPv4(host)) return true
  if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('127.')) return true
  return false
}

/** 校验 URL 为公开 HTTPS（防 SSRF）。Reject localhost/私网 IP/非 https/纯 IP 元数据。 */
const PRIVATE_HOSTS = new Set(['localhost', 'localhost.', 'ip6-localhost', 'ip6-loopback'])
export function isPublicHttpsUrl(input: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname
  if (!host || PRIVATE_HOSTS.has(host.toLowerCase())) return false
  if (isLoopbackOrPrivateHost(host)) return false
  // 显式拒绝云元数据/内网关键地址（纵深防御，即使上面已拦）
  if (host === '169.254.169.254' || host === 'metadata.google.internal') return false
  // 拒绝 URL 中包含 @ 的 userinfo（可绕过 host 解析）
  if (parsed.username || parsed.password) return false
  return true
}

/**
 * 内容链接安全校验（P1，2026-09-07 审查）。
 *
 * 与 isPublicHttpsUrl 的区别：这里只防客户端 scheme 注入（`javascript:` 经包
 * 直达 tuna「↗原文」），不做 SSRF 判定——链接文本永不直接被服务端抓取。
 * http 允许（部分源如 V2EX API 返回 http 链接），空串允许（itemId 回退内容哈希派生）。
 */
export function isSafeLinkUrl(input: string): boolean {
  if (input === '') return true
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return false
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:'
}
