import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ingestTunaSignals, parsePostId, TUNA_SIGNALS_SCHEMA } from '../src/ingest/tuna-signals.js'
import { runPipeline } from '../src/pipeline.js'
import { buildBoard } from '../src/gatekeeper/board.js'
import { formatSyncReport, planSync, syncPack, TUNA_BUILTIN_PACK_REL } from '../src/publish/sync-tuna.js'
import { buildPack } from '../src/publish/pack.js'
import { MemoryStore } from '../src/memory/store.js'
import { interestOf, loadState } from '../src/memory/interest.js'
import type { DomainConfig, GatesConfig, PersonaConfig, SourceConfig } from '../src/types.js'

/**
 * tuna 行为回流接收端 + 发布同步。
 *
 * 这一环是老张 2026-09-04 裁决 5（砍 Telegram，新建 tuna 行为回流通道）的落地：
 * `views.json` / `engagements.json` 的原唯一写入方 `src/feedback/receiver.ts` 已删，
 * 不建接收端则 `interest.ts` 的 Beta 后验与 `weights.ts` 的源权重学习永久停摆
 * （实测 `memory/weights.json` 早已是空的 `{"weights":{}}`，而文档一直宣称「自进化」）。
 */

const gates = JSON.parse(readFileSync(join(process.cwd(), 'config/gates.json'), 'utf8')) as GatesConfig

const domain: DomainConfig = { domain: 'ai-llm', keywords: ['llm'], clusterThreshold: 0.35 }
const sources: SourceConfig[] = [
  { id: 'rss-1', type: 'rss', url: 'http://e/rss', weight: 0.5, enabled: true },
  { id: 'rss-2', type: 'rss', url: 'http://e/rss2', weight: 0.5, enabled: true },
]
const persona: PersonaConfig = {
  id: 'newsline',
  displayName: 'AI时事快线',
  domain: 'ai-llm',
  sources: ['rss-1', 'rss-2'],
  maxAgeHours: 72,
  maxItems: 10,
  minQualityScore: 6,
  clusterThreshold: 0.35,
  rejectRules: [],
}

/** 两个源各出 2 条互不相关的内容，便于验证权重按源分化。 */
function feedFor(url: string, sourceTag: string) {
  return `<?xml version="1.0"?><rss><channel>
  <item><title>${sourceTag} alpha LLM inference benchmark released</title><description>llm inference benchmark transformer serving open source release outperform</description><link>${url}/1</link></item>
  <item><title>${sourceTag} beta LLM serving quantization study</title><description>llm inference quantization transformer benchmark open source release</description><link>${url}/2</link></item>
</channel></rss>`
}

function mockFetch() {
  return async (url: string) => ({
    ok: true,
    status: 200,
    text: async () => (String(url).includes('rss2') ? feedFor('https://b.com', 'Second') : feedFor('https://a.com', 'First')),
  })
}

describe('parsePostId：从 tuna postId 反解 ref', () => {
  it('标准格式 domain-bot-<persona>:<digestId>:<index> 解析出 ref/digestId/index/persona', () => {
    expect(parsePostId('domain-bot-newsline:abc123:7')).toEqual({
      ref: 'abc123:7',
      digestId: 'abc123',
      index: 7,
      persona: 'newsline',
    })
  })

  it('四段式（persona 用冒号而非连字符）判为非法——那正是 tuna 侧正则会拒的格式', () => {
    expect(parsePostId('domain-bot:newsline:abc123:7')).toBeNull()
  })

  it('非 domain-bot 前缀、非数字 index、空串一律判 null', () => {
    expect(parsePostId('other-bot:abc:0')).toBeNull()
    expect(parsePostId('domain-bot-newsline:abc:x')).toBeNull()
    expect(parsePostId('domain-bot-newsline:abc:-1')).toBeNull()
    expect(parsePostId('')).toBeNull()
  })
})

describe('ingestTunaSignals：把 tuna 行为喂回记忆库', () => {
  /** 跑一轮真产线，拿到真实的 digestId 与 postId（不手造 ref，否则测不到归因链）。 */
  async function publishOnce(dir: string) {
    const r = await runPipeline({
      persona,
      gates,
      domain,
      sources,
      memoryDir: join(dir, 'memory'),
      fetchFn: mockFetch(),
      now: Date.parse('2026-09-04T12:00:00Z'),
    })
    expect(r.published.length).toBeGreaterThan(0)
    return r
  }

  function signalsFile(dir: string, signals: unknown[], favorites: unknown[] = []) {
    const path = join(dir, 'tuna-signals.json')
    writeFileSync(path, JSON.stringify({ schema: TUNA_SIGNALS_SCHEMA, exportedAt: '2026-09-05T00:00:00Z', signals, favorites }))
    return path
  }

  it('展开信号（dwellMs）落 views + engagements，并把兴趣后验推离先验 1/3', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-ing-'))
    const r = await publishOnce(dir)
    const target = r.published[0]!

    const before = interestOf(loadState(join(dir, 'memory')), target.source)
    expect(before).toBeCloseTo(1 / 3, 5) // 无数据时是新源先验

    const path = signalsFile(dir, [{ postId: target.id, dwellMs: 45_000, completed: true, chatTurns: 0, dismissed: false, reaction: null, ts: Date.parse('2026-09-04T13:00:00Z') }])
    const report = ingestTunaSignals(path, { memoryDir: join(dir, 'memory'), sources, now: Date.parse('2026-09-04T13:30:00Z') })

    expect(report.views).toBe(1)
    expect(report.engagements).toBe(1)
    expect(report.unparsable).toBe(0)
    expect(report.unresolved).toBe(0)
    expect(report.problems).toEqual([])

    // Beta 后验：expands+1, exposures+1 → (1+1)/(1+1+2) = 0.5 > 先验 1/3
    const after = interestOf(loadState(join(dir, 'memory')), target.source)
    expect(after).toBeGreaterThan(before)
    expect(after).toBeCloseTo(0.5, 5)
    expect(report.interestBySource[target.source]).toBeCloseTo(0.5, 5)

    // 落盘可见（不是只在内存里算了一遍）
    expect(JSON.parse(readFileSync(join(dir, 'memory', 'views.json'), 'utf8'))).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(dir, 'memory', 'engagements.json'), 'utf8'))).toHaveLength(1)
  })

  it('dismissed 落 👎，reaction=satisfied 落 👍，源权重随之分化', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-ing2-'))
    const r = await publishOnce(dir)
    const fromA = r.published.find((p) => p.source === 'rss-1')!
    const fromB = r.published.find((p) => p.source === 'rss-2')!
    expect(fromA).toBeTruthy()
    expect(fromB).toBeTruthy()

    const path = signalsFile(dir, [
      { postId: fromA.id, dwellMs: 5000, dismissed: true, ts: Date.parse('2026-09-04T13:00:00Z') },
      { postId: fromB.id, dwellMs: 60_000, completed: true, reaction: 'satisfied', ts: Date.parse('2026-09-04T13:00:00Z') },
    ])
    const report = ingestTunaSignals(path, { memoryDir: join(dir, 'memory'), sources, now: Date.parse('2026-09-04T13:30:00Z') })

    expect(report.feedbackDown).toBe(1)
    expect(report.feedbackUp).toBe(1)
    // 👎 的源权重下降、👍 的源权重上升（初始均为 0.5）
    expect(report.weights['rss-1']!).toBeLessThan(0.5)
    expect(report.weights['rss-2']!).toBeGreaterThan(0.5)
    // 且真的落盘了，不是只返回值
    const onDisk = JSON.parse(readFileSync(join(dir, 'memory', 'weights.json'), 'utf8')).weights
    expect(onDisk['rss-1']).toBeLessThan(0.5)
    expect(onDisk['rss-2']).toBeGreaterThan(0.5)
  })

  it('reaction=ok 是中性信号，不计入反馈（进 Beta 只会稀释后验）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-ing3-'))
    const r = await publishOnce(dir)
    const path = signalsFile(dir, [{ postId: r.published[0]!.id, dwellMs: 3000, reaction: 'ok' }])
    const report = ingestTunaSignals(path, { memoryDir: join(dir, 'memory'), sources })
    expect(report.feedbackUp).toBe(0)
    expect(report.feedbackDown).toBe(0)
    expect(report.engagements).toBe(1) // 展开仍算，只是不折算成正负票
  })

  it('收藏是最强正信号：落 👍 并推兴趣后验', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-ing4-'))
    const r = await publishOnce(dir)
    const target = r.published[0]!
    const path = signalsFile(dir, [], [{ postId: target.id, ts: Date.parse('2026-09-04T13:00:00Z') }])
    // now 必须与 runPipeline 的模拟时钟同时代：省略时回落到真实时钟，会令
    // already 发布 24h 的记录被 settleStaleExposures 结算「曝光未展开」的弱负证据，
    // 恰好把收藏的正信号稀释回先验 1/3（2026-09-05 实测：00:39 绿、12:00 红，纯时间错位）
    const report = ingestTunaSignals(path, { memoryDir: join(dir, 'memory'), sources, now: Date.parse('2026-09-04T13:30:00Z') })
    expect(report.favorites).toBe(1)
    expect(report.interestBySource[target.source]!).toBeGreaterThan(1 / 3)
  })

  it('幂等：同一份文件重复摄入不虚增反馈计数（判定线 P-2「有效反馈 ≥20 条」靠这条守住）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-ing5-'))
    const r = await publishOnce(dir)
    const target = r.published[0]!
    const path = signalsFile(dir, [{ postId: target.id, dwellMs: 9000, dismissed: true, reaction: 'satisfied' }])

    const first = ingestTunaSignals(path, { memoryDir: join(dir, 'memory'), sources, now: Date.parse('2026-09-04T13:30:00Z') })
    const second = ingestTunaSignals(path, { memoryDir: join(dir, 'memory'), sources, now: Date.parse('2026-09-04T13:31:00Z') })
    const third = ingestTunaSignals(path, { memoryDir: join(dir, 'memory'), sources, now: Date.parse('2026-09-04T13:32:00Z') })

    // views 按 digestId 去重、feedback 按 digestId+itemId+signal 去重 → 第二三次为 0
    expect(first.views).toBe(1)
    expect(second.views).toBe(0)
    expect(third.views).toBe(0)
    expect(first.feedbackUp).toBe(1)
    expect(second.feedbackUp).toBe(0)
    // engagements 刻意不去重（同一条展开几次算几次真实交互，store.ts 既有语义）
    expect(second.engagements).toBe(1)

    const fb = JSON.parse(readFileSync(join(dir, 'memory', 'feedback.json'), 'utf8')) as unknown[]
    expect(fb).toHaveLength(2) // 一条 up（satisfied）+ 一条 down（dismissed），重放三次也不增
  })

  it('postId 不可解析与 ref 查不到分别计数，不静默丢弃', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-ing6-'))
    await publishOnce(dir)
    const path = signalsFile(dir, [
      { postId: 'not-a-domain-bot-id', dwellMs: 1000 },
      { postId: 'domain-bot-newsline:zzzz9999:0', dwellMs: 1000 }, // digestId 不存在
    ])
    const report = ingestTunaSignals(path, { memoryDir: join(dir, 'memory'), sources })
    expect(report.unparsable).toBe(1)
    expect(report.unresolved).toBe(1)
    expect(report.problems.some((p) => p.includes('无法解析'))).toBe(true)
    expect(report.problems.some((p) => p.includes('查不到 ref'))).toBe(true)
  })

  it('schema 不符时仍尝试解析，但必须报出来（契约可能已变）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-ing7-'))
    const r = await publishOnce(dir)
    const path = join(dir, 'bad-schema.json')
    writeFileSync(path, JSON.stringify({ schema: 'tuna-signals-v999', signals: [{ postId: r.published[0]!.id, dwellMs: 1000 }] }))
    const report = ingestTunaSignals(path, { memoryDir: join(dir, 'memory'), sources })
    expect(report.problems.some((p) => p.includes('schema 不是'))).toBe(true)
    expect(report.views).toBe(1) // 同构仍可解析
  })

  it('文件不存在 / 不可解析 / 零信号入账都要显式报问题，不得静默成功', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-ing8-'))
    const missing = ingestTunaSignals(join(dir, 'nope.json'), { memoryDir: join(dir, 'memory'), sources })
    expect(missing.problems.some((p) => p.includes('不存在'))).toBe(true)

    const broken = join(dir, 'broken.json')
    writeFileSync(broken, '{ not json')
    const bad = ingestTunaSignals(broken, { memoryDir: join(dir, 'memory'), sources })
    expect(bad.problems.some((p) => p.includes('解析失败'))).toBe(true)

    await publishOnce(dir)
    const empty = signalsFile(dir, [{ postId: 'domain-bot-newsline:zzzz9999:0' }])
    const zero = ingestTunaSignals(empty, { memoryDir: join(dir, 'memory'), sources })
    expect(zero.problems.some((p) => p.includes('未产生任何信号入账'))).toBe(true)
  })

  it('过期曝光结算：未展开的条目计弱负证据，把兴趣后验压到先验以下', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-ing9-'))
    const r = await publishOnce(dir)
    // 只展开第一条；其余条目在 24h 判定期后结算为「曝光未展开」
    const path = signalsFile(dir, [{ postId: r.published[0]!.id, dwellMs: 30_000 }])
    ingestTunaSignals(path, { memoryDir: join(dir, 'memory'), sources, now: Date.parse('2026-09-04T13:00:00Z') })

    // 推进到判定期之后（EXPOSURE_HORIZON = 24h）再摄入一次空信号触发结算
    const later = signalsFile(dir, [])
    const report = ingestTunaSignals(later, { memoryDir: join(dir, 'memory'), sources, now: Date.parse('2026-09-06T12:00:00Z') })
    expect(report.settledExposures).toBeGreaterThan(0)

    // 未展开的源后验被压低：exposures 增加而 expands 不变
    const state = loadState(join(dir, 'memory'))
    const counts = Object.values(state.counts).reduce((a, c) => ({ exposures: a.exposures + c.exposures, expands: a.expands + c.expands }), { exposures: 0, expands: 0 })
    expect(counts.exposures).toBeGreaterThan(counts.expands)
  })
})

describe('看板 selfEvolutionActive 由真实信号存量决定', () => {
  const baseInput = {
    persona: 'newsline',
    personaDisplay: 'AI时事快线',
    digestId: 'abc1',
    generatedAt: 0,
    funnel: [{ stage: 'collected', count: 4 }, { stage: 'published', count: 2 }],
    dropped: [],
    rejected: [],
    rejectCounts: {},
    backfilled: 0,
    poolExhausted: false,
    eventTrimmed: 0,
    eventFillMode: false,
    eventDemoted: 0,
    eventCount: 2,
    skippedSources: [],
    zeroYieldSources: [],
    publishedFingerprintCount: 2,
    compileErrors: [],
    editorial: {
      enabled: false, active: false, inactiveReason: '未配置', writerDegradedBatches: 0,
      reviewerDegradedBatches: 0, truncatedBatches: 0, calibrationPassed: null,
      calibrationProblems: [], endpoints: [], llmCopyCount: 0,
    },
  }
  const published = [{ source: 'rss-1', lang: 'zh' }, { source: 'rss-2', lang: 'en' }]

  it('零信号时 false，且 note 指明回流通道在哪（不得让读者以为自进化在跑）', () => {
    const b = buildBoard(baseInput, published)
    expect(b.selfEvolutionActive).toBe(false)
    expect(b.signalCounts).toEqual({ views: 0, engagements: 0, feedback: 0 })
    expect(b.selfEvolutionNote).toContain('src/ingest/tuna-signals.ts')
    expect(b.selfEvolutionNote).toContain('DB-06')
  })

  it('有信号入账时自动转 true（写死 false 会在接通后变成假话）', () => {
    const b = buildBoard(baseInput, published, { views: 3, engagements: 3, feedback: 1 })
    expect(b.selfEvolutionActive).toBe(true)
    expect(b.selfEvolutionNote).toContain('已接通')
  })
})

describe('syncPack：取代人工拷贝进 tuna 仓', () => {
  function makePack(count = 2) {
    const published = Array.from({ length: count }, (_, i) => ({
      id: `domain-bot-newsline:abc1:${i}`,
      title: `title ${i}`,
      hooks: ['h1 long enough here', 'h2 long enough here', 'h3 long enough here'],
      summary: 'summary',
      body: 'body',
      why: 'why',
      url: `https://ex.com/${i}`,
      lang: 'zh' as const,
      publishedAt: 0,
      source: 'rss-1',
      eventKey: `ev${i}`,
      valueScore: 0.8,
    }))
    return buildPack(published, { digestId: 'abc1', persona: 'newsline', personaDisplay: 'AI时事快线', domain: 'ai-llm', generatedAt: 1_700_000_000_000 })
  }

  function fakeTuna(existing?: unknown): string {
    const root = mkdtempSync(join(tmpdir(), 'dbot-tuna-'))
    const dir = join(root, TUNA_BUILTIN_PACK_REL, '..')
    mkdirSync(dir, { recursive: true })
    if (existing !== undefined) writeFileSync(join(root, TUNA_BUILTIN_PACK_REL), JSON.stringify(existing))
    return root
  }

  it('dry-run 只算差异不落盘（默认行为，tuna 由督阵会话管）', () => {
    const tunaRoot = fakeTuna()
    const pack = makePack(3)
    const r = planSync(pack, { tunaRoot, dryRun: true })
    expect(r.dryRun).toBe(true)
    expect(r.written).toBe(false)
    expect(r.targetExisted).toBe(false)
    expect(r.added).toHaveLength(3)
    expect(r.afterCount).toBe(3)
    expect(existsSync(join(tunaRoot, TUNA_BUILTIN_PACK_REL))).toBe(false)
    expect(formatSyncReport(r, 'AI时事快线')).toContain('DRY-RUN')
  })

  it('显式非 dry-run 才真写，且写入内容就是 pack 本体', () => {
    const tunaRoot = fakeTuna()
    const pack = makePack(2)
    const r = syncPack(pack, { tunaRoot, dryRun: false })
    expect(r.written).toBe(true)
    const onDisk = JSON.parse(readFileSync(join(tunaRoot, TUNA_BUILTIN_PACK_REL), 'utf8'))
    expect(onDisk.schema).toBe('tuna-brief-v1')
    expect(onDisk.posts).toHaveLength(2)
    expect(formatSyncReport(r, 'AI时事快线')).toContain('已落盘')
    expect(formatSyncReport(r, 'AI时事快线')).toContain('归 tuna 督阵会话')
  })

  it('覆盖既有包时报告新增/移除/保留，并警告移除会断掉行为信号归因', () => {
    const tunaRoot = fakeTuna({ schema: 'tuna-brief-v1', posts: [{ id: 'domain-bot-newsline:old:0' }, { id: 'domain-bot-newsline:abc1:0' }] })
    const r = planSync(makePack(2), { tunaRoot, dryRun: true })
    expect(r.beforeCount).toBe(2)
    expect(r.kept).toEqual(['domain-bot-newsline:abc1:0'])
    expect(r.added).toEqual(['domain-bot-newsline:abc1:1'])
    expect(r.removed).toEqual(['domain-bot-newsline:old:0'])
    // tuna 侧信号按 postId 归因，移除条目会让那些信号无处回流——必须警告
    expect(formatSyncReport(r, 'AI时事快线')).toContain('将无法回流')
  })

  it('目标文件损坏时拒绝覆盖（不静默抹掉别人未提交的工作）', () => {
    const root = mkdtempSync(join(tmpdir(), 'dbot-tuna-bad-'))
    mkdirSync(join(root, TUNA_BUILTIN_PACK_REL, '..'), { recursive: true })
    writeFileSync(join(root, TUNA_BUILTIN_PACK_REL), '{ broken')
    expect(() => planSync(makePack(1), { tunaRoot: root, dryRun: true })).toThrow(/解析失败，拒绝覆盖/)
  })

  it('schema 非 tuna-brief-v1 时拒绝写入（写坏包会让 tuna 编译期校验失败，比不写更糟）', () => {
    const tunaRoot = fakeTuna()
    const pack = makePack(1)
    expect(() => syncPack({ ...pack, schema: 'made-up-v9' }, { tunaRoot, dryRun: false })).toThrow(/schema 非法/)
  })

  it('写入的每个 post id 都过 tuna 侧正则（四段式会被拒）', () => {
    const tunaRoot = fakeTuna()
    const pack = makePack(3)
    syncPack(pack, { tunaRoot, dryRun: false })
    const onDisk = JSON.parse(readFileSync(join(tunaRoot, TUNA_BUILTIN_PACK_REL), 'utf8')) as { posts: Array<{ id: string }> }
    for (const p of onDisk.posts) expect(p.id).toMatch(/^[a-z0-9-]+:[a-z0-9]+:\d+$/)
  })
})

describe('端到端：产线发布 → tuna 信号 → 自进化真的动起来', () => {
  it('回流后下一轮产线的看板 selfEvolutionActive 转 true', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-loop-'))
    const memoryDir = join(dir, 'memory')
    const now = Date.parse('2026-09-04T12:00:00Z')

    // 第一轮：无信号 → 看板必须诚实报 false
    const r1 = await runPipeline({ persona, gates, domain, sources, memoryDir, fetchFn: mockFetch(), now })
    expect(r1.board.selfEvolutionActive).toBe(false)
    expect(r1.board.signalCounts).toEqual({ views: 0, engagements: 0, feedback: 0 })

    // tuna 侧导出信号（模拟 T2 的产物）
    const signalsPath = join(dir, 'tuna-signals.json')
    writeFileSync(
      signalsPath,
      JSON.stringify({
        schema: TUNA_SIGNALS_SCHEMA,
        signals: r1.published.map((p, i) => ({
          postId: p.id,
          dwellMs: i === 0 ? 60_000 : 2000,
          completed: i === 0,
          chatTurns: 0,
          dismissed: i === r1.published.length - 1,
          reaction: i === 0 ? 'satisfied' : null,
          ts: now + 3_600_000,
        })),
      }),
    )
    const ingested = ingestTunaSignals(signalsPath, { memoryDir, sources, now: now + 7_200_000 })
    expect(ingested.problems).toEqual([])
    expect(ingested.views).toBeGreaterThan(0)

    // 第二轮：看板从盘上真实存量算出 true（不是测试注入，不构成循环论证）
    const r2 = await runPipeline({ persona, gates, domain, sources, memoryDir, fetchFn: mockFetch(), now: now + 86_400_000 })
    expect(r2.board.selfEvolutionActive).toBe(true)
    expect(r2.board.signalCounts.views).toBeGreaterThan(0)

    // 权重真的分化了：被 👍 的源 > 被 👎 的源
    const store = new MemoryStore(memoryDir)
    const w = JSON.parse(readFileSync(join(memoryDir, 'weights.json'), 'utf8')).weights
    expect(Object.keys(w).length).toBeGreaterThan(0)
    expect(store.feedbackCount()).toBeGreaterThan(0)
  })
})
