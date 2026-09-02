import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** D9（小巴 impl 审查）：gen-evidence.mjs 的守卫——判定线 11 键不许被静默丢，fail/nodata 方向各锁一例。 */
function makeFixture(withZeroRounds: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'dbot-evidence-'))
  mkdirSync(join(dir, 'memory'), { recursive: true })
  mkdirSync(join(dir, 'config'), { recursive: true })
  mkdirSync(join(dir, 'docs'), { recursive: true })
  const round = (at: number, candidates: number) =>
    JSON.stringify({ at, candidates, pushed: 0, collected: 0, relevant: 0, skippedSources: [], zeroYieldSources: [], saturationRate: 0 })
  const lines = withZeroRounds
    ? [round(1, 0), round(2, 0), round(3, 0)]
    : [round(1, 5), round(2, 3), round(3, 1)]
  writeFileSync(join(dir, 'memory', 'observations.jsonl'), lines.join('\n') + '\n')
  writeFileSync(join(dir, 'memory', 'archive.json'), JSON.stringify({ entries: [], digestRefs: {} }))
  writeFileSync(join(dir, 'config', 'sources.json'), JSON.stringify([
    { id: 's1', enabled: true }, { id: 's2', enabled: true },
  ]))
  writeFileSync(join(dir, 'docs', 'probe-changelog.md'), '# 探针配置变更记录\n\n（无 P-4 artifact）\n')
  return dir
}

function runScript(dir: string, args: string[] = []): { criteria: Array<{ id: string; status: string }>; probeStart: number | null } {
  const scriptPath = join(import.meta.dirname, '..', 'scripts', 'gen-evidence.mjs')
  const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: dir, encoding: 'utf8',
  })
  return JSON.parse(stdout)
}

describe('gen-evidence.mjs 判据覆盖守卫（A′3 红灯补齐，D9）', () => {
  it('输出恒含 11 个判据键（I-1..4 / G-1..3 / P-1..4）', () => {
    const out = runScript(makeFixture(false))
    expect(out.criteria.map((c) => c.id)).toEqual([
      'I-1', 'I-2', 'I-3', 'I-4', 'G-1', 'G-2', 'G-3', 'P-1', 'P-2', 'P-3', 'P-4',
    ])
  })

  it('fail 方向：连续 3 轮 candidates=0 → I-1=fail；nodata 方向：无 feedback.json → I-2=nodata；P-4 无 artifact 且未到期 → nodata', () => {
    const out = runScript(makeFixture(true))
    const byId = Object.fromEntries(out.criteria.map((c) => [c.id, c.status]))
    expect(byId['I-1']).toBe('fail')
    expect(byId['I-2']).toBe('nodata')
    expect(byId['P-4']).toBe('nodata')
  })

  it('D8：观测不足 3 轮时 I-1/I-4 为 nodata 而非 pass', () => {
    const dir = makeFixture(false)
    writeFileSync(join(dir, 'memory', 'observations.jsonl'), JSON.stringify({ at: 1, candidates: 0, pushed: 0, saturationRate: 0 }) + '\n')
    const out = runScript(dir)
    const byId = Object.fromEntries(out.criteria.map((c) => [c.id, c.status]))
    expect(byId['I-1']).toBe('nodata')
    expect(byId['I-4']).toBe('nodata')
  })

  it('D4：--probe-start 生效时 I-2 分母只统计探针期内推送', () => {
    const dir = makeFixture(false)
    // 修复期推送（at=100，probe-start 之前）+ 探针期推送（at=500）
    writeFileSync(join(dir, 'memory', 'observations.jsonl'), [
      JSON.stringify({ at: 100, candidates: 5, pushed: 10, saturationRate: 0 }),
      JSON.stringify({ at: 500, candidates: 3, pushed: 2, saturationRate: 0 }),
    ].join('\n') + '\n')
    writeFileSync(join(dir, 'memory', 'feedback.json'), JSON.stringify([
      { signal: 'up', at: 600 }, { signal: 'down', at: 610 },
    ]))
    const all = runScript(dir)
    const i2All = all.criteria.find((c) => c.id === 'I-2')!.status
    const windowed = runScript(dir, ['--probe-start', '400'])
    const i2Win = windowed.criteria.find((c) => c.id === 'I-2')!.status
    // 全史口径：2/12 = 16.7% ≥ 5% → pass；窗口口径：2/2 = 100% → pass
    expect(i2All).toBe('pass')
    expect(i2Win).toBe('pass')
    expect(windowed.probeStart).not.toBeNull()
    // 数值差验证窗口真的生效：value 字符串不同（2/12 vs 2/2）
    const vAll = all.criteria.find((c) => c.id === 'I-2')!.value
    const vWin = windowed.criteria.find((c) => c.id === 'I-2')!.value
    expect(vAll).not.toBe(vWin)
  })
})
