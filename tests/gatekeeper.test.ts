import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkEventOversubscribed,
  gatekeep,
  isAccepted,
  rejectionOf,
  runAssertions,
  type AssertionInput,
} from '../src/gatekeeper/index.js'
import { renderPost } from '../src/gatekeeper/render.js'
import { BackfillPool } from '../src/gatekeeper/backfill.js'
import { auditBoard, buildBoard } from '../src/gatekeeper/board.js'
import { WHY_MAX } from '../src/render/tuna.js'
import type { GatesConfig, GatekeeperInput, PersonaConfig, ScoredItem } from '../src/types.js'

/**
 * 主编终审：十条硬断言**各造一个违例样本**，逐个断言被否决。
 *
 * 违例样本尽量取自 DB-03 审计的真实缺陷（`[object Object]`、`"arXiv:2609."`、
 * `"AI深度思想·rss：价值 0.94"`、招聘帖、2024 年旧闻），不用合成玩具串——
 * 终审要拦的就是那些，拿玩具串测等于没测。
 */

const gates = JSON.parse(readFileSync(join(process.cwd(), 'config/gates.json'), 'utf8')) as GatesConfig

const persona: PersonaConfig = {
  id: 'newsline',
  displayName: 'AI时事快线',
  domain: 'ai-llm',
  sources: ['rss-1'],
  maxAgeHours: 72,
  maxItems: 3,
  minQualityScore: 6,
  clusterThreshold: 0.35,
  rejectRules: [],
}

const NOW = Date.parse('2026-09-04T12:00:00Z')

/** 一条能通过全部十二条断言的合法样本，作为各违例样本的基准（改一个字段造一个违例）。 */
function good(overrides: Partial<GatekeeperInput> = {}): GatekeeperInput {
  return {
    id: 'domain-bot-newsline:abc1:0',
    title: 'KC-Bench: a benchmark for knowledge conflict in LLM reasoning agents',
    hooks: [
      'LLM 参数知识与检索上下文冲突时准确率显著下滑',
      'kc · bench · reasoning 三个维度上的评测结果',
      'ai-llm｜kc · bench · reasoning',
    ],
    summary: 'KC-Bench 是首个评估 LLM 智能体动态知识冲突的交互基准，覆盖九款前沿模型。',
    body: 'KC-Bench 是首个评估 LLM 智能体动态知识冲突的交互基准，覆盖九款前沿模型。实验显示参数知识与检索上下文冲突时性能明显退化。',
    why: '聚焦你的关注点「benchmark」',
    url: 'https://arxiv.org/abs/2609.03884',
    lang: 'zh',
    publishedAt: NOW - 3_600_000,
    source: 'rss-1',
    eventKey: 'ev1',
    valueScore: 0.8,
    ...overrides,
  }
}

function input(overrides: Partial<AssertionInput> = {}): AssertionInput {
  return {
    persona,
    gates,
    now: NOW,
    knownCanonical: new Set<string>(),
    batch: [],
    ...overrides,
  }
}

/** 断言某条 ruleId 被触发（不是"有断言失败"，而是指名道姓那一条）。 */
function expectRejected(item: GatekeeperInput, ruleId: string, ctx: Partial<AssertionInput> = {}) {
  const verdicts = runAssertions(item, input({ batch: [item], ...ctx }))
  expect(isAccepted(verdicts), `期望 ${ruleId} 否决，实际全部通过`).toBe(false)
  const r = rejectionOf(verdicts)!
  expect(r.ruleId).toBe(ruleId)
  expect(r.detail.length).toBeGreaterThan(0)
  return verdicts
}

describe('十二条硬断言：违例样本逐个否决', () => {
  it('基准样本必须全绿（否则各违例用例测的是别的失败原因）', () => {
    const g = good()
    const verdicts = runAssertions(g, input({ batch: [g] }))
    expect(verdicts).toHaveLength(12)
    expect(isAccepted(verdicts)).toBe(true)
  })

  it('① gk:damagedBody —— DB-03 实测 8 条 GitHub Issues 正文为 [object Object]', () => {
    expectRejected(good({ body: '[object Object]' }), 'gk:damagedBody')
    expectRejected(good({ summary: '前置说明 [object Object] 后置' }), 'gk:damagedBody')
  })

  it('② gk:duplicateUrl —— 规范 URL 批内唯一（跟踪参数变体算同一条）', () => {
    const a = good({ url: 'https://ex.com/a' })
    const b = good({ id: 'domain-bot-newsline:abc1:1', url: 'https://ex.com/a?utm_source=newsletter' })
    // 契约：待判条目是 batch 末位。b 在 a 之后 → b 被否决
    expectRejected(b, 'gk:duplicateUrl', { batch: [a, b] })
    // a 是首条，不得被误杀：把重复组全否决看似更严，实际是白白浪费坑位
    expect(isAccepted(runAssertions(a, input({ batch: [a] })))).toBe(true)
  })

  it('③ gk:alreadyPublished —— 跨产线指纹库命中即一票否决', () => {
    expectRejected(
      good({ url: 'https://theverge.com/astra' }),
      'gk:alreadyPublished',
      { knownCanonical: new Set(['https://theverge.com/astra']) },
    )
  })

  it('④ gk:mechanicalTruncation —— 钩子不得是标题前缀截断（DB-03 §2.4 的头号文案缺陷）', () => {
    const title = good().title
    const truncated = `${title.slice(0, 50)}…`
    expectRejected(good({ hooks: [truncated, good().hooks[1]!, good().hooks[2]!] }), 'gk:mechanicalTruncation')
  })

  it('⑤ gk:fragmentHook —— DB-03 实测第二钩子直接产出 "arXiv:2609."（11 字符碎片）', () => {
    expectRejected(good({ hooks: [good().hooks[0]!, 'arXiv:2609.', good().hooks[2]!] }), 'gk:fragmentHook')
    // 短于 12 码点的非 arXiv 碎片同样拦
    expectRejected(good({ hooks: [good().hooks[0]!, '短碎片', good().hooks[2]!] }), 'gk:fragmentHook')
  })

  it('⑥ gk:scoreEcho —— DB-03 实测 why 回显 "AI深度思想·rss：价值 0.94"', () => {
    expectRejected(good({ why: 'AI深度思想·rss：价值 0.94' }), 'gk:scoreEcho')
    expectRejected(good({ why: '得分 0.71 的一条内容' }), 'gk:scoreEcho')
  })

  it('⑦ gk:blacklistRecheck —— 终审复跑门禁 1，防渲染/编辑环节引入违规文本', () => {
    // 上游闸门放行的是原始 body；渲染后 summary 混进了中转站广告 → 终审必须拦住
    expectRejected(good({ summary: 'AI API 中转站，注册送 $1 额度，限时优惠' }), 'gk:blacklistRecheck')
  })

  it('⑧ gk:hookEntity —— 泛化钩子（不含原文任何实体词）必须被滤除', () => {
    // 借鉴 tuna commit 11477b0：「Is the data reliable?」这类泛化问句自然被滤除。
    // 三条钩子必须都 ≥12 码点，否则会先被 gk:fragmentHook 拦下，测不到本条断言。
    expectRejected(
      good({ hooks: ['Is the data reliable here', '这条内容到底值得看吗朋友们', '大家觉得这条怎么样呢各位'] }),
      'gk:hookEntity',
    )
  })

  it('⑨ gk:tooOld —— newsline 超 72h 即否决（DB-03 #193：2024 年旧闻混进 2026 年信息流）', () => {
    expectRejected(good({ publishedAt: NOW - 100 * 3_600_000 }), 'gk:tooOld')
    // 未来时间戳同样是坏数据，会绕过所有时效判定
    expectRejected(good({ publishedAt: NOW + 86_400_000 }), 'gk:tooOld')
    // publishedAt=0（源未给时间，jina/bili 常态）不得按超时处理，否则整源被误杀
    expect(isAccepted(runAssertions(good({ publishedAt: 0 }), input({ batch: [good()] })))).toBe(true)
  })

  it('⑩ gk:shapeViolation —— 钩子数量/互异/限长、summary 与 why 限长、url 非空', () => {
    // 超长钩子必须**含原文实体词**，否则会先被 gk:hookEntity 拦下，测不到本条断言。
    // '知识冲突' 循环：既超 zh 上限 70 码点，又含实体 2-gram（知识/冲突/检索 均在原文里）。
    const tooLong = '知识冲突'.repeat(18) // 72 码点 > 70
    expect(Array.from(tooLong).length).toBe(72)

    expectRejected(good({ hooks: [good().hooks[0]!, good().hooks[1]!] }), 'gk:shapeViolation')
    expectRejected(good({ hooks: [good().hooks[0]!, good().hooks[0]!, good().hooks[2]!] }), 'gk:shapeViolation')
    expectRejected(good({ hooks: [tooLong, good().hooks[1]!, good().hooks[2]!] }), 'gk:shapeViolation')
    expectRejected(good({ summary: '摘'.repeat(301) }), 'gk:shapeViolation')
    expectRejected(good({ why: '为'.repeat(WHY_MAX + 1) }), 'gk:shapeViolation')
    expectRejected(good({ url: '' }), 'gk:shapeViolation')
    // 空标题会被**更早的** gk:blacklistRecheck 拦下（终审复跑门禁1 的 titleTooShort）。
    // 这是正确的纵深防御：断言按顺序跑，rejectionOf 取第一条失败。
    // 不得把它改成断言 shapeViolation——那会是在要求削弱前置断言。
    expectRejected(good({ title: '' }), 'gk:blacklistRecheck')
    // 且 shapeViolation 自身也能拦空标题（两道防线都得有效）
    const noTitle = runAssertions(good({ title: '' }), input({ batch: [good()] }))
    expect(noTitle.find((v) => v.ruleId === 'gk:shapeViolation')!.ok).toBe(false)
  })

  it('限长常量取自 src/render/tuna.ts，终审不得另立一套数字（tuna 5fca284 刚同步 zh70/en95）', () => {
    // zh 上限 70：70 码点通过、71 码点否决。两边都用含实体词的钩子，避开 gk:hookEntity 干扰。
    const at70 = '知识冲突'.repeat(17) + '知识' // 70 码点
    const at71 = at70 + '冲' // 71 码点
    expect(Array.from(at70).length).toBe(70)
    expect(Array.from(at71).length).toBe(71)

    expect(isAccepted(runAssertions(good({ hooks: [at70, good().hooks[1]!, good().hooks[2]!] }), input({ batch: [good()] })))).toBe(true)
    expectRejected(good({ hooks: [at71, good().hooks[1]!, good().hooks[2]!] }), 'gk:shapeViolation')
  })
})

describe('跨条目断言：gk:eventOversubscribed', () => {
  it('同一事件簇占位超 maxPerEvent 即否决（防递补绕过 capEvents）', () => {
    const three = [
      good({ id: 'domain-bot-newsline:abc1:0', eventKey: 'ev1', url: 'https://ex.com/1' }),
      good({ id: 'domain-bot-newsline:abc1:1', eventKey: 'ev1', url: 'https://ex.com/2' }),
      good({ id: 'domain-bot-newsline:abc1:2', eventKey: 'ev1', url: 'https://ex.com/3' }),
    ]
    const v = checkEventOversubscribed(three, gates)
    expect(v.ok).toBe(false)
    expect(v.ruleId).toBe('gk:eventOversubscribed')
    expect(v.detail).toContain('ev1')
  })

  it('占位不超上限时通过', () => {
    const two = [
      good({ id: 'domain-bot-newsline:abc1:0', eventKey: 'ev1', url: 'https://ex.com/1' }),
      good({ id: 'domain-bot-newsline:abc1:1', eventKey: 'ev1', url: 'https://ex.com/2' }),
    ]
    expect(checkEventOversubscribed(two, gates).ok).toBe(true)
  })
})

describe('BackfillPool：候补池按分递补，耗尽即停', () => {
  const mk = (id: string, score: number): ScoredItem => ({
    id, source: 'rss-1', title: `t-${id}`, body: '', url: `https://ex.com/${id}`,
    publishedAt: 0, valueScore: score, isNew: true, reason: '',
  })

  it('按分降序取，不按传入顺序', () => {
    const pool = new BackfillPool([mk('a', 0.3), mk('b', 0.9), mk('c', 0.6)])
    expect(pool.next()!.id).toBe('b')
    expect(pool.next()!.id).toBe('c')
    expect(pool.next()!.id).toBe('a')
  })

  it('耗尽返回 undefined 且不回绕重取（宁可少发也不重复放同一条）', () => {
    const pool = new BackfillPool([mk('a', 0.5)])
    expect(pool.next()!.id).toBe('a')
    expect(pool.exhausted).toBe(true)
    expect(pool.next()).toBeUndefined()
    expect(pool.next()).toBeUndefined()
    expect(pool.remaining).toBe(0)
    expect(pool.consumed).toBe(1)
  })

  it('不修改传入数组（避免上游 selected/pool 被就地重排）', () => {
    const arr = [mk('a', 0.3), mk('b', 0.9)]
    new BackfillPool(arr)
    expect(arr.map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('gatekeep 编排：渲染 → 断言 → 递补 → 事件复检 → 重编号', () => {
  const scored = (id: string, title: string, url: string, score: number, body?: string): ScoredItem => ({
    id, source: 'rss-1', title,
    body: body ?? 'KC-Bench 是首个评估 LLM 智能体动态知识冲突的交互基准，覆盖九款前沿模型。实验显示冲突时性能退化。',
    url, publishedAt: NOW - 3_600_000, valueScore: score, isNew: true,
    reason: '聚焦你的关注点「benchmark」',
  })

  const ctx = { persona, gates, now: NOW, digestId: 'abc1', stopwords: new Set(gates.dedupe.eventStopwords) }

  it('全部合格时按序发布，id 连续无空洞', () => {
    const selected = [
      scored('i1', 'KC-Bench: a benchmark for knowledge conflict in LLM reasoning', 'https://ex.com/1', 0.9),
      scored('i2', 'FlashInfer kernels accelerate transformer serving for LLM inference', 'https://ex.com/2', 0.8),
    ]
    const r = gatekeep(selected, [], ctx)
    expect(r.published).toHaveLength(2)
    expect(r.published.map((p) => p.id)).toEqual(['domain-bot-newsline:abc1:0', 'domain-bot-newsline:abc1:1'])
    expect(r.rejected).toHaveLength(0)
    expect(r.backfilled).toBe(0)
  })

  it('被否决的坑由候补池递补，递补项同样过十条断言', () => {
    const selected = [
      scored('i1', 'KC-Bench: a benchmark for knowledge conflict in LLM reasoning', 'https://ex.com/1', 0.9),
      // 违例：正文含 [object Object] → gk:damagedBody
      scored('bad', 'Some LLM inference benchmark study about transformer serving', 'https://ex.com/bad', 0.85, '[object Object]'),
    ]
    const pool = [scored('i3', 'MemHop embeds long term memory database for LLM agents', 'https://ex.com/3', 0.7)]
    const r = gatekeep(selected, pool, ctx)

    expect(r.rejected).toHaveLength(1)
    expect(r.rejected[0].ruleId).toBe('gk:damagedBody')
    expect(r.rejected[0].from).toBe('selected')
    // 递补进来了，且产出条数没缩水
    expect(r.backfilled).toBe(1)
    expect(r.published).toHaveLength(2)
    expect(r.published.some((p) => p.url === 'https://ex.com/3')).toBe(true)
    // 递补后重编号：id 仍连续
    expect(r.published.map((p) => p.id)).toEqual(['domain-bot-newsline:abc1:0', 'domain-bot-newsline:abc1:1'])
  })

  it('候补池里也是垃圾时不得放进来（宁可少发，不因凑数而降低门槛）', () => {
    // 主池 2 条：一条合格、一条坏数据；候补池 2 条全是坏数据。
    // 正确行为：只发 1 条（合格那条），候补全被否决，published < maxItems。
    const selected = [
      scored('i1', 'KC-Bench: a benchmark for knowledge conflict in LLM reasoning', 'https://ex.com/1', 0.9),
      scored('bad1', 'Some LLM inference benchmark study about transformer serving', 'https://ex.com/bad1', 0.85, '[object Object]'),
    ]
    const pool = [
      scored('bad2', 'Another LLM inference benchmark study on transformer serving', 'https://ex.com/bad2', 0.7, '[object Object]'),
      scored('bad3', 'Yet another LLM inference benchmark on transformer serving', 'https://ex.com/bad3', 0.6, '[object Object]'),
    ]
    const r = gatekeep(selected, pool, ctx)
    expect(r.published).toHaveLength(1)
    expect(r.published[0].url).toBe('https://ex.com/1')
    expect(r.backfilled).toBe(0)
    // 三条坏数据全被否决，且候补里的那两条标 from=backfill（看板要能区分「主池就烂」与「候补也烂」）
    expect(r.rejected).toHaveLength(3)
    expect(r.rejected.filter((x) => x.from === 'backfill')).toHaveLength(2)
    expect(r.rejected.every((x) => x.ruleId === 'gk:damagedBody')).toBe(true)
    expect(r.poolExhausted).toBe(true)
  })

  it('候补池耗尽即少发：published 可以小于 maxItems，绝不凑数', () => {
    const selected = [
      scored('bad', 'Some LLM inference benchmark study about transformer serving', 'https://ex.com/bad', 0.9, '[object Object]'),
    ]
    const r = gatekeep(selected, [], ctx)
    expect(r.published).toHaveLength(0)
    expect(r.poolExhausted).toBe(true)
    expect(r.rejected).toHaveLength(1)
  })

  it('渲染在断言之前：机械钩子只有渲染后才拦得到', () => {
    // renderPost 用 deriveHooks 生成钩子；断言作用于渲染产物而非 ScoredItem。
    // 若顺序颠倒（先断言 ScoredItem），机械截断/碎片钩子/浮点回显 三类缺陷全都测不到。
    const item = scored('i1', 'A Blind Trust the Bloody Thrust When Attacker Controlled Hook Updates Steer AI Agent Harnesses', 'https://ex.com/1', 0.9,
      'arXiv:2609.03884v1 Announce Type: cross Abstract: Modern AI agent harnesses expose lifecycle hooks that bind shell commands.')
    const rendered = renderPost(item, { persona, digestId: 'abc1', index: 0, stopwords: new Set(gates.dedupe.eventStopwords) })
    // arXiv 元数据必须被 stripMetadata 清掉，不得出现在 summary 或钩子里
    expect(rendered.summary).not.toContain('arXiv:2609')
    expect(rendered.hooks.join('\n')).not.toContain('Announce Type')
    for (const h of rendered.hooks) expect(h).not.toMatch(/^arxiv:\d+\.?/i)
    expect(isAccepted(runAssertions(rendered, input({ batch: [rendered] })))).toBe(true)
  })

  it('事件复检·候选充足分支：同事件超额时裁掉低分项，并强制多样性', () => {
    // maxItems=2 而候选有 3 条同事件 + 1 条独立事件 → 多样性足以填满 target，
    // 超额的同事件条目全部不要（eventTrimmed>0，非填充模式）
    const selected = [
      scored('i1', 'OpenAI Astra rollout continues across european regions for LLM serving', 'https://ex.com/1', 0.9),
      scored('i2', 'OpenAI Astra rollout expands into asian markets for LLM serving', 'https://ex.com/2', 0.8),
      scored('i3', 'OpenAI Astra rollout reaches enterprise customers for LLM serving', 'https://ex.com/3', 0.7),
      scored('i4', 'FlashInfer kernels accelerate transformer serving for LLM inference', 'https://ex.com/4', 0.6),
    ]
    const eventKeyOf = new Map([['i1', 'ev1'], ['i2', 'ev1'], ['i3', 'ev1'], ['i4', 'ev2']])
    // maxItems=3：ev1 最多占 2 个坑，第 3 条 i3 被降权排队，i4（ev2）补上第 3 个坑。
    // 这条断言的是「多样性在接受时就强制」——旧实现按分数序取满 target 就停，
    // i3 会先占满第 3 个坑、i4 永远进不来。
    const r = gatekeep(selected, [], { ...ctx, persona: { ...persona, maxItems: 3 }, eventKeyOf })
    expect(r.published).toHaveLength(3)
    expect(r.eventFillMode).toBe(false)
    expect(r.eventTrimmed).toBe(1) // i3 留在 deferred 未获回填
    expect(r.published.map((p) => p.url)).toEqual(['https://ex.com/1', 'https://ex.com/2', 'https://ex.com/4'])
    expect(checkEventOversubscribed(r.published, gates).ok).toBe(true)
  })

  it('事件复检·候选薄分支：宁发重复不发薄包，并显式标记 eventFillMode', () => {
    // maxItems=3 但只有 3 条同事件候选 → 多样性最多给 2 条，不足 target。
    // 此时**不得**为了多样性发一个 2 条的薄包：「宁缺毋滥」适用于质量（十条客观断言），
    // 不适用于事件多样性——用不可靠的词法聚类结果惩罚用户是错的。
    const selected = [
      scored('i1', 'OpenAI Astra rollout continues across european regions for LLM serving', 'https://ex.com/1', 0.9),
      scored('i2', 'OpenAI Astra rollout expands into asian markets for LLM serving', 'https://ex.com/2', 0.8),
      scored('i3', 'OpenAI Astra rollout reaches enterprise customers for LLM serving', 'https://ex.com/3', 0.7),
    ]
    const eventKeyOf = new Map([['i1', 'ev1'], ['i2', 'ev1'], ['i3', 'ev1']])
    const r = gatekeep(selected, [], { ...ctx, eventKeyOf })
    expect(r.published).toHaveLength(3) // 填满 target，不发薄包
    expect(r.eventFillMode).toBe(true) // 但必须显式暴露：本轮防刷屏能力降级
    // 填充模式下 checkEventOversubscribed 必然不 ok——这是已知取舍，不是缺陷
    expect(checkEventOversubscribed(r.published, gates).ok).toBe(false)
  })

  it('跨产线指纹库命中在终审层也拦一次（门禁 3 之外的第二道保险）', () => {
    const selected = [scored('i1', 'KC-Bench: a benchmark for knowledge conflict in LLM reasoning', 'https://ex.com/1', 0.9)]
    const r = gatekeep(selected, [], { ...ctx, knownCanonical: new Set(['https://ex.com/1']) })
    expect(r.published).toHaveLength(0)
    expect(r.rejected[0].ruleId).toBe('gk:alreadyPublished')
  })
})

describe('质量看板：漏斗必须可对账', () => {
  const baseBoard = {
    persona: 'newsline',
    personaDisplay: 'AI时事快线',
    digestId: 'abc1',
    generatedAt: NOW,
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
      enabled: false,
      active: false,
      inactiveReason: '未配置编辑部',
      writerDegradedBatches: 0,
      reviewerDegradedBatches: 0,
      truncatedBatches: 0,
      calibrationPassed: null,
      calibrationProblems: [],
      endpoints: [],
      llmCopyCount: 0,
    },
  }
  const published = Array.from({ length: 18 }, (_, i) => ({ source: i < 10 ? 'rss-1' : 'exa-1', lang: i % 2 ? 'zh' : 'en' }))

  it('自洽看板零问题，且派生统计正确', () => {
    const b = buildBoard(baseBoard, published)
    expect(auditBoard(b).fatal).toEqual([])
    expect(b.qualityYieldRatio).toBeCloseTo(0.18, 10)
    expect(b.perSourcePublished).toEqual({ 'rss-1': 10, 'exa-1': 8 })
    expect(b.langDistribution).toEqual({ zh: 9, en: 9 })
    expect(b.schema).toBe('domain-bot-quality-board-v1')
  })

  it('必须明写 selfEvolutionActive=false 并注明原因（不得让读者以为自进化在跑）', () => {
    const b = buildBoard(baseBoard, published)
    expect(b.selfEvolutionActive).toBe(false)
    expect(b.selfEvolutionNote).toContain('Telegram')
    expect(b.selfEvolutionNote).toContain('DB-06')
  })

  it('漏斗非单调 → 报不自洽', () => {
    const b = buildBoard(
      { ...baseBoard, funnel: [{ stage: 'collected', count: 10 }, { stage: 'published', count: 20 }] },
      published,
    )
    expect(auditBoard(b).fatal.some((p) => p.includes('非单调'))).toBe(true)
  })

  it('漏斗末层与实际发布数不符 → 报不自洽（防"看板只是修辞"）', () => {
    const b = buildBoard({ ...baseBoard, funnel: baseBoard.funnel.map((f) => (f.stage === 'published' ? { ...f, count: 99 } : f)) }, published)
    expect(auditBoard(b).fatal.some((p) => p.includes('perSourcePublished'))).toBe(true)
  })

  it('dropped + rejected 超过入口 → 报重复计账', () => {
    const b = buildBoard(
      {
        ...baseBoard,
        dropped: Array.from({ length: 200 }, () => ({ itemId: 'x', title: 't', source: 's', url: '', gate: 'blacklist' as const, ruleId: 'r', reason: 'x' })),
      },
      published,
    )
    expect(auditBoard(b).fatal.some((p) => p.includes('超过入口'))).toBe(true)
  })

  it('配置正则编译失败必须显式暴露（一条失效规则=闸门假绿）', () => {
    const b = buildBoard(
      { ...baseBoard, compileErrors: [{ gate: 'blacklist' as const, ruleId: 'broken:demo', error: 'Unterminated group' }] },
      published,
    )
    const audit = auditBoard(b)
    expect(audit.fatal.some((p) => p.includes('broken:demo'))).toBe(true)
    expect(audit.fatal.some((p) => p.includes('闸门假绿'))).toBe(true)
  })
})

// ---------- DB-11 修复回归锁（D1 裸 HTML / D2 why 语言 / D3 空壳 / D5 词边界截断） ----------

import { truncateWhy } from '../src/render/tuna.js'
import { HeuristicScorer } from '../src/refinery/scorer.js'
import type { DomainConfig, RawItem } from '../src/types.js'
import type { WrittenCopy } from '../src/editorial/writer.js'

describe('DB-11 修复回归锁：交付文本必须可直接上屏（tuna local-brief 路径无 sanitize）', () => {
  /** 与 :241 的 scored 同构（那个 helper 在另一 describe 内，这里自备一份）。 */
  const mkScored = (id: string, title: string, url: string, score: number, body?: string): ScoredItem => ({
    id,
    title,
    url,
    body: body ?? title,
    source: 'rss-1',
    publishedAt: NOW - 3_600_000,
    valueScore: score,
    reason: '',
    isNew: true,
  })
  const copyOf = (why: string): WrittenCopy => ({
    hooks: ['first hook long enough text', 'second hook long enough text', 'third hook long enough text'],
    summary: 'A substantive summary of the piece.',
    why,
    origin: 'fallback' as const,
  })

  it('⑪ gk:htmlLeak —— 任意字段含裸 HTML 标签即否决（D1，样例取自 DB-11 报告 newsline#5）', () => {
    expectRejected(
      good({ summary: '<p>Article URL: <a href="https://engineering.atspotify.com/x">original</a></p>' }),
      'gk:htmlLeak',
    )
    expectRejected(good({ why: 'why has <strong>bold</strong> inside' }), 'gk:htmlLeak')
    // 干净样本不得误伤
    const clean = good()
    expect(isAccepted(runAssertions(clean, input({ batch: [clean] })))).toBe(true)
  })

  it('⑫ gk:hollowSummary —— 平台 chrome 空壳（视频观看数/落地页导航）即否决（D3）', () => {
    // 钩子须与 chrome 实体同源（gk:hookEntity 要求），否则先被 ⑧ 拦下、测不到本断言
    const ytHooks = ['Subscribe Share 频道订阅与分享数据', '频道 · 订阅 · 分享 数据卡', 'ai-llm｜频道 · subscribe']
    expectRejected(
      good({ hooks: ytHooks, summary: '频道 · 1.2万次观看', body: '频道 · 1.2万次观看 Subscribe Share' }),
      'gk:hollowSummary',
    )
    const navHooks = ['Filter and Sort on the Latest News page', 'latest · news · filter · sort', 'ai-llm｜filter · latest']
    expectRejected(
      good({ hooks: navHooks, summary: 'Filter Sort Latest News 123K views', body: 'Filter Sort Latest News 123K views' }),
      'gk:hollowSummary',
    )
  })

  it('D1 渲染层：title/body 含裸 HTML 时，渲染产物（标题/钩子/摘要/底料）必须全部纯净', () => {
    const item = mkScored(
      'i-html',
      '<p>Spotify engineering <a href="https://engineering.atspotify.com/x">wrote about LLM serving</a></p>',
      'https://ex.com/html',
      0.9,
      '<strong>Genie</strong> is a benchmark for agentic LLM tool use with 12 sandboxed execution tasks.',
    )
    const rendered = renderPost(item, { persona, digestId: 'abc1', index: 0, stopwords: new Set(gates.dedupe.eventStopwords) })
    for (const field of [rendered.title, rendered.summary, rendered.body, ...rendered.hooks]) {
      expect(field).not.toMatch(/<\/?\w+[^>]*>/)
    }
    expect(rendered.summary).toContain('Genie is a benchmark')
    expect(isAccepted(runAssertions(rendered, input({ batch: [rendered] })))).toBe(true)
  })

  it('D2 why 语言随条目：英文条目产英文 why（HeuristicScorer 与 renderPost 兜底两层）', async () => {
    const scorer = new HeuristicScorer()
    const domain: DomainConfig = { domain: 'ai-llm', keywords: ['llm'], clusterThreshold: 0.35 }
    const rows: RawItem[] = [
      { id: 'x', source: 'rss', title: 'New LLM inference runtime released', body: 'A new LLM inference runtime outperforms prior kernels', url: 'https://e.com/1', publishedAt: 0 },
    ]
    const r = await scorer.score(rows, domain)
    expect(r[0]!.reason).toMatch(/^Matches your interest/)

    const enItem = mkScored('i-en', 'A Blind Trust When Attacker Controlled Hook Updates Steer AI Agent Harnesses', 'https://ex.com/en', 0.9,
      'Modern AI agent harnesses expose lifecycle hooks that bind shell commands and steer model behavior.')
    const rendered = renderPost(enItem, { persona, digestId: 'abc1', index: 0, stopwords: new Set(gates.dedupe.eventStopwords) })
    expect(rendered.lang).toBe('en')
    expect(rendered.why).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('D5 why 词边界截断：truncateWhy 不产生 benchmar… 式半词，且不超 WHY_MAX', () => {
    const longWhy = 'Matches your interests in llm, inference and a strong "benchmark" signal for serving workloads'
    const cut = truncateWhy(longWhy, WHY_MAX)
    expect(Array.from(cut).length).toBeLessThanOrEqual(WHY_MAX)
    expect(cut.endsWith('…')).toBe(true)
    // 省略号前的英文单词必须是原文里的完整单词（词边界切分），不得是 benchmar 这类残词
    const lastWord = cut.match(/([A-Za-z]+)…$/)?.[1]
    if (lastWord) expect(longWhy).toContain(lastWord)
    // 短文本原样通过；无空格超长串退化为硬切，不无限丢字
    expect(truncateWhy('短why', WHY_MAX)).toBe('短why')
    expect(Array.from(truncateWhy('a'.repeat(80), 40)).length).toBeLessThanOrEqual(WHY_MAX)
  })
})
