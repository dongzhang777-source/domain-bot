import { describe, expect, it, vi } from 'vitest'
import { isPublicHttpsUrl } from '../src/collector/adapters/fetchUtil.js'

describe('isPublicHttpsUrl (SSRF 防护)', () => {
  it('接受公开 HTTPS', () => {
    expect(isPublicHttpsUrl('https://huggingface.co/papers')).toBe(true)
    expect(isPublicHttpsUrl('https://example.com/page')).toBe(true)
  })
  it('拒绝非 HTTPS', () => {
    expect(isPublicHttpsUrl('http://huggingface.co/papers')).toBe(false)
  })
  it('拒绝 localhost', () => {
    expect(isPublicHttpsUrl('https://localhost/x')).toBe(false)
    expect(isPublicHttpsUrl('https://127.0.0.1/x')).toBe(false)
  })
  it('拒绝云元数据 IP', () => {
    expect(isPublicHttpsUrl('https://169.254.169.254/latest/meta-data/')).toBe(false)
  })
  it('拒绝非 URL 字符串', () => {
    expect(isPublicHttpsUrl('not a url')).toBe(false)
    expect(isPublicHttpsUrl('')).toBe(false)
  })
  it('拒绝私网段', () => {
    expect(isPublicHttpsUrl('https://10.0.0.1/x')).toBe(false)
    expect(isPublicHttpsUrl('https://192.168.1.1/x')).toBe(false)
    expect(isPublicHttpsUrl('https://172.16.5.4/x')).toBe(false)
    expect(isPublicHttpsUrl('https://172.31.255.1/x')).toBe(false)
    expect(isPublicHttpsUrl('https://0.0.0.0/x')).toBe(false)
  })
  it('拒绝带 userinfo 的 URL', () => {
    expect(isPublicHttpsUrl('https://user:pass@example.com/')).toBe(false)
    expect(isPublicHttpsUrl('https://user@example.com/')).toBe(false)
  })
  it('放行公网 IP（非私网）', () => {
    expect(isPublicHttpsUrl('https://8.8.8.8/')).toBe(true)
    expect(isPublicHttpsUrl('https://1.1.1.1/')).toBe(true)
  })
})

describe('isPublicHttpsUrl IPv6 补盲（2026-09-09 审查 P1）', () => {
  it('拒绝 IPv6 ULA / 链路本地 / IPv4 映射地址', () => {
    expect(isPublicHttpsUrl('https://[fd00::1]/x')).toBe(false)
    expect(isPublicHttpsUrl('https://[fe80::1]/x')).toBe(false)
    // WHATWG 把 [::ffff:127.0.0.1] 规范化为 hostname `[::ffff:7f00:1]`，两种写法都要拦
    expect(isPublicHttpsUrl('https://[::ffff:127.0.0.1]/x')).toBe(false)
    expect(isPublicHttpsUrl('https://[::ffff:7f00:1]/x')).toBe(false)
    expect(isPublicHttpsUrl('https://[::ffff:10.0.0.1]/x')).toBe(false)
  })
  it('不误伤公网 IPv6 与 fc/fd 开头的域名', () => {
    expect(isPublicHttpsUrl('https://[2606:4700::1]/x')).toBe(true)
    expect(isPublicHttpsUrl('https://fcupdate.example.com/')).toBe(true)
  })
})

describe('withSizeLimit ssrfGuard（重定向复核，2026-09-09 审查 P1）', () => {
  const okRes = (text: string, status = 200, headers?: Record<string, string>) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers?.[n.toLowerCase()] ?? null },
    text: async () => text,
  })

  it('公网 302 → 本机：拒绝并抛错（旧实现默认 follow 会直接打进 127.0.0.1）', async () => {
    const { withSizeLimit } = await import('../src/collector/adapters/fetchUtil.js')
    const fetchFn = vi.fn().mockResolvedValueOnce(okRes('', 302, { location: 'https://127.0.0.1:8051/v1/vision' }))
    await expect(
      withSizeLimit(fetchFn as any, 'https://evil.example/feed', {}, { ssrfGuard: true }),
    ).rejects.toThrow('重定向目标非公开 HTTPS')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('公网 302 → 公网：正常跟跳并返回终响应', async () => {
    const { withSizeLimit } = await import('../src/collector/adapters/fetchUtil.js')
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(okRes('', 302, { location: 'https://elsewhere.example/final' }))
      .mockResolvedValueOnce(okRes('hello-redirected'))
    const res = await withSizeLimit(fetchFn as any, 'https://origin.example/feed', {}, { ssrfGuard: true })
    await expect(res.text()).resolves.toBe('hello-redirected')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('初跳 http 公网源放行（arxiv export API），重定向跳必须 https', async () => {
    const { withSizeLimit } = await import('../src/collector/adapters/fetchUtil.js')
    const fetchFn = vi.fn().mockResolvedValueOnce(okRes('', 301, { location: 'http://elsewhere.example/x' }))
    await expect(
      withSizeLimit(fetchFn as any, 'http://export.arxiv.org/api/query', {}, { ssrfGuard: true }),
    ).rejects.toThrow('重定向目标非公开 HTTPS')
  })

  it('初跳本机/私网直接拒绝（scheme 不限），fetch 不发出', async () => {
    const { withSizeLimit } = await import('../src/collector/adapters/fetchUtil.js')
    const fetchFn = vi.fn()
    await expect(
      withSizeLimit(fetchFn as any, 'http://10.0.0.5/feed', {}, { ssrfGuard: true }),
    ).rejects.toThrow('本机/私网')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('超过最大跳数中止', async () => {
    const { withSizeLimit, MAX_REDIRECT_HOPS } = await import('../src/collector/adapters/fetchUtil.js')
    const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(okRes('', 302, { location: 'https://hop.example/next' })))
    await expect(
      withSizeLimit(fetchFn as any, 'https://origin.example/', {}, { ssrfGuard: true }),
    ).rejects.toThrow('重定向超过')
    expect(fetchFn.mock.calls.length).toBe(MAX_REDIRECT_HOPS + 1)
  })

  it('不开守卫保持原行为：单次调用，不注入 redirect', async () => {
    const { withSizeLimit } = await import('../src/collector/adapters/fetchUtil.js')
    const fetchFn = vi.fn().mockResolvedValueOnce(okRes('plain'))
    const res = await withSizeLimit(fetchFn as any, 'https://example.com/')
    await expect(res.text()).resolves.toBe('plain')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect((fetchFn.mock.calls[0]![1] as RequestInit).redirect).toBeUndefined()
  })
})

describe('withSizeLimit (巨响应 DoS 防护)', () => {
  it('mock 无 body 流时按文本长度限流', async () => {
    const { withSizeLimit, MAX_BODY_BYTES } = await import('../src/collector/adapters/fetchUtil.js')
    const big = 'x'.repeat(MAX_BODY_BYTES + 1)
    const fetchFn = async () => ({ ok: true, status: 200, text: async () => big } as any)
    const res = await withSizeLimit(fetchFn, 'https://example.com/')
    await expect(res.text()).rejects.toThrow('sizeLimit')
  })
  it('小响应放行', async () => {
    const { withSizeLimit } = await import('../src/collector/adapters/fetchUtil.js')
    const fetchFn = async () => ({ ok: true, status: 200, text: async () => 'hello' } as any)
    const res = await withSizeLimit(fetchFn, 'https://example.com/')
    await expect(res.text()).resolves.toBe('hello')
  })
})

describe('fetchWithTimeout 与 timeoutSignal', () => {
  it('注入 timeoutSignal 时在挂起超时后抛出异常（安全穿透 withSizeLimit）', async () => {
    const { withSizeLimit, timeoutSignal } = await import('../src/collector/adapters/fetchUtil.js')
    const hangingFetch = (_url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve({ ok: true, status: 200, text: async () => 'late' } as any), 500)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(init.signal?.reason ?? new Error('aborted'))
        })
      })

    await expect(
      withSizeLimit(hangingFetch as any, 'https://example.com/', { signal: timeoutSignal(50) }),
    ).rejects.toThrow()
  })
})
