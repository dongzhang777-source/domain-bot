import type { FetchFn } from '../../types.js'

/** 统一响应体大小上限（2 MiB）：防御巨响应 DoS，裁剪前就中止。
 * 256 KiB 曾误伤 arXiv cs.AI 这类合法大 feed（单文件 1~2 MB），放宽后仍有界。 */
export const MAX_BODY_BYTES = 2 * 1024 * 1024

/** SSRF 重定向守卫最大跟跳数：超过视为重定向风暴，中止（2026-09-09 审查 P1）。 */
export const MAX_REDIRECT_HOPS = 5

/** 需要 manual 跟跳复核的重定向状态码 */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

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
/** 初跳校验（scheme 不限）：sources.json 含 http:// 公网源（arxiv export API），故初跳只查
 * 本机/私网主机与 userinfo；重定向跳才要求全量 isPublicHttpsUrl（https + 公网）。 */
function assertNotPrivateOrigin(input: string): void {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new Error(`SSRF 防护：URL 无法解析: ${input}`)
  }
  if (parsed.username || parsed.password) throw new Error('SSRF 防护：URL 含 userinfo，已拒绝')
  const host = parsed.hostname
  if (!host || PRIVATE_HOSTS.has(host.toLowerCase()) || isLoopbackOrPrivateHost(host)) {
    throw new Error(`SSRF 防护：URL 指向本机/私网，已拒绝: ${host || input}`)
  }
}

/** SSRF 重定向守卫下的抓取：redirect:'manual' 手动跟跳，初跳查私网主机（scheme 放行），
 * 其后每一跳全量 isPublicHttpsUrl 重验，堵「公网 URL 302 → 本机/私网」绕道。 */
async function fetchWithRedirectGuard(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit | undefined,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<FetchFn>>> {
  let currentUrl = url
  for (let hop = 0; ; hop += 1) {
    if (hop === 0) {
      assertNotPrivateOrigin(currentUrl)
    } else if (!isPublicHttpsUrl(currentUrl)) {
      throw new Error(`SSRF 防护：重定向目标非公开 HTTPS URL，已拒绝: ${currentUrl}`)
    }
    const res = await fetchFn(currentUrl, { ...init, redirect: 'manual', signal })
    const status = res.status ?? 0
    // FetchFn 返回类型无 headers 字段（测试 mock 亦无），按结构访问；非重定向响应直接返回
    const headers = (res as { headers?: { get?: (name: string) => string | null } }).headers
    const location = REDIRECT_STATUSES.has(status) ? headers?.get?.('location') : undefined
    if (!location) return res
    if (hop >= MAX_REDIRECT_HOPS) {
      throw new Error(`SSRF 防护：重定向超过 ${MAX_REDIRECT_HOPS} 跳，已中止`)
    }
    currentUrl = new URL(location, currentUrl).toString()
  }
}

export async function withSizeLimit(
  fetchFn: FetchFn,
  url: string,
  init?: RequestInit,
  opts?: { ssrfGuard?: boolean },
): Promise<{ ok: boolean; status?: number; text: () => Promise<string> }> {
  const controller = new AbortController()
  const signal = init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal
  const res = opts?.ssrfGuard === true
    ? await fetchWithRedirectGuard(fetchFn, url, init, signal)
    : await fetchFn(url, { ...init, signal })
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

/** IPv6 本机/私有段判定（host 须已去方括号、小写）。仅对 IPv6 字面量生效（域名不含冒号）：
 * - ::1 回环 / :: 未指定
 * - fc00::/7 ULA（fc/fd 开头）
 * - fe80::/10 链路本地（fe8/fe9/fea/feb 开头）
 * - ::ffff:0:0/96 IPv4 映射地址——WHATWG 不展开 v6 字面量，`[::ffff:127.0.0.1]` 的
 *   hostname 是 `[::ffff:7f00:1]`（实测），不查映射段则私网过滤形同虚设 */
function isPrivateIPv6Literal(host: string): boolean {
  if (!host.includes(':')) return false
  if (host === '::1' || host === '::') return true
  if (host.startsWith('fc') || host.startsWith('fd')) return true
  if (host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) return true
  const mapped = host.match(/^::ffff:(?:([0-9a-f]{1,4}):([0-9a-f]{1,4})|(\d{1,3}(?:\.\d{1,3}){3}))$/)
  if (mapped) {
    const v4 = mapped[3] ?? (() => {
      const hi = parseInt(mapped[1]!, 16)
      const lo = parseInt(mapped[2]!, 16)
      return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
    })()
    return isPrivateIPv4(v4)
  }
  return false
}

function isLoopbackOrPrivateHost(host: string): boolean {
  const lower = host.toLowerCase()
  if (lower === 'localhost' || lower === 'localhost.' || lower === 'ip6-localhost' || lower === 'ip6-loopback') return true
  if (isPrivateIPv6Literal(lower.replace(/^\[/, '').replace(/\]$/, ''))) return true
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
