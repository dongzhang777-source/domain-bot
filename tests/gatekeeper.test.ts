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
import { HeuristicScorer } from '../src/refinery/scorer.js'
import { TITLE_ECHO_OVERLAP, BODY_MIN, titleOverlap, WHY_MAX } from '../src/render/tuna.js'
import type { GatesConfig, GatekeeperInput, PersonaConfig, ScoredItem } from '../src/types.js'

/**
 * 主编终审：十条硬断言**各造一个违例样本**，逐个断言被否决。
 *
 * 违例样本尽量取自 DB-03 审计的真实缺陷（`[object Object]`、`"arXiv:2609."`、
 * `"AI深度思想·rss：价值 0.94"`、招聘帖、2024 年旧闻），不用合成玩具串——
 * 终审要拦的就是那些，拿玩具串测等于没测。
 */

const gates = JSON.parse(readFileSync(join(process.cwd(), 'config/gates.json'), 'utf8')) as GatesConfig

/** L3 正文下限（gk:bodyBelowFloor，zh600/en900）之后，fixture 默认底料必须像真实内容
 * （产线 body 中位 1200 码点）而不是合成短句——短到过不了自己闸门的样本测不出回归。 */
const LONG_BODY_PAD =
  '这一实验同时在三类硬件配置上复测，覆盖本地 4090 工作站、A100 云节点与消费级笔记本，以验证结论在不同算力条件下的稳定性。' +
  '作者还开放了完整的评测脚本、原始日志与复现指南，社区可以在自己的环境里以一条命令重建全部图表。' +
  '讨论区目前最集中的争议在于采样温度的选择是否系统性抬高了基线，作者回应将在下一版补充温度扫描实验，并承诺把全部中间产物一并开源。' +
  '此外，论文附录给出了每个子任务的误差条与置信区间，跨三次随机种子的方差控制在百分之一点二以内，显著优于前作的百分之四点七，' +
  '这也解释了为什么多个独立团队在复现时得到的高度一致的数字。' +
  '部署侧的实测数据同样值得关注：在开启连续批处理后，单卡吞吐提升约百分之三十七，尾延迟中位数保持在两百毫秒以内，' +
  '代价是显存占用上升两成三，对小显存设备不够友好；作者给出的折中方案是把 KV 缓存量化到八比特，实测质量损失在一个点以内，' +
  '不过该方案在长上下文场景尚无充分数据，团队计划在下个版本补齐五万 token 级别的压力测试与对比曲线。' +
  '在工程落地层面，作者演示了三条接入路径：裸 HTTP 服务、LangChain 回调封装，以及面向推理引擎的 C++ 插件，三者的基准数据相差在一成半以内，团队可以按既有技术栈就近选择，不需要为评测本身迁移基础设施。' +
  '附录还逐条回应了审稿人关于数据泄漏的质疑：全部评测集在模型权重冻结之后才发布，训练语料的时间截断点早于评测集六个月，n-gram 重合度扫描为零，公开的检查点哈希与训练日志一一对应，可供第三方独立核对。'

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
    summary:
      'KC-Bench 是首个评估 LLM 智能体动态知识冲突的交互基准，覆盖九款前沿模型。实验设计上，基准把「参数知识」与「检索上下文」同时喂给模型，再测量其在两类信息打架时的判断质量，从而暴露 RAG 系统最常见的隐性失败模式。这一失败模式在检索增强生成（RAG）系统里尤为常见，工程团队需要专门的评测手段来定位。评测结论对 nine-model 对比表的解读也有提示：冲突越大，检索质量的边际收益越低。',
    body: 'KC-Bench 是首个评估 LLM 智能体动态知识冲突的交互基准，覆盖九款前沿模型。实验显示参数知识与检索上下文冲突时性能明显退化。' + LONG_BODY_PAD,
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

describe('十三条硬断言：违例样本逐个否决', () => {
  it('基准样本必须全绿（否则各违例用例测的是别的失败原因）', () => {
    const g = good()
    const verdicts = runAssertions(g, input({ batch: [g] }))
    expect(verdicts).toHaveLength(14)
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

  it('⑪ gk:summaryBelowFloor —— 概要低于下限（zh<200 / en<300 码点）拒收（2026-09-06 老张篇幅令）', () => {
    // 基准 fixture summary 已加长至 zh 区间内；这里造一条低于下限的薄稿
    expectRejected(good({ summary: '太短的概要。' }), 'gk:summaryBelowFloor')
    // en 下限 300：一条 250 码点的英文概要同样拒收
    expectRejected(good({ lang: 'en', summary: 'x'.repeat(250) }), 'gk:summaryBelowFloor')
    // zh 区间内（200–300）放行、恰好等于下限放行（闭区间）
    const atFloor = good({ summary: '知'.repeat(200) })
    expect(isAccepted(runAssertions(atFloor, input({ batch: [atFloor] })))).toBe(true)
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
    // body 须 ≥ zh 概要下限 200 码点：概要过短时渲染层 ensureSummaryFloor 从 body 补句，
    // body 无料可补则触发 gk:summaryBelowFloor 拒收（2026-09-06 篇幅令）。此文本实测 201 码点。
    body: body ??
      ('KC-Bench 是首个评估 LLM 智能体动态知识冲突的交互基准，覆盖九款前沿模型。实验设计上，基准把「参数知识」与「检索上下文」同时喂给模型，再测量其在两类信息打架时的判断质量，从而暴露 RAG 系统最常见的隐性失败模式。这一失败模式在检索增强生成（RAG）系统里尤为常见，工程团队需要专门的评测手段来定位。评测结论对 nine-model 对比表的解读也有提示：冲突越大，检索质量的边际收益越低。' + LONG_BODY_PAD),
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
      'arXiv:2609.03884v1 Announce Type: cross Abstract: Modern AI agent harnesses expose lifecycle hooks that bind shell commands. These results highlight how evaluation design shapes reported capability gaps across model families, harness implementations, and retrieval configurations in practice. Benchmark coverage spans tool selection, parameter passing, and error recovery under sandboxed execution, which is where real deployments fail first. ' + LONG_BODY_PAD)
    const rendered = renderPost(item, { persona, digestId: 'abc1', index: 0, stopwords: new Set(gates.dedupe.eventStopwords) })
    // arXiv 元数据必须被 stripMetadata 清掉，不得出现在 summary 或钩子里
    expect(rendered.summary).not.toContain('arXiv:2609')
    expect(rendered.hooks.join('\n')).not.toContain('Announce Type')
    for (const h of rendered.hooks) expect(h).not.toMatch(/^arxiv:\d+\.?/i)
    expect(isAccepted(runAssertions(rendered, input({ batch: [rendered] })))).toBe(true)
  })

  it('DB-12/D6：首句同源的条目走机械兜底后仍过终审（去冗余不得引入新违例）', () => {
    // 真实形态取自 DB-11 §B5 #0：正文首句就是标题主体。去冗余会改写钩子组合，
    // 改写后的钩子必须仍同时满足 gk:mechanicalTruncation / gk:hookEntity / gk:shapeViolation。
    const item = scored(
      'i1',
      'neuronto/agentic-resource-discovery: Neuronto Agentic Resource Discovery (ARD) Index',
      'https://ex.com/1',
      0.9,
      'Neuronto Agentic Resource Discovery (ARD) Index. Federated search across every public ARD registry, ' +
        'plus a verified tool index read from each MCP server. Hybrid lexical and semantic retrieval, and ARD-Bench. ' +
        'These results highlight how evaluation design shapes reported capability gaps across model families, ' +
        'harness implementations, and retrieval configurations in practice. ' + LONG_BODY_PAD,
    )
    const rendered = renderPost(item, { persona, digestId: 'abc1', index: 0, stopwords: new Set(gates.dedupe.eventStopwords) })
    expect(rendered.hooks).toHaveLength(3)
    // DB-11 §B5 的口径是 hook[0]：门面位不得是标题复读（实体卡字符天然来自标题，不在此判）
    expect(
      titleOverlap(rendered.hooks[0]!, rendered.title),
      `门面钩子与标题重叠过高：${rendered.hooks[0]}`,
    ).toBeLessThan(TITLE_ECHO_OVERLAP)
    const verdicts = runAssertions(rendered, input({ batch: [rendered] }))
    expect(
      isAccepted(verdicts),
      `未过终审：${JSON.stringify(verdicts.filter((v) => !v.ok))}`,
    ).toBe(true)
  })

  it('DB-12/D4：无命中条目走完 打分→渲染 后，why 非空、≤40 码点、语言随条目、不再是通用模板', async () => {
    // 走真实产物路径：HeuristicScorer（无关键词命中）→ ScoredItem.reason → renderPost 兜底 why
    const scorer = new HeuristicScorer()
    const raw = [
      { title: 'GeoJSON Map Viewer', body: 'A tiny tool to preview GeoJSON files on a map.' },
      { title: '智能体记忆管理的实践笔记', body: '记录我们在生产环境里做智能体记忆管理的做法。' },
    ]
    const domainCfg = {
      domain: 'ai-llm',
      keywords: ['rag'],
      signalWords: ['beat'],
      scoreThreshold: 0.45,
      maxPerDigest: 6,
      clusterThreshold: 0.35,
    }
    const scores = await scorer.score(
      raw.map((r) => ({ id: r.title, source: 'rss-1', title: r.title, body: r.body, url: '', publishedAt: NOW - 3_600_000 })),
      domainCfg,
    )
    const items: ScoredItem[] = raw.map((r, i) => ({
      id: r.title,
      source: 'rss-1',
      title: r.title,
      body: r.body,
      url: `https://ex.com/${i}`,
      publishedAt: NOW - 3_600_000,
      valueScore: scores[i]!.valueScore,
      isNew: true,
      reason: scores[i]!.reason,
    }))
    const render = (i: ScoredItem) =>
      renderPost(i, { persona, digestId: 'abc1', index: 0, stopwords: new Set(gates.dedupe.eventStopwords) })
    for (const item of items) {
      const out = render(item)
      const n = Array.from(out.why).length
      expect(n, `why 非空：${out.why}`).toBeGreaterThan(0)
      expect(n, `why ${n} 码点超上限：${out.why}`).toBeLessThanOrEqual(WHY_MAX)
      expect(out.why).not.toMatch(/\d\.\d/)
      expect(out.why).not.toContain('与「ai-llm」相关')
      expect(out.why).not.toContain('Related to your ai-llm feed')
    }
    // 语言随条目（DB-11/D2 的意图在兜底分支同样成立）
    expect(render(items[0]!).why).toMatch(/^Picked for /)
    expect(render(items[1]!).why).toMatch(/^因「/)
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
    body: body ?? (title + LONG_BODY_PAD),
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
    // 任意标签形模式都拦（含 LLM 会话转录的 XML 形标签），白名单式会漏
    expectRejected(good({ why: 'transcript has <user> tags inside' }), 'gk:htmlLeak')
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
      '<strong>Genie</strong> is a benchmark for agentic LLM tool use with 12 sandboxed execution tasks. These results highlight how evaluation design shapes reported capability gaps across model families, harness implementations, and retrieval configurations in practice. Benchmark coverage spans tool selection, parameter passing, and error recovery under sandboxed execution. ' + LONG_BODY_PAD,
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

// ---------- L3 篇幅（2026-09-07 老张「很多 L3 级内容篇幅不够」） ----------

describe('L3 篇幅：亲写 body 覆盖 + gk:bodyBelowFloor', () => {
  const gates = JSON.parse(readFileSync(join(process.cwd(), 'config/gates.json'), 'utf8')) as GatesConfig
  const persona: PersonaConfig = {
    id: 'newsline', displayName: 'AI时事快线', domain: 'ai-llm', sources: ['rss-1'],
    maxAgeHours: 72, maxItems: 3, minQualityScore: 6, clusterThreshold: 0.35, rejectRules: [],
  }
  function scored(id: string, title: string, url: string, valueScore: number, body: string): ScoredItem {
    return { id, title, url, valueScore, body, source: 'rss-1', publishedAt: Date.now(), lang: 'zh' } as ScoredItem
  }
  const longCopyBody = '这是一段足够长的亲写中文正文，用于验证编辑部把 L3 心流层写足的契约。'.repeat(20) // ≈1400 码点

  it('copy.body 存在时覆盖原文底料，且过同一清洗链（stripHtml/stripMetadata）', () => {
    const item = scored('i1', '某论文标题', 'https://ex.com/1', 0.9, '原文底料——不应出现在 L3。')
    const rendered = renderPost(item, {
      persona, digestId: 'abc1', index: 0, stopwords: new Set(gates.dedupe.eventStopwords),
      copy: { hooks: ['钩子一', '钩子二', '钩子三'], summary: '摘要', why: '相关', body: `<p>${longCopyBody}</p>`, origin: 'llm' },
    })
    expect(rendered.body).not.toContain('原文底料')
    expect(rendered.body).toContain('亲写中文正文')
    expect(rendered.body).not.toContain('<p>')
  })

  it('copy.body 缺省时回退原文底料（既有契约不回退）', () => {
    const original = '清洗后的原文底料，采集端截断已放宽到 6000 码点。' + 'x'.repeat(700)
    const item = scored('i1', '某论文标题', 'https://ex.com/1', 0.9, original)
    const rendered = renderPost(item, { persona, digestId: 'abc1', index: 0, stopwords: new Set(gates.dedupe.eventStopwords) })
    expect(rendered.body).toContain('原文底料')
  })

  it('gk:bodyBelowFloor：断头料（<下限）拒收，亲写足稿放行', () => {
    const thin = scored('i1', '某推文', 'https://ex.com/1', 0.9, '就一句话的短正文。')
    const thinRendered = renderPost(thin, { persona, digestId: 'abc1', index: 0, stopwords: new Set(gates.dedupe.eventStopwords) })
    const thinVerdicts = runAssertions(thinRendered, input({ batch: [thinRendered] }))
    const bodyFail = thinVerdicts.find((v) => v.ruleId === 'gk:bodyBelowFloor')
    expect(bodyFail?.ok).toBe(false) // 断言本身红即可；rejectionOf 取首违例，可能被前置断言抢占

    const rich = scored('i2', '某论文标题', 'https://ex.com/2', 0.9, '短原文。')
    const richRendered = renderPost(rich, {
      persona, digestId: 'abc1', index: 0, stopwords: new Set(gates.dedupe.eventStopwords),
      copy: { hooks: ['钩子一', '钩子二', '钩子三'], summary: '摘要', why: '相关', body: longCopyBody, origin: 'llm' },
    })
    const richVerdicts = runAssertions(richRendered, input({ batch: [richRendered] }))
    expect(rejectionOf(richVerdicts)?.ruleId).not.toBe('gk:bodyBelowFloor')
  })

  it('BODY_MIN 双档：zh 600 / en 900（数值钉死，防无意放宽）', () => {
    expect(BODY_MIN).toEqual({ zh: 600, en: 900 })
  })
})
