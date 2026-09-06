import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectCommand, editCommand, publishCommand, reviewCommand, runCommand } from '../src/cli.js'
import { runPipeline } from '../src/pipeline.js'
import {
  COPY_SCHEMA,
  STAGE_SCHEMA,
  VERDICT_SCHEMA,
  assertTargetAlignment,
  combineStagedEditorial,
  editorialTargetsOf,
  restoreStage,
  snapshotStage,
  stagePath,
  type CollectStageSnapshot,
} from '../src/staging.js'
import type { EditorialConfig } from '../src/editorial/index.js'

/**
 * 分阶段批产作业（collect → edit → review → publish）的契约测试。
 *
 * 头号不变量是**分段跑与整链跑产出完全相同的内容包**。这不是形式要求：
 * 两条路径各写一遍终审与归档，就必然漂移，而漂移的产物是「格式全绿、内容不同」——
 * 本项目三道影子工序（`/tmp/edit.mjs` → 人肉终审 → 人工拷贝进 tuna）正是这么长出来的。
 * 故四段命令全部走 `pipeline.ts` 的 `collectStage` / `finalizeStage`，本文件用
 * 逐字段比对内容包来钉死这件事。
 *
 * 二号不变量是**每段只做自己那一段的副作用**：collect 不得写归档/观测，
 * 否则 collect + publish 会双重归档，第二轮 dedupe 把候选全屏蔽。
 */

const NOW = Date.parse('2026-09-04T12:00:00Z')

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
      created_at: '2026-09-04T00:00:00Z',
      stargazers_count: 50,
      topics: ['llm'],
    },
  ],
})

/** 采集替身：只认 rss 与 github，其余源不在本测试的 sources 里 */
function mockFetch() {
  return async (url: string) => ({
    ok: true,
    status: 200,
    text: async () => (String(url).includes('api.github.com') ? GH_JSON : RSS_XML),
  })
}

/**
 * 编辑部替身：按 prompt 里的 `[i] 标题` 编号块逐条作答。
 *
 * 两个必须遵守的口径，否则替身产出会被终审全数否决（那是终审在正确工作，
 * 不是缺陷，但会让本文件测不到分段契约）：
 * 1. 按编号答而不是按顺序答——writer/reviewer 都靠响应里的 `index` 字段回填
 *    （`writeBatch` / `reviewBatch` 的 `if (idx < 0 || idx >= out.length) continue`），
 *    漏答返回 null 而非常数填充（旧 LlmScorer 填 0.5 造出假平台，矩阵 P0-6 已修）。
 * 2. 钩子必须含原文实体词——`gk:hookEntity` 要求每条 hook 与原文共享至少一个
 *    topicToken，否则判为泛化文案。故钩子里嵌一个从标题抽出的真实词元。
 */
function editorialMockFetch(kind: 'writer' | 'reviewer') {
  return async (_url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as { messages?: Array<{ content?: string }> }) : {}
    const prompt = (body.messages ?? []).map((m) => m.content ?? '').join('\n')
    // renderItemsBlock 的格式是 `[i] 标题\n正文`，据此取回每条的标题
    const blocks = [...prompt.matchAll(/^\[(\d+)\]\s*(.*)$/gm)].map((m) => ({ idx: Number(m[1]), title: m[2] ?? '' }))
    const entries = blocks.length > 0 ? blocks : [{ idx: 0, title: '' }]
    const items = entries.map(({ idx, title }) => {
      if (kind === 'reviewer') return { index: idx, score: 8, decision: '保留', category: 'AI核心', rejectReason: '' }
      const tok = entityOf(title)
      return {
        index: idx,
        hooks: [
          `${tok}的推理成本窗口正在打开（甲${idx}）`,
          `${tok}的部署代价由谁承担（乙${idx}）`,
          `${tok}让开源权重议价能力变化（丙${idx}）`,
        ],
        summary: `本条围绕 ${tok} 给出可复现的推理基准与部署成本对比，并说明结论适用的边界条件。`,
        why: '与产线聚焦直接相关',
      }
    })
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(items) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 10 } },
        }),
    }
  }
}

/** 从标题抽一个长度 ≥4 的字母词元（跳开 eventStopwords 里的泛词）。抽不到时退到 'llm'。 */
function entityOf(title: string): string {
  const stop = new Set(['new', 'another', 'released', 'today', 'the', 'by', 'lab', 'for', 'with', 'open', 'source'])
  const tok = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !stop.has(t))
  return tok[0] ?? 'llm'
}

const gatesDoc = {
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

const personaDoc = {
  id: 'newsline',
  displayName: 'AI时事快线',
  domain: 'ai-llm',
  sources: ['rss-1', 'gh-1'],
  maxAgeHours: 72,
  maxItems: 80,
  minQualityScore: 6,
  clusterThreshold: 0.35,
  rejectRules: [],
}

/** 不带 calibration.goldStandardPath：本文件测的是分段契约，金标自检由 editorial-calibrate.test.ts 覆盖 */
const editorDoc: EditorialConfig = {
  enabled: true,
  stagingDir: 'staging',
  writer: {
    batchSize: 3,
    maxTokens: 6000,
    temperature: 0.3,
    chain: [{ id: 'w1', baseUrlDefault: 'http://127.0.0.1:1/v1', timeoutMs: 5000 }],
  },
  reviewer: {
    batchSize: 10,
    maxTokens: 1500,
    temperature: 0.1,
    chain: [{ id: 'r1', baseUrlDefault: 'http://127.0.0.1:2/v1', timeoutMs: 5000 }],
  },
} as unknown as EditorialConfig

/** 造一个自带配置的临时仓根。每段命令都读磁盘配置，故必须真落文件。 */
function makeRoot(opts: { withEditor?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'dbot-stage-'))
  mkdirSync(join(root, 'config/personas'), { recursive: true })
  mkdirSync(join(root, 'memory'), { recursive: true })
  writeFileSync(join(root, 'config/domain.json'), JSON.stringify({ domain: 'ai-llm', keywords: ['llm', 'inference'], clusterThreshold: 0.35 }))
  writeFileSync(join(root, 'config/gates.json'), JSON.stringify(gatesDoc))
  writeFileSync(
    join(root, 'config/sources.json'),
    JSON.stringify([
      { id: 'rss-1', type: 'rss', url: 'http://e/rss', weight: 0.5, enabled: true },
      { id: 'gh-1', type: 'github', url: 'https://api.github.com/search/x', weight: 0.5, enabled: true },
    ]),
  )
  writeFileSync(join(root, 'config/personas/newsline.json'), JSON.stringify(personaDoc))
  if (opts.withEditor) writeFileSync(join(root, 'config/editor.json'), JSON.stringify(editorDoc))
  return root
}

function readPack(root: string): { posts: unknown[] } {
  const dir = join(root, 'outbox/tuna')
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  expect(files, 'outbox 里应恰有一个内容包').toHaveLength(1)
  return JSON.parse(readFileSync(join(dir, files[0]!), 'utf8')) as { posts: unknown[] }
}

/** 读一份分段产物。字段用 unknown 取，断言处再收窄——不预先给它一个宽容的类型。 */
function readStage(root: string, kind: 'candidates' | 'copy' | 'verdicts', digestId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(stagePath(join(root, 'staging'), kind, 'newsline', digestId), 'utf8')) as Record<
    string,
    unknown
  >
}

const silent = { stdout: () => {}, stderr: () => {} }

describe('分阶段作业：collect 只做采集，不碰归档与观测', () => {
  it('collect 落快照，且不写 archive / observations / outbox', async () => {
    const root = makeRoot()
    const r = await collectCommand({ root, persona: 'newsline', now: NOW, fetchFn: mockFetch(), io: silent })
    expect(r.exitCode).toBe(0)
    expect(r.count).toBeGreaterThan(0)
    expect(existsSync(r.path)).toBe(true)

    // 旧版本此处调 runPipeline（整链），collect 一次就 recordItems + saveDigest +
    // appendObservation；接着 publish 再跑一遍 → 候选被记成「已消费」，第二轮 dedupe
    // 全屏蔽，观测序列还多一份重复轮次。以下三条断言就是钉死这个回归。
    expect(existsSync(join(root, 'memory/archive.json')), 'collect 不得写归档').toBe(false)
    expect(existsSync(join(root, 'memory/observations.jsonl')), 'collect 不得落观测').toBe(false)
    expect(existsSync(join(root, 'outbox')), 'collect 不得发布').toBe(false)

    const snap = JSON.parse(readFileSync(r.path, 'utf8')) as CollectStageSnapshot
    expect(snap.schema).toBe(STAGE_SCHEMA)
    // 观测口径的源级明细必须随快照落盘：finalizeStage 拿不到采集现场
    expect(snap.observed.collectedCount).toBe(4)
    expect(snap.observed.enabledSourceIds).toEqual(['rss-1', 'gh-1'])
    expect(Object.keys(snap.observed.sourceFetched).sort()).toEqual(['gh-1', 'rss-1'])
  })

  it('快照经 JSON round-trip 后 eventOrdered 与 eventKeyOf 完全保真', async () => {
    const root = makeRoot()
    const r = await collectCommand({ root, persona: 'newsline', now: NOW, fetchFn: mockFetch(), io: silent })
    const snap = JSON.parse(readFileSync(r.path, 'utf8')) as CollectStageSnapshot
    const restored = restoreStage(snap)

    expect(restored.eventOrdered.map((it) => it.id)).toEqual(snap.eventOrder)
    // eventOrdered 必须是 candidates 的一个排列（事件聚合只降权、不增删）
    expect(restored.eventOrdered).toHaveLength(restored.candidates.length)
    expect(new Set(restored.eventOrdered.map((it) => it.id)).size).toBe(restored.candidates.length)
    expect([...restored.eventKeyOf.entries()].length).toBeGreaterThan(0)
    expect(restored.digestId).toBe(snap.digestId)
    expect(restored.now).toBe(NOW)
  })
})

describe('分阶段作业：分段跑与整链跑产出完全相同的内容包', () => {
  it('collect + publish 的内容包与 run 逐字段一致', async () => {
    const fullRoot = makeRoot()
    const stagedRoot = makeRoot()

    const full = await runCommand({ root: fullRoot, persona: 'newsline', now: NOW, fetchFn: mockFetch(), io: silent })
    expect(full.exitCode).toBe(0)

    const collected = await collectCommand({ root: stagedRoot, persona: 'newsline', now: NOW, fetchFn: mockFetch(), io: silent })
    expect(collected.exitCode).toBe(0)
    const published = await publishCommand({ root: stagedRoot, persona: 'newsline', io: silent })
    expect(published.exitCode).toBe(0)

    // 比的是**落盘的内容包**而不是内存对象：交付物一致才算一致，
    // 内存对象一致但装配不同（例如 id 重编号）同样是漂移。
    expect(readPack(stagedRoot).posts).toEqual(readPack(fullRoot).posts)
    expect(published.packPath).toBeTruthy()
  })

  it('publish 不重跑采集：断网（fetch 抛错）也能发布已 collect 的候选', async () => {
    const root = makeRoot()
    const collected = await collectCommand({ root, persona: 'newsline', now: NOW, fetchFn: mockFetch(), io: silent })
    expect(collected.exitCode).toBe(0)
    expect(collected.count).toBeGreaterThan(0)

    // publishCommand 的签名里根本没有 fetchFn/spawnFn——这是「不重跑采集」的结构性保证。
    // 若将来有人给它加了采集能力，本用例会因为 outbox 内容变化而暴露。
    const before = readFileSync(collected.path, 'utf8')
    const r = await publishCommand({ root, persona: 'newsline', io: silent })
    expect(r.exitCode).toBe(0)
    expect(readPack(root).posts.length).toBeGreaterThan(0)
    // publish 不得回写采集快照（它是 collect 的产物，改动会让重跑 publish 不可复现）
    expect(readFileSync(collected.path, 'utf8')).toBe(before)
  })

  it('重复 publish 不重复归档：第二次因指纹库命中而发布 0 条', async () => {
    const root = makeRoot()
    await collectCommand({ root, persona: 'newsline', now: NOW, fetchFn: mockFetch(), io: silent })
    const first = await publishCommand({ root, persona: 'newsline', io: silent })
    expect(first.exitCode).toBe(0)
    const firstCount = readPack(root).posts.length
    expect(firstCount).toBeGreaterThan(0)

    const second = await publishCommand({ root, persona: 'newsline', io: silent })
    expect(second.exitCode).toBe(0)
    // 同一份快照再发一次：规范 URL 已在指纹库里 → 终审一票否决 → 空包。
    // 这是「不凑数」的预期行为，不是缺陷；静默重发同一内容才是缺陷。
    expect(readPack(root).posts.length).toBe(0)
  })
})

describe('分阶段作业：edit / review 产物与下标对齐', () => {
  it('edit 写 copy 产物，targetIds 与编辑部作用域一致', async () => {
    const root = makeRoot({ withEditor: true })
    const collected = await collectCommand({ root, persona: 'newsline', now: NOW, fetchFn: mockFetch(), io: silent })
    const snap = JSON.parse(readFileSync(collected.path, 'utf8')) as CollectStageSnapshot

    const r = await editCommand({
      root,
      persona: 'newsline',
      fetchFn: editorialMockFetch('writer') as never,
      io: silent,
    })
    expect(r.exitCode).toBe(0)

    const copy = readStage(root, 'copy', snap.digestId)
    expect(copy.schema).toBe(COPY_SCHEMA)
    expect(copy.targetIds).toEqual(editorialTargetsOf(restoreStage(snap), personaDoc.maxItems).map((t) => t.id))
    expect(copy.active).toBe(true)
    expect((copy.copies as unknown[]).filter((c) => c !== null).length).toBeGreaterThan(0)
  })

  it('review 写 verdicts 产物并带 qualifiedIndices', async () => {
    const root = makeRoot({ withEditor: true })
    const collected = await collectCommand({ root, persona: 'newsline', now: NOW, fetchFn: mockFetch(), io: silent })
    const snap = JSON.parse(readFileSync(collected.path, 'utf8')) as CollectStageSnapshot

    const r = await reviewCommand({
      root,
      persona: 'newsline',
      fetchFn: editorialMockFetch('reviewer') as never,
      io: silent,
    })
    expect(r.exitCode).toBe(0)

    const verdict = readStage(root, 'verdicts', snap.digestId)
    expect(verdict.schema).toBe(VERDICT_SCHEMA)
    expect(verdict.targetIds).toEqual(editorialTargetsOf(restoreStage(snap), personaDoc.maxItems).map((t) => t.id))
    expect(verdict.qualifiedIndices).not.toBeNull()
    expect((verdict.qualifiedIndices as number[]).length).toBeGreaterThan(0)
  })

  it('edit + review + publish 全链：LLM 文案真的进了内容包', async () => {
    const root = makeRoot({ withEditor: true })
    await collectCommand({ root, persona: 'newsline', now: NOW, fetchFn: mockFetch(), io: silent })
    expect((await editCommand({ root, persona: 'newsline', fetchFn: editorialMockFetch('writer') as never, io: silent })).exitCode).toBe(0)
    expect((await reviewCommand({ root, persona: 'newsline', fetchFn: editorialMockFetch('reviewer') as never, io: silent })).exitCode).toBe(0)
    expect((await publishCommand({ root, persona: 'newsline', io: silent })).exitCode).toBe(0)

    const posts = readPack(root).posts as Array<{ hooks?: string[] }>
    expect(posts.length).toBeGreaterThan(0)
    // 机械兜底也会给 3 条钩子，故不能用「钩子数=3」判定 LLM 是否生效；
    // 认替身写进来的字样（「甲/乙/丙」视角编号）才是硬证据。
    expect(posts.some((p) => (p.hooks ?? []).some((h) => h.includes('甲')))).toBe(true)
  })

  it('persona.maxItems 在 edit 与 publish 之间被改过 → 拒绝发布而不是错位错发', async () => {
    const root = makeRoot({ withEditor: true })
    await collectCommand({ root, persona: 'newsline', now: NOW, fetchFn: mockFetch(), io: silent })
    await editCommand({ root, persona: 'newsline', fetchFn: editorialMockFetch('writer') as never, io: silent })

    // maxItems 从 80 改成 1：作用域从 160 条缩到 2 条，copy 的 targetIds 立刻对不上。
    // 失败模式极阴险——copies 按下标对齐，错位不会让任何断言变红，
    // 只会让 A 条目的文案挂到 B 条目上，产出格式完美、内容张冠李戴。
    const p = join(root, 'config/personas/newsline.json')
    writeFileSync(p, JSON.stringify({ ...personaDoc, maxItems: 1 }))

    const errors: string[] = []
    const r = await publishCommand({ root, persona: 'newsline', io: { stdout: () => {}, stderr: (l) => errors.push(l) } })
    expect(r.exitCode).toBe(6)
    expect(existsSync(join(root, 'outbox')), '错位时必须拒绝发布').toBe(false)
    // 错误文本必须说清是哪一段产物对不上，否则夜里跑完早上无从处置
    expect(errors.join('\n')).toContain('copy 阶段产物')
  })
})

describe('分阶段作业：缺产物与坏快照的处置', () => {
  it('publish 找不到采集快照 → exit 2 + 可操作提示（不得静默用空候选跑一遍）', async () => {
    const root = makeRoot()
    const errors: string[] = []
    const r = await publishCommand({ root, persona: 'newsline', io: { stdout: () => {}, stderr: (l) => errors.push(l) } })
    expect(r.exitCode).toBe(2)
    expect(errors.join('\n')).toContain('collect --persona=newsline')
    expect(existsSync(join(root, 'outbox'))).toBe(false)
  })

  it('publish 无 edit/review 产物 → 走机械兜底且 exit 0（阶段一的预期行为）', async () => {
    const root = makeRoot({ withEditor: true })
    await collectCommand({ root, persona: 'newsline', now: NOW, fetchFn: mockFetch(), io: silent })
    const errors: string[] = []
    const r = await publishCommand({ root, persona: 'newsline', io: { stdout: () => {}, stderr: (l) => errors.push(l) } })
    expect(r.exitCode).toBe(0)
    expect(readPack(root).posts.length).toBeGreaterThan(0)
    // 降级必须可见：静默降级正是「格式全绿≠内容合格」的老毛病
    expect(errors.join('\n')).toContain('机械兜底')
  })

  it('edit 无 config/editor.json → exit 2 并说明可直接 publish', async () => {
    const root = makeRoot()
    await collectCommand({ root, persona: 'newsline', now: NOW, fetchFn: mockFetch(), io: silent })
    const errors: string[] = []
    const r = await editCommand({ root, persona: 'newsline', io: { stdout: () => {}, stderr: (l) => errors.push(l) } })
    expect(r.exitCode).toBe(2)
    expect(errors.join('\n')).toContain('publish')
  })

  it('未知 persona → exit 2 并列出可选值', async () => {
    const root = makeRoot()
    const errors: string[] = []
    const r = await publishCommand({ root, persona: 'nope', io: { stdout: () => {}, stderr: (l) => errors.push(l) } })
    expect(r.exitCode).toBe(2)
    expect(errors.join('\n')).toContain('newsline')
  })
})

describe('staging 契约：校验从严，坏快照不得静默通过', () => {
  function goodSnapshot(): CollectStageSnapshot {
    return {
      schema: STAGE_SCHEMA,
      persona: 'newsline',
      personaDisplay: 'AI时事快线',
      digestId: 'abc',
      now: NOW,
      candidates: [
        { id: 'u-1', url: 'https://e.com/1', title: 't1', body: '', source: 'rss-1', valueScore: 0.8, isNew: true, reason: '' },
        { id: 'u-2', url: 'https://e.com/2', title: 't2', body: '', source: 'rss-1', valueScore: 0.7, isNew: true, reason: '' },
      ] as never,
      rawScores: [0.8, 0.7],
      eventOrder: ['u-2', 'u-1'],
      eventKeys: [['u-1', 'k1']],
      eventCount: 2,
      eventDemoted: 0,
      dropped: [],
      weights: {},
      funnelPrefix: [],
      skippedSources: [],
      zeroYieldSources: [],
      observed: {
        collectedCount: 2,
        relevantCount: 2,
        sourceFetched: { 'rss-1': 2 },
        sourceAfterDedupe: { 'rss-1': 2 },
        sourceRelevant: { 'rss-1': 2 },
        skippedSourceIds: [],
        enabledSourceIds: ['rss-1'],
      },
    }
  }

  it('eventOrder 保序还原（降权序不得在序列化中丢失）', () => {
    const r = restoreStage(goodSnapshot())
    expect(r.eventOrdered.map((it) => it.id)).toEqual(['u-2', 'u-1'])
    expect(r.eventKeyOf.get('u-1')).toBe('k1')
  })

  it('schema 不符 → 抛错', () => {
    expect(() => restoreStage({ ...goodSnapshot(), schema: 'nope' } as never)).toThrow(/schema/)
  })

  it('rawScores 与 candidates 长度不一致 → 抛错（观测口径会错行）', () => {
    expect(() => restoreStage({ ...goodSnapshot(), rawScores: [0.8] })).toThrow(/rawScores/)
  })

  it('candidates 有重复 id → 抛错（规范 URL 派生 id 失效的征兆）', () => {
    const s = goodSnapshot()
    s.candidates = [s.candidates[0]!, s.candidates[0]!]
    s.eventOrder = [s.candidates[0]!.id]
    expect(() => restoreStage(s)).toThrow(/重复 id/)
  })

  it('eventOrder 引用不存在的 id → 抛错（不得静默丢条目）', () => {
    expect(() => restoreStage({ ...goodSnapshot(), eventOrder: ['u-1', 'ghost'] })).toThrow(/ghost/)
  })

  it('assertTargetAlignment：长度不符与顺序不符都抛错，一致则通过', () => {
    expect(() => assertTargetAlignment('copy', ['a'], ['a', 'b'])).toThrow(/覆盖 1 条/)
    expect(() => assertTargetAlignment('verdicts', ['b', 'a'], ['a', 'b'])).toThrow(/第 0 条/)
    expect(() => assertTargetAlignment('copy', ['a', 'b'], ['a', 'b'])).not.toThrow()
  })

  it('combineStagedEditorial：两段产物合流，端点统计与降级原因都不丢', () => {
    const copy = {
      schema: COPY_SCHEMA,
      persona: 'newsline',
      digestId: 'abc',
      targetIds: ['a'],
      copies: [{ hooks: ['h1', 'h2', 'h3'], summary: 's', why: 'w', origin: 'llm' }],
      active: true,
      stats: {
        endpoints: [{ role: 'writer', endpointId: 'w1', calls: 2, failures: 0, reasoningTokens: 10, elapsedMs: 5 }],
        writerDegradedBatches: 1,
        reviewerDegradedBatches: 0,
        truncatedBatches: 0,
      },
      usage: null,
    }
    const verdict = {
      schema: VERDICT_SCHEMA,
      persona: 'newsline',
      digestId: 'abc',
      targetIds: ['a'],
      verdicts: [{ score: 8, decision: '保留', category: 'AI核心', rejectReason: '', origin: 'llm' }],
      qualifiedIndices: [0],
      active: false,
      inactiveReason: 'reviewer 端点全链失败',
      stats: {
        endpoints: [{ role: 'reviewer', endpointId: 'r1', calls: 1, failures: 3, reasoningTokens: 0, elapsedMs: 9 }],
        writerDegradedBatches: 0,
        reviewerDegradedBatches: 2,
        truncatedBatches: 1,
      },
      usage: null,
    }
    const out = combineStagedEditorial(copy as never, verdict as never, 1)
    expect(out.active).toBe(true)
    expect(out.qualifiedIndices).toEqual([0])
    expect(out.stats.endpoints.map((e) => e.role)).toEqual(['writer', 'reviewer'])
    expect(out.stats.writerDegradedBatches).toBe(1)
    expect(out.stats.reviewerDegradedBatches).toBe(2)
    expect(out.stats.truncatedBatches).toBe(1)
    // 降级原因必须保留：writer 生效不代表 reviewer 也生效，看板要能分别归因
    expect(out.inactiveReason).toContain('reviewer 端点全链失败')
  })

  it('两段产物都缺 → 全 null 且 active=false（机械兜底，不假装生效）', () => {
    const out = combineStagedEditorial(null, null, 3)
    expect(out.copies).toEqual([null, null, null])
    expect(out.verdicts).toEqual([null, null, null])
    expect(out.active).toBe(false)
    expect(out.qualifiedIndices).toBeNull()
    expect(out.stats.endpoints).toEqual([])
  })
})

describe('分阶段作业：runPipeline 的 staged 入口与整链入口共用同一段实现', () => {
  it('staged 路径不触发采集（sources 给空表也照样出结果）', async () => {
    const root = makeRoot()
    const collected = await collectCommand({ root, persona: 'newsline', now: NOW, fetchFn: mockFetch(), io: silent })
    const snapshot = JSON.parse(readFileSync(collected.path, 'utf8')) as CollectStageSnapshot

    const gates = JSON.parse(readFileSync(join(root, 'config/gates.json'), 'utf8'))
    const domain = JSON.parse(readFileSync(join(root, 'config/domain.json'), 'utf8'))
    const persona = JSON.parse(readFileSync(join(root, 'config/personas/newsline.json'), 'utf8'))
    // 用另一个干净 memoryDir，避免与 collect 的锁/归档互相干扰
    const memoryDir = join(root, 'memory-staged')
    mkdirSync(memoryDir, { recursive: true })

    const r = await runPipeline({
      persona,
      gates,
      domain,
      // 空源表 + 无 fetchFn：若 staged 路径还在采集，产出必为空，本断言就会红
      sources: [],
      memoryDir,
      staged: snapshot,
      now: NOW,
    })
    expect(r.published.length).toBeGreaterThan(0)
    expect(r.funnel.map((f) => f.stage)).toEqual([
      'collected',
      'afterSourcePrescreen', // DB-13：源级时效预筛层（0 条被砍时也保留，层形状稳定）
      'afterDedupe',
      'afterGates',
      'afterEventCap',
      'afterTruncate',
      'published',
    ])
    // 观测口径必须与整链一致：源级明细来自快照，不是现场重算
    expect(r.funnel.find((f) => f.stage === 'collected')!.count).toBe(snapshot.observed.collectedCount)
  })
})
