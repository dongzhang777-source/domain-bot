import { describe, expect, it } from 'vitest'
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
