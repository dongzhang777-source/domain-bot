import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runDoctor, formatDoctorReport } from '../src/runtime/doctor.js'

describe('环境诊断 doctor 模块', () => {
  it('当工具均正常且配置完整时，doctor 给出 ok 结果', async () => {
    const mockSpawn = async (cmd: string) => {
      return { stdout: `${cmd} v1.0.0\n`, stderr: '' }
    }
    const res = await runDoctor(process.cwd(), mockSpawn)
    expect(res.configs.domain).toBe(true)
    expect(res.configs.sources).toBe(true)
    expect(res.tools.mcporter.ok).toBe(true)
    expect(res.tools.bili.ok).toBe(true)
    expect(res.tools['yt-dlp'].ok).toBe(true)
    const report = formatDoctorReport(res)
    expect(report).toContain('domain-bot 环境诊断 (doctor)')
  })

  it('当外部 spawn CLI 抛出 ENOENT 时，tools 报告失败并生成 issues', async () => {
    const mockSpawnFail = async (cmd: string) => {
      throw new Error(`spawn ${cmd} ENOENT`)
    }
    const res = await runDoctor(process.cwd(), mockSpawnFail)
    expect(res.ok).toBe(false)
    expect(res.tools.mcporter.ok).toBe(false)
    expect(res.tools.bili.ok).toBe(false)
    expect(res.tools['yt-dlp'].ok).toBe(false)
    expect(res.issues.some((i) => i.includes('mcporter'))).toBe(true)
    const report = formatDoctorReport(res)
    expect(report).toContain('FAIL')
    expect(report).toContain('发现以下问题')
  })

  it('ops/com.domain-bot.plist 必须包含绝对路径 PATH、WorkingDirectory 与关键运行参数', () => {
    const plistPath = join(process.cwd(), 'ops/com.domain-bot.plist')
    const content = readFileSync(plistPath, 'utf8')
    expect(content).toContain('<key>Label</key>')
    expect(content).toContain('<string>com.domain-bot</string>')
    expect(content).toContain('<key>WorkingDirectory</key>')
    expect(content).toContain('/Users/aiatwork/Projects/domain-bot')
    expect(content).toContain('<key>PATH</key>')
    expect(content).toContain('/opt/homebrew/bin')
    expect(content).toContain('/Users/aiatwork/.local/bin')
    expect(content).toContain('--env-file-if-exists=.env')
  })

  /**
   * 本组断言在 DB-04 被**反转**，不是删除。
   *
   * 旧版本这里断言 `content` 必须包含 `<key>KeepAlive</key>` 与 `<true/>`——
   * 它把缺陷锁死了：KeepAlive 守护的是已退役的常驻循环（日推 6 条 + Telegram
   * 长轮询）。老张 2026-09-04 裁决「只保留批产线」后本命令是一次性作业，
   * KeepAlive=true 与它组合 = launchd 认为「又挂了」而立即重拉，形成紧凑重启循环。
   * 改完 plist 后正是本断言把修改判为失败——所以它必须跟着反转。
   */
  it('plist 不得用 KeepAlive 守护一次性批产（紧凑重启循环），改用 StartCalendarInterval', () => {
    const content = readFileSync(join(process.cwd(), 'ops/com.domain-bot.plist'), 'utf8')
    expect(content, 'KeepAlive 与一次性批产组合会造成紧凑重启循环').not.toContain('<key>KeepAlive</key>')
    expect(content, '定时触发必须由 StartCalendarInterval 承担').toContain('<key>StartCalendarInterval</key>')
    expect(content).toContain('<key>RunAtLoad</key>')
    // RunAtLoad 必须为 false：否则每次 load（重启/调试）都会立即触发一轮完整批产，
    // 启用编辑部后那是 ≈53 分钟的作业，会在调试时意外起跑。
    expect(content).toMatch(/<key>RunAtLoad<\/key>\s*<false\/>/)
  })

  it('plist 的入口必须指向现行产线 dist/cli.js，不得指退役入口 dist/index.js', () => {
    const content = readFileSync(join(process.cwd(), 'ops/com.domain-bot.plist'), 'utf8')
    const args = content.slice(content.indexOf('<key>ProgramArguments</key>'), content.indexOf('</array>'))
    expect(args, 'launchd 必须跑 cli.js 的 run 子命令').toContain('<string>dist/cli.js</string>')
    expect(args).toContain('<string>run</string>')
    expect(args).toContain('<string>--persona=all</string>')
    // dist/index.ts 仅作兼容转发保留（避免旧调用方式静默失效），但定时作业不应指着它：
    // 指退役入口会让作业行为取决于那个转发壳里的默认值。
    expect(args, '不得再指退役入口').not.toContain('dist/index.js')
  })
})
