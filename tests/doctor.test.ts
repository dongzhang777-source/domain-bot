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
    expect(content).toContain('<key>KeepAlive</key>')
    expect(content).toContain('<true/>')
  })
})
