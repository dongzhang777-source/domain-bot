import { mkdtempSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderTunaBrief, pushTuna } from '../src/push/tuna.js'
import type { Digest, ScoredItem } from '../src/types.js'

const mk = (id: string, title: string, isNew = true): ScoredItem =>
  ({ id, source: 'src-a', title, body: '', url: 'https://e.com/x', publishedAt: 1000, valueScore: 0.66, isNew, reason: '' })

const digest: Digest = {
  id: 'dw1', generatedAt: 2000, domain: 'ai',
  clusters: [
    { ref: 'dw1:0', title: 'first', summary: 's1', why: 'w1', items: [mk('1', 'first')] },
    { ref: 'dw1:1', title: 'second', summary: 's2', why: 'w2', items: [mk('2', 'second', false)] },
  ],
}

describe('tuna 分发渠道（tuna-brief-v0）', () => {
  it('renderTunaBrief：schema 与三级瀑布流字段齐备，tier 内容与截断正确', () => {
    const long = 'x'.repeat(500)
    const d: Digest = { id: 'dw2', generatedAt: 1, domain: 'ai', clusters: [
      { ref: 'dw2:0', title: long, summary: long, why: long, items: [mk('1', long)] },
    ] }
    const json = JSON.parse(renderTunaBrief(d, 456)) as {
      schema: string; digestId: string; domain: string; generatedAt: number; now: number
      items: Array<{ index: number; tier1: { hook: string; meta: string; isNew: boolean; publishedAt: number }; tier2: { title: string; summary: string; why: string }; tier3: { url: string }; score: number }>
    }
    expect(json.schema).toBe('tuna-brief-v0')
    expect(json.digestId).toBe('dw2')
    expect(json.domain).toBe('ai')
    expect(json.generatedAt).toBe(1)
    expect(json.now).toBe(456)
    const item = json.items[0]!
    // 三级结构齐备
    expect(item.tier1.meta).toBe('src-a')
    expect(item.tier1.isNew).toBe(true)
    expect(item.tier1.publishedAt).toBe(1000)
    expect(item.tier2.title).toHaveLength(120)      // 标题限长 120
    expect(item.tier2.summary).toHaveLength(300)    // 摘要限长 300（一屏）
    expect(item.tier2.why).toHaveLength(200)        // why 限长 200
    expect(item.tier3.url).toBe('https://e.com/x')
    expect(item.score).toBeCloseTo(0.66, 10)
    expect(item.index).toBe(0)
  })

  it('pushTuna 落盘 brief-<id>.json 且内容可被 JSON.parse 读回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-tuna-'))
    const path = pushTuna(digest, dir, 456)
    expect(path.endsWith('brief-dw1.json')).toBe(true)
    const back = JSON.parse(require('node:fs').readFileSync(path, 'utf8'))
    expect(back.schema).toBe('tuna-brief-v0')
    expect(back.items).toHaveLength(2)
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
