#!/usr/bin/env node
// scripts/gen-evidence.mjs —— 从 artifacts 直接生成报告用数据块（A7 纪律：禁止手抄）
// A′3（2026-09-02）：读 views.json，输出判定线 11 项判据自动读数（pass/fail/nodata）。
//   - I-1..I-4 是滚动监测项：pass=未触发，fail=已触发（签字后即按此裁决）。
//   - G/P 组是两周累计/探针期末项：中途一律 nodata（当前值仅展示）；加 --probe-end 才做期末判定。
//   - I-4 暂按 criteria 现行文（saturationRate > 0.5，原始分口径）；决策点 7 已拍板案 B（P90 型），
//     criteria 签字稿改文后本脚本的 I-4 行随之更新——两者必须同批改（X6 纪律）。
// 用法：node scripts/gen-evidence.mjs [--md] [--probe-end]     # --md 同时写 docs/evidence-latest.md
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null)

const observations = (read('memory/observations.jsonl') ?? '')
  .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
let archive = { entries: [], digestRefs: {} }
try { archive = JSON.parse(read('memory/archive.json')) ?? archive } catch { /* 无归档 */ }
const feedbackExists = existsSync(join(root, 'memory', 'feedback.json'))
const feedback = (() => { try { return JSON.parse(read('memory/feedback.json')) ?? [] } catch { return [] } })()
const viewsExists = existsSync(join(root, 'memory', 'views.json'))
const views = (() => { try { return JSON.parse(read('memory/views.json')) ?? [] } catch { return [] } })()
let weights = null
try { weights = JSON.parse(read('memory/weights.json')) } catch { /* 无权重 */ }
const sources = (() => { try { return JSON.parse(read('config/sources.json')) ?? [] } catch { return [] } })()
const changelog = read('docs/probe-changelog.md') ?? ''
const probeEnd = process.argv.includes('--probe-end')
// D4（小巴 impl 审查）：探针期口径——传 --probe-start <epoch-ms|ISO> 后，I-2 的分子分母只统计探针期内
// 数据，修复期推送不再永久稀释反馈率。不传则保持全史口径（签字稿定稿时同批切换，X6 纪律）。
const probeStartIdx = process.argv.indexOf('--probe-start')
const probeStartRaw = probeStartIdx > -1 ? process.argv[probeStartIdx + 1] : undefined
const probeStart = probeStartRaw ? (Number(probeStartRaw) || Date.parse(probeStartRaw) || null) : null
const obsForI2 = probeStart ? observations.filter((o) => (o.at ?? 0) >= probeStart) : observations
const fbForI2 = probeStart ? feedback.filter((f) => (f.at ?? 0) >= probeStart) : feedback

const bySourceArchive = {}
for (const e of archive.entries) bySourceArchive[e.source] = (bySourceArchive[e.source] ?? 0) + 1
const pushedCount = archive.entries.filter((e) => e.pushed).length

// ---- 判定线 11 项自动读数（判据原文以 docs/probe-verdict-criteria.md 为唯一口径）----
const last3 = observations.slice(-3)
const trailingZeroRounds = (() => {
  let n = 0
  for (let i = observations.length - 1; i >= 0 && observations[i].candidates === 0; i--) n++
  return n
})()
const totalPushed = obsForI2.reduce((s, o) => s + (o.pushed ?? 0), 0)
const ups = fbForI2.filter((f) => f.signal === 'up').length
const downs = fbForI2.filter((f) => f.signal === 'down').length
const validFeedback = ups + downs
const thumbsUpRate = validFeedback > 0 ? ups / validFeedback : null
const enabledCount = sources.filter((s) => s.enabled).length
// D5（小巴 impl 审查）：P-4 artifact 行必须可核验——日期 + digestId= + itemId= + decision= 四要素齐备
// 才算有效；裸「| P-4 |」片段不再假触发。行格式：`| P-4 | 2026-09-15 | digestId=<id> | itemId=<id> | decision=<一句话> |`
const p4Rows = changelog.split('\n').filter((l) => /^\|\s*P-4\s*\|/.test(l))
const p4Valid = p4Rows.filter((l) =>
  /\d{4}-\d{2}-\d{2}/.test(l) && /digestId\s*[=:]\s*\S+/i.test(l) && /itemId\s*[=:]\s*\S+/i.test(l) && /decision\s*[=:]/i.test(l))
const roundBadSources = (o) => (o?.skippedSources?.length ?? 0) + (o?.zeroYieldSources?.length ?? 0)

/** I-3：采集失败 + 零产出源占比，连续 3 轮 > 1/3。§2.6.4 收尾 1：分母按轮取（该轮 enabledSourceIds.length），
 *  旧观测缺该字段 → 显式 nodata，不回退当前 config（否则 18 源分母会稀释 7 源时代的分子——假绿通道）。 */
const i3 = (() => {
  if (observations.length < 3) return { value: 'nodata', status: 'nodata' }
  const last3r = observations.slice(-3)
  if (last3r.some((o) => !Array.isArray(o.enabledSourceIds) || o.enabledSourceIds.length === 0)) {
    return { value: '旧观测缺 enabledSourceIds——分母无法按轮取', status: 'nodata' }
  }
  const l = observations.at(-1)
  const bad = roundBadSources(l)
  const value = `${bad}/${l.enabledSourceIds.length} = ${(100 * bad / l.enabledSourceIds.length).toFixed(0)}%`
  const badRounds = last3r.filter((o) => roundBadSources(o) / o.enabledSourceIds.length > 1 / 3).length
  return { value, status: badRounds >= 3 ? 'fail' : 'pass' }
})()

const criteriaRows = [
  {
    id: 'I-1', name: '连续 3 轮 candidates=0（候选池枯竭）', threshold: '3 轮',
    value: `${trailingZeroRounds}/3 轮`,
    status: observations.length < 3 ? 'nodata' : (trailingZeroRounds >= 3 ? 'fail' : 'pass'),
    note: 'M6 标定中：拟加「且全源零新增」限定（arXiv 周五/周六无公告属排班，非仪器故障）',
  },
  {
    id: 'I-2', name: '反馈率 < 5%（👍+👎 数 / 推送条数）', threshold: '5%',
    value: !feedbackExists ? 'feedback.json 不存在'
      : totalPushed === 0 ? `0 条反馈 / 0 条推送（n/a）`
      : `${validFeedback}/${totalPushed} = ${(100 * validFeedback / totalPushed).toFixed(1)}%`,
    status: !feedbackExists || totalPushed === 0 ? 'nodata' : (validFeedback / totalPushed < 0.05 ? 'fail' : 'pass'),
    note: probeStart ? `探针期口径（--probe-start 已生效）` : '无 Telegram key 时无输入通道，nodata 属预期；全史口径（修复期推送计入分母）——签字稿定稿时同批切换',
  },
  { id: 'I-3', name: '采集失败+零产出源占比 连续 3 轮 > 1/3（B′1 新口径）', threshold: '1/3', value: i3.value, status: i3.status, note: '分母按轮取（§2.6.4）；返回空的源单列 emptyYieldSources 可见不报警，是否并入分子待 M6 标定' },
  {
    id: 'I-4', name: 'saturationRate 持续 > 0.5（原始分口径）', threshold: '0.5',
    value: `${observations.at(-1)?.saturationRate ?? 'nodata'}`,
    status: observations.length < 3 ? 'nodata' : (last3.every((o) => (o.saturationRate ?? 0) > 0.5) ? 'fail' : 'pass'),
    note: '决策点 7 已拍板案 B（P90 型），criteria 签字稿改文后本行同步更新',
  },
  {
    id: 'G-1', name: '主动消费性查看 < 10 次（两周累计）', threshold: '10 次',
    value: viewsExists ? `${views.length} 次` : 'views.json 不存在',
    status: probeEnd && viewsExists ? (views.length < 10 ? 'fail' : 'pass') : 'nodata',
    note: 'views.json 是 viewed 唯一定义（criteria §2c）',
  },
  {
    id: 'G-2', name: '👍率 < 20%（有效反馈中）', threshold: '20%',
    value: thumbsUpRate === null ? 'nodata' : `${(thumbsUpRate * 100).toFixed(1)}%（${ups}👍/${downs}👎）`,
    status: probeEnd && thumbsUpRate !== null ? (thumbsUpRate < 0.2 ? 'fail' : 'pass') : 'nodata',
    note: '',
  },
  { id: 'G-3', name: '戒断测试：停 3 天无主动打开', threshold: '停 3 天', value: '需探针期末人工判读', status: 'nodata', note: '依赖探针结束后的戒断窗口观测' },
  {
    id: 'P-1', name: '主动查看 ≥ 10 次', threshold: '10 次',
    value: viewsExists ? `${views.length} 次` : 'views.json 不存在',
    status: probeEnd && viewsExists ? (views.length >= 10 ? 'pass' : 'fail') : 'nodata',
    note: '',
  },
  {
    id: 'P-2', name: '👍率 ≥ 30% 且有效反馈 ≥ 20 条', threshold: '30% 且 20 条',
    value: thumbsUpRate === null ? 'nodata' : `${(thumbsUpRate * 100).toFixed(1)}% 且 ${validFeedback} 条`,
    status: probeEnd && thumbsUpRate !== null ? (thumbsUpRate >= 0.3 && validFeedback >= 20 ? 'pass' : 'fail') : 'nodata',
    note: '有效反馈已按 C′10 同条同信号去重，不可被重放虚增',
  },
  { id: 'P-3', name: '戒断测试通过：停 3 天内有主动打开', threshold: '停 3 天', value: '需探针期末人工判读', status: 'nodata', note: '依赖探针结束后的戒断窗口观测' },
  {
    id: 'P-4', name: '定性证据 ≥1 条（probe-changelog.md 的 P-4 artifact 行）', threshold: '≥1 条',
    value: `${p4Valid.length} 条有效 / ${p4Rows.length} 行 P-4 记录`,
    status: probeEnd ? (p4Valid.length >= 1 ? 'pass' : 'fail') : 'nodata',
    note: 'artifact 行格式：`| P-4 | <date> | digestId=<id> | itemId=<id> | decision=<一句话> |`——四要素齐备才计有效（D5）',
  },
]

const summary = {
  generatedAt: new Date().toISOString(),
  probeStart: probeStart ?? null,
  rounds: observations.length,
  lastRound: observations.at(-1) ?? null,
  archive: { total: archive.entries.length, pushed: pushedCount, bySource: bySourceArchive },
  feedbackCount: feedback.length,
  viewsCount: views.length,
  weights: weights?.weights ?? null,
  weightsFeedbackHash: weights?.feedbackHash?.slice(0, 12) ?? null,
  criteria: criteriaRows,
}

if (process.argv.includes('--md')) {
  const md = [
    '## 探针证据快照（gen-evidence.mjs 生成，非手抄）', '',
    '```json', JSON.stringify(summary, null, 2), '```', '',
    '### 判定线 11 项读数（A′3 自动产出；判据原文见 docs/probe-verdict-criteria.md）', '',
    '| 判据 | 内容 | 阈值 | 当前值 | 状态 | 备注 |',
    '|---|---|---|---|---|---|',
    ...criteriaRows.map((c) => `| ${c.id} | ${c.name} | ${c.threshold} | ${c.value} | **${c.status}** | ${c.note} |`),
    '', '> G/P 组为两周累计/期末项，中途一律 nodata；探针结束后加 --probe-end 评估。', '',
    '### observations.jsonl 全文', '',
    '```jsonl', ...(observations.map((o) => JSON.stringify(o))), '```', '',
  ].join('\n')
  writeFileSync(join(root, 'docs', 'evidence-latest.md'), md)
  console.log(`[evidence] 写入 docs/evidence-latest.md（${observations.length} 轮观测，${criteriaRows.length} 项判据读数）`)
}
console.log(JSON.stringify(summary, null, 2))
