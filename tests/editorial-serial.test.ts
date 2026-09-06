import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditBoard, buildBoard } from '../src/gatekeeper/board.js'
import type { EditorialConfig, PersonaConfig, ScoredItem } from '../src/types.js'

/**
 * DB-14 编辑部同端点串行修复 + 运行时撞车告警（2026-09-05 小巴审查 P1-1）。
 *
 * 旧实现先启动两个 runJob 再 await——「串行」从未生效（调用即执行）。
 * 本组测试用工单要求的时序区间法验证真串行，并钉死 auditBoard 的撞车告警。
 */
describe('DB-14 同端点串行：请求区间两两不重叠', () => {
  const candidates: ScoredItem[] = [
    { id: 'i1', source: 'rss-1', title: 'KC-Bench: a benchmark for knowledge conflict in LLM agents', body: 'First benchmark evaluating dynamic knowledge conflict.', url: 'https://e.com/1', publishedAt: 0, valueScore: 0.8, isNew: true, reason: 'r' },
    { id: 'i2', source: 'rss-1', title: 'Second LLM serving piece for the batch', body: 'Another body with enough words.', url: 'https://e.com/2', publishedAt: 0, valueScore: 0.7, isNew: true, reason: 'r' },
  ]
  const persona: PersonaConfig = JSON.parse(readFileSync(join(process.cwd(), 'config/personas/newsline.json'), 'utf8')) as PersonaConfig

  const chatBody = JSON.stringify({ choices: [{ message: { content: '[]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5 } })

  /** 记录每个请求的起止毫秒区间（工单提示：fetch 内延时 8ms 使区间非零）。 */
  function intervalFetch() {
    const intervals: Array<{ start: number; end: number }> = []
    const fn = async () => {
      const start = Date.now()
      await new Promise((r) => setTimeout(r, 8))
      intervals.push({ start, end: Date.now() })
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => chatBody }
    }
    return { fn: fn as unknown as Parameters<typeof import('../src/editorial/index.js').runEditorial>[0]['fetchFn'], intervals }
  }

  const mkCfg = (writerBase: string, reviewerBase: string): EditorialConfig => ({
    enabled: true,
    stagingDir: join(mkdtempSync(join(tmpdir(), 'dbot-db14-')), 'jobs'),
    writer: { batchSize: 2, maxTokens: 100, temperature: 0, chain: [{ id: 'w', baseUrlDefault: writerBase, modelDefault: 'm', timeoutMs: 5000 }] },
    reviewer: { batchSize: 2, maxTokens: 100, temperature: 0, chain: [{ id: 'r', baseUrlDefault: reviewerBase, modelDefault: 'm', timeoutMs: 5000 }] },
  })

  it('sameEndpoint=true：writer 与 reviewer 请求区间不重叠（真串行）', async () => {
    const { runEditorial } = await import('../src/editorial/index.js')
    const { fn, intervals } = intervalFetch()
    await runEditorial({ config: mkCfg('http://same/v1', 'http://same/v1'), persona, candidates, root: process.cwd(), fetchFn: fn, env: {} as NodeJS.ProcessEnv })
    expect(intervals.length).toBeGreaterThanOrEqual(2)
    intervals.sort((a, b) => a.start - b.start)
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]!.start, `区间 ${i} 起点不得早于前一区间终点（串行）`).toBeGreaterThanOrEqual(intervals[i - 1]!.end)
    }
  })

  it('变异验证：sameEndpoint=false（异端点并行）时能观察到区间重叠——证明上一断言有区分力', async () => {
    const { runEditorial } = await import('../src/editorial/index.js')
    const { fn, intervals } = intervalFetch()
    await runEditorial({ config: mkCfg('http://a/v1', 'http://b/v1'), persona, candidates, root: process.cwd(), fetchFn: fn, env: {} as NodeJS.ProcessEnv })
    expect(intervals.length).toBeGreaterThanOrEqual(2)
    intervals.sort((a, b) => a.start - b.start)
    const anyOverlap = intervals.some((iv, i) => i > 0 && iv.start < intervals[i - 1]!.end)
    expect(anyOverlap, '并行场景必须观察到至少一对重叠区间').toBe(true)
  })
})

describe('DB-14 auditBoard 撞车告警：实际用量端点交集', () => {
  const baseBoard = {
    persona: 'newsline',
    personaDisplay: 'AI时事快线',
    digestId: 'abc1',
    generatedAt: Date.parse('2026-09-05T12:00:00Z'),
    funnel: [
      { stage: 'collected', count: 100 },
      { stage: 'afterDedupe', count: 80 },
      { stage: 'afterGates', count: 50 },
      { stage: 'afterEventCap', count: 30 },
      { stage: 'afterTruncate', count: 20 },
      { stage: 'published', count: 18 },
    ],
    dropped: [],
    rejected: [],
    rejectCounts: {},
    backfilled: 2,
    poolExhausted: false,
    eventTrimmed: 1,
    eventFillMode: false,
    eventDemoted: 0,
    eventCount: 25,
    skippedSources: [],
    zeroYieldSources: [],
    publishedFingerprintCount: 18,
    compileErrors: [],
    editorial: {
      enabled: true,
      active: true,
      llmCopyCount: 18,
      writerDegradedBatches: 0,
      reviewerDegradedBatches: 0,
      truncatedBatches: 0,
      calibrationPassed: true,
      calibrationProblems: [],
      endpoints: [
        { role: 'writer', endpointId: 'nous-proxy', calls: 2, promptTokens: 10, completionTokens: 10, reasoningTokens: 0, elapsedMs: 10, failures: 0 },
        { role: 'reviewer', endpointId: 'nous-proxy', calls: 1, promptTokens: 10, completionTokens: 10, reasoningTokens: 0, elapsedMs: 10, failures: 0 },
      ],
    },
  } as unknown as Parameters<typeof buildBoard>[0]
  const published = Array.from({ length: 18 }, (_, i) => ({ source: 'rss-1', lang: 'en' }))

  it('writer 与 reviewer 实际共用 endpointId → warnings 含撞车提示', () => {
    const b = buildBoard(baseBoard, published)
    const audit = auditBoard(b)
    expect(audit.warnings.some((w) => w.includes('端点撞车') && w.includes('nous-proxy'))).toBe(true)
  })

  it('无交集时不产生撞车 warning（防误报）', () => {
    const b = buildBoard(
      {
        ...baseBoard,
        editorial: {
          ...(baseBoard.editorial as unknown as Record<string, unknown>),
          endpoints: [
            { role: 'writer', endpointId: 'nous-proxy', calls: 2, promptTokens: 10, completionTokens: 10, reasoningTokens: 0, elapsedMs: 10, failures: 0 },
            { role: 'reviewer', endpointId: 'ds4-local', calls: 1, promptTokens: 10, completionTokens: 10, reasoningTokens: 0, elapsedMs: 10, failures: 0 },
          ],
        },
      } as unknown as Parameters<typeof buildBoard>[0],
      published,
    )
    const audit = auditBoard(b)
    expect(audit.warnings.some((w) => w.includes('端点撞车'))).toBe(false)
  })
})
