import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPipeline } from '../src/pipeline.js'
import { auditBoard } from '../src/gatekeeper/board.js'
import { canonicalUrl } from '../src/collector/canonicalUrl.js'
import { isTitlePrefix } from '../src/render/tuna.js'
import type { DomainConfig, GatesConfig, PersonaConfig, SourceConfig } from '../src/types.js'
import type { GoldSample } from '../src/editorial/calibrate.js'

/**
 * 内容质量回归：**堵住「测试全绿而交付内容是垃圾」这个盲区**。
 *
 * 为什么必须有这一层（根仓 DRIFT D-09 的核心事实）：DB-04 之前 `npm test` 149/149 全绿，
 * 而老张真机刷到的 172 条里 **65 条（32.5%）应剔除**（DB-03 全量逐条审计）。
 * 根因是测试守的是仓内管线的 6 条摘要格式，用户看到的内容产自仓库外的
 * `/tmp/tuna-feed-run/edit.mjs` + 人肉终审 + 人工拷贝，**从不在任何测试覆盖范围内**。
 *
 * 本文件的夹具全部是 DB-03 审计里的**真实垃圾条目**（取自
 * `tests/fixtures/gold-standard.json`，即 agy 200 条逐条判定的原始结论），
 * 不用合成玩具串——闸门要拦的就是那 65 条，拿玩具串测等于没测。
 */

const gates = JSON.parse(readFileSync(join(process.cwd(), 'config/gates.json'), 'utf8')) as GatesConfig
const gold = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/gold-standard.json'), 'utf8')) as { samples: GoldSample[] }

/** DB-03 判定为「剔除」的真实垃圾（0-4 分）。这就是产线必须拦下的东西。 */
const KNOWN_BAD = gold.samples.filter((s) => s.humanDecision === '剔除')
/** DB-03 判定为「保留」的高质量条目（≥7 分）。这些必须能过闸门，否则闸门只是在杀内容。 */
const KNOWN_GOOD = gold.samples.filter((s) => s.humanScore >= 7)

/**
 * 剔除理由属**语义判断**、模式匹配本质上做不到的条目。
 *
 * 列在这里而不是静默跳过：它们是 DB-05（LLM reviewer）的待办清单，
 * 下方有专门用例断言这份清单与金标集一致、且规模不得增长。
 */
const SEMANTIC_ONLY = new Set(['db03-060', 'db03-148'])

const domain: DomainConfig = { domain: 'ai-llm', keywords: ['llm'], clusterThreshold: 0.35 }
const sources: SourceConfig[] = [{ id: 'feed-1', type: 'rss', url: 'http://e/rss', weight: 0.5, enabled: true }]

function persona(overrides: Partial<PersonaConfig> = {}): PersonaConfig {
  // **必须加载真实配置**，不得内联一份：内联会漏掉 rejectRules（首次跑本测试就因此
  // 没测到生产配置里的 nameExplainer 红线，`What Is a LLM? Key Concepts Explained` 直接泄漏）。
  // 测试的职责是验证生产配置拦得住垃圾，而不是验证一份只存在于测试里的理想配置。
  const real = JSON.parse(
    readFileSync(join(process.cwd(), 'config/personas/deepthought.json'), 'utf8'),
  ) as PersonaConfig
  return {
    ...real,
    sources: ['feed-1'],
    // 用 deepthought 的 720h 窗：夹具里的条目由 rssOf 统一赋近期 pubDate，
    // 本文件测的是内容质量而不是时效（时效另有 persona/gatekeeper 用例覆盖）。
    maxAgeHours: 720,
    maxItems: 200,
    ...overrides,
  }
}

/**
 * 把金标条目渲染成 RSS，喂给真产线（不联网，用注入的 fetchFn）。
 *
 * **故意不发 pubDate**：六个渠道里 bili / ytsearch / jina 四个恒返回 `publishedAt = 0`
 * （源不给时间），DB-03 #193 的「AI 大模型周报 2024年10月」正是从这条路径泄漏的。
 * 给夹具伪造近期时间戳会让 `persona:staleYearInTitle` 这条新闸门永远测不到。
 */
function rssOf(samples: GoldSample[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const items = samples
    .map(
      (s) =>
        `<item><title>${esc(s.title)}</title><description>${esc(s.body ?? '')}</description><link>https://db03.example/${s.id}</link></item>`,
    )
    .join('\n')
  return `<?xml version="1.0"?><rss><channel><title>DB-03 gold standard replay</title>${items}</channel></rss>`
}

async function runSamples(samples: GoldSample[], overrides: Partial<PersonaConfig> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dbot-quality-'))
  const xml = rssOf(samples)
  return runPipeline({
    persona: persona(overrides),
    gates,
    domain,
    sources,
    memoryDir: join(dir, 'memory'),
    fetchFn: async () => ({ ok: true, status: 200, text: async () => xml }),
    now: Date.parse('2026-09-04T12:00:00Z'),
  })
}

describe('内容质量回归：DB-03 的真实垃圾必须一条都进不了产出', () => {
  it('全部剔除样本喂进去，可模式化的垃圾零泄漏', async () => {
    expect(KNOWN_BAD.length).toBeGreaterThanOrEqual(20) // 夹具规模守卫：太少测不出东西
    const r = await runSamples(KNOWN_BAD)

    const publishedTitles = new Set(r.published.map((p) => p.title))
    const publishedUrls = new Set(r.published.map((p) => canonicalUrl(p.url)))
    const leaked: string[] = []
    for (const bad of KNOWN_BAD) {
      if (SEMANTIC_ONLY.has(bad.id)) continue // 见上方声明：这类只能靠 DB-05 的 reviewer
      const url = canonicalUrl(`https://db03.example/${bad.id}`)
      // 标题会被 truncateChars 截到 120 码点，故按前缀比对
      const titleHit = [...publishedTitles].some((t) => t.startsWith(bad.title.slice(0, 40)) || bad.title.startsWith(t.slice(0, 40)))
      if (publishedUrls.has(url) || titleHit) leaked.push(`${bad.id} ${bad.title.slice(0, 50)}（${bad.reason ?? '未注明'}）`)
    }
    expect(leaked, `以下 DB-03 判定应剔除的条目泄漏进了产出：\n${leaked.join('\n')}`).toEqual([])
  })

  it('语义类泄漏已显式挂账 DB-05（不得静默忽略，也不得用脆弱正则硬凑）', () => {
    // 这几条的剔除理由是**语义判断**，模式匹配本质上做不到：
    // - db03-060 「同质化/炒作」：它是另一条报道的洗稿转述，需跟全批对比才能判
    // - db03-148 「劣质空仓库」：标题已用 damaged:emptyRepoDesc 拦住，但「仓库无有效代码」本身是语义判断
    // 强行用正则覆盖会误杀大量合法内容（如正常的对比评测、正常的空描述仓库）。
    // DB-05 的 reviewer 就是为这类而设：它拿得到全批上下文与正文。
    for (const id of SEMANTIC_ONLY) {
      const sample = gold.samples.find((s) => s.id === id)
      expect(sample, `SEMANTIC_ONLY 里的 ${id} 已不在金标集，请同步清理`).toBeTruthy()
      expect(sample!.humanDecision).toBe('剔除')
    }
    // 挂账必须可机读：看板/台账靠它追踪，不得只写在注释里
    expect(SEMANTIC_ONLY.size).toBeGreaterThan(0)
    expect(SEMANTIC_ONLY.size).toBeLessThanOrEqual(4) // 超过 4 条说明闸门在把活推给 LLM，得回头补规则
  })

  it('七大顽疾逐类点名验证（不得只测总量，否则某类全放过也看不出来）', async () => {
    const r = await runSamples(KNOWN_BAD)
    const blob = JSON.stringify(r.published)

    // 1. 数据损坏
    expect(blob).not.toContain('[object Object]')
    // 2. 招聘
    expect(blob).not.toMatch(/招全栈开发工程师/)
    // 3. 中转站广告
    expect(blob).not.toMatch(/注册送/)
    // 4. 卖课
    expect(blob).not.toMatch(/学完即就业|零基础入门教程|小学生都能学会/)
    // 5. 过期旧闻（2024 年 10 月的周报）
    expect(blob).not.toMatch(/2024年10月/)
    // 6. 个人简历/实习作业/求职笔试
    expect(blob).not.toMatch(/portfolio|Internship|examenQA/i)
    // 7. 领域无关硬件（DB-03 §2.1 的自行车码表，单正则时代的标志性误放）
    expect(blob).not.toMatch(/eInk Bike Computer/i)
    // 社区碎片与拉群
    expect(blob).not.toMatch(/自救群|是不是一个常用语|额度已经消耗完/)
    // 过期旧闻：bili/yt/jina 恒返回 publishedAt=0，时效闸对它们无效，
    // 只能靠标题里的显式年份拦（persona:staleYearInTitle）
    expect(r.dropped.some((d) => d.ruleId === 'persona:staleYearInTitle')).toBe(true)
  })

  it('产出零机械钩子、零碎片、零浮点回显（DB-03 §2.4 的三类文案缺陷）', async () => {
    // 混入合格条目，确保产出非空——否则"零缺陷"是因为一条都没发
    const r = await runSamples([...KNOWN_GOOD, ...KNOWN_BAD])
    expect(r.published.length).toBeGreaterThan(0)

    for (const p of r.published) {
      for (const h of p.hooks) {
        expect(isTitlePrefix(h, p.title), `钩子是标题前缀截断：${h}`).toBe(false)
        expect(h, `钩子是 arXiv 碎片：${h}`).not.toMatch(/^arxiv:\d+\.?/i)
        expect(Array.from(h).length, `钩子过短：${h}`).toBeGreaterThanOrEqual(12)
      }
      expect(p.why, `why 回显浮点数：${p.why}`).not.toMatch(/价值\s*\d\.\d|\d\.\d{2}/)
      expect(p.summary).not.toContain('Announce Type')
      expect(p.summary).not.toMatch(/^\s*arXiv:/i)
    }
  })

  it('产出零重复规范 URL（DB-03 实测 12 条一字不差的完全重复）', async () => {
    // 故意注入同一 URL 的跟踪参数变体与逐字重复标题
    const dupes: GoldSample[] = [
      // 标题含 core 词（openai/llm），否则会被 relevance 闸门拦掉，测不到 URL 去重那一层
      { id: 'dup-a', title: 'Corporate America is getting hooked on open-source LLM models', body: 'NYT investigation on enterprise adoption of open LLM inference stacks.', humanScore: 8, humanDecision: '保留' },
      { id: 'dup-b', title: 'Corporate America is getting hooked on open-source LLM models', body: 'NYT investigation on enterprise adoption of open LLM inference stacks.', humanScore: 0, humanDecision: '剔除' },
    ]
    const dir = mkdtempSync(join(tmpdir(), 'dbot-quality-dup-'))
    const xml = rssOf(dupes).replace('https://db03.example/dup-b', 'https://db03.example/dup-a?utm_source=newsletter&fbclid=xyz')
    const r = await runPipeline({
      persona: persona(),
      gates,
      domain,
      sources,
      memoryDir: join(dir, 'memory'),
      fetchFn: async () => ({ ok: true, status: 200, text: async () => xml }),
      now: Date.parse('2026-09-04T12:00:00Z'),
    })
    const urls = r.published.map((p) => canonicalUrl(p.url))
    expect(new Set(urls).size).toBe(urls.length)
    expect(urls).toHaveLength(1) // 跟踪参数变体必须被认成同一文档
  })

  it('同事件刷屏被压到 maxPerEvent（DB-03 里 GPT-6 Astra 有 15 篇跟风报道）', async () => {
    // 用 DB-03 的真实 Astra 标题（各家刻意写不同标题，jaccard 聚不拢——见 eventCluster 的实测）
    const astra: GoldSample[] = [
      'ChatGPT overtakes all rivals with new Astra model, OpenAI says',
      'OpenAI launches GPT-6 Astra, the AI model built to do more than chat',
      "OpenAI Says GPT-6 Astra Is 'The Most Intelligent And Aligned' Model",
      'OpenAI unveils GPT-6 Astra amid rising scrutiny and safety concerns',
      'OpenAI launches Astra, its powerful (and controversial) new AI model',
      "OpenAI hails 'new era of artificial general intelligence' with Astra",
      'OpenAI launches new Astra model amid growing scrutiny over agent safety',
      'GPT-6 Astra横空出世，全网彻底炸锅了！',
    ].map((title, i) => ({
      id: `astra-${i}`,
      title,
      body: 'OpenAI 发布新一代模型，具备更强的自主推理与电脑操作能力，业界关注其安全审查机制。',
      humanScore: 7,
      humanDecision: '保留' as const,
    }))
    const r = await runSamples(astra)
    const astraCount = r.published.filter((p) => /astra/i.test(p.title)).length
    expect(astraCount).toBeLessThanOrEqual(gates.dedupe.maxPerEvent)
    expect(astraCount).toBeGreaterThan(0) // 不是靠"全杀"达标的
  })
})

describe('内容质量回归：合格内容不得被闸门误杀', () => {
  it('DB-03 判定 ≥7 分的条目大部分能进产出（闸门是过滤器不是粉碎机）', async () => {
    expect(KNOWN_GOOD.length).toBeGreaterThanOrEqual(10)
    const r = await runSamples(KNOWN_GOOD)
    // 允许少量因事件聚合（同属一个事件）或标题过短被压掉，但不得大面积误杀
    const rate = r.published.length / KNOWN_GOOD.length
    expect(rate, `高质量条目入选率仅 ${(rate * 100).toFixed(1)}%，闸门在误杀内容`).toBeGreaterThanOrEqual(0.6)
  })

  it('中英内容都要能过（CJK 与英文走两套匹配口径，任一套坏了都会整语种归零）', async () => {
    const zh = KNOWN_GOOD.filter((s) => /[\u4e00-\u9fff]/.test(s.title))
    const en = KNOWN_GOOD.filter((s) => !/[\u4e00-\u9fff]/.test(s.title))
    expect(zh.length).toBeGreaterThan(0)
    expect(en.length).toBeGreaterThan(0)

    const rZh = await runSamples(zh)
    const rEn = await runSamples(en)
    expect(rZh.published.length, '中文内容全军覆没：CJK 匹配口径坏了').toBeGreaterThan(0)
    expect(rEn.published.length, '英文内容全军覆没：词边界口径坏了').toBeGreaterThan(0)
  })
})

describe('质量看板：漏斗必须可对账，缺陷不得只写在散文里', () => {
  it('漏斗逐层单调不增，末层等于实际发布数，auditBoard 零 fatal', async () => {
    const r = await runSamples([...KNOWN_GOOD, ...KNOWN_BAD])
    const audit = auditBoard(r.board)
    expect(audit.fatal).toEqual([])

    for (let i = 1; i < r.funnel.length; i++) {
      expect(r.funnel[i]!.count).toBeLessThanOrEqual(r.funnel[i - 1]!.count)
    }
    expect(r.funnel[r.funnel.length - 1]!.count).toBe(r.published.length)
    expect(r.funnel[0]!.count).toBe(KNOWN_GOOD.length + KNOWN_BAD.length)
  })

  it('每一条被拦的都能归因到 gate + ruleId（DB-03 第一期漏斗 1396→750→703 无人能复算）', async () => {
    const r = await runSamples(KNOWN_BAD)
    expect(r.dropped.length).toBeGreaterThan(0)
    for (const d of r.dropped) {
      expect(d.gate).toBeTruthy()
      expect(d.ruleId).toBeTruthy()
      expect(d.reason.length).toBeGreaterThan(0)
      expect(d.title).toBeTruthy()
    }
    // 漏斗计数之和 == dropped 总数（可对账）
    const funnelDropTotal = r.board.dropped.length
    expect(funnelDropTotal).toBe(r.dropped.length)
  })

  it('入选比落盘（废除均摊配额后的主指标，取代「每渠道 ≥50 条」）', async () => {
    const r = await runSamples([...KNOWN_GOOD, ...KNOWN_BAD])
    expect(r.board.qualityYieldRatio).toBeGreaterThan(0)
    expect(r.board.qualityYieldRatio).toBeLessThanOrEqual(1)
    // 全部喂的是 KNOWN_BAD 时入选比必须极低——这是"指标真的在度量质量"的证据
    const rBad = await runSamples(KNOWN_BAD)
    expect(rBad.board.qualityYieldRatio).toBeLessThan(r.board.qualityYieldRatio)
  })
})
