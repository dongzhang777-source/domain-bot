import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveHooks, detectLang, renderTunaBrief, pushTuna } from '../src/push/tuna.js'
import type { Digest, ScoredItem } from '../src/types.js'

const mk = (id: string, title: string, isNew = true, body = ''): ScoredItem =>
  ({ id, source: 'src-a', title, body, url: 'https://e.com/x', publishedAt: 1000, valueScore: 0.66, isNew, reason: '' })

const digest: Digest = {
  id: 'dw1', generatedAt: 2000, domain: 'ai',
  clusters: [
    { ref: 'dw1:0', title: 'first', summary: 's1', why: 'w1', items: [mk('1', 'first')] },
    { ref: 'dw1:1', title: 'second', summary: 's2', why: 'w2', items: [mk('2', 'second', false)] },
  ],
}

describe('行为→语言推断', () => {
  it('detectLang：CJK 占比 >30% 判 zh，否则 en', () => {
    expect(detectLang('这是一个中文标题，包含大模型资讯')).toBe('zh')
    expect(detectLang('an all english title about llm inference')).toBe('en')
    expect(detectLang('')).toBe('en')
  })
})

describe('deriveHooks（对齐 tuna placeholderHooks 语义）', () => {
  it('恒 3 条互异，且全部不超过语言限长（zh 35）', () => {
    const hooks = deriveHooks('OpenAI 发布新模型引发关注', '首句概要在这里。第二句不重要。关于大模型的观察。', 'ai', 'zh')
    expect(hooks).toHaveLength(3)
    expect(new Set(hooks).size).toBe(3)
    for (const h of hooks) expect(Array.from(h).length).toBeLessThanOrEqual(35)
  })

  it('英文条目按 en 限长（50）', () => {
    const hooks = deriveHooks('llm inference breakthrough', 'a benchmark shows new results. another sentence follows.', 'ai', 'en')
    expect(hooks).toHaveLength(3)
    for (const h of hooks) expect(Array.from(h).length).toBeLessThanOrEqual(50)
  })
})

describe('tuna 分发渠道（tuna-brief-v1：对齐 tuna Post 候选）', () => {
  it('renderTunaBrief：v1 结构（posts + brief），Post 候选字段齐备且限长正确', () => {
    const long = 'x'.repeat(500)
    const d: Digest = { id: 'dw2', generatedAt: 1, domain: 'ai', clusters: [
      { ref: 'dw2:0', title: long, summary: long, why: long, items: [mk('1', long, true, 'body text here')] },
    ] }
    const json = JSON.parse(renderTunaBrief(d, 456)) as {
      schema: string; digestId: string; domain: string; generatedAt: string
      posts: Array<{ id: string; title: string; hooks: string[]; summary: string; body: string; lang: string; author: { id: string; name: string; kind: string }; provenance: string; epistemic: string; signer: null; schemaVersion: number; createdAt: string; sourceUrl: string }>
      brief: { generatedAt: string; items: Array<{ postId: string; why: string; source: string }> }
    }
    expect(json.schema).toBe('tuna-brief-v1')
    expect(json.digestId).toBe('dw2')
    expect(json.generatedAt).toContain('T') // ISO
    const post = json.posts[0]!
    // Post 候选契约（tuna packages/core）
    expect(post.id).toBe('domain-bot:dw2:0')
    expect(post.hooks).toHaveLength(3)
    expect(new Set(post.hooks).size).toBe(3)
    expect(post.summary.length).toBeLessThanOrEqual(450) // en 上限（全 x 判 en，SUMMARY_MAX.en=450）
    expect(post.body).toBe('body text here')             // L3 底料不再缺失（DB-02 缺口 d）
    expect(post.lang).toBe('en')
    expect(post.author).toEqual({ id: 'domain-bot', name: 'domain-bot 探针', kind: 'user' })
    expect(post.provenance).toBe('human')
    expect(post.epistemic).toBe('inference')
    expect(post.signer).toBeNull()
    expect(post.schemaVersion).toBe(1)
    expect(post.createdAt).toContain('T') // ISO
    expect(post.sourceUrl).toBe('https://e.com/x')
    // 简报层 why ≤40（DB-02 缺口 e 关闭）
    expect(json.brief.items[0]!.postId).toBe('domain-bot:dw2:0')
    expect(json.brief.items[0]!.why.length).toBeLessThanOrEqual(40)
    expect(json.brief.items[0]!.source).toBe('static')
  })

  it('pushTuna 落盘 brief-<id>.json 且内容可被 JSON.parse 读回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-tuna-'))
    const path = pushTuna(digest, dir, 456)
    expect(path.endsWith('brief-dw1.json')).toBe(true)
    const back = JSON.parse(readFileSync(path, 'utf8'))
    expect(back.schema).toBe('tuna-brief-v1')
    expect(back.posts).toHaveLength(2)
  })

  it('pushTuna 建子目录并写指定位置；digestId 消毒（非法字符剔除，空 id 抛错）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-tuna-ns-'))
    const d: Digest = { ...digest, id: 'ab-cd' }
    const path = pushTuna(d, join(dir, 'tuna'), 456)
    expect(existsSync(path)).toBe(true)
    expect(path).toContain(join('tuna', 'brief-abcd.json'))
    expect(() => pushTuna({ ...digest, id: '***' }, dir, 456)).toThrow(/digest id 非法/)
    // 消毒先于 mkdir：非法 id 抛错时不得落任何文件（tuna/ 目录为上一条合法调用所建）
    expect(readdirSync(dir)).toEqual(['tuna'])
    expect(existsSync(join(dir, 'tuna', 'brief-.json'))).toBe(false)
  })
})
