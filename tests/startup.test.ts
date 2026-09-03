import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startBot } from '../src/index.js'
import type { DomainConfig, SourceConfig } from '../src/types.js'

const domain: DomainConfig = {
  domain: 'ai', keywords: ['llm', 'inference'], scoreThreshold: 0.45,
  maxPerDigest: 6, clusterThreshold: 0.35,
}
const sources: SourceConfig[] = [
  { id: 'rss-1', type: 'rss', url: 'http://e/rss', weight: 0.5, enabled: true },
  { id: 'gh-1', type: 'github', url: 'https://api.github.com/x', weight: 0.5, enabled: true },
]

const RSS_XML = `<?xml version="1.0"?><rss><channel><item><title>LLM inference benchmark released</title><description>open source release outperform SOTA</description><link>https://e.com/1</link></item></channel></rss>`
const GH_JSON = JSON.stringify({ items: [] })
const mockFetch = async (url: string) => ({
  ok: true, status: 200,
  text: async () => (String(url).includes('api.github.com') ? GH_JSON : RSS_XML),
})

describe('运行时可达性（hy3 条件 1）', () => {
  it('常驻 + 有 telegram 时，startBot 必须真的调用 pollFeedback（不只是文本存在）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-start-'))
    let pollCalled = false
    await startBot({
      domain, sources, memoryDir: join(dir, 'memory'), outDir: join(dir, 'out'),
      telegram: { token: 't', chatId: 'c' },
      once: false, maxRounds: 1, fetchFn: mockFetch,
      pollFeedbackFn: async () => { pollCalled = true; return new Promise(() => {}) },
    })
    expect(pollCalled).toBe(true)
  })

  it('--once 模式不启动反馈接收（与生产行为一致）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-start2-'))
    let pollCalled = false
    await startBot({
      domain, sources, memoryDir: join(dir, 'memory'), outDir: join(dir, 'out'),
      telegram: { token: 't', chatId: 'c' },
      once: true, fetchFn: mockFetch,
      pollFeedbackFn: async () => { pollCalled = true; return new Promise(() => {}) },
    })
    expect(pollCalled).toBe(false)
  })

  it('启动横幅：printBootBanner 打印通道状态并在常驻缺 Telegram 时警告（盲区二守卫）', async () => {
    const { printBootBanner } = await import('../src/index.js')
    const logs: string[] = []
    const warns: string[] = []
    const origLog = console.log
    const origWarn = console.warn
    console.log = (...args) => logs.push(args.join(' '))
    console.warn = (...args) => warns.push(args.join(' '))
    try {
      printBootBanner(undefined, false)
      expect(logs.some((l) => l.includes('Telegram: off'))).toBe(true)
      expect(warns.some((w) => w.includes('未配置 Telegram 且非 --once 模式'))).toBe(true)

      logs.length = 0
      warns.length = 0
      printBootBanner({ token: '12345:ABC', chatId: '987654321' }, true)
      expect(logs.some((l) => l.includes('Telegram: on (chatId=987***)'))).toBe(true)
      expect(warns.length).toBe(0)
    } finally {
      console.log = origLog
      console.warn = origWarn
    }
  })
})

describe('单实例锁（hy3 条件 2）', () => {
  it('同 memoryDir 第二次 acquire 必须抛错；持有人死后可接管', async () => {
    const { acquireLock, releaseLock } = await import('../src/runtime/lock.js')
    const { writeFileSync } = await import('node:fs')
    const dir = mkdtempSync(join(tmpdir(), 'dbot-lock-'))
    acquireLock(dir)
    expect(() => acquireLock(dir)).toThrow(/不允许并发运行/)
    releaseLock(dir)
    acquireLock(dir) // 释放后可重新持有
    releaseLock(dir)
    // 陈旧锁：写入一个几乎不可能存活的 PID，再 acquire 应接管成功
    writeFileSync(join(dir, '.lock'), '999999999')
    acquireLock(dir)
    releaseLock(dir)
  })

  // 2026-09-02 审查发现 B7：锁文件损坏时进程会**永久拒绝启动**，只能人工删锁。
  // 触发场景真实存在——进程在 openSync('wx') 之后、writePid 之前被 SIGKILL
  //（此时信号清理钩子不会执行），就会留下一个空锁文件。
  it('B7 回归护栏：空 / 非数字 / 非正整数的锁文件必须能被接管', async () => {
    const { acquireLock, releaseLock } = await import('../src/runtime/lock.js')
    const { writeFileSync } = await import('node:fs')
    const dir = mkdtempSync(join(tmpdir(), 'dbot-lock-corrupt-'))
    for (const bad of ['', 'not-a-pid', '0', '-1']) {
      // 修复前：Number('') === 0 → process.kill(0, 0) 语义是"检查整个进程组"，
      // 必然判定存活 → 抛"不允许并发运行"，且没有任何自动恢复路径。
      writeFileSync(join(dir, '.lock'), bad)
      expect(() => acquireLock(dir), `锁内容 ${JSON.stringify(bad)} 应可接管`).not.toThrow()
      releaseLock(dir)
    }
  })

  // 2026-09-02 审查发现 B3：acquireLock 与 releaseLock 之间横跨整个长驻循环，
  // 此前没有 try/finally，runOnce 抛错就会残留锁文件。
  //
  // ⚠️ 注入点选择（踩坑记录）：**不能用采集失败来验证异常路径**——
  // collector 对单源失败是**有意容错**的（只打印 `[collector] xxx 失败` 后继续，
  // 一个源挂掉不该拖垮整轮），异常根本不会传播到 startBot，用例会假失败。
  // 必须走启动链上的非采集类故障（磁盘满 / 权限 / 配置解析失败等同型场景）。
  it('B3 回归护栏：startBot 异常退出后不得残留锁文件', async () => {
    const { existsSync } = await import('node:fs')
    const dir = mkdtempSync(join(tmpdir(), 'dbot-lock-err-'))
    const memoryDir = join(dir, 'memory')
    let threw = false
    try {
      await startBot({
        domain, sources, memoryDir, outDir: join(dir, 'out'),
        once: false, maxRounds: 1, fetchFn: mockFetch,
        telegram: { token: 't', chatId: 'c' },
        // 同步抛错：模拟启动链故障
        pollFeedbackFn: (() => { throw new Error('启动链故意炸掉') }) as never,
      })
    } catch {
      threw = true
    }
    expect(threw, '注入的启动异常应向上暴露，否则该用例验证不到异常路径').toBe(true)
    expect(existsSync(join(memoryDir, '.lock')), '锁文件残留').toBe(false)
  })
})
