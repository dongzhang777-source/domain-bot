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
  stripMetadata,
  truncateChars,
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
