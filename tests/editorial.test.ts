import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AllEndpointsFailedError,
  EditorialProvider,
  extractJsonArray,
  resolveChain,
  resolveEndpoint,
} from '../src/editorial/provider.js'
import { makeJobId, runJob, loadJobState, jobPath } from '../src/editorial/job.js'
import { buildWriterPrompt, normalizeCopy, writeBatch } from '../src/editorial/writer.js'
import { buildReviewerPrompt, meetsQualityBar, normalizeVerdict, reviewBatch } from '../src/editorial/reviewer.js'
import type { EditorialConfig, PersonaConfig, ScoredItem } from '../src/types.js'

/**
 * AI 编辑部：provider 降级链、长时批产作业（进度落盘/断点续跑）、writer/reviewer 归一化。
 *
 * 批参数的依据是实测（2026-09-04），不是拍的：writer 批=3/max_tokens=6000 单批 47.1s，
 * completion 2500 里 reasoning 占 1739（70%）；reviewer 批=10/max_tokens=1500 单批 17.8s，
 * completion 940 里 reasoning 占 795（85%）。批大小受限于 reasoning 开销而非可见输出——
 * 曾按 10 条/批估算 writer，实测只写完约 1 条就撞 max_tokens（finish_reason=length）。
 */

const persona: PersonaConfig = {
  id: 'newsline',
  displayName: 'AI时事快线',
  domain: 'ai-llm',
  sources: ['rss-1'],
  maxAgeHours: 72,
  maxItems: 10,
  minQualityScore: 6,
  clusterThreshold: 0.35,
  rejectRules: [],
}

function role(chain: Array<{ id: string; baseUrlDefault: string; timeoutMs?: number }>) {
  return {
    batchSize: 3,
    maxTokens: 6000,
    temperature: 0.3,
    chain: chain.map((c) => ({ id: c.id, baseUrlDefault: c.baseUrlDefault, timeoutMs: c.timeoutMs ?? 5000 })),
  }
}

/** 造一个可编程的 fetch 替身：按调用次序返回预设响应或抛错。 */
function scriptedFetch(script: Array<{ status?: number; body?: string; throw?: string; model?: string }>) {
  let i = 0
  const calls: Array<{ url: string; body: unknown }> = []
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const step = script[Math.min(i, script.length - 1)]!
    i += 1
    if (step.throw) throw new Error(step.throw)
    return {
      ok: (step.status ?? 200) < 400,
      status: step.status ?? 200,
      text: async () => step.body ?? '',
    }
  }
  return { fn, calls, get invoked() { return i } }
}

const okBody = (content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    model: 'actual-model',
    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 200, completion_tokens_details: { reasoning_tokens: 140 } },
    ...extra,
  })

describe('resolveEndpoint / resolveChain：端点不绑定，全部走配置', () => {
  it('env 优先于 baseUrlDefault（老张裁决：不硬编码任何地址）', () => {
    const ep = resolveEndpoint(
      { id: 'x', baseUrlEnv: 'EDITOR_TEST_URL', baseUrlDefault: 'http://default/v1', modelEnv: 'EDITOR_TEST_MODEL', modelDefault: 'dm', timeoutMs: 1000 },
      { EDITOR_TEST_URL: 'http://from-env/v1', EDITOR_TEST_MODEL: 'em' } as NodeJS.ProcessEnv,
    )
    expect(ep).toMatchObject({ baseUrl: 'http://from-env/v1', model: 'em' })
  })

  it('env 未设时回落到 default；两者皆空则该端点被剔除', () => {
    expect(resolveEndpoint({ id: 'x', baseUrlDefault: 'http://d/v1', modelDefault: 'm', timeoutMs: 1 }, {} as NodeJS.ProcessEnv))
      .toMatchObject({ baseUrl: 'http://d/v1', model: 'm' })
    expect(resolveEndpoint({ id: 'x', timeoutMs: 1 }, {} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('baseUrl 末尾斜杠被剥掉（否则拼出 //chat/completions）', () => {
    expect(resolveEndpoint({ id: 'x', baseUrlDefault: 'http://d/v1/', timeoutMs: 1 }, {} as NodeJS.ProcessEnv)!.baseUrl)
      .toBe('http://d/v1')
  })

  it('resolveChain 保持顺序（顺序就是降级优先级）', () => {
    const chain = resolveChain(role([{ id: 'a', baseUrlDefault: 'http://a/v1' }, { id: 'b', baseUrlDefault: 'http://b/v1' }]), {} as NodeJS.ProcessEnv)
    expect(chain.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('extraBody 解析透传且进入请求体（ds4 补 reasoning_effort:low 的实测必需件）', async () => {
    const ep = resolveEndpoint(
      { id: 'ds4', baseUrlDefault: 'http://a/v1', modelDefault: 'deepseek-v4-flash', timeoutMs: 1000, extraBody: { reasoning_effort: 'low' } },
      {} as NodeJS.ProcessEnv,
    )
    expect(ep!.extraBody).toEqual({ reasoning_effort: 'low' })

    const s = scriptedFetch([{ body: okBody('ok') }])
    const p = new EditorialProvider(
      {
        batchSize: 3,
        maxTokens: 6000,
        temperature: 0.3,
        chain: [{ id: 'ds4', baseUrlDefault: 'http://a/v1', modelDefault: 'deepseek-v4-flash', timeoutMs: 1000, extraBody: { reasoning_effort: 'low' } }],
      },
      {} as NodeJS.ProcessEnv,
      s.fn,
    )
    await p.chat('hi')
    expect(s.calls[0]!.body).toMatchObject({ model: 'deepseek-v4-flash', reasoning_effort: 'low' })
    // 未配 extraBody 的端点不得自带该字段（降级链上的普通端点不受污染）
    const s2 = scriptedFetch([{ body: okBody('ok') }])
    const p2 = new EditorialProvider(role([{ id: 'plain', baseUrlDefault: 'http://b/v1' }]), {} as NodeJS.ProcessEnv, s2.fn)
    await p2.chat('hi')
    expect((s2.calls[0]!.body as Record<string, unknown>).reasoning_effort).toBeUndefined()
  })
})

describe('EditorialProvider：自动降级链', () => {
  it('首端点非 2xx 时降到次端点，并回读实际 model', async () => {
    const s = scriptedFetch([
      { status: 503, body: '' },
      { body: okBody([{ index: 0, score: 8 }]), model: 'rewritten-by-proxy' },
    ])
    const p = new EditorialProvider(role([{ id: 'primary', baseUrlDefault: 'http://a/v1' }, { id: 'fallback', baseUrlDefault: 'http://b/v1' }]), {} as NodeJS.ProcessEnv, s.fn)
    const res = await p.chat('hi')
    expect(s.calls).toHaveLength(2)
    expect(s.calls[0].url).toBe('http://a/v1/chat/completions')
    expect(s.calls[1].url).toBe('http://b/v1/chat/completions')
    expect(res.usage.endpointId).toBe('fallback')
    // 8052 实测会无视传入 model 一律返回 meituan/longcat-2.0:free，故必须回读而不是信配置
    expect(res.usage.model).toBe('actual-model')
    expect(res.usage.reasoningTokens).toBe(140)
  })

  it('首端点抛错（超时/连接失败）也降级', async () => {
    const s = scriptedFetch([{ throw: 'connect ECONNREFUSED' }, { body: okBody('ok') }])
    const p = new EditorialProvider(role([{ id: 'a', baseUrlDefault: 'http://a/v1' }, { id: 'b', baseUrlDefault: 'http://b/v1' }]), {} as NodeJS.ProcessEnv, s.fn)
    const res = await p.chat('hi')
    expect(res.usage.endpointId).toBe('b')
  })

  it('响应无 content 视为失败并降级（HTTP 200 但内容不可用）', async () => {
    const s = scriptedFetch([
      { body: JSON.stringify({ choices: [{ message: {} }] }) },
      { body: okBody('ok') },
    ])
    const p = new EditorialProvider(role([{ id: 'a', baseUrlDefault: 'http://a/v1' }, { id: 'b', baseUrlDefault: 'http://b/v1' }]), {} as NodeJS.ProcessEnv, s.fn)
    expect((await p.chat('hi')).usage.endpointId).toBe('b')
  })

  it('validate 抛错视同该端点失败并降级（形状错误不落备胎就会整批直降机械——2026-09-06 NIM 故障期根因）', async () => {
    const s = scriptedFetch([{ body: okBody('{"not":"an array"}') }, { body: okBody('[1]') }])
    const p = new EditorialProvider(role([{ id: 'a', baseUrlDefault: 'http://a/v1' }, { id: 'b', baseUrlDefault: 'http://b/v1' }]), {} as NodeJS.ProcessEnv, s.fn)
    const res = await p.chat('hi', { validate: (content) => {
      if (!content.trim().startsWith('[')) throw new Error('JSON 数组不可解析')
    } })
    expect(s.calls).toHaveLength(2)
    expect(res.usage.endpointId).toBe('b')
  })

  it('validate 全链不过时抛 AllEndpointsFailedError，attempts 记录形状错误原文', async () => {
    const s = scriptedFetch([{ body: okBody('oops') }, { body: okBody('oops too') }])
    const p = new EditorialProvider(role([{ id: 'a', baseUrlDefault: 'http://a/v1' }, { id: 'b', baseUrlDefault: 'http://b/v1' }]), {} as NodeJS.ProcessEnv, s.fn)
    const err = await p.chat('hi', { validate: () => { throw new Error('形状不对') } }).then(
      () => null,
      (e) => e as AllEndpointsFailedError,
    )
    expect(err).toBeInstanceOf(AllEndpointsFailedError)
    expect(err!.attempts.map((a) => a.error)).toEqual(['形状不对', '形状不对'])
  })

  it('全链失败抛 AllEndpointsFailedError，且带每个端点的失败原因', async () => {
    const s = scriptedFetch([{ throw: 'timeout' }, { throw: 'refused' }])
    const p = new EditorialProvider(role([{ id: 'a', baseUrlDefault: 'http://a/v1' }, { id: 'b', baseUrlDefault: 'http://b/v1' }]), {} as NodeJS.ProcessEnv, s.fn)
    await expect(p.chat('hi')).rejects.toBeInstanceOf(AllEndpointsFailedError)
    // 错误信息必须点名每个端点，否则排障时看不出降级链走到哪一步断的
    const err = await p.chat('hi').then(
      () => null,
      (e) => e as AllEndpointsFailedError,
    )
    expect(err).toBeInstanceOf(AllEndpointsFailedError)
    expect(err!.attempts).toHaveLength(2)
    expect(err!.attempts.map((a) => a.endpointId)).toEqual(['a', 'b'])
    expect(err!.message).toContain('2 个端点')
  })

  it('链为空时 available=false，chat 立即抛错而不是静默返回空', () => {
    const p = new EditorialProvider(role([]), {} as NodeJS.ProcessEnv)
    expect(p.available).toBe(false)
    expect(p.chat('hi')).rejects.toBeInstanceOf(AllEndpointsFailedError)
  })

  it('finish_reason=length 必须标记 truncated（撞 max_tokens 的 JSON 不可解析）', async () => {
    const s = scriptedFetch([{ body: okBody('[{"index":0', { choices: [{ message: { content: '[{"index":0' }, finish_reason: 'length' }] }) }])
    const p = new EditorialProvider(role([{ id: 'a', baseUrlDefault: 'http://a/v1' }]), {} as NodeJS.ProcessEnv, s.fn)
    const res = await p.chat('hi')
    expect(res.truncated).toBe(true)
  })

  it('apiKey 存在才带 authorization 头（本地 llama-server 不校验 key，不得伪造）', async () => {
    const s = scriptedFetch([{ body: okBody('ok') }])
    const p = new EditorialProvider(
      { batchSize: 1, maxTokens: 10, temperature: 0, chain: [{ id: 'a', baseUrlDefault: 'http://a/v1', apiKeyEnv: 'K', timeoutMs: 1000 }] },
      { K: 'secret' } as NodeJS.ProcessEnv,
      s.fn,
    )
    await p.chat('hi')
    expect(s.calls).toHaveLength(1)
  })
})

describe('extractJsonArray：模型常包裹说明文字或 markdown 围栏', () => {
  it('裸数组、围栏包裹、前后有说明文字都能抠出来', () => {
    expect(extractJsonArray('[{"a":1}]')).toEqual({ items: [{ a: 1 }], parsed: true })
    expect(extractJsonArray('```json\n[{"a":1}]\n```').parsed).toBe(true)
    expect(extractJsonArray('好的，结果如下：[{"a":1}] 希望有帮助').parsed).toBe(true)
  })

  it('被截断的 JSON 判为不可解析，不得返回半截结果', () => {
    // 这正是撞 max_tokens 时的真实产物：HTTP 200、有 content、但 JSON 不完整
    const r = extractJsonArray('[{"index":0,"score":8},{"index":1,"sc')
    expect(r.parsed).toBe(false)
    expect(r.items).toEqual([])
  })

  it('非数组的合法 JSON 也判为不可解析（不得把对象当数组用）', () => {
    expect(extractJsonArray('{"index":0}').parsed).toBe(false)
  })
})

describe('writer：三档钩子 + 摘要 + 人话 why', () => {
  const item = { title: 'KC-Bench: a benchmark for knowledge conflict in LLM agents', body: 'First benchmark evaluating dynamic knowledge conflict.' }

  it('prompt 含三条铁律：禁标题前缀截断、禁元数据、禁浮点分数', () => {
    const p = buildWriterPrompt([item], persona)
    expect(p).toContain('不得是标题的前缀截断')
    expect(p).toContain('arXiv:2609.')
    expect(p).toContain('严禁出现任何数字分数')
    expect(p).toContain('价值 0.94') // 直接把 DB-03 的反面样本写进 prompt
    expect(p).toContain(persona.displayName)
  })

  it('合法输出被接受，且 origin=llm', () => {
    const copy = normalizeCopy(
      { index: 0, hooks: ['钩子一讲技术结论与数据反差', '钩子二讲系统痛点与风险', '钩子三讲实践启示'], summary: '一段足够长的摘要内容。', why: '聚焦知识冲突评测' },
      item,
      persona,
    )
    expect(copy).not.toBeNull()
    expect(copy!.origin).toBe('llm')
    expect(copy!.hooks).toHaveLength(3)
  })

  it('钩子不足 3 条判为不合格（不硬凑，交由机械兜底）', () => {
    expect(normalizeCopy({ index: 0, hooks: ['只有一条钩子内容够长了'], summary: '摘要内容够长了确实', why: '理由' }, item, persona)).toBeNull()
  })

  it('钩子是标题前缀截断时被剔除（DB-03 头号文案缺陷，模型也会犯）', () => {
    const title = item.title
    const r = normalizeCopy(
      { index: 0, hooks: [title.slice(0, 40), '另一条讲系统痛点与风险的钩子', '第三条讲实践启示的钩子'], summary: '摘要内容够长了确实', why: '理由' },
      item,
      persona,
    )
    // 前缀那条被剔除 → 只剩 2 条 → 判不合格
    expect(r).toBeNull()
  })

  it('why 含浮点分数时判为不合格，而不是悄悄改掉', () => {
    // 悄悄改会让「模型没学会要求」在看板上不可见
    expect(
      normalizeCopy({ index: 0, hooks: ['钩子一讲技术结论与数据', '钩子二讲系统痛点风险', '钩子三讲实践启示内容'], summary: '摘要内容够长了确实', why: 'AI时事快线·rss：价值 0.94' }, item, persona),
    ).toBeNull()
  })

  it('超长按码点截断（不信任模型遵守长度约束）', () => {
    const copy = normalizeCopy(
      { index: 0, hooks: ['钩'.repeat(200), '另一条钩子内容足够长了', '第三条钩子内容也够长'], summary: '摘'.repeat(900), why: '为'.repeat(90) },
      { ...item, body: '中文正文'.repeat(20) },
      persona,
    )
    // 第一条钩子被截断后可能与别的重复或被剔除；摘要与 why 必须被限长
    if (copy) {
      expect(Array.from(copy.summary).length).toBeLessThanOrEqual(300)
      expect(Array.from(copy.why).length).toBeLessThanOrEqual(40)
      for (const h of copy.hooks) expect(Array.from(h).length).toBeLessThanOrEqual(70)
    }
    expect(copy === null || Array.from(copy.why).length <= 40).toBe(true)
  })

  it('writeBatch：单批失败返回 error 而不抛异常（不拖垮整轮）', async () => {
    const s = scriptedFetch([{ throw: 'timeout' }])
    const p = new EditorialProvider(role([{ id: 'a', baseUrlDefault: 'http://a/v1' }]), {} as NodeJS.ProcessEnv, s.fn)
    const r = await writeBatch(p, [item], persona)
    expect(r.error).toContain('timeout')
    expect(r.copies).toEqual([null])
  })

  it('writeBatch：主端点返回非数组 JSON 时落备胎出稿，而不是降机械（2026-09-06 NIM 故障期 42% 批降级的修复）', async () => {
    const s = scriptedFetch([
      { body: okBody('{"note":"模型把对象当数组返回"}') },
      { body: okBody([{ index: 0, hooks: ['钩子一讲技术结论与数据反差', '钩子二讲系统痛点与风险', '钩子三讲实践启示'], summary: '一段足够长的摘要内容。', why: '聚焦知识冲突评测' }]) },
    ])
    const p = new EditorialProvider(role([{ id: 'a', baseUrlDefault: 'http://a/v1' }, { id: 'b', baseUrlDefault: 'http://b/v1' }]), {} as NodeJS.ProcessEnv, s.fn)
    const r = await writeBatch(p, [item], persona)
    expect(r.error).toBeUndefined()
    expect(r.copies[0]).not.toBeNull()
    expect(r.copies[0]!.origin).toBe('llm')
    expect(s.calls).toHaveLength(2)
  })

  it('writeBatch：漏答的条目为 null，不用中间值冒充（旧 LlmScorer 填 0.5 造假平台的教训）', async () => {
    const s = scriptedFetch([{ body: okBody([{ index: 0, hooks: ['钩子一讲技术结论与数据反差', '钩子二讲系统痛点与风险', '钩子三讲实践启示'], summary: '一段足够长的摘要内容。', why: '聚焦知识冲突评测' }]) }])
    const p = new EditorialProvider(role([{ id: 'a', baseUrlDefault: 'http://a/v1' }]), {} as NodeJS.ProcessEnv, s.fn)
    const r = await writeBatch(p, [item, { title: 'Second item about LLM inference', body: 'body two' }], persona)
    expect(r.copies[0]).not.toBeNull()
    expect(r.copies[1]).toBeNull()
  })
})

describe('reviewer：独立模型审读打分', () => {
  const item = { title: 'KC-Bench: a benchmark for knowledge conflict in LLM agents', body: 'First benchmark.' }

  it('prompt 含 DB-03 的打分标尺与「必须用满值域」铁律（防打分饱和）', () => {
    const p = buildReviewerPrompt([item], persona)
    expect(p).toContain('9-10')
    expect(p).toContain('0-2')
    expect(p).toContain('打分必须用满值域')
    expect(p).toContain('打分饱和会让质量衰减在观测上不可见')
    expect(p).toContain(persona.displayName)
  })

  it('分数被夹到 0-10 整数；非数字判为漏答（null）而非常数', () => {
    expect(normalizeVerdict({ index: 0, score: 13 })!.score).toBe(10)
    expect(normalizeVerdict({ index: 0, score: -4 })!.score).toBe(0)
    expect(normalizeVerdict({ index: 0, score: 7.6 })!.score).toBe(8)
    expect(normalizeVerdict({ index: 0, score: 'abc' })).toBeNull()
    expect(normalizeVerdict({ index: 0 })).toBeNull()
  })

  it('decision 非法时按分数推定，而不是丢弃整条', () => {
    expect(normalizeVerdict({ index: 0, score: 8, decision: 'maybe' })!.decision).toBe('保留')
    expect(normalizeVerdict({ index: 0, score: 5, decision: 'maybe' })!.decision).toBe('降权')
    expect(normalizeVerdict({ index: 0, score: 2, decision: 'maybe' })!.decision).toBe('剔除')
  })

  it('category 非法时回落 AI周边（不得让脏值流进看板统计）', () => {
    expect(normalizeVerdict({ index: 0, score: 8, category: 'unknown' })!.category).toBe('AI周边')
    expect(normalizeVerdict({ index: 0, score: 8, category: 'AI核心' })!.category).toBe('AI核心')
  })

  it('meetsQualityBar 按 persona.minQualityScore 判定', () => {
    const v = normalizeVerdict({ index: 0, score: 6 })!
    expect(meetsQualityBar(v, persona)).toBe(true) // newsline 门槛 6
    expect(meetsQualityBar(v, { ...persona, minQualityScore: 7 })).toBe(false) // deepthought 门槛 7
  })

  it('reviewBatch：单批失败返回 error 而不抛异常', async () => {
    const s = scriptedFetch([{ throw: 'refused' }])
    const p = new EditorialProvider(role([{ id: 'a', baseUrlDefault: 'http://a/v1' }]), {} as NodeJS.ProcessEnv, s.fn)
    const r = await reviewBatch(p, [item], persona)
    expect(r.error).toContain('refused')
    expect(r.verdicts).toEqual([null])
  })
})

describe('runJob：长时批产的进度落盘与断点续跑', () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ id: `i${i}`, title: `title ${i}`, body: `body ${i}` }))

  it('按 batchSize 切批，结果展平后与输入同序等长', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-job-'))
    const r = await runJob({
      jobId: 'writer-newsline-20260904',
      role: 'writer',
      persona,
      items,
      batchSize: 3,
      stagingDir: dir,
      runBatch: async (batch) => ({ results: batch.map((b) => ({ ok: true, id: b.id })), truncated: false }),
    })
    expect(r.state.totalBatches).toBe(3) // 7 / 3 → 3 批
    expect(r.results).toHaveLength(7)
    expect(r.results.map((x) => x!.id)).toEqual(items.map((i) => i.id))
    expect(r.batchesRun).toBe(3)
    expect(r.resumed).toBe(false)
  })

  it('每批完成即落盘（攒到最后一次写等于没有断点续跑）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-job2-'))
    const seen: number[] = []
    await runJob({
      jobId: 'j',
      role: 'reviewer',
      persona,
      items,
      batchSize: 3,
      stagingDir: dir,
      runBatch: async (batch) => {
        // 在批处理内部检查进度文件：上一批的结果必须已经在盘上
        if (existsSync(jobPath(dir, 'j'))) {
          seen.push((loadJobState<{ ok: boolean }>(dir, 'j')!.completedBatches).length)
        }
        return { results: batch.map(() => ({ ok: true })), truncated: false }
      },
    })
    expect(seen).toEqual([1, 2]) // 第 2、3 批开跑时，盘上分别已有 1、2 批完成记录
  })

  it('中断后续跑：已完成的批不再重跑', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-job3-'))
    const executed: number[] = []
    const run = () =>
      runJob({
        jobId: 'j3',
        role: 'writer',
        persona,
        items,
        batchSize: 3,
        stagingDir: dir,
        runBatch: async (batch, b) => {
          executed.push(b)
          // 第一批成功后模拟崩溃：抛错让本轮中断
          if (b === 0) throw new Error('模拟崩溃')
          return { results: batch.map((x) => ({ id: x.id })), truncated: false }
        },
      }).catch((e) => e as Error)

    await run()
    expect(executed).toEqual([0])
    // 续跑：批 0 已有进度（虽然该批 runBatch 抛错，进度未写入），故仍会重跑批 0，
    // 但批 0 成功后批 1、2 依次跑；关键是**已完成批不重跑**
    executed.length = 0
    const second = await runJob({
      jobId: 'j3',
      role: 'writer',
      persona,
      items,
      batchSize: 3,
      stagingDir: dir,
      runBatch: async (batch, b) => {
        executed.push(b)
        return { results: batch.map((x) => ({ id: x.id })), truncated: false }
      },
    })
    expect(executed).toEqual([0, 1, 2])
    expect(second.results).toHaveLength(7)

    // 第三次：全部已完成 → 一批都不跑
    executed.length = 0
    const third = await runJob({
      jobId: 'j3',
      role: 'writer',
      persona,
      items,
      batchSize: 3,
      stagingDir: dir,
      runBatch: async (batch, b) => {
        executed.push(b)
        return { results: batch.map((x) => ({ id: x.id })), truncated: false }
      },
    })
    expect(executed).toEqual([])
    expect(third.batchesRun).toBe(0)
    expect(third.resumed).toBe(true)
    expect(third.results).toHaveLength(7)
  })

  it('输入条数变了则重开而非续跑（用旧进度拼新输入会张冠李戴且看不出来）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-job4-'))
    const base = { jobId: 'j4', role: 'writer' as const, persona, batchSize: 3, stagingDir: dir }
    await runJob({ ...base, items, runBatch: async (b) => ({ results: b.map((x) => ({ id: x.id })), truncated: false }) })

    const executed: number[] = []
    const shorter = items.slice(0, 4)
    const r = await runJob({
      ...base,
      items: shorter,
      runBatch: async (b, i) => {
        executed.push(i)
        return { results: b.map((x) => ({ id: x.id })), truncated: false }
      },
    })
    expect(executed).toEqual([0, 1]) // 4 条 / 批 3 = 2 批，全部重跑
    expect(r.resumed).toBe(false)
    expect(r.results).toHaveLength(4)
  })

  it('失败批记入 degradedBatches，成功批不受影响（不拖垮整轮）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-job5-'))
    const r = await runJob({
      jobId: 'j5',
      role: 'reviewer',
      persona,
      items,
      batchSize: 3,
      stagingDir: dir,
      runBatch: async (batch, b) =>
        b === 1
          ? { results: batch.map(() => null), truncated: false, error: '端点全链失败' }
          : { results: batch.map((x) => ({ score: 8, id: x.id })), truncated: false },
    })
    expect(r.state.degradedBatches).toEqual([1])
    expect(r.state.completedBatches.sort()).toEqual([0, 1, 2])
    // DB-16：降级原因必须留痕——只有 degradedBatches 时，「端点挂了」与「模型输出不合规」
    // 在看板上完全同形，2026-09-06 排障时被迫离线复现才能区分
    expect(r.state.degradedReasons['1']).toBe('端点全链失败')
    // 成功批不产生原因记录
    expect(Object.keys(r.state.degradedReasons)).toEqual(['1'])
    // 失败批的 3 条为 null，其余有值
    expect(r.results.slice(0, 3).every((x) => x !== null)).toBe(true)
    expect(r.results.slice(3, 6).every((x) => x === null)).toBe(true)
    expect(r.results.slice(6).every((x) => x !== null)).toBe(true)
  })

  it('全 null 但无 error 也判降级，且原因标注「输出不合规」与端点故障区分（DB-16）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-job5b-'))
    const r = await runJob({
      jobId: 'j5b',
      role: 'writer',
      persona,
      items,
      batchSize: 3,
      stagingDir: dir,
      runBatch: async (batch) => ({ results: batch.map(() => null), truncated: false }),
    })
    expect(r.state.degradedBatches).toEqual([0, 1, 2])
    for (const b of ['0', '1', '2']) {
      expect(r.state.degradedReasons[b]).toBe('全部条目被判不合格（非端点故障，模型输出不合规）')
    }
  })

  it('空输入零批：不触发「[].every() 恒真」的伪降级（DB-16 顺带修正）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-job5c-'))
    const r = await runJob({
      jobId: 'j5c',
      role: 'writer',
      persona,
      items: [],
      batchSize: 3,
      stagingDir: dir,
      runBatch: async () => ({ results: [], truncated: false }),
    })
    expect(r.state.degradedBatches).toEqual([])
    expect(r.state.degradedReasons).toEqual({})
    expect(r.results).toEqual([])
  })

  it('截断批记入 truncatedBatches（>0 说明批大小或 maxTokens 配错）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-job6-'))
    const r = await runJob({
      jobId: 'j6',
      role: 'writer',
      persona,
      items: items.slice(0, 3),
      batchSize: 3,
      stagingDir: dir,
      runBatch: async (batch) => ({ results: batch.map(() => null), truncated: true, error: 'JSON 不可解析' }),
    })
    expect(r.state.truncatedBatches).toEqual([0])
  })

  it('端点用量按 endpointId 累计，含 reasoningTokens（不看它会把批大小估错一个量级）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-job7-'))
    const r = await runJob({
      jobId: 'j7',
      role: 'writer',
      persona,
      items: items.slice(0, 6),
      batchSize: 3,
      stagingDir: dir,
      runBatch: async (batch) => ({
        results: batch.map(() => ({ ok: true })),
        truncated: false,
        usage: { endpointId: 'nous-proxy', model: 'm', promptTokens: 870, completionTokens: 2500, reasoningTokens: 1739, elapsedMs: 47100 },
      }),
    })
    const stat = r.state.endpointUsage['nous-proxy']!
    expect(stat.calls).toBe(2)
    // 实测值：writer 单批 completion 2500 里 reasoning 占 1739
    expect(stat.reasoningTokens).toBe(3478)
    expect(stat.completionTokens).toBe(5000)
    expect(stat.elapsedMs).toBe(94200)
  })

  it('makeJobId 按天+角色+产线稳定（同一天续跑同一作业）', () => {
    const day = Date.parse('2026-09-04T12:00:00Z')
    expect(makeJobId('writer', 'newsline', day)).toBe('writer-newsline-20260904')
    expect(makeJobId('writer', 'newsline', day + 3_600_000)).toBe('writer-newsline-20260904')
    expect(makeJobId('reviewer', 'deepthought', day)).toBe('reviewer-deepthought-20260904')
  })

  it('jobId 消毒防路径穿越', () => {
    const p = jobPath('/tmp/x', '../../etc/passwd')
    expect(p).not.toContain('..')
    expect(p.startsWith('/tmp/x/')).toBe(true)
    // 点号必须被剔除：留下 '.' 会把 ../../ 削成 ....，部分文件系统上仍解析为上级目录
    expect(jobPath('/tmp/x', 'a.b.c')).toBe('/tmp/x/abc.json')
  })
})

describe(' EditorialConfig 契约', () => {
  it('config/editor.json 可解析，且 writer/reviewer 首端点异族分离（写与评分离）', () => {
    const cfg = JSON.parse(readFileSync(join(process.cwd(), 'config/editor.json'), 'utf8')) as EditorialConfig
    expect(cfg.writer.batchSize).toBe(2) // DB-17 续三（d101864）：3→2，进一步降 max_tokens 撞顶概率
    expect(cfg.writer.maxTokens).toBe(6000)
    expect(cfg.reviewer.batchSize).toBe(10) // 实测：reviewer 输出短，批可大
    expect(cfg.reviewer.maxTokens).toBe(3000) // 实测：批 10 的 JSON 在 reasoning_effort:low 下需 3000 才装得下（ds4 定，8082 沿用同量级）
    // 老张裁决 4：写与评分离。两端点若相同，同一模型既写又评构成循环。id 与地址双校验，
    // 防未来有人把两端点配回同一个 id（id 相同时地址必然相配，故 id 不同是更强的守卫）
    const w = cfg.writer.chain[0]!
    const r = cfg.reviewer.chain[0]!
    expect(w.id).not.toBe(r.id)
    expect(w.baseUrlDefault).not.toBe(r.baseUrlDefault)
    // 老张裁决 3：端点不绑定——必须有 env 覆盖位
    expect(w.baseUrlEnv).toBeTruthy()
    expect(r.baseUrlEnv).toBeTruthy()
    for (const ep of [...cfg.writer.chain, ...cfg.reviewer.chain]) {
      expect(ep.baseUrlDefault).toMatch(/^https?:\/\//)
    }
    // 历史条款（2026-09-04）曾禁止 192.168.100.1:8002/deepseek-v4-flash 出现在任何端点配置，
    // 依据是「老张口述该端点经实测不存在」。2026-09-05 老张指令以 ~/start_ds4.sh 落地后该端点
    // 真实可用并配为 reviewer 主端点（ds4-local），条款被事实推翻而移除。
    // 订正（2026-09-06，小巴实测）：ds4 端点再次失效（07:47 实测 HTTP 502，主机 ping 通说明后端
    // 服务未起），老张指令改用新设的 127.0.0.1:8082 Qwen3.8-Flash-Next 双机（qwen38-tb）作 reviewer
    // 主端点。同一端点 48 小时内两次翻转结论——端点状态是易变事实，故本用例只钉「不变量」
    // （异族分离、有 env 覆盖位、地址走 http(s)），**不钉任何具体地址**；
    // 「不硬编码进代码、只走配置」的裁决不变（见 src/editorial/provider.ts 头部注释订正）。
  })

  it('enabled 为布尔；全部端点缺省 env 也能解析（回落 default，产线不会因少配 env 而炸）', () => {
    const cfg = JSON.parse(readFileSync(join(process.cwd(), 'config/editor.json'), 'utf8')) as EditorialConfig
    expect(typeof cfg.enabled).toBe('boolean')
    for (const role of [cfg.writer, cfg.reviewer]) {
      const resolved = resolveChain(role, {} as NodeJS.ProcessEnv)
      expect(resolved.length).toBe(role.chain.length) // env 全缺仍全部落到 default
      for (const ep of resolved) expect(ep.baseUrl).toMatch(/^https?:\/\//)
    }
  })
})

describe('runEditorial 降级语义', () => {
  const candidates: ScoredItem[] = [
    { id: 'i1', source: 'rss-1', title: 'KC-Bench: a benchmark for knowledge conflict in LLM agents', body: 'First benchmark evaluating dynamic knowledge conflict.', url: 'https://e.com/1', publishedAt: 0, valueScore: 0.8, isNew: true, reason: '聚焦你的关注点「benchmark」' },
  ]

  it('enabled=false 时不生效，且必须给出原因（不得静默降级）', async () => {
    const { runEditorial } = await import('../src/editorial/index.js')
    const cfg = JSON.parse(readFileSync(join(process.cwd(), 'config/editor.json'), 'utf8')) as EditorialConfig
    const r = await runEditorial({ config: { ...cfg, enabled: false }, persona, candidates, root: process.cwd() })
    expect(r.active).toBe(false)
    expect(r.inactiveReason).toContain('enabled=false')
    expect(r.qualifiedIndices).toBeNull() // 未做质量排序，产线保持原分数序
  })

  it('端点全不可解析时不生效并说明原因', async () => {
    const { runEditorial } = await import('../src/editorial/index.js')
    const cfg: EditorialConfig = {
      enabled: true,
      stagingDir: 'staging/jobs',
      writer: { batchSize: 3, maxTokens: 100, temperature: 0.3, chain: [{ id: 'x', timeoutMs: 100 }] },
      reviewer: { batchSize: 3, maxTokens: 100, temperature: 0.2, chain: [{ id: 'y', timeoutMs: 100 }] },
    }
    const r = await runEditorial({ config: cfg, persona, candidates, root: process.cwd(), env: {} as NodeJS.ProcessEnv })
    expect(r.active).toBe(false)
    expect(r.inactiveReason).toContain('无可解析端点')
  })

  it('候选为空时不生效（不必连端点）', async () => {
    const { runEditorial } = await import('../src/editorial/index.js')
    const cfg = JSON.parse(readFileSync(join(process.cwd(), 'config/editor.json'), 'utf8')) as EditorialConfig
    const r = await runEditorial({ config: { ...cfg, enabled: true }, persona, candidates: [], root: process.cwd() })
    expect(r.active).toBe(false)
    expect(r.inactiveReason).toContain('候选为空')
  })

  it('金标集自检未过时拒绝启用编辑部（分数不得用于判定）', async () => {
    const { runEditorial } = await import('../src/editorial/index.js')
    const dir = mkdtempSync(join(tmpdir(), 'dbot-ed-'))
    // 金标集指向不存在的文件 → 自检无法执行 → 不生效
    const cfg = JSON.parse(readFileSync(join(process.cwd(), 'config/editor.json'), 'utf8')) as EditorialConfig
    const r = await runEditorial({
      config: { ...cfg, enabled: true, calibration: { ...cfg.calibration, goldStandardPath: 'nope.json' } },
      persona,
      candidates,
      root: dir,
      env: {} as NodeJS.ProcessEnv,
    })
    expect(r.active).toBe(false)
    expect(r.inactiveReason).toMatch(/端点|金标集/)
  })
})
