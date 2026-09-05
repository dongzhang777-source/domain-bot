#!/usr/bin/env node
/**
 * 事件聚类判据复算脚本（`npm run probe:events`）。
 *
 * 存在理由：DB-03 §3.2 提议的「标题 jaccard > 0.75 判同事件」是**纸面推理**，
 * 实测在真实数据上命中 0 条。任何人将来再提阈值方案，跑本脚本即可自行证伪，
 * 不用信任何报告的结论。
 *
 * 数据全部取自 docs/tasks/TASK-DB-03-quality-audit-done.md §1.3 的真实标题：
 *   - GPT-6 Astra 同一事件 10 条（#58/#84/#85/#86/#122/#123/#124/#153/#156/#181）
 *   - K2 Horizon 同一事件 5 条（#32/#33/#103/#144/#191）
 *   - 3 条独立事件干扰项（误并检验）
 *
 * 停用词表读 config/gates.json（与生产同源），不用内联副本。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = process.cwd()
const { tokenize, jaccard } = require(join(root, 'dist/collector/dedupe.js'))
const { clusterByEntity, entityTokens } = require(join(root, 'dist/gates/eventCluster.js'))

const gates = JSON.parse(readFileSync(join(root, 'config/gates.json'), 'utf8'))
const STOP = new Set(gates.dedupe.eventStopwords)

const ASTRA = [
  'ChatGPT overtakes all rivals with new Astra model, OpenAI says',
  'OpenAI launches GPT-6 Astra, the AI model built to do more than chat',
  "OpenAI's next big AI model has 'entered the AGI era' | The Verge",
  "OpenAI Says GPT-6 Astra Is 'The Most Intelligent And Aligned' Model",
  'OpenAI unveils GPT-6 Astra amid rising scrutiny and safety concerns',
  'OpenAI launches Astra, its powerful (and controversial) new AI model',
  "OpenAI hails 'new era of artificial general intelligence' with Astra",
  'OpenAI launches new Astra model amid growing scrutiny over agent safety',
  'GPT-6 Astra横空出世，全网彻底炸锅了！',
  'GPT-6 Astra 来了，全网38个“神级”案例一次看完！',
]
const DISTRACTORS = [
  'KC-Bench: A Dynamic Interactive Benchmark for Evaluating Knowledge Conflict',
  'FlashInfer: high-performance LLM serving kernels released',
  'Microsoft Agent Framework Overview for enterprise orchestration',
]
const K2 = [
  'K2 Horizon Press Release | Institute of Foundation Models',
  'MBZUAI Launches K2 Horizon Fleet of Fully Open AI Models - ITP.net',
  "Institute of Foundation Models Launches the Industry's Largest Open Model",
  'Introducing K2 Horizon: Frontier Performance, Radically Open',
  "MBZUAI's Institute of Foundation Models launches K2 Horizon, an open model",
]

const toProbe = (titles) => titles.map((title, i) => ({ id: `t${i}`, title }))

function jaccardReport(name, titles) {
  const toks = titles.map(tokenize)
  let pairs = 0
  let max = 0
  let hit75 = 0
  let hit50 = 0
  const all = []
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j < toks.length; j++) {
      const v = jaccard(toks[i], toks[j])
      all.push(v)
      pairs++
      if (v > max) max = v
      if (v >= 0.75) hit75++
      if (v >= 0.5) hit50++
    }
  }
  all.sort((a, b) => a - b)
  console.log(`\n[jaccard] ${name}（${titles.length} 条同事件）`)
  console.log(`  配对数=${pairs}  最大=${max.toFixed(3)}  中位=${all[Math.floor(all.length / 2)].toFixed(3)}`)
  console.log(`  ≥0.75 命中=${hit75}   ≥0.50 命中=${hit50}`)
  console.log(`  → DB-03 §3.2 的门禁 3 阈值(0.75)在本组数据上命中 ${hit75} 条`)
}

function entityReport(name, titles, distractors = []) {
  const items = [...toProbe(titles), ...distractors.map((t, i) => ({ id: `d${i}`, title: t }))]
  const clusters = clusterByEntity(items, STOP)
  const biggest = clusters.reduce((m, c) => (c.items.length > m.items.length ? c : m), clusters[0])
  console.log(`\n[实体词并查集] ${name}`)
  console.log(`  聚成 ${clusters.length} 簇；最大簇 ${biggest.items.length} 条（占同事件 ${titles.length} 条的 ${((biggest.items.length / titles.length) * 100).toFixed(0)}%）`)
  clusters.forEach((c, i) => {
    const tag = c.items.every((x) => x.id.startsWith('d')) ? '干扰项(应独立)' : ''
    console.log(`   簇${i} (${c.items.length}条) ${tag}`)
    for (const it of c.items) console.log(`      - ${it.title.slice(0, 68)}`)
  })
  const merged = clusters.filter((c) => c.items.some((x) => x.id.startsWith('d')) && c.items.some((x) => !x.id.startsWith('d')))
  console.log(`  误并（干扰项被并进同事件簇）：${merged.length} 簇 ${merged.length === 0 ? '✓' : '✗ 需补 eventStopwords'}`)
  // 打印每条的实体集，便于诊断为什么没聚上
  console.log('  实体集：')
  for (const it of items) console.log(`   ${it.id}: {${[...entityTokens(it.title, STOP)].join(', ')}}`)
}

console.log('═'.repeat(72))
console.log('事件聚类判据复算（数据源：DB-03 审计报告 §1.3 真实标题）')
console.log(`eventStopwords 词表大小：${STOP.size}`)
console.log('═'.repeat(72))

jaccardReport('GPT-6 Astra 刷屏', ASTRA)
jaccardReport('K2 Horizon 刷屏', K2)
entityReport('GPT-6 Astra 10 条 + 3 条干扰项', ASTRA, DISTRACTORS)
entityReport('K2 Horizon 5 条', K2)

console.log('\n' + '═'.repeat(72))
console.log('结论：jaccard 阈值方案在真实洗稿标题上命中 0 条；实体词并查集可聚拢绝大部分，')
console.log('剩余漏网（如 The Verge 那条不含 "Astra" 的标题）归 DB-05 的 LLM 语义事件归并。')
console.log('═'.repeat(72))
