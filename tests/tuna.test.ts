import { describe, expect, it } from 'vitest'
import {
  HOOK_LIMITS,
  MIN_HOOK_CHARS,
  SUMMARY_MAX,
  WHY_MAX,
  deriveHooks,
  detectLang,
  firstSentence,
  isTitlePrefix,
  splitSentences,
  stripHtml,
  stripMetadata,
  TITLE_ECHO_OVERLAP,
  titleOverlap,
  truncateChars,
  truncateWhy,
} from '../src/render/tuna.js'
import { PACK_SCHEMA, TUNA_POST_ID, assertPackContract, buildPack } from '../src/publish/pack.js'
import type { GatekeeperInput } from '../src/types.js'

/**
 * tuna 契约的渲染原语 + 内容包装配。
 *
 * 旧版本文件测的是 `renderTunaBrief` / `pushTuna`（产 `outbox/tuna/brief-<id>.json`）。
 * 二者已被 `src/publish/pack.ts` 的 `buildPack` / `writePack` 完全取代并删除——
 * 两套装配实现并存必然漂移（tuna 侧限长在 `5fca284` 同步过一次，两处数字不一致
 * 就会重现 L1 第二行残字问题）。故本文件改为：原语测 `src/render/tuna.ts`，
 * 契约测 `src/publish/pack.ts`。
 */

describe('detectLang（与 tuna feeds/sanitize.ts 同族）', () => {
  it('CJK 占比 >30% 判 zh，否则 en', () => {
    expect(detectLang('这是一个中文标题，包含大模型资讯')).toBe('zh')
    expect(detectLang('an all english title about llm inference')).toBe('en')
  })

  it('空串判 en（不得抛错，也不得判 zh 导致限长取错）', () => {
    expect(detectLang('')).toBe('en')
  })

  it('只看前 400 码点：后段的中文不得翻转判定', () => {
    const en = 'a'.repeat(400) + '中文中文中文中文中文'
    expect(detectLang(en)).toBe('en')
  })
})

describe('truncateChars / firstSentence（码点口径，不是 UTF-16 长度）', () => {
  it('按码点截断并补省略号，中日韩不被切半', () => {
    expect(truncateChars('大模型推理优化', 4)).toBe('大模型…')
    expect(Array.from(truncateChars('大模型推理优化', 4))).toHaveLength(4)
  })

  it('未超限原样返回，不加省略号', () => {
    expect(truncateChars('short', 70)).toBe('short')
  })

  it('firstSentence 取首个句末标点前的内容', () => {
    expect(firstSentence('第一句在这里。第二句不要。', 70)).toBe('第一句在这里。')
    expect(firstSentence('no punctuation at all here', 70)).toBe('no punctuation at all here')
    expect(firstSentence('   ', 70)).toBe('')
  })
})

describe('stripMetadata（DB-03 §2.4：arXiv 元数据混入 summary）', () => {
  it('剥掉 arXiv 编号行、Announce Type 与 Abstract 前缀', () => {
    const raw = 'arXiv:2609.03884v1 Announce Type: cross \nAbstract: Modern AI agent harnesses expose lifecycle hooks.'
    const clean = stripMetadata(raw)
    expect(clean).not.toContain('arXiv:2609')
    expect(clean).not.toContain('Announce Type')
    expect(clean).not.toContain('Abstract:')
    expect(clean).toContain('Modern AI agent harnesses expose lifecycle hooks.')
  })

  it('无元数据的正文原样保留（只压空白）', () => {
    expect(stripMetadata('plain   body\ntext')).toBe('plain body text')
  })
})

describe('splitSentences', () => {
  it('中英句末标点都能切，且丢弃短于 MIN_HOOK_CHARS 的碎片', () => {
    const s = splitSentences('这是一段足够长的中文句子。短。Another sufficiently long english sentence. ok.')
    expect(s).toHaveLength(2)
    expect(s.every((x) => Array.from(x).length >= MIN_HOOK_CHARS)).toBe(true)
  })
})

describe('isTitlePrefix（gk:mechanicalTruncation 的同源判据）', () => {
  it('标题前缀截断判真', () => {
    const title = 'A Blind Trust, the Bloody Thrust: When Attacker-Controlled Hook Updates Steer AI Agent Harnesses'
    expect(isTitlePrefix(truncateChars(title, 70), title)).toBe(true)
  })

  it('标题的短前缀（占比不足 0.6）不判为机械截断', () => {
    const title = 'A very long title that goes on and on for quite a while indeed'
    expect(isTitlePrefix('A very long title', title)).toBe(false)
  })

  it('非前缀内容判假', () => {
    expect(isTitlePrefix('正文首句讲的是别的事情，足够长了', '完全不同的标题内容')).toBe(false)
    expect(isTitlePrefix('', 'any title')).toBe(false)
  })
})

describe('deriveHooks（机械兜底：三视角，非标题切三段）', () => {
  const title = 'A Blind Trust, the Bloody Thrust: When Attacker-Controlled Hook Updates Steer AI Agent Harnesses'
  const body =
    'arXiv:2609.03884v1 Announce Type: cross Abstract: Modern AI agent harnesses expose lifecycle hooks that bind shell commands to runtime events. ' +
    'We identify the lifecycle-hook update path as a new attack surface called HookPry. Experiments cover seven mainstream harnesses.'

  it('不再产出标题前缀截断，也不再产出 arXiv 碎片（DB-03 实测的两类缺陷）', () => {
    const hooks = deriveHooks(title, body, 'ai-llm', 'en')
    expect(hooks.length).toBeGreaterThan(0)
    for (const h of hooks) {
      expect(isTitlePrefix(h, title), `钩子不得是标题前缀截断：${h}`).toBe(false)
      expect(h).not.toMatch(/^arxiv:\d+\.?/i)
      expect(Array.from(h).length).toBeGreaterThanOrEqual(MIN_HOOK_CHARS)
    }
    // 旧实现会产出 "arXiv:2609."（11 字符碎片）当第二钩子；stripMetadata 后不得再出现
    expect(hooks.join('\n')).not.toContain('arXiv:2609')
  })

  it('素材充足时给满 3 条互异钩子，且全部不超限长', () => {
    const hooks = deriveHooks(title, body, 'ai-llm', 'en')
    expect(hooks).toHaveLength(3)
    expect(new Set(hooks).size).toBe(3)
    for (const h of hooks) expect(Array.from(h).length).toBeLessThanOrEqual(HOOK_LIMITS.en)
  })

  it('中文条目按 zh 限长（70 码点）', () => {
    const zh = deriveHooks(
      '国产大模型推理优化实战：KV Cache 与算子融合',
      '本文给出量化后的显存占用对比。实测吞吐提升明显。适用于长上下文服务场景。',
      'ai-llm',
      'zh',
    )
    expect(zh.length).toBeGreaterThan(0)
    for (const h of zh) expect(Array.from(h).length).toBeLessThanOrEqual(HOOK_LIMITS.zh)
  })

  it('素材不足时宁可少给，也不用标题截断充数（交由 gk:shapeViolation 否决 + 递补）', () => {
    // body 只有一句短文本、标题全是停用词 → 抽不出三条合法钩子
    const thin = deriveHooks('the a of and', 'ok.', 'ai-llm', 'en')
    expect(thin.length).toBeLessThan(3)
    for (const h of thin) expect(Array.from(h).length).toBeGreaterThanOrEqual(MIN_HOOK_CHARS)
  })

  it('DB-12/D6：首句与标题同源时换视角递补，钩子不再是标题复读', () => {
    // 真实形态取自 DB-11 §B5 #0（deepthought 主材）：正文首句就是标题主体，
    // 旧实现 hook[0] = 「Neuronto Agentic Resource Discovery (ARD) Index.」，与标题重叠≈0.95
    const title = 'neuronto/agentic-resource-discovery: Neuronto Agentic Resource Discovery (ARD) Index'
    const body =
      'Neuronto Agentic Resource Discovery (ARD) Index. Federated search across every public ARD registry, ' +
      'plus a verified tool index read from each MCP server. Hybrid lexical and semantic retrieval, and ARD-Bench.'
    const hooks = deriveHooks(title, body, 'ai-llm', 'en')

    expect(hooks).toHaveLength(3)
    expect(new Set(hooks).size).toBe(3)
    // 修复目标：门面位（hook[0]）不得是标题复读——DB-11 §B5 扫的正是 hook[0]，阈值同口径
    expect(titleOverlap(hooks[0]!, title), `门面钩子与标题重叠过高：${hooks[0]}`).toBeLessThan(TITLE_ECHO_OVERLAP)
    // 与标题同源的首句本体整体消失，递补来自真实素材（次句），不是把标题换个切法
    expect(hooks.join('\n')).not.toContain('Neuronto Agentic Resource Discovery (ARD) Index.')
    expect(hooks.join('\n')).toContain('Federated search')
    for (const h of hooks) {
      // 联动约束：去冗余不得引入新违例
      expect(isTitlePrefix(h, title), `钩子不得是标题前缀截断：${h}`).toBe(false)
      expect(Array.from(h).length).toBeGreaterThanOrEqual(MIN_HOOK_CHARS)
      expect(Array.from(h).length).toBeLessThanOrEqual(HOOK_LIMITS.en)
    }
  })

  it('DB-12/D6：素材不足时同源候选回补——少一条冗余钩子好过整条被否决', () => {
    // 标题与唯一一句正文同源、且抽不出实体卡：放宽后仍给满 3 条（够不成 3 条才会被 shapeViolation 否决）
    const title = 'Monitoring the monitoring stack with self-hosted agents'
    const body = 'Monitoring the monitoring stack with self-hosted agents explained.'
    const hooks = deriveHooks(title, body, 'ai-llm', 'en')
    for (const h of hooks) {
      expect(Array.from(h).length).toBeGreaterThanOrEqual(MIN_HOOK_CHARS)
      expect(isTitlePrefix(h, title)).toBe(false)
    }
    expect(hooks.length).toBeGreaterThanOrEqual(1)
  })

  it('DB-12/D6：titleOverlap 判据本身可复算（去省略号、忽略大小写、按去重码点）', () => {
    expect(titleOverlap('Neuronto Agentic Resource Discovery (ARD) Index.', 'neuronto/agentic-resource-discovery: Neuronto Agentic Resource Discovery (ARD) Index'))
      .toBeGreaterThan(0.9)
    expect(titleOverlap('Federated search across every public ARD registry', 'Neuronto Agentic Resource Discovery (ARD) Index'))
      .toBeLessThan(TITLE_ECHO_OVERLAP)
    expect(titleOverlap('', 'any title')).toBe(0)
    // 尾部省略号不参与判定：截断钩子与完整钩子同判
    expect(titleOverlap('Federated search across every public ARD regi…', 'Neuronto Agentic Resource Discovery (ARD) Index'))
      .toBe(titleOverlap('Federated search across every public ARD regi', 'Neuronto Agentic Resource Discovery (ARD) Index'))
  })
})

describe('buildPack / assertPackContract（tuna-brief-v1 装配）', () => {
  function post(overrides: Partial<GatekeeperInput> = {}): GatekeeperInput {
    return {
      id: 'domain-bot-newsline:abc123:0',
      title: 'KC-Bench evaluates knowledge conflict in reasoning models',
      hooks: ['hook one long enough', 'hook two long enough', 'hook three long enough'],
      summary: 'A sufficiently long summary for the pack.',
      body: 'A sufficiently long body for the pack.',
      why: '聚焦你的关注点「benchmark」',
      url: 'https://arxiv.org/abs/1',
      lang: 'en',
      publishedAt: 1_700_000_000_000,
      source: 'rss-1',
      eventKey: 'e1',
      valueScore: 0.8,
      ...overrides,
    }
  }
  const ctx = { digestId: 'abc123', persona: 'newsline', personaDisplay: 'AI时事快线', domain: 'ai-llm', generatedAt: 1_700_000_000_000 }

  it('schema 与字段齐备，posts 与 brief.items 一一对应', () => {
    const pack = buildPack([post(), post({ id: 'domain-bot-newsline:abc123:1', url: 'https://arxiv.org/abs/2' })], ctx)
    expect(pack.schema).toBe(PACK_SCHEMA)
    expect(pack.schema).toBe('tuna-brief-v1')
    expect(pack.persona).toBe('newsline')
    expect(pack.posts).toHaveLength(2)
    expect(pack.brief.items).toHaveLength(2)
    expect(pack.brief.items[0]).toEqual({ postId: pack.posts[0]!['id'], why: '聚焦你的关注点「benchmark」', source: 'static' })
    const p = pack.posts[0]!
    expect(p['provenance']).toBe('human')
    expect(p['epistemic']).toBe('inference')
    expect(p['schemaVersion']).toBe(1)
    expect(p['author']).toEqual({ id: 'domain-bot-newsline', name: 'AI时事快线', kind: 'user' })
    expect(String(p['createdAt'])).toContain('T')
    expect(p['sourceUrl']).toBe('https://arxiv.org/abs/1')
  })

  it('id 必须过 tuna 侧正则（只允许两段冒号，四段式会校验失败）', () => {
    expect(TUNA_POST_ID.test('domain-bot-newsline:abc123:0')).toBe(true)
    // 这条钉住已核实的坑：persona 必须用连字符并进第一段
    expect(TUNA_POST_ID.test('domain-bot:newsline:abc123:0')).toBe(false)
    expect(() => assertPackContract(buildPack([post({ id: 'domain-bot:newsline:abc123:0' })], ctx))).toThrow(/不合 tuna 契约/)
  })

  it('重复 id / 重复规范 URL / posts 与 brief 数量不一致 一律拒绝装配', () => {
    expect(() =>
      assertPackContract(buildPack([post(), post({ url: 'https://arxiv.org/abs/1' })], ctx)),
    ).toThrow(/重复/)
    expect(() =>
      assertPackContract(buildPack([post(), post({ id: 'domain-bot-newsline:abc123:0', url: 'https://arxiv.org/abs/2' })], ctx)),
    ).toThrow(/重复 id/)
    const pack = buildPack([post()], ctx)
    pack.brief.items = []
    expect(() => assertPackContract(pack)).toThrow(/数量不一致/)
  })

  it('跟踪参数变体视为同一 URL，装配阶段即拦（不等 tuna 侧报错）', () => {
    expect(() =>
      assertPackContract(
        buildPack([post(), post({ id: 'domain-bot-newsline:abc123:1', url: 'https://arxiv.org/abs/1?utm_source=x' })], ctx),
      ),
    ).toThrow(/重复规范 URL/)
  })

  it('限长常量与 tuna 侧同步值一致（不得两处各写一套数字）', () => {
    expect(HOOK_LIMITS).toEqual({ zh: 70, en: 95 })
    expect(SUMMARY_MAX).toEqual({ zh: 300, en: 450 })
    expect(WHY_MAX).toBe(40)
  })
})

// ---------- DB-11 修复回归锁 ----------

describe('stripHtml（DB-11/D1：tuna local-brief 路径无 sanitize，生产端必须交纯文本）', () => {
  it('剥标签、还原常见实体、压平空白', () => {
    expect(stripHtml('<p>Article URL: <a href="https://x.com/a">original</a></p>')).toBe('Article URL: original')
    expect(stripHtml('<strong>Genie</strong> &amp; friends &#039;quoted&#039;')).toBe('Genie & friends \'quoted\'')
    expect(stripHtml('<style>.x{}</style>keep <script>bad()</script>this')).toBe('keep this')
    expect(stripHtml('plain text stays')).toBe('plain text stays')
    // DB-11 回放实测：转义形式的标签（&lt;example&gt;）解码后必须再剥一遍
    expect(stripHtml('prompt transcript &lt;example&gt; &lt;user&gt;hi&lt;/user&gt; end')).toBe('prompt transcript hi end')
  })
})

describe('truncateWhy（DB-11/D5：词边界截断）', () => {
  it('英文在词边界切，不产生 benchmar… 式残词；超长无空格串退化为硬切', () => {
    const cut = truncateWhy('Matches your interests in llm and a strong benchmark signal', 40)
    expect(Array.from(cut).length).toBeLessThanOrEqual(40)
    expect(cut.endsWith('…')).toBe(true)
    const last = cut.match(/([A-Za-z]+)…$/)?.[1]
    if (last) expect('Matches your interests in llm and a strong benchmark signal').toContain(last)
    // DB-12 收口实测：切点落在单词中间时必须整词退掉（16:51 真实包出过 'be…'）
    const real = truncateWhy('Matches your interests in inference, benchmark, with a strong "release" signal', 40)
    expect(real.startsWith('Matches your interests in inference')).toBe(true)
    const src2 = 'Matches your interests in inference, benchmark, with a strong "release" signal'
    const lastWord = real.match(/([A-Za-z]+)…$/)?.[1]
    if (lastWord) expect(new RegExp(`\\b${lastWord}\\b`).test(src2)).toBe(true)
    expect(truncateWhy('很短', 40)).toBe('很短')
    expect(Array.from(truncateWhy('a'.repeat(60), 40)).length).toBeLessThanOrEqual(40)
  })
})

describe('assertPackContract sourceUrl 熔断（DB-11/D9：L2「↗ 原文」不得静默断链）', () => {
  it('缺 sourceUrl 的包拒绝落盘', () => {
    const pack = buildPack([postPack()], { digestId: 'abc123', persona: 'newsline', personaDisplay: 'x', domain: 'ai-llm', generatedAt: 1_700_000_000_000 })
    pack.posts[0]!['sourceUrl'] = ''
    expect(() => assertPackContract(pack)).toThrow(/sourceUrl/)
  })
})


/** DB-11/D9 用：独立构造一条合法 GatekeeperInput（buildPack describe 里的 post() 不在此作用域）。 */
function postPack(): GatekeeperInput {
  return {
    id: 'domain-bot-newsline:abc123:9',
    title: 'A benchmark for knowledge conflict in reasoning models',
    hooks: ['hook one long enough', 'hook two long enough', 'hook three long enough'],
    summary: 'A sufficiently long summary for the pack.',
    body: 'A sufficiently long body for the pack.',
    why: '聚焦你的关注点「benchmark」',
    url: 'https://arxiv.org/abs/9',
    lang: 'en',
    publishedAt: 1_700_000_000_000,
    source: 'rss-1',
    eventKey: 'e9',
    valueScore: 0.8,
  }
}
