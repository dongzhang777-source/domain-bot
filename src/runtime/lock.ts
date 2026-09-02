import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/**
 * 单实例锁（hy3 条件 2）：同一 memoryDir 起两个进程（loop 重复启动、loop + cron 的 --once）
 * 会对 feedback.json/weights.json 做 last-writer-wins 全量覆盖，丢反馈、回退权重。
 * 锁文件 = memory/.lock，内容为持有者 PID；持有进程死亡后自动接管（stale lock）。
 */
export function acquireLock(memoryDir: string): void {
  mkdirSync(memoryDir, { recursive: true })
  const lockPath = join(memoryDir, '.lock')
  if (existsSync(lockPath)) {
    const holderPid = Number(readFileSync(lockPath, 'utf8').trim())
    let alive = false
    try {
      process.kill(holderPid, 0)
      alive = true
    } catch {
      alive = false // ESRCH：进程已死，锁是陈旧的
    }
    if (alive) {
      throw new Error(`memoryDir 已被进程 ${holderPid} 持有（${lockPath}）。同一 memoryDir 不允许并发运行：请停掉旧进程或删除陈旧锁。`)
    }
  }
  writeFileSync(lockPath, String(process.pid))
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
