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

  // 终审 P1-2（opencode 线）：P-4 fail 方向缺锁定——probeEnd 到期 + changelog 零有效 artifact 时 P-4 应为 fail（gen-evidence:128）。
  it('P-4 fail 方向：probe-end 到期 + 零有效 artifact → P-4=fail', () => {
    const dir = makeFixture(false) // fixture 自带无 P-4 artifact 的 changelog
    const out = runScript(dir, ['--probe-end'])
    const p4 = out.criteria.find((c) => c.id === 'P-4')!
    expect(p4.status).toBe('fail')
    expect(p4.value).toContain('0 条有效')
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

  it('§2.6.4 收尾 1：I-3 分母按轮取（观测 enabledSourceIds=7 源）而非当前 config（18 源）', () => {
    const dir = makeFixture(false)
    const seven = Array.from({ length: 7 }, (_, i) => `src${i}`)
    writeFileSync(join(dir, 'config', 'sources.json'), JSON.stringify(
      Array.from({ length: 18 }, (_, i) => ({ id: `cfg${i}`, enabled: true })),
    ))
    const mkRound = (at: number) => JSON.stringify({
      at, candidates: 2, pushed: 1, collected: 10, relevant: 3,
      skippedSources: ['src6'], zeroYieldSources: [], emptyYieldSources: [],
      enabledSourceIds: seven, saturationRate: 0,
    })
    writeFileSync(join(dir, 'memory', 'observations.jsonl'), [mkRound(1), mkRound(2), mkRound(3)].join('\n') + '\n')
    const out = runScript(dir)
    const i3 = out.criteria.find((c) => c.id === 'I-3')!
    expect(i3.value).toContain('/7')
    expect(i3.value).toContain('14%')
    expect(i3.status).toBe('pass')
  })

  // 终审 P1-2 守卫（agy 线）：G-1/P-1 的 viewed 计数必须经 --probe-start 窗口过滤，否则修复期/联调期点过的 👀 会虚增两周累计。
  it('G-1/P-1 的 viewed 计数经 --probe-start 窗口过滤（修复期点击不虚增）', () => {
    const dir = makeFixture(false)
    writeFileSync(join(dir, 'memory', 'views.json'), JSON.stringify([
      { digestId: 'd-early', at: 100 }, // 修复期（probe-start 之前）
      { digestId: 'd-probe-a', at: 500 }, // 探针期
      { digestId: 'd-probe-b', at: 600 }, // 探针期
    ]))
    const all = runScript(dir, ['--probe-end'])
    const g1All = all.criteria.find((c) => c.id === 'G-1')!
    expect(g1All.value).toContain('3 次') // 全史口径：3 次
    const windowed = runScript(dir, ['--probe-end', '--probe-start', '400'])
    const g1Win = windowed.criteria.find((c) => c.id === 'G-1')!
    const p1Win = windowed.criteria.find((c) => c.id === 'P-1')!
    expect(g1Win.value).toContain('2 次') // 窗口口径：仅探针期 2 次
    expect(p1Win.value).toContain('2 次')
    expect(g1All.value).not.toBe(g1Win.value) // 两口径读数不同，证明窗口真生效
  })
})
