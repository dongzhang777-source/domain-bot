// scripts/snapshot-evidence.mjs
// 把 memory/ 与 outbox/ 当前状态打包到 evidence/（evidence/ 纳入 git 跟踪）。
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const dest = join(root, 'evidence', stamp)
mkdirSync(dest, { recursive: true })

for (const dir of ['memory', 'outbox']) {
  if (existsSync(join(root, dir))) cpSync(join(root, dir), join(dest, dir), { recursive: true })
}

// 附一份人可读摘要，事后不解析 JSON 也能看趋势
const summary = { snapshotAt: stamp, rounds: 0, feedback: 0, archived: 0, pushedEntries: 0, digestFiles: 0 }
const arch = join(dest, 'memory', 'archive.json')
if (existsSync(arch)) {
  const a = JSON.parse(readFileSync(arch, 'utf8'))
  summary.archived = a.entries?.length ?? 0
  summary.pushedEntries = a.entries?.filter((e) => e.pushed).length ?? 0
}
const fb = join(dest, 'memory', 'feedback.json')
if (existsSync(fb)) summary.feedback = JSON.parse(readFileSync(fb, 'utf8')).length
const obs = join(dest, 'memory', 'observations.jsonl')
if (existsSync(obs)) summary.rounds = readFileSync(obs, 'utf8').trim().split('\n').filter(Boolean).length
const out = join(dest, 'outbox')
if (existsSync(out)) summary.digestFiles = readdirSync(out).length
writeFileSync(join(dest, 'SUMMARY.json'), JSON.stringify(summary, null, 2))

console.log(`[snapshot] → evidence/${stamp}`, summary)
