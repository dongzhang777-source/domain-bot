import { describe, expect, it } from 'vitest'
import { canonicalUrl, sameDocument } from '../src/collector/canonicalUrl.js'
import { itemId } from '../src/collector/dedupe.js'
import { BlacklistGate } from '../src/gates/blacklist.js'
import { PersonaGate } from '../src/gates/persona.js'
import { RelevanceGate } from '../src/gates/relevance.js'
import { capEvents, collectCanonicalUrls, dedupeByCanonicalUrl } from '../src/gates/fingerprint.js'
import { buildFunnel, runGates } from '../src/gates/index.js'
import type { GatesConfig, PersonaConfig, RawItem } from '../src/types.js'

/**
 * 三层硬闸门 + persona 闸的单元测试。
 *
 * 样本尽量取自 DB-03 审计的真实剔除清单（docs/tasks/TASK-DB-03-quality-audit-done.md §1.2），
 * 不用合成玩具串——闸门要拦的就是那 65 条，拿玩具串测等于没测。
 */

function item(partial: Partial<RawItem> & { title: string }): RawItem {
  return {
    id: partial.id ?? itemId(partial.url ?? '', partial.title, partial.body ?? ''),
    source: partial.source ?? 'rss-1',
    title: partial.title,
    body: partial.body ?? '',
    url: partial.url ?? '',
    publishedAt: partial.publishedAt ?? 0,
  }
}

const gates: GatesConfig = {
  minTitleChars: 15,
  minPoints: 3,
  strongAiWords: ['llm', 'transformer', '大模型'],
  keywordTiers: [
    {
      tier: 'core',
      points: 3,
      words: ['llm', 'agent', 'transformer', 'inference', 'benchmark', 'rag', 'fine-tuning', '大模型', '智能体'],
    },
    { tier: 'ecosystem', points: 1, words: ['open source', 'api', 'prompt', 'dataset', 'evaluation', '开源'] },
    { tier: 'generic', points: 0, words: ['ai', 'model', 'neural', 'tool', 'technology'] },
  ],
  blacklist: [
    { id: 'ad:recruit', group: 'adRecruit', pattern: '招聘|求职|兼职|招全栈', scope: 'both' },
    { id: 'ad:relay', group: 'adRecruit', pattern: '中转站|注册送|代充', scope: 'both' },
    { id: 'ad:course', group: 'adRecruit', pattern: '零基础|小白|保姆级|学完即就业|小学生|入门教程', scope: 'title' },
    { id: 'cross:biomed', group: 'crossDomain', pattern: 'pathogen|antimicrobial|molecular diffusion|clinical trial', unlessStrongAi: true },
    { id: 'nonTech:hardware', group: 'nonTech', pattern: 'bike computer|eink bike', scope: 'title' },
    { id: 'broken:regex', group: 'nonTech', pattern: '(unclosed', scope: 'title' },
  ],
  dedupe: {
    jaccardThreshold: 0.75,
    maxPerEvent: 2,
    // 与 config/gates.json 同源的精简版：实体词聚类的必需输入，缺了会把全部条目并成一坨
    eventStopwords: [
      'openai', 'model', 'models', 'ai', 'new', 'launches', 'launch', 'release',
      'the', 'of', 'for', 'and', 'is', 'says', 'with', 'gpt', 'llm', 'big', 'next',
      'has', 'its', 'over', 'most', 'era', 'artificial', 'general', 'intelligence',
      'powerful', 'chat', 'chatgpt', 'rivals', 'all', 'more', 'than', 'built',
      'scrutiny', 'growing', 'amid', 'unveils', 'hails', 'introducing', 'overview',
      'today', 'tonight', 'now', 'here',
    ],
  },
}

const persona: PersonaConfig = {
  id: 'newsline',
  displayName: 'AI时事快线',
  domain: 'ai-llm',
  sources: ['rss-1', 'exa-1'],
  maxAgeHours: 72,
  maxItems: 80,
  minQualityScore: 6,
  clusterThreshold: 0.35,
  rejectRules: [{ id: 'clickbait', pattern: '全网彻底炸锅|神级案例' }],
}

const NOW = Date.parse('2026-09-04T12:00:00Z')

describe('canonicalUrl', () => {
  it('剥离跟踪参数：utm_* / tab=readme-ov-file / fbclid', () => {
    expect(canonicalUrl('https://github.com/microsoft/agent-framework?utm_source=newsletter&tab=readme-ov-file'))
      .toBe('https://github.com/microsoft/agent-framework')
    expect(canonicalUrl('https://x.com/a/b?fbclid=abc123')).toBe('https://x.com/a/b')
  })

  it('归一化 host（小写 + 去 www）、去尾斜杠、丢 fragment', () => {
    expect(canonicalUrl('HTTPS://WWW.Example.COM/Path/To/Doc/#section-3')).toBe('https://example.com/Path/To/Doc')
  })

  it('保留的非跟踪参数按 key 排序，与原始顺序无关', () => {
    const a = canonicalUrl('https://ex.com/s?b=2&a=1')
    const b = canonicalUrl('https://ex.com/s?a=1&b=2')
    expect(a).toBe('https://ex.com/s?a=1&b=2')
    expect(b).toBe(a)
  })

  it('根路径的尾斜杠不被吃掉（否则 https://ex.com 与 https://ex.com/ 会误判为不同文档）', () => {
    expect(canonicalUrl('https://ex.com/')).toBe('https://ex.com/')
  })

  it('不可解析 / 非 http(s) / 空串一律返回空串，交由调用方回退内容哈希', () => {
    expect(canonicalUrl('')).toBe('')
    expect(canonicalUrl('not a url')).toBe('')
    expect(canonicalUrl('ftp://ex.com/a')).toBe('')
    expect(canonicalUrl('none')).toBe('')
  })

  it('sameDocument：DB-03 #174 的打点参数变体判为同一文档', () => {
    expect(sameDocument(
      'https://github.com/microsoft/agent-framework',
      'https://github.com/microsoft/agent-framework?WT.mc_id=api',
    )).toBe(true)
    expect(sameDocument('https://ex.com/a', 'https://ex.com/b')).toBe(false)
    // 任一侧无法规范化即判否，不猜
    expect(sameDocument('', '')).toBe(false)
  })
})

describe('itemId', () => {
  it('有 URL 时走 u- 前缀，且正文差异不影响 id（跨渠道去重的根）', () => {
    const a = itemId('https://ex.com/post/1', 'GPT-6 Astra 发布', '路透社正文')
    const b = itemId('https://ex.com/post/1', 'GPT-6 Astra 发布', '印度经济时报的不同正文')
    expect(a).toBe(b)
    expect(a.startsWith('u-')).toBe(true)
  })

  it('无 URL 时回退 c- 前缀内容哈希，且不同内容必得不同 id', () => {
    const a = itemId('', '标题甲', '正文甲')
    const b = itemId('', '标题乙', '正文乙')
    expect(a.startsWith('c-')).toBe(true)
    expect(a).not.toBe(b)
  })
})

describe('门禁 1：BlacklistGate', () => {
  const gate = new BlacklistGate(gates)

  it('结构性坏数据 [object Object] 一票否决（DB-03 的 8 条 GitHub Issues）', () => {
    const v = gate.check(item({ title: '[RFC][Architecture] STP 架构治理与 AI 辅助提效', body: '[object Object]' }))
    expect(v.blocked).toBe(true)
    expect(v.ruleId).toBe('damaged:objectObject')
  })

  it('标题短于 minTitleChars 判为无意义碎条（DB-03 的 "arXiv:2609." 类）', () => {
    const v = gate.check(item({ title: 'arXiv:2609.', body: 'x'.repeat(500) }))
    expect(v.blocked).toBe(true)
    expect(v.ruleId).toBe('damaged:titleTooShort')
  })

  it('招聘与中转站广告被拦（DB-03 #95/#96）', () => {
    expect(gate.check(item({ title: '招全栈开发工程师啦！远程 + on-site 结合', body: 'AI Agent 团队' })).ruleId).toBe('ad:recruit')
    expect(gate.check(item({ title: 'AI API 中转站，GPT / Claude 等模型，注册送 $1 额度', body: '' })).ruleId).toBe('ad:relay')
  })

  it('卖课与少儿科普被拦（DB-03 #197/#199）', () => {
    expect(gate.check(item({ title: '【2026最新】B站最全最细的AI零基础入门教程，学完即就业', body: '' })).ruleId).toBe('ad:course')
    expect(gate.check(item({ title: '【小学生都能学会的人工智能】深度学习基础知识合集', body: '' })).ruleId).toBe('ad:course')
  })

  it('跨学科噪音：无强 AI 词时拦，命中强 AI 词时豁免（防误杀真论文）', () => {
    // Nature 类：正文提 antimicrobial，全文无强 AI 词 → 拦
    const bio = gate.check(item({
      title: 'Antimicrobial resistance genes in wild mouse populations',
      body: 'We sequenced pathogen samples and ran a clinical trial.',
    }))
    expect(bio.blocked).toBe(true)
    expect(bio.ruleId).toBe('cross:biomed')

    // 真 AI 论文：同样出现 clinical trial，但标题含 LLM → 豁免
    const real = gate.check(item({
      title: 'LLM Agents for Clinical Trial Screening: A Benchmark',
      body: 'We evaluate an llm on clinical trial eligibility criteria.',
    }))
    expect(real.blocked).toBe(false)
  })

  it('非技术泛周边被拦（DB-03 #16 自行车码表）', () => {
    expect(gate.check(item({ title: 'Show HN: Open-Source eInk Bike Computer', body: 'I used AI to help' })).ruleId)
      .toBe('nonTech:hardware')
  })

  it('合格内容不被误杀', () => {
    expect(gate.check(item({
      title: 'KC-Bench: A Dynamic Interactive Benchmark for Evaluating Knowledge Conflict',
      body: 'We evaluate 9 frontier LLM agents on knowledge conflict.',
    })).blocked).toBe(false)
  })

  it('配置里写错的正则不得静默跳过——必须暴露在 compileErrors（否则闸门假绿）', () => {
    expect(gate.compileErrors).toHaveLength(1)
    expect(gate.compileErrors[0]).toEqual({ ruleId: 'broken:regex', error: expect.any(String) })
  })

  it('flags 白名单剔除 g：带 g 的规则复用同一 RegExp 会因 lastIndex 状态漏判', () => {
    const g = new BlacklistGate({
      ...gates,
      blacklist: [{ id: 'ad:g', group: 'adRecruit', pattern: '招聘', flags: 'gi' }],
    })
    const target = item({ title: '招全栈开发工程师啦！远程结合', body: '' })
    // 连续三次同一条：若 g 未被剔除，第二次起会因 lastIndex 前移而漏判
    expect(g.check(target).blocked).toBe(true)
    expect(g.check(target).blocked).toBe(true)
    expect(g.check(target).blocked).toBe(true)
  })
})

describe('门禁 2：RelevanceGate', () => {
  const gate = new RelevanceGate(gates)

  it('标题命中 1 个 core 词即 3 分，达门槛', () => {
    const v = gate.check(item({ title: 'A new LLM serving stack', body: '' }))
    expect(v.score.points).toBeGreaterThanOrEqual(3)
    expect(v.passed).toBe(true)
  })

  it('纯泛词计 0 分，无论命中多少个都过不了（击穿假闸门的关键）', () => {
    const v = gate.check(item({
      title: 'AI model neural tool technology overview',
      body: 'Another ai model with neural tool technology. AI model neural tool.',
    }))
    expect(v.score.points).toBe(0)
    expect(v.passed).toBe(false)
  })

  it('积分不足时 reason 必须列出命中明细，不得只说「不相关」', () => {
    const v = gate.check(item({ title: 'Open source API prompt dataset', body: '' }))
    // 4 个 ecosystem 词 = 4 分 ≥3，改测真不足的：仅 2 个 ecosystem
    const weak = gate.check(item({ title: 'An open source api wrapper', body: '' }))
    expect(weak.passed).toBe(false)
    expect(weak.reason).toContain('open source')
    expect(weak.reason).toContain('api')
    expect(v.passed).toBe(true)
  })

  it('标题加权：只在正文命中的 core 词降为 1 分（治「边角料 Mentions 污染」）', () => {
    // 标题零 core 词，正文命中 1 个 core（inference）→ 1 分，不过
    const oneBodyHit = gate.check(item({
      title: 'Show HN: A mechanical keyboard firmware',
      body: 'I used inference to tune the debounce.',
    }))
    expect(oneBodyHit.score.hits).toEqual([{ word: 'inference', tier: 'core', points: 1 }])
    expect(oneBodyHit.passed).toBe(false)

    // 正文命中 3 个不同 core 词 → 3 分，过（正文确有实质 AI 内容时不该误杀）
    const threeBodyHits = gate.check(item({
      title: 'Show HN: A mechanical keyboard firmware',
      body: 'Uses inference and rag with a small llm for debounce tuning.',
    }))
    expect(threeBodyHits.score.points).toBe(3)
    expect(threeBodyHits.passed).toBe(true)
  })

  it('DB-03 #16 自行车码表：正文一句 AI 提及不得放行（旧假闸门正是这里失守）', () => {
    const v = gate.check(item({
      title: 'Show HN: Open-Source eInk Bike Computer',
      body: 'Built with a microcontroller; I used AI to help write some of the drivers.',
    }))
    expect(v.passed).toBe(false)
  })

  it('中文关键词走子串匹配，不因词边界规则被打死', () => {
    const v = gate.check(item({ title: '国产大模型推理优化实战开源', body: '' }))
    expect(v.score.hits.map((h) => h.word)).toContain('大模型')
    expect(v.passed).toBe(true)
  })

  it('同一词在标题与正文各出现一次只计一次（标题优先，不重复计分）', () => {
    const v = gate.score(item({ title: 'LLM inference at scale', body: 'llm inference llm inference' }))
    const llmHits = v.hits.filter((h) => h.word === 'llm')
    expect(llmHits).toHaveLength(1)
    expect(llmHits[0].points).toBe(3)
  })
})

describe('门禁 3：dedupeByCanonicalUrl / capEvents', () => {
  it('批内规范 URL 重复只留第一条，并记 DropRecord', () => {
    const a = item({ title: 'Corporate America is getting hooked on open-source AI', url: 'https://nytimes.com/a', source: 'rss-1' })
    const b = item({ title: 'Corporate America is getting hooked on open-source AI', url: 'https://nytimes.com/a?utm_source=x', source: 'exa-1' })
    const { kept, dropped } = dedupeByCanonicalUrl([a, b])
    expect(kept).toHaveLength(1)
    expect(dropped).toHaveLength(1)
    expect(dropped[0].ruleId).toBe('fingerprint:duplicateUrlInBatch')
    expect(dropped[0].gate).toBe('fingerprint')
  })

  it('命中已发布指纹库（跨产线共享）即一票否决', () => {
    const a = item({ title: 'GPT-6 Astra launches with computer use', url: 'https://theverge.com/astra' })
    const { kept, dropped } = dedupeByCanonicalUrl([a], new Set(['https://theverge.com/astra']))
    expect(kept).toHaveLength(0)
    expect(dropped[0].ruleId).toBe('fingerprint:alreadyPublished')
  })

  it('无 URL 的条目不参与本层去重（交由 id 内容哈希兜底），不得被误杀', () => {
    const a = item({ title: '第一条无 URL 的内容甲', url: '' })
    const b = item({ title: '第二条无 URL 的内容乙', url: '' })
    const { kept, dropped } = dedupeByCanonicalUrl([a, b])
    expect(kept).toHaveLength(2)
    expect(dropped).toHaveLength(0)
  })

  it('collectCanonicalUrls 跳过无法规范化的 URL', () => {
    expect(collectCanonicalUrls([{ url: 'https://ex.com/a?utm_x=1' }, { url: 'none' }, { url: '' }]))
      .toEqual(['https://ex.com/a'])
  })

  it('capEvents 保留每事件分最高的 maxPerEvent 条，不是先到的那几条', () => {
    const mk = (title: string, score: number, url: string) =>
      ({ ...item({ title, url }), valueScore: score, isNew: true, reason: '' })
    // 同一通稿被多家原样转发（标题逐字相同，共享实体 astra）
    const same = [
      mk('OpenAI launches GPT-6 Astra model today', 0.4, 'https://a.com/1'),
      mk('OpenAI launches GPT-6 Astra model today', 0.9, 'https://b.com/2'),
      mk('OpenAI launches GPT-6 Astra model today', 0.7, 'https://c.com/3'),
      mk('OpenAI launches GPT-6 Astra model today', 0.5, 'https://d.com/4'),
    ]
    const other = mk('A completely different benchmark for llm agents', 0.6, 'https://e.com/5')

    const r = capEvents([...same, other], gates)
    // 标题逐字相同 → jaccard 补充判据认定为原样转发，只占 1 个坑（而非 maxPerEvent=2）
    expect(r.kept).toHaveLength(2)
    expect(r.eventCount).toBe(2)
    expect(r.kept[0].valueScore).toBe(0.9)
    expect(r.kept[1].valueScore).toBe(0.6)
    // 超额是**降权不是丢弃**：三条重复转发进 demoted，一条都不丢
    expect(r.demoted).toHaveLength(3)
    expect(r.demoted.map((d) => d.valueScore)).toEqual([0.7, 0.5, 0.4])
    // eventKeyOf 必须覆盖全部输入（kept + demoted），否则看板无法归因
    expect(r.eventKeyOf.size).toBe(5)
    // 同簇条目得同一 eventKey，不同簇不等
    const keys = same.map((s) => r.eventKeyOf.get(s.id))
    expect(new Set(keys).size).toBe(1)
    expect(r.eventKeyOf.get(other.id)).not.toBe(keys[0])
  })

  it('洗稿标题（非逐字相同）仍受 maxPerEvent 限制，超额条目降权而非丢弃', () => {
    const mk = (title: string, score: number, url: string) =>
      ({ ...item({ title, url }), valueScore: score, isNew: true, reason: '' })
    // 共享实体 astra 但措辞不同，jaccard 低于 0.75 → 走 maxPerEvent 而非 verbatimRepost
    const cluster = [
      mk('OpenAI Astra release brings computer use', 0.9, 'https://a.com/1'),
      mk('Astra model from OpenAI reviewed by analysts', 0.7, 'https://b.com/2'),
      mk('OpenAI Astra rollout continues across regions', 0.5, 'https://c.com/3'),
    ]
    const r = capEvents(cluster, gates)
    expect(r.eventCount).toBe(1)
    expect(r.kept).toHaveLength(2)
    expect(r.kept.map((k) => k.valueScore)).toEqual([0.9, 0.7])
    // 降权而非丢弃：词法聚类判别不可靠，丢弃会在候选池薄时静默摧毁内容
    expect(r.demoted).toHaveLength(1)
    expect(r.demoted[0].valueScore).toBe(0.5)
    // kept + demoted 必须等于输入总数（一条都不能凭空消失）
    expect(r.kept.length + r.demoted.length).toBe(cluster.length)
  })

  /**
   * 实体词聚类聚拢真实洗稿标题——jaccard 做不到。
   *
   * 实测依据（不得删）：DB-03 §3.2 门禁 3 提议「标题 jaccard > 0.75 判同事件，仅保留 1 篇」。
   * 取该报告 §1.3 里 GPT-6 Astra 同一事件的 10 条真实报道标题
   * （#58/#84/#85/#86/#122/#123/#124/#153/#156/#181），45 个配对中最大 jaccard 仅 **0.313**、
   * 中位 0.105，≥0.75 命中 **0**、≥0.50 命中 **0**；K2 Horizon 5 条（#32/#33/#103/#144/#191）
   * 最大 0.500，≥0.75 同样命中 0。记者刻意给同一事件写不同标题，阈值不可调成有用。
   * 复算：`npm run probe:events`。
   *
   * 改用实体词并查集后，同批数据实测 Astra 8/10 聚一簇、K2 5/5 聚一簇、3 条干扰项零误并。
   * 本用例取其中 4 条（含 The Verge 那条不含 "Astra" 的——它就是实测漏网的 2 条之一）。
   */
  it('实体词聚类聚拢真实洗稿标题（jaccard 做不到）', () => {
    const mk = (title: string, url: string) =>
      ({ ...item({ title, url }), valueScore: 0.8, isNew: true, reason: '' })
    const realAstra = [
      mk('ChatGPT overtakes all rivals with new Astra model, OpenAI says', 'https://a.com/1'),
      mk("OpenAI's next big AI model has 'entered the AGI era' | The Verge", 'https://b.com/2'),
      mk('OpenAI unveils GPT-6 Astra amid rising scrutiny and safety concerns', 'https://c.com/3'),
      mk('OpenAI hails new era of artificial general intelligence with Astra', 'https://d.com/4'),
    ]
    const r = capEvents(realAstra, gates)
    // 第 1/3/4 条共享实体 "astra" → 聚成一簇（受 maxPerEvent=2 限制，超额 1 条降权）。
    // 第 2 条（The Verge）标题不含 "Astra"，实体集为 {agi, verge}，与其余零交集
    // → 独立成簇。这正是实测漏网的 2 条之一，归 DB-05 的 LLM reviewer 语义归并。
    // 对比旧 jaccard 实现：4 条会被当成 4 个独立事件全部放行（eventCount=4），那就是刷屏的成因。
    expect(r.eventCount).toBe(2)
    expect(r.kept).toHaveLength(3)
    expect(r.demoted).toHaveLength(1)
    expect(r.demoted[0].title).toContain('Astra')
    expect(r.kept.map((k) => k.url)).toContain('https://b.com/2')
    // 降权不丢弃：总数守恒
    expect(r.kept.length + r.demoted.length).toBe(realAstra.length)
  })
})

describe('persona 闸', () => {
  const gate = new PersonaGate(persona)

  it('源不在白名单即拦（双产线彻底分离的载体）', () => {
    const v = gate.check(item({ title: 'A new LLM benchmark released', source: 'bili-1' }), NOW)
    expect(v.passed).toBe(false)
    expect(v.ruleId).toBe('persona:sourceNotWhitelisted')
  })

  it('超过 maxAgeHours 即拦，无论内容多好（DB-03 #193 的 2024 年旧闻）', () => {
    const old = gate.check(item({
      title: 'AI 大模型周报 2024年10月 第一期',
      source: 'rss-1',
      publishedAt: Date.parse('2024-10-05T00:00:00Z'),
    }), NOW)
    expect(old.passed).toBe(false)
    expect(old.ruleId).toBe('persona:tooOld')
  })

  it('publishedAt=0（源未给时间，jina/bili 常态）不按超时处理，否则整源被误杀', () => {
    expect(gate.check(item({ title: 'A new LLM benchmark released', source: 'rss-1', publishedAt: 0 }), NOW).passed).toBe(true)
  })

  it('未来时间戳判为坏数据（会绕过所有时效判定）', () => {
    const v = gate.check(item({ title: 'A new LLM benchmark released', source: 'rss-1', publishedAt: NOW + 86_400_000 }), NOW)
    expect(v.passed).toBe(false)
    expect(v.ruleId).toBe('persona:futureTimestamp')
  })

  it('persona 特有淘汰红线：时事快线禁标题党（DB-03 #181/#194）', () => {
    expect(gate.check(item({ title: 'GPT-6 Astra横空出世，全网彻底炸锅了！', source: 'rss-1' }), NOW).ruleId)
      .toBe('persona:reject:clickbait')
  })

  it('红线正则写错时暴露在 compileErrors，不静默失效', () => {
    const bad = new PersonaGate({ ...persona, rejectRules: [{ id: 'broken', pattern: '[a-' }] })
    expect(bad.compileErrors).toHaveLength(1)
    expect(bad.compileErrors[0].ruleId).toBe('broken')
  })
})

describe('runGates 编排', () => {
  const samples: RawItem[] = [
    // 合格
    item({ title: 'KC-Bench: A Dynamic Interactive Benchmark for LLM Agents', url: 'https://arxiv.org/abs/1', source: 'rss-1' }),
    // 同 URL 变体（门禁 3 拦）
    item({ title: 'KC-Bench: A Dynamic Interactive Benchmark for LLM Agents', url: 'https://arxiv.org/abs/1?utm_source=x', source: 'exa-1' }),
    // 招聘（门禁 1 拦）
    item({ title: '招全栈开发工程师啦！远程 + on-site 结合', url: 'https://v2ex.com/t/1', source: 'rss-1' }),
    // 泛词零分（门禁 2 拦）
    item({ title: 'Some ai model tool technology news today', url: 'https://ex.com/2', source: 'rss-1' }),
    // 源不在白名单（persona 拦）
    item({ title: 'A new LLM inference benchmark for agents', url: 'https://bili.com/3', source: 'bili-1' }),
  ]

  it('四层按序拦截，每条被拦条目都有 gate + ruleId + reason', () => {
    const r = runGates(samples, { persona, gates, now: NOW })
    expect(r.passed).toHaveLength(1)
    expect(r.dropped).toHaveLength(4)
    for (const d of r.dropped) {
      expect(d.gate).toBeTruthy()
      expect(d.ruleId).toBeTruthy()
      expect(d.reason.length).toBeGreaterThan(0)
    }
    const byGate = Object.fromEntries(r.dropped.map((d) => [d.ruleId, d.gate]))
    expect(byGate['persona:sourceNotWhitelisted']).toBe('persona')
    expect(byGate['ad:recruit']).toBe('blacklist')
    expect(byGate['fingerprint:duplicateUrlInBatch']).toBe('fingerprint')
  })

  it('漏斗计数可复算：各 ruleId 计数之和等于 dropped 总数', () => {
    const r = runGates(samples, { persona, gates, now: NOW })
    const sum = r.funnel.reduce((acc, f) => acc + f.count, 0)
    expect(sum).toBe(r.dropped.length)
    expect(r.funnel.every((f) => f.count > 0)).toBe(true)
  })

  it('buildFunnel 按计数降序，同 ruleId 合并', () => {
    const f = buildFunnel([
      { itemId: '1', title: 't', source: 's', url: '', gate: 'blacklist', ruleId: 'ad:recruit', reason: 'r' },
      { itemId: '2', title: 't', source: 's', url: '', gate: 'blacklist', ruleId: 'ad:recruit', reason: 'r' },
      { itemId: '3', title: 't', source: 's', url: '', gate: 'persona', ruleId: 'persona:tooOld', reason: 'r' },
    ])
    expect(f[0]).toEqual({ gate: 'blacklist', ruleId: 'ad:recruit', count: 2 })
    expect(f[1]).toEqual({ gate: 'persona', ruleId: 'persona:tooOld', count: 1 })
  })

  it('配置正则写错时 runGates 汇总 compileErrors，不吞掉（闸门假绿的根源）', () => {
    const r = runGates(samples, { persona, gates, now: NOW })
    expect(r.compileErrors.map((e) => e.ruleId)).toContain('broken:regex')
    expect(r.compileErrors[0].gate).toBeTruthy()
  })

  it('已发布指纹库参与去重：上一期发过的 URL 本期不得再出', () => {
    const r = runGates(samples, {
      persona,
      gates,
      now: NOW,
      knownCanonical: new Set(['https://arxiv.org/abs/1']),
    })
    expect(r.passed).toHaveLength(0)
    expect(r.dropped.map((d) => d.ruleId)).toContain('fingerprint:alreadyPublished')
  })
})

// ---------- DB-08 宽通道（recall widening） ----------

describe('runGates 宽通道：relevance 降为快通道，漏网条目进待定池而非词表一票否决', () => {
  // 标题与正文刻意避开本文件词表夹具的全部命中词（core/ecosystem 均零命中）——
  // 这类条目在旧语义下会被 relevance:belowMinPoints 一票否决（词表=边界的结构性屏蔽）。
  const leaky = (title: string, body = 'Governance and economics roundup with policy analysis notes.') =>
    item({ title, body, url: `https://e.com/${encodeURIComponent(title.slice(0, 12))}` })

  it('recall 启用时未过 relevance 但预筛达标的条目进 recallPool，不计入 dropped', () => {
    const r = runGates([leaky('Model Economics: The Real Cost Of Serving Machines')], {
      persona,
      gates,
      now: NOW,
      recall: { maxPerRound: 5 },
    })
    expect(r.passed).toHaveLength(0)
    expect(r.recallPool).toHaveLength(1)
    expect(r.dropped.filter((d) => d.gate === 'relevance')).toHaveLength(0)
  })

  it('recall 未启用时保持旧语义：relevance:belowMinPoints 直接丢弃（现状回归锁）', () => {
    const r = runGates([leaky('Model Economics: The Real Cost Of Serving Machines')], {
      persona,
      gates,
      now: NOW,
    })
    expect(r.recallPool ?? []).toHaveLength(0)
    expect(r.dropped.map((d) => d.ruleId).some((id) => id.startsWith('relevance:belowMinPoints'))).toBe(true)
  })

  it('预筛不达标（正文空洞）进 recall:ineligible 而不是待定池', () => {
    const r = runGates([leaky('Model Economics: The Real Cost Of Serving Machines', 'too short')], {
      persona,
      gates,
      now: NOW,
      recall: { maxPerRound: 5 },
    })
    expect(r.recallPool).toHaveLength(0)
    expect(r.dropped.map((d) => d.ruleId)).toContain('recall:ineligible')
  })

  it('池按 relevance 积分降序截断到 maxPerRound，超出部分落 recall:poolOverflow（漏斗恒可复算）', () => {
    // 两条零命中（0 分）、一条仅正文命中 ecosystem 词（body-only 降为 0 分但计入 hits 排序同分），
    // 另一条正文命中 ecosystem 且标题无关——验证排序与截断，三条全部 body ≥ 30 字符过预筛
    const zeroA = leaky('Policy Watch: Governance Roundup Weekly Edition', 'policy governance discussion notes.')
    const zeroB = leaky('Hardware Watch: Accelerator Economics Quarterly', 'hardware economics discussion notes.')
    // onePt 标题命中本地夹具 ecosystem 词 'prompt'（标题命中拿满 1 分）> 零分条目 → 降序后先进池
    const onePt = item({
      title: 'Prompt Store: A Weekly Briefing On Deployment Stories',
      body: 'this week in open source deployment stories and updates.',
      url: 'https://e.com/one-pt',
    })
    const r = runGates([zeroA, zeroB, onePt], { persona, gates, now: NOW, recall: { maxPerRound: 2 } })
    expect(r.recallPool).toHaveLength(2)
    expect(r.recallPool!.map((it) => it.id)).toContain(onePt.id)
    expect(r.recallPool!.map((it) => it.id)).not.toContain(zeroB.id)
    expect(r.dropped.filter((d) => d.ruleId === 'recall:poolOverflow')).toHaveLength(1)
  })

  it('黑名单命中不得进待定池（黑名单在 relevance 之前，宽通道不得绕过质量底线）', () => {
    const gatesWithHiring: GatesConfig = {
      ...gates,
      blacklist: [...gates.blacklist, { id: 'ad:recruitEn', group: 'adRecruit', pattern: 'hiring|join our team', scope: 'title' }],
    }
    const r = runGates(
      [item({ title: 'Join our team: platform engineers wanted', url: 'https://e.com/hiring' })],
      { persona, gates: gatesWithHiring, now: NOW, recall: { maxPerRound: 5 } },
    )
    expect(r.recallPool).toHaveLength(0)
    expect(r.dropped.map((d) => d.ruleId)).toContain('ad:recruitEn')
  })
})
