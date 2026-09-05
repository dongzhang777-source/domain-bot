import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPipeline, type PipelineOptions } from '../src/pipeline.js'
import { canonicalUrl } from '../src/collector/canonicalUrl.js'
import { appendFingerprints, loadFingerprints } from '../src/publish/pack.js'
import type { DomainConfig, GatesConfig, PersonaConfig, SourceConfig } from '../src/types.js'

/**
 * 端到端：采集 → 精确去重 → 四层闸门 → 打分 → 事件聚合 → 截断 → 主编终审 → 归档观测。
 *
 * 旧版本文件测的是 `runOnce`（每日 6 条摘要 + 每源均摊配额 + Telegram 反馈回路），
 * 已随老张 2026-09-04 裁决退役。本文件改测 `runPipeline`。
 *
 * **一处前提被本次改造反转，注意不要照旧断言**：旧用例「每源配额：单一密集源不得霸占
 * 全部推送位」的前提是均摊配额，而 DB-03 §2.2 已定性「每渠道 ≥N 条」的均摊指标是
 * 「应付差事」的头号制度根因（为凑数把 V2EX 水帖、B 站卖课、YouTube 通识科普全盘收割）。
 * 新产线**不设每源下限也不设每源上限**，故对应用例改写为断言相反行为（见下）。
 */

const RSS_XML = `<?xml version="1.0"?><rss><channel>
  <item><title>New LLM inference benchmark released by the lab</title><description>open source release, outperform SOTA on transformer serving</description><link>https://e.com/1</link></item>
  <item><title>Another LLM inference benchmark released today</title><description>open source release, outperform SOTA on transformer serving</description><link>https://e.com/2</link></item>
  <item><title>chocolate cake recipe for beginners</title><description>delicious and easy</description><link>https://e.com/3</link></item>
</channel></rss>`

const GH_JSON = JSON.stringify({
  items: [
    {
      id: 7,
      full_name: 'foo/llm-kit',
      description: 'local LLM inference toolkit with transformer serving benchmarks',
      html_url: 'https://github.com/foo/llm-kit',
      // 必须落在 newsline 的 72h 时效窗内（now = 2026-09-04T12:00Z）。
      // 旧值 2026-08-30 距今 120h，会被 persona 时效闸拦下 → 不入候选 → 不入归档，
      // 干扰「跨轮次精确去重」用例的读数（该用例首轮实测就是因此失败）。
      created_at: '2026-09-04T00:00:00Z',
      stargazers_count: 50,
      topics: ['llm'],
    },
  ],
})

function mockFetch() {
  return async (url: string) => ({
    ok: true,
    status: 200,
    text: async () => (String(url).includes('api.github.com') ? GH_JSON : RSS_XML),
  })
}

const domain: DomainConfig = {
  domain: 'ai-llm',
  keywords: ['llm', 'inference'],
  clusterThreshold: 0.35,
}

const gates: GatesConfig = {
  minTitleChars: 15,
  minPoints: 3,
  strongAiWords: ['llm', 'transformer'],
  keywordTiers: [
    { tier: 'core', points: 3, words: ['llm', 'inference', 'transformer', 'benchmark', 'serving'] },
    { tier: 'ecosystem', points: 1, words: ['open source', 'release', 'sota', 'outperform'] },
    { tier: 'generic', points: 0, words: ['ai', 'model', 'tool'] },
  ],
  blacklist: [
    { id: 'ad:course', group: 'adRecruit', pattern: '零基础|for beginners', scope: 'title' },
    { id: 'damaged:objectObject', group: 'damaged', pattern: '\\[object Object\\]', scope: 'both' },
  ],
  dedupe: {
    jaccardThreshold: 0.75,
    maxPerEvent: 2,
    eventStopwords: ['new', 'another', 'released', 'today', 'the', 'by', 'lab', 'for', 'with', 'open', 'source'],
  },
}

const sources: SourceConfig[] = [
  { id: 'rss-1', type: 'rss', url: 'http://e/rss', weight: 0.5, enabled: true },
  { id: 'gh-1', type: 'github', url: 'https://api.github.com/search/x', weight: 0.5, enabled: true },
  // 不在 persona 白名单里：双产线彻底分离时该源不得被采集
  { id: 'excluded-1', type: 'rss', url: 'http://e/other', weight: 0.5, enabled: true },
]

function persona(overrides: Partial<PersonaConfig> = {}): PersonaConfig {
  return {
    id: 'newsline',
    displayName: 'AI时事快线',
    domain: 'ai-llm',
    sources: ['rss-1', 'gh-1'],
    maxAgeHours: 72,
    maxItems: 80,
    minQualityScore: 6,
    clusterThreshold: 0.35,
    rejectRules: [],
    ...overrides,
  }
}

function opts(dir: string, overrides: Partial<PipelineOptions> = {}): PipelineOptions {
  return {
    persona: persona(),
    gates,
    domain,
    sources,
    memoryDir: join(dir, 'memory'),
    fetchFn: mockFetch(),
    now: Date.parse('2026-09-04T12:00:00Z'),
    ...overrides,
  }
}

const canonicalOf = (url: string): string => canonicalUrl(url)

describe('e2e: 采集 → 闸门 → 事件聚合 → 主编终审 → 归档观测', () => {
  it('第一轮：噪音被闸门拦掉、漏斗逐层可对账、产出落归档', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-e2e-'))
    const r = await runPipeline(opts(dir))

    // 3 条 rss + 1 条 github = 4；excluded-1 不在白名单，未被采集
    expect(r.funnel.find((f) => f.stage === 'collected')!.count).toBe(4)
    // 蛋糕食谱被拦：既命中 relevance 积分不足，也命中 ad:course（"for beginners"）
    expect(r.published.every((p) => !/chocolate|cake/i.test(p.title))).toBe(true)
    expect(r.dropped.length).toBeGreaterThan(0)
    expect(r.dropped.every((d) => d.gate && d.ruleId && d.reason.length > 0)).toBe(true)

    // 漏斗单调不增且末层等于实际发布数
    for (let i = 1; i < r.funnel.length; i++) {
      expect(r.funnel[i]!.count).toBeLessThanOrEqual(r.funnel[i - 1]!.count)
    }
    expect(r.funnel[r.funnel.length - 1]!.count).toBe(r.published.length)

    // 归档口径是全量候选（解传送带），不是发布条目
    const mem = JSON.parse(readFileSync(join(dir, 'memory', 'archive.json'), 'utf8')) as {
      entries: Array<{ id: string; pushed: boolean; source: string }>
    }
    expect(mem.entries.length).toBe(r.candidates.length)
    expect(mem.entries.filter((e) => e.pushed).length).toBe(r.published.length)
    expect(mem.entries.some((e) => e.source === 'rss-1')).toBe(true)
  })

  it('第二轮：同内容不再重复产出（跨轮次精确去重）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-e2e2-'))
    const o = opts(dir)
    const r1 = await runPipeline(o)
    expect(r1.published.length).toBeGreaterThan(0)
    const r2 = await runPipeline({ ...o, now: o.now! + 1000 })
    expect(r2.published).toHaveLength(0)
    // 注意：afterDedupe **不为 0**。归档口径是「过闸门后的候选」（解传送带纪律），
    // 被闸门拦掉的垃圾不入归档 → 下一轮会重新进闸门被重新拦一次。
    // 这是正确行为：闸门判定确定性且便宜，重复判定无成本；
    // 若把垃圾也归档，反而会让「源水质变差」在观测上不可见。
    expect(r2.funnel.find((f) => f.stage === 'afterGates')!.count).toBe(0)
    // 蛋糕食谱被闸门拦、未入归档，故下一轮仍会进 dedupe 后被重新拦一次
    expect(r2.funnel.find((f) => f.stage === 'afterDedupe')!.count).toBe(1)
  })

  it('persona 白名单外的源不被采集（双产线彻底分离的载体）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-e2e3-'))
    const r = await runPipeline(opts(dir))
    expect(r.skippedSources).not.toContain('excluded-1') // 未采集 ≠ 采集失败，不得混入 skipped
    expect(r.candidates.every((c) => c.source !== 'excluded-1')).toBe(true)
  })

  it('聚类先于配额：同事件 8 条 + 独立 2 条，maxItems=4 时同事件最多占 maxPerEvent 个坑', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-e2e4-'))
    // 8 条同事件（共享实体 astra）+ 2 条独立事件。
    // 标题必须在**词级**上有差异：旧版夹具只差一个数字，而 tokenize 会滤掉单字符 token
    // → 8 条标题 token 集完全相同 → jaccard=1.0 全被判 verbatimRepost（只留 1 条），
    // 测不到 maxPerEvent=2 这条路径。真实洗稿标题就是词级不同、实体相同。
    const astraTitles = [
      'OpenAI Astra rollout continues across european regions',
      'OpenAI Astra rollout expands into asian markets',
      'OpenAI Astra rollout reaches enterprise customers',
      'OpenAI Astra rollout hits developer preview stage',
      'OpenAI Astra rollout faces regulatory questions',
      'OpenAI Astra rollout praised by industry analysts',
      'OpenAI Astra rollout compared against rival systems',
      'OpenAI Astra rollout documented in technical report',
    ]
    const flood = `<?xml version="1.0"?><rss><channel>${astraTitles
      .map(
        (t, i) =>
          `<item><title>${t}</title><description>llm inference benchmark transformer serving dispatch ${i}</description><link>https://e.com/a${i}</link></item>`,
      )
      .join('')}${[
      // 两条独立事件：标题必须含至少一个 core 词，否则会被门禁2 的标题加权规则
      // 正确拦下（仅正文命中 core 词只得 1 分/词），那不是本用例要测的东西
      '<item><title>FlashInfer kernels speed up transformer serving dramatically</title><description>llm inference benchmark open source release</description><link>https://e.com/f1</link></item>',
      '<item><title>KC-Bench: a benchmark for knowledge conflict in LLM reasoning</title><description>llm benchmark evaluation dataset release</description><link>https://e.com/k1</link></item>',
    ].join('')}</channel></rss>`
    const fetchFn = async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => (String(url).includes('api.github.com') ? JSON.stringify({ items: [] }) : flood),
    })

    const r = await runPipeline(opts(dir, { persona: persona({ maxItems: 4 }), fetchFn }))
    // 旧管线（先截断后聚类）会让 8 条 Astra 吃满全部 4 个坑；
    // 新管线聚合在前，同事件最多占 maxPerEvent=2 个坑，独立事件必然入选。
    const astraCount = r.published.filter((p) => /astra/i.test(p.title)).length
    expect(astraCount).toBe(gates.dedupe.maxPerEvent)
    expect(r.published.some((p) => /flashinfer/i.test(p.title))).toBe(true)
    expect(r.published.some((p) => /kc-bench/i.test(p.title))).toBe(true)
    expect(r.published).toHaveLength(4)
    // 8 条同事件里超额的 6 条是**降权**（排在 kept 之后被 maxItems 截掉），不是丢弃。
    // 事件聚合不产生 DropRecord：词法聚类判别不可靠，丢弃会静默摧毁内容。
    expect(r.dropped.filter((d) => d.ruleId.startsWith('fingerprint:event'))).toHaveLength(0)
    expect(r.board.eventDemoted).toBeGreaterThan(0)
    // 降权的条目仍进了归档（下一轮 dedupe 能屏蔽），没有凭空消失
    expect(r.candidates.length).toBe(10)
  })

  it('废除均摊：单一高质量源可以占满 maxItems，不设每源上限', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-e2e5-'))
    // rss 出 6 条互不相同事件的高质量内容，github 出 0 条
    const many = `<?xml version="1.0"?><rss><channel>${[
      'FlashInfer kernels accelerate transformer serving',
      'KC-Bench probes knowledge conflict in reasoning',
      'MemHop embeds long term memory for agents',
      'TensorRT guide optimizes gpu operator fusion',
      'VoxPrivacy evaluates speech model privacy leaks',
      'TAP-Path prunes tokens for pathology models',
    ]
      .map(
        (t, i) =>
          `<item><title>${t}</title><description>llm inference benchmark transformer serving open source variant ${i}</description><link>https://e.com/m${i}</link></item>`,
      )
      .join('')}</channel></rss>`
    const fetchFn = async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => (String(url).includes('api.github.com') ? JSON.stringify({ items: [] }) : many),
    })

    const r = await runPipeline(opts(dir, { persona: persona({ maxItems: 4 }), fetchFn }))
    // 旧管线的 perSourceCap = ceil(6/2) = 3 会把 rss 压到 3 条；新产线不设每源上限。
    // 夹具里 6 条标题彼此无共享实体词（故意不写 "report N" 这类共同词，
    // 否则实体词聚类会把它们当成同一事件而只留 maxPerEvent=2 条，测不出均摊废除）。
    expect(r.published.filter((p) => p.source === 'rss-1').length).toBe(4)
    // github 零产出不得报错，只在看板里记为 emptyYield/zeroYield
    expect(r.board.perSourcePublished['gh-1'] ?? 0).toBe(0)
  })

  it('minPoints 真的生效：调高门槛必须清空产出', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-e2e6-'))
    const loose = await runPipeline(opts(dir, { gates: { ...gates, minPoints: 3 } }))
    const strictDir = mkdtempSync(join(tmpdir(), 'dbot-e2e7-'))
    // 门槛高到任何条目都够不着：只有 core 词能贡献分数，全部 core 词删掉即恒 0 分
    const strict = await runPipeline(
      opts(strictDir, {
        gates: { ...gates, minPoints: 99, keywordTiers: gates.keywordTiers.map((t) => ({ ...t, words: [] })) },
      }),
    )
    expect(loose.published.length).toBeGreaterThan(0)
    expect(strict.published).toHaveLength(0)
    expect(strict.funnel.find((f) => f.stage === 'afterGates')!.count).toBe(0)
  })

  it('过滤用原始分：权重被压到 0 的源仍留在候选池（防反馈死锁）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-e2e8-'))
    const lopsided: SourceConfig[] = [
      { id: 'rss-1', type: 'rss', url: 'http://e/rss', weight: 0, enabled: true },
      { id: 'gh-1', type: 'github', url: 'https://api.github.com/search/x', weight: 0.9, enabled: true },
    ]
    const r = await runPipeline(opts(dir, { sources: lopsided }))
    // 源权重只影响排序，不得把低权源整体挡在候选池外，
    // 否则它永远进不了产出 → 永远拿不到反馈 → 权重再也回不来。
    const mem = JSON.parse(readFileSync(join(dir, 'memory', 'archive.json'), 'utf8')) as {
      entries: Array<{ source: string }>
    }
    expect(mem.entries.some((e) => e.source === 'rss-1')).toBe(true)
    expect(r.candidates.some((c) => c.source === 'rss-1')).toBe(true)
  })

  it('采集失败的源必须出现在 skippedSources（否则该观测字段恒为空）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-e2e9-'))
    const fetchFn = async (url: string) =>
      String(url).includes('api.github.com')
        ? { ok: true, status: 200, text: async () => GH_JSON }
        : { ok: false, status: 503, text: async () => '' }
    const r = await runPipeline(opts(dir, { fetchFn }))
    expect(r.skippedSources).toEqual(['rss-1'])
    expect(r.board.skippedSources).toEqual(['rss-1'])
  })

  it('跨产线指纹库共享：先跑的产线发布过的 URL，后跑的必须否决', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-e2e10-'))
    const memoryDir = join(dir, 'memory')
    const first = await runPipeline(opts(dir))
    expect(first.published.length).toBeGreaterThan(0)
    appendFingerprints(memoryDir, first.published)

    const fingerprints = loadFingerprints(memoryDir)
    expect(fingerprints.size).toBeGreaterThan(0)

    // 换一个 memoryDir（避免跨轮次 id 去重先生效），只靠指纹库拦
    const dir2 = mkdtempSync(join(tmpdir(), 'dbot-e2e11-'))
    const second = await runPipeline(opts(dir2, { knownCanonical: fingerprints }))
    // 注意：不得断言 published 为空。maxPerEvent=2 使同簇 3 条只发 2 条，
    // 未发布那条不在指纹库里，第二轮仍会入选——这是正确行为（指纹库只记「已发布」）。
    // 该断言的是：**凡在指纹库里的 URL，绝不得再次出现在产出中**。
    for (const p of second.published) {
      expect(fingerprints.has(canonicalOf(p.url)), `已发布过的 URL 又出现了：${p.url}`).toBe(false)
    }
    // 指纹库命中发生在**门禁 3**（进不了候选池），不是主编终审层——
    // 两者 ruleId 相似但 gate 不同，断言必须指对层，否则测不到真正的拦截点。
    expect(second.dropped.some((d) => d.gate === 'fingerprint' && d.ruleId === 'fingerprint:alreadyPublished')).toBe(true)
    expect(second.dropped.filter((d) => d.ruleId === 'fingerprint:alreadyPublished')).toHaveLength(first.published.length)
  })

  it('观测落盘：observations.jsonl 每轮追加一条，含 skippedSources 与 zeroYieldSources', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-e2e12-'))
    await runPipeline(opts(dir))
    const obsPath = join(dir, 'memory', 'observations.jsonl')
    expect(existsSync(obsPath)).toBe(true)
    const lines = readFileSync(obsPath, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const obs = JSON.parse(lines[0]!) as { collected: number; skippedSources: string[]; enabledSourceIds: string[] }
    expect(obs.collected).toBe(4)
    expect(Array.isArray(obs.skippedSources)).toBe(true)
    expect(obs.enabledSourceIds).toContain('rss-1')
  })

  it('质量看板明写 selfEvolutionActive=false（Telegram 退役后自进化无信号流入）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-e2e13-'))
    const r = await runPipeline(opts(dir))
    // 这条不是形式主义：看板若不明写，读者会以为 interest/weights 在跑。
    // 实测 memory/weights.json 早已是空的 {"weights":{}}，而文档一直宣称「自进化」。
    expect(r.board.selfEvolutionActive).toBe(false)
    expect(r.board.selfEvolutionNote).toContain('Telegram')
    expect(r.board.schema).toBe('domain-bot-quality-board-v1')
  })
})
