import { describe, expect, it } from 'vitest'
import {
  assessRecallCalibration,
  buildRecallPrompt,
  judgeRecallPool,
  parseRecallVerdicts,
  recallExpectation,
} from '../src/editorial/recall.js'
import { EditorialProvider } from '../src/editorial/provider.js'
import type { GoldSample } from '../src/editorial/calibrate.js'
import type { PersonaConfig, RawItem } from '../src/types.js'

/**
 * DB-08 宽通道召回判定的单元测试。
 *
 * 边界（与 DB-04 §六.4 对齐）：reviewer 在宽通道只做 include/exclude 二元判定，
 * 不产分数、不参与终审——测试钉死解析对齐与 fail-safe 语义（漏答=exclude）。
 */

const persona: PersonaConfig = {
  id: 'newsline',
  displayName: 'AI时事快线',
  domain: 'ai-llm',
  sources: ['rss-1'],
  maxAgeHours: 72,
  maxItems: 80,
  minQualityScore: 6,
  clusterThreshold: 0.35,
  rejectRules: [],
  recall: { enabled: true, maxPerRound: 5 },
}

function raw(title: string, body = 'governance and economics policy analysis notes.'): RawItem {
  return {
    id: `u-${title.slice(0, 10).replace(/\W/g, '')}`,
    source: 'rss-1',
    title,
    body,
    url: `https://e.com/${encodeURIComponent(title.slice(0, 10))}`,
    publishedAt: 0,
  }
}

/** 与 editorial.test.ts 同款的可编程 fetch 替身：记录请求体、按序返回响应。 */
function scriptedFetch(script: Array<{ status?: number; body?: string; throw?: string }>) {
  let i = 0
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} })
    const step = script[Math.min(i, script.length - 1)]!
    i += 1
    if (step.throw) throw new Error(step.throw)
    return { ok: (step.status ?? 200) < 400, status: step.status ?? 200, text: async () => step.body ?? '' }
  }
  return { fn, calls }
}

const provider = new EditorialProvider(persona.recall ? { batchSize: 5, maxTokens: 3000, temperature: 0.2, chain: [{ id: 't', baseUrlDefault: 'http://t/v1', timeoutMs: 5000 }] } : { batchSize: 5, maxTokens: 3000, temperature: 0.2, chain: [] })

describe('parseRecallVerdicts：输出对齐与 fail-safe', () => {
  it('正常数组按 index 对齐回条目', () => {
    const items = [raw('a governance'), raw('b economics')]
    const { verdicts, missing } = parseRecallVerdicts(
      JSON.stringify([
        { index: 1, include: false, reason: 'off topic' },
        { index: 0, include: true, reason: 'relevant policy' },
      ]),
      items,
    )
    expect(missing).toBe(0)
    expect(verdicts[0]).toMatchObject({ include: true })
    expect(verdicts[1]).toMatchObject({ include: false })
  })

  it('index 越界 / 重复 / 非 JSON 全部记 missing（漏答在 judge 层 fail-safe 为 exclude）', () => {
    const items = [raw('a'), raw('b'), raw('c')]
    const bad = parseRecallVerdicts(JSON.stringify([{ index: 9, include: true }, { index: 0, include: true }, { index: 0, include: false }]), items)
    expect(bad.missing).toBeGreaterThan(0)
    expect(bad.verdicts[0]).toMatchObject({ include: true })
    expect(bad.verdicts[1]).toBeNull()

    const noJson = parseRecallVerdicts('模型这次没有输出数组', items)
    expect(noJson.missing).toBe(items.length)
    expect(noJson.verdicts.every((v) => v === null)).toBe(true)
  })
})

describe('judgeRecallPool：include 并入、exclude/漏答落账（gate=recall）', () => {
  it('include 的条目进 included；漏答条目 fail-safe 记 recall:unanswered', async () => {
    const items = [raw('Alpha governance'), raw('Beta economics'), raw('Gamma policy')]
    const s = scriptedFetch([
      {
        body: JSON.stringify({
          choices: [{ message: { content: JSON.stringify([{ index: 0, include: true, reason: 'relevant' }, { index: 1, include: false, reason: 'spam' }]) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 5 } },
        }),
      },
    ])
    const p = new EditorialProvider(
      { batchSize: 5, maxTokens: 3000, temperature: 0.2, chain: [{ id: 't', baseUrlDefault: 'http://t/v1', timeoutMs: 5000 }] },
      {} as NodeJS.ProcessEnv,
      s.fn,
    )
    const r = await judgeRecallPool(p, items, persona)
    expect(r.included.map((it) => it.title)).toEqual(['Alpha governance'])
    expect(r.excluded).toHaveLength(2)
    expect(r.excluded.map((d) => d.ruleId)).toContain('recall:excluded')
    expect(r.excluded.map((d) => d.ruleId)).toContain('recall:unanswered')
    expect(r.excluded.every((d) => d.gate === 'recall')).toBe(true)
  })

  it('prompt 含 persona 显示名与逐条编号块，且不带打分指令（宽通道不做质量分）', async () => {
    const s = scriptedFetch([
      { body: JSON.stringify({ choices: [{ message: { content: '[]' }, finish_reason: 'stop' }], usage: {} }) },
    ])
    const p = new EditorialProvider(
      { batchSize: 5, maxTokens: 3000, temperature: 0.2, chain: [{ id: 't', baseUrlDefault: 'http://t/v1', timeoutMs: 5000 }] },
      {} as NodeJS.ProcessEnv,
      s.fn,
    )
    await judgeRecallPool(p, [raw('Alpha governance')], persona)
    const prompt = String(s.calls[0]!.body.messages ? (s.calls[0]!.body.messages as Array<{ content: string }>)[0]!.content : '')
    expect(prompt).toContain('AI时事快线')
    expect(prompt).toContain('Alpha governance')
    expect(prompt).toContain('"include"')
    expect(prompt).not.toMatch(/score/i)
  })

  it('buildRecallPrompt 对空正文条目仍可构造（RSS 无摘要是常态）', () => {
    const prompt = buildRecallPrompt([raw('Title Only Governance', '')], persona)
    expect(prompt).toContain('Title Only Governance')
  })
})

describe('assessRecallCalibration：金标期望由 DB-03 人工审计派生', () => {
  const gold = (id: string, decision: GoldSample['humanDecision'], title = id): GoldSample => ({
    id,
    title,
    humanScore: decision === '剔除' ? 2 : 8,
    humanDecision: decision,
  })
  const v = (i: number, include: boolean) => ({ index: i, include, reason: '' })

  it('剔除→exclude、保留/降权→include；全对即通过', () => {
    const g = [gold('a', '保留'), gold('b', '剔除'), gold('c', '降权')]
    const r = assessRecallCalibration(g, [v(0, true), v(1, false), v(2, true)], 0.7)
    expect(r.passed).toBe(true)
    expect(r.agreementRate).toBe(1)
    expect(recallExpectation(g[1]!)).toBe(false)
  })

  it('一致率低于下限即不通过并列出分歧明细', () => {
    const g = [gold('a', '保留'), gold('b', '剔除'), gold('c', '保留'), gold('d', '保留')]
    const r = assessRecallCalibration(g, [v(0, true), v(1, true), v(2, true), v(3, false)], 0.7)
    expect(r.passed).toBe(false)
    expect(r.agreementRate).toBe(0.5)
    expect(r.disagreements.length).toBe(2)
    expect(r.problems.join(' ')).toContain('低于下限')
  })

  it('漏答率超过 30% 判定不可用（端点或 prompt 有问题）', () => {
    const g = [gold('a', '保留'), gold('b', '保留'), gold('c', '保留'), gold('d', '保留')]
    const r = assessRecallCalibration(g, [v(0, true), null, null, null], 0.7)
    expect(r.passed).toBe(false)
    expect(r.problems.join(' ')).toContain('漏答率')
  })
})

// ---------- pipeline 集成：宽通道捞回条目走统一打分/终审链 ----------

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPipeline } from '../src/pipeline.js'
import type { DomainConfig, GatesConfig, SourceConfig } from '../src/types.js'

describe('runPipeline 集成：recallJudge 捞回的条目与快通道共用同一终审（质量底线不放松）', () => {
  const gates = JSON.parse(readFileSync(join(process.cwd(), 'config/gates.json'), 'utf8')) as GatesConfig
  const domain: DomainConfig = { domain: 'ai-llm', keywords: ['llm'], clusterThreshold: 0.35 }
  const sources: SourceConfig[] = [
    { id: 'rss-1', type: 'rss', url: 'http://e/rss', weight: 0.5, enabled: true },
  ]
  const personaWithRecall: PersonaConfig = {
    ...persona,
    sources: ['rss-1'],
    maxItems: 10,
    minQualityScore: 6,
  }

  const feed = `<?xml version="1.0"?><rss><channel>
  <item><title>LLM inference benchmark released for serving workloads</title><description>llm inference benchmark transformer serving quantization release outperform open source</description><link>https://a.com/1</link></item>
  <item><title>Model Economics: What Compute Budgets Mean For Labs</title><description>governance and economics policy analysis with cost breakdowns and market notes</description><link>https://a.com/2</link></item>
  <item><title>Join our team: we are hiring platform engineers now</title><description>hiring join our team career opportunity for engineers</description><link>https://a.com/3</link></item>
</channel></rss>`

  it('快通道条目与宽通道捞回条目都能发布，黑名单垃圾即使被 judge include 也进不了产出', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-recall-e2e-'))
    const fetchFn = async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => String(url).includes('rss') ? feed : '',
    })
    const judgedTitles: string[] = []
    const result = await runPipeline({
      persona: personaWithRecall,
      gates,
      domain,
      sources,
      memoryDir: join(dir, 'memory'),
      fetchFn: fetchFn as unknown as Parameters<typeof runPipeline>[0]['fetchFn'],
      now: Date.parse('2026-09-04T12:00:00Z'),
      recallJudge: async (pool) => {
        judgedTitles.push(...pool.map((it) => it.title))
        // 恶意/错误的 judge：把黑名单条目也 include——终审/黑名单必须仍然拦住它
        return { included: pool, excluded: [] }
      },
    })

    // 治理条目（零关键词命中）只能经宽通道进入候选池
    expect(judgedTitles.some((t) => t.includes('Model Economics'))).toBe(true)
    const publishedTitles = result.published.map((p) => p.title).join('\n')
    expect(publishedTitles).toContain('LLM inference benchmark')
    expect(publishedTitles).toContain('Model Economics')
    // 黑名单在 relevance 之前：招聘帖根本进不了待定池（judge 看不到它），也不会出现在产出
    expect(judgedTitles.some((t) => t.includes('hiring'))).toBe(false)
    expect(publishedTitles).not.toContain('hiring')
    expect(result.dropped.some((d) => d.gate === 'blacklist' && d.ruleId.includes('recruit'))).toBe(true)
    // 观测口径：宽通道数据单独存档，candidates 口径含捞回条目
    expect(result.funnel[0]?.stage).toBe('collected')
  })
})
