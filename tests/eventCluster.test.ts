import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clusterByEntity, entityTokens, eventKeyMap } from '../src/gates/eventCluster.js'
import { jaccard, tokenize } from '../src/collector/dedupe.js'
import type { GatesConfig } from '../src/types.js'

/**
 * 实体词事件聚类的召回/误并测试。
 *
 * **夹具全部取自 DB-03 审计报告 §1.3 的真实标题**（docs/tasks/TASK-DB-03-quality-audit-done.md），
 * 不用合成玩具串——聚类要解决的就是那批真实刷屏，拿玩具串测等于没测。
 *
 * **停用词表直接读 config/gates.json**，不用内联副本：这样任何人削弱词表导致召回退化，
 * 本文件立刻打红。工单要求「扩充 eventStopwords 后必须重跑验证」由此自动化。
 */

const gates = JSON.parse(
  readFileSync(join(process.cwd(), 'config/gates.json'), 'utf8'),
) as GatesConfig
const STOP = new Set(gates.dedupe.eventStopwords)

interface Probe {
  id: string
  title: string
}
const p = (id: string, title: string): Probe => ({ id, title })

/** DB-03 #58/#84/#85/#86/#122/#123/#124/#153/#156/#181：GPT-6 Astra 同一事件的 10 条真实报道 */
const ASTRA: Probe[] = [
  p('a1', 'ChatGPT overtakes all rivals with new Astra model, OpenAI says'),
  p('a2', 'OpenAI launches GPT-6 Astra, the AI model built to do more than chat'),
  p('a3', "OpenAI's next big AI model has 'entered the AGI era' | The Verge"),
  p('a4', "OpenAI Says GPT-6 Astra Is 'The Most Intelligent And Aligned' Model"),
  p('a5', 'OpenAI unveils GPT-6 Astra amid rising scrutiny and safety concerns'),
  p('a6', 'OpenAI launches Astra, its powerful (and controversial) new AI model'),
  p('a7', "OpenAI hails 'new era of artificial general intelligence' with Astra"),
  p('a8', 'OpenAI launches new Astra model amid growing scrutiny over agent safety'),
  p('a9', 'GPT-6 Astra横空出世，全网彻底炸锅了！'),
  p('a10', 'GPT-6 Astra 来了，全网38个“神级”案例一次看完！'),
]

/** 三条独立事件，不得被并进 Astra 簇（误并检验） */
const DISTRACTORS: Probe[] = [
  p('d1', 'KC-Bench: A Dynamic Interactive Benchmark for Evaluating Knowledge Conflict'),
  p('d2', 'FlashInfer: high-performance LLM serving kernels released'),
  p('d3', 'Microsoft Agent Framework Overview for enterprise orchestration'),
]

/** DB-03 #32/#33/#103/#144/#191：K2 Horizon 同一事件的 5 条真实报道 */
const K2: Probe[] = [
  p('k1', 'K2 Horizon Press Release | Institute of Foundation Models'),
  p('k2', 'MBZUAI Launches K2 Horizon Fleet of Fully Open AI Models - ITP.net'),
  p('k3', "Institute of Foundation Models Launches the Industry's Largest Open Model"),
  p('k4', 'Introducing K2 Horizon: Frontier Performance, Radically Open'),
  p('k5', "MBZUAI's Institute of Foundation Models launches K2 Horizon, an open model"),
]

function largestCluster(items: Probe[]) {
  const clusters = clusterByEntity(items, STOP)
  return clusters.reduce((max, c) => (c.items.length > max.items.length ? c : max), clusters[0]!)
}

describe('entityTokens', () => {
  it('剔除停用词与过短 token，保留真实实体', () => {
    const t = entityTokens('OpenAI launches GPT-6 Astra model amid scrutiny', STOP)
    expect(t.has('astra')).toBe(true)
    expect(t.has('openai')).toBe(false) // 停用词
    expect(t.has('model')).toBe(false) // 停用词
    expect(t.has('launches')).toBe(false) // 停用词
    expect(t.has('gpt')).toBe(false) // 停用词
  })

  it('中文标题经 tokenize 的 CJK 2-gram 得到可匹配实体（复用而非重写分词）', () => {
    const t = entityTokens('GPT-6 Astra横空出世，全网彻底炸锅了！', STOP)
    expect(t.size).toBeGreaterThan(0)
    expect(t.has('astra')).toBe(true)
  })

  it('全是停用词的标题得到空实体集（不参与合并，自成一体）', () => {
    expect(entityTokens('OpenAI new model for AI', STOP).size).toBe(0)
  })
})

describe('clusterByEntity：召回（真实刷屏必须聚拢）', () => {
  it('Astra 10 条 + 3 条干扰项：最大簇 ≥8 条，且含全部带 "Astra" 字样的标题', () => {
    const all = [...ASTRA, ...DISTRACTORS]
    const big = largestCluster(all)
    // 实测 8/10 聚成一簇（漏网 2 条：a3 The Verge 不含 Astra、a9 中文标题实体不共享）
    expect(big.items.length).toBeGreaterThanOrEqual(8)
    const ids = new Set(big.items.map((i) => i.id))
    for (const withAstra of ['a1', 'a2', 'a4', 'a5', 'a6', 'a7', 'a8', 'a10']) {
      expect(ids.has(withAstra), `${withAstra} 应在主簇内`).toBe(true)
    }
  })

  it('3 条独立事件干扰项零误并：各自独立成簇', () => {
    const all = [...ASTRA, ...DISTRACTORS]
    const clusters = clusterByEntity(all, STOP)
    for (const d of DISTRACTORS) {
      const home = clusters.find((c) => c.items.some((i) => i.id === d.id))!
      expect(home.items.filter((i) => i.id.startsWith('d')), `${d.id} 所在簇不得含其他干扰项`).toHaveLength(1)
      expect(home.items.some((i) => i.id.startsWith('a')), `${d.id} 不得被并进 Astra 簇`).toBe(false)
    }
  })

  it('K2 Horizon 5 条聚成 1 簇（含那条不含 "Horizon" 的 #103）', () => {
    const clusters = clusterByEntity(K2, STOP)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].items.map((i) => i.id).sort()).toEqual(['k1', 'k2', 'k3', 'k4', 'k5'])
  })

  it('只共享停用词的不同事件不得被并到一起（误并的根防线）', () => {
    const pair = [
      p('x1', 'OpenAI releases new model for developers'),
      p('x2', 'OpenAI releases new model for researchers'),
    ]
    // 两条的全部实词都是停用词 → 实体集为空 → 各自独立成簇
    expect(clusterByEntity(pair, STOP)).toHaveLength(2)
  })

  it('空输入返回空数组，不抛错', () => {
    expect(clusterByEntity([], STOP)).toEqual([])
  })
})

describe('clusterByEntity：对照 jaccard（证明换判据是必要的）', () => {
  it('Astra 10 条真实标题的最大 jaccard 远低于 0.75——旧门禁 3 命中 0 条', () => {
    // 这条不是测实现，是把「为什么不能用 jaccard」的实测事实钉在测试里。
    // 删掉它，后续会话就会有人再把阈值方案提回来。
    let max = 0
    let hit75 = 0
    let hit50 = 0
    let pairs = 0
    const toks = ASTRA.map((a) => tokenize(a.title))
    for (let i = 0; i < toks.length; i++) {
      for (let j = i + 1; j < toks.length; j++) {
        const v = jaccard(toks[i]!, toks[j]!)
        pairs++
        if (v > max) max = v
        if (v >= 0.75) hit75++
        if (v >= 0.5) hit50++
      }
    }
    expect(pairs).toBe(45)
    expect(max).toBeLessThan(0.4) // 实测 0.313
    expect(hit75).toBe(0) // 实测 0：agy 方案的阈值一条也命中不了
    expect(hit50).toBe(0) // 实测 0：降到 0.50 也没用
  })

  it('K2 Horizon 5 条同样：≥0.75 命中 0', () => {
    const toks = K2.map((k) => tokenize(k.title))
    let hit75 = 0
    for (let i = 0; i < toks.length; i++) {
      for (let j = i + 1; j < toks.length; j++) {
        if (jaccard(toks[i]!, toks[j]!) >= 0.75) hit75++
      }
    }
    expect(hit75).toBe(0)
  })
})

describe('eventKeyMap', () => {
  it('为每条输入给出簇标识，同簇相等、异簇不等', () => {
    const m = eventKeyMap([...ASTRA, ...DISTRACTORS], STOP)
    expect(m.size).toBe(ASTRA.length + DISTRACTORS.length)
    expect(m.get('a1')).toBe(m.get('a2'))
    expect(m.get('d1')).not.toBe(m.get('a1'))
    expect(m.get('d1')).not.toBe(m.get('d2'))
  })

  it('簇标识取自簇内某个成员 id（可回溯，不是随机串）', () => {
    const all = [...ASTRA, ...DISTRACTORS]
    const m = eventKeyMap(all, STOP)
    const ids = new Set(all.map((a) => a.id))
    for (const key of m.values()) expect(ids.has(key)).toBe(true)
  })
})

/**
 * DB-12/D7：newsline 同一事件 6 变体未合并的诊断与修复。
 *
 * 标题**逐字取自** outbox/tuna/feed-pack-newsline-newslinemtobsx4p.json（DB-11 §D7 点名的
 * 「OpenAI agents 劫持德国 wiki」事件，2026-09-05 轮主材）。
 *
 * 诊断结论（先复现再动手）：聚类判据本身能聚拢这批变体——5/6 词级不同、实体相同的
 * 变体本就聚成一簇。真正把两个**独立事件**缝成一簇的边是转载渠道名：
 * `… - IBTimes India`（Astra 事件）与 `… - India Today`（wiki 事件）共享实体词 `india`，
 * 并查集经它把 GPT-6 Astra 与德国 wiki 劫持缝成一簇（修复前 9 条跨两事件一簇）。
 * outlet 名同样是专有名词，capitalizedTokens 的大小写信号区分不了「事件标识」与「来源词汇」。
 */
describe('DB-12/D7：newsline 同事件变体的真实洗稿形态', () => {
  const WIKI = [
    p('w1', 'Thousands of OpenAI Agents Quietly Turned an Abandoned Wiki Into Their Coordination Channel'),
    p('w2', 'Rogue OpenAI agents go crazy, hijack German site to use as message board, report says - India Today'),
    p('w3', 'Researchers Document OpenAI Agent Swarm That Repurposed German Wiki – Unite.AI'),
    p('w4', 'OpenAI agents secretly hijacked a German wiki for two months to swap tips on evading rules - Startup Fortune'),
    p('w5', 'Inside the OpenAI Swarm Crisis That Proved Safety Guardrails — Ipan'),
    // 词级差异过大、实体只剩一个的变体：词法上孤立（与 The Verge 那条 Astra 同类，归 LLM reviewer 语义归并）
    p('w6', 'Discovery of a new OpenAI agent message board'),
  ]
  // 同一轮主材里的另一个独立事件：GPT-6 Astra。修复前它经 `india` 被缝进 wiki 簇
  const ASTRA_REAL = [
    p('s1', 'GPT-6 Astra Goes Live: AGI Claim Fails OpenAI Own Bar, Monitoring Called Fragile'),
    p('s2', 'OpenAI launches GPT-6 Astra, the AI model built to do more than answer questions - IBTimes India'),
    p('s3', 'OpenAI launches new Astra model amid growing scrutiny over agents safety | Reuters'),
    p('s4', 'GPT-6 Astra on OpenRouter'),
  ]

  const homeOf = (items: Probe[], id: string) => clusterByEntity(items, STOP).find((c) => c.items.some((i) => i.id === id))!

  it('词级不同、实体相同的同事件变体聚成一簇（5/6）', () => {
    const home = homeOf(WIKI, 'w1')
    const ids = new Set(home.items.map((i) => i.id))
    for (const id of ['w1', 'w2', 'w3', 'w4', 'w5']) {
      expect(ids.has(id), `${id} 应在 wiki 事件簇内`).toBe(true)
    }
  })

  it('转载渠道名后缀不再是事件实体：两个独立事件不得被缝成一簇（修复前经 india 误并）', () => {
    const all = [...WIKI, ...ASTRA_REAL]
    const wikiHome = homeOf(all, 'w1')
    for (const a of ASTRA_REAL) {
      expect(wikiHome.items.some((i) => i.id === a.id), `Astra 条目 ${a.id} 被误并进 wiki 簇`).toBe(false)
    }
    expect(homeOf(all, 's1').items.map((i) => i.id).sort()).toEqual(['s1', 's2', 's3', 's4'])
    // 连接边本身被拆除：`india` 不再是事件实体
    expect(
      entityTokens('OpenAI launches GPT-6 Astra, the AI model built to do more than answer questions - IBTimes India', STOP).has('india'),
    ).toBe(false)
  })

  it('守门：剥完后缀若一个实体都不剩，退回原标题抽词（不让条目失去聚类资格）', () => {
    // 剥掉 " - Cloudflare" 后只剩小写词 → 实体集为空 → 必须回退，否则该条目永不参与合并
    const t = entityTokens('outage hits global services - Cloudflare', STOP)
    expect(t.size).toBeGreaterThan(0)
    expect(t.has('cloudflare')).toBe(true)
  })
})
