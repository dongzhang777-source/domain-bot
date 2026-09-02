#!/usr/bin/env node
// scripts/gen-evidence.mjs —— 从 artifacts 直接生成报告用数据块（A7 纪律：禁止手抄）
// 用法：node scripts/gen-evidence.mjs [--md]     # --md 同时写 docs/evidence-latest.md
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null)

const observations = (read('memory/observations.jsonl') ?? '')
  .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
let archive = { entries: [], digestRefs: {} }
try { archive = JSON.parse(read('memory/archive.json')) ?? archive } catch { /* 无归档 */ }
const feedback = (() => { try { return JSON.parse(read('memory/feedback.json')) ?? [] } catch { return [] } })()
let weights = null
try { weights = JSON.parse(read('memory/weights.json')) } catch { /* 无权重 */ }

const bySourceArchive = {}
for (const e of archive.entries) bySourceArchive[e.source] = (bySourceArchive[e.source] ?? 0) + 1
const pushedCount = archive.entries.filter((e) => e.pushed).length

const summary = {
  generatedAt: new Date().toISOString(),
  rounds: observations.length,
  lastRound: observations.at(-1) ?? null,
  archive: { total: archive.entries.length, pushed: pushedCount, bySource: bySourceArchive },
  feedbackCount: feedback.length,
  weights: weights?.weights ?? null,
  weightsFeedbackHash: weights?.feedbackHash?.slice(0, 12) ?? null,
}

if (process.argv.includes('--md')) {
  const md = [
    '## 探针证据快照（gen-evidence.mjs 生成，非手抄）', '',
    '```json', JSON.stringify(summary, null, 2), '```', '',
    '### observations.jsonl 全文', '',
    '```jsonl', ...(observations.map((o) => JSON.stringify(o))), '```', '',
  ].join('\n')
  writeFileSync(join(root, 'docs', 'evidence-latest.md'), md)
  console.log(`[evidence] 写入 docs/evidence-latest.md（${observations.length} 轮观测）`)
}
console.log(JSON.stringify(summary, null, 2))
