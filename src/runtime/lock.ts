import { openSync, closeSync, readSync, existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/**
 * 单实例锁（hy3 条件 2 / agy 加固）：同一 memoryDir 并发运行会 last-writer-wins 丢反馈。
 * agy 三审修复：①`openSync(wx)` 原子创建消 TOCTOU；②EPERM 与 ESRCH 区分（EPERM=活进程，
 * 不再误判为死锁）；③SIGINT/SIGTERM 清理钩子；④信号残留锁下次启动检测命令行可覆盖。
 * PID 复用残余风险：kill(pid,0) 判活的随机 PID 极低概率误锁——留存启动时间比对属过度设计，接受。
 */
export function acquireLock(memoryDir: string): void {
  mkdirSync(memoryDir, { recursive: true })
  const lockPath = join(memoryDir, '.lock')
  if (existsSync(lockPath)) {
    const holderPid = Number(readFileSync(lockPath, 'utf8').trim())
    try {
      process.kill(holderPid, 0)
      // 活着（kill 成功或 EPERM 都说明进程存在）→ 拒绝
      throw new Error(`memoryDir 已被进程 ${holderPid} 持有（${lockPath}）。同一 memoryDir 不允许并发运行；确认旧进程已死后可 rm ${lockPath}`)
    } catch (err) {
      if (err instanceof Error && /不允许并发运行/.test(err.message)) throw err
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ESRCH') throw err
      // ESRCH：持锁进程已死 → 接管陈旧锁
      rmSync(lockPath)
    }
  }
  let fd: number
  try {
    fd = openSync(lockPath, 'wx') // 原子创建：毫秒级并发时第二个 open 直接 EEXIST
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // 并发窗口：existsSync 检查后、创建前被另一进程抢先 → 按拒绝处理
      throw new Error(`memoryDir 并发加锁冲突（${lockPath} 已被另一进程创建）。同一 memoryDir 不允许并发运行`)
    }
    throw err
  }
  try {
    writePid(fd, process.pid)
  } finally {
    closeSync(fd)
  }
  registerSignalCleanup(lockPath)
}

function writePid(fd: number, pid: number): void {
  const buf = Buffer.from(String(pid))
  let off = 0
  while (off < buf.length) off += writeSyncFd(fd, buf, off)
}

import { writeSync as writeSyncFd } from 'node:fs'

function registerSignalCleanup(lockPath: string): void {
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      try { rmSync(lockPath) } catch { /* 尽力清理 */ }
      process.exit(1)
    })
  }
}

export function releaseLock(memoryDir: string): void {
  const lockPath = join(memoryDir, '.lock')
  try {
    if (existsSync(lockPath) && Number(readFileSync(lockPath, 'utf8').trim()) === process.pid) {
      rmSync(lockPath)
    }
  } catch {
    /* 释放失败不影响主流程 */
  }
}
