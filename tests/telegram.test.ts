import { describe, expect, it } from 'vitest'
import { parseCallbackData, sendDigestTelegram, renderHookCard, renderExpandedBody, expandDigestMessage, parseExpandCallbackData } from '../src/push/telegram.js'
import { renderDigestMarkdown } from '../src/push/file.js'
import type { Digest, ScoredItem } from '../src/types.js'

const item: ScoredItem = {
  id: 'i1', source: 'rss-1', title: 'llm news', body: 'body', url: 'https://e.com', publishedAt: 0,
  valueScore: 0.8, isNew: true, reason: 'r',
}

const digest: Digest = {
  id: 'd1', generatedAt: 0, domain: 'ai',
  clusters: [{ ref: 'd1:0', title: 'llm news', summary: 's', why: 'r', items: [item] }],
}

describe('file push', () => {
  it('渲染 markdown 含簇、来源与反馈提示', () => {
    const md = renderDigestMarkdown(digest)
    expect(md).toContain('领域情报 · ai')
    expect(md).toContain('llm news')
    expect(md).toContain('https://e.com')
    expect(md).toContain('👍')
  })
})

describe('telegram push', () => {
  it('parseCallbackData 解析 👍/👎', () => {
    expect(parseCallbackData('fb:u:d1:0')).toEqual({ signal: 'up', ref: 'd1:0' })
    expect(parseCallbackData('fb:d:d1:1')).toEqual({ signal: 'down', ref: 'd1:1' })
    expect(parseCallbackData('other')).toBeUndefined()
  })

  it('每个条目独立一条 L1 钩子卡，唯一按钮「展开 ▼」绑定 ex: 回调（行为即信号，2026-09-04 决断）', async () => {
    const multi: Digest = {
      id: 'dm', generatedAt: 0, domain: 'ai',
      clusters: [
        { ref: 'dm:0', title: 'first', summary: 's', why: 'w', items: [item] },
        { ref: 'dm:1', title: 'second', summary: 's', why: 'w', items: [item] },
      ],
    }
    const bodies: string[] = []
    const res = await sendDigestTelegram(multi, {
      token: 'T', chatId: 'C',
      fetchFn: async (_url, init) => {
        bodies.push(String(init?.body))
        return { ok: true, status: 200, text: async () => '{}' }
      },
    }, 1000)
    expect(res).toBe(2)
    const parsed = bodies.map((b) => JSON.parse(b) as {
      chat_id: string; text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
    })
    expect(parsed).toHaveLength(2)
    for (let i = 0; i < parsed.length; i++) {
      expect(parsed[i]!.chat_id).toBe('C')
      // L1 只有「▽」一个极简按钮，回调绑定本条目；不再有 👍/👀/不感兴趣 显式按钮
      const kb = parsed[i]!.reply_markup.inline_keyboard
      expect(kb).toHaveLength(1)
      expect(kb[0]![0]!.callback_data).toBe(`ex:dm:${i}`)
      expect(kb[0]![0]!.text).toBe('▽')
    }
    // 每张卡的钩子行对应自己的条目标题
    expect(parsed[0]!.text).toContain('first')
    expect(parsed[1]!.text).toContain('second')
  })
})

describe('telegram 增量标记', () => {
  it('L1 钩子卡标注增量（🆕）；旧闻无标记', async () => {
    // 模块级已有名为 item / digest 的常量，这里用 mk / d 避免遮蔽。
    const mk = (id: string, title: string, isNew: boolean): ScoredItem =>
      ({ id, source: 's', title, body: '', url: 'u', publishedAt: 0, valueScore: 0.8, isNew, reason: '' })
    const d: Digest = { id: 'd', generatedAt: 0, domain: 'ai', clusters: [
      { ref: 'd:0', title: 'new thing', summary: 's', why: 'w', items: [mk('1', 'new thing', true)] },
      { ref: 'd:1', title: 'old thing', summary: 's', why: 'w', items: [mk('2', 'old thing', false)] },
    ] }
    const bodies: string[] = []
    await sendDigestTelegram(d, {
      token: 't', chatId: 'c',
      fetchFn: async (_u, init) => { bodies.push(String(init?.body)); return { ok: true, status: 200, text: async () => '{}' } },
    }, 1000)
    expect(bodies[0]).toContain('🆕')
    expect(bodies[1]).not.toContain('🆕')
  })
})

describe('L1 钩子卡 / L2 消费层（tuna 三级瀑布流对齐，2026-09-04 老张决断）', () => {
  const mk = (id: string, title: string): ScoredItem =>
    ({ id, source: 's', title, body: '', url: 'u', publishedAt: 0, valueScore: 0.8, isNew: true, reason: '' })

  it('L1 钩子卡：两行结构（钩子 + 元信息），唯一按钮「展开 ▼」绑定 ex: 回调', async () => {
    const d: Digest = { id: 'd', generatedAt: 0, domain: 'ai', clusters: [
      { ref: 'd:0', title: 'Claude 微调开源 LLM', summary: 's', why: 'w', items: [mk('1', 'Claude 微调开源 LLM')] },
    ] }
    const bodies: string[] = []
    await sendDigestTelegram(d, {
      token: 't', chatId: 'c',
      fetchFn: async (_u, init) => { bodies.push(String(init?.body)); return { ok: true, status: 200, text: async () => '{}' } },
    }, 1000)
    const body = JSON.parse(bodies[0]!) as {
      text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
    }
    expect(body.text.split('\n')).toHaveLength(2)
    expect(body.text).toContain('Claude 微调开源 LLM')
    // D1 转义规范：粗体只包常量 token（🆕），标题/元信息在实体外；元信息不再斜体包裹
    expect(body.text).toBe('*🆕* Claude 微调开源 LLM\ns')
    const kb = body.reply_markup.inline_keyboard
    expect(kb).toHaveLength(1)
    expect(kb[0]![0]!.callback_data).toBe('ex:d:0')
    expect(kb[0]![0]!.text).toBe('▽')
  })

  it('L2 展开体：标题 + 摘要 + 💡 为什么推给你；用户文本转义（官方 4 字符集）、反斜杠剔除', () => {
    const d: Digest = { id: 'd', generatedAt: 0, domain: 'ai', clusters: [
      { ref: 'd:0', title: 'path\\end BERT_base [CLS]', summary: 'a_b [c] `d`', why: 'x_y', items: [mk('1', 'BERT_base vs [CLS]')] },
    ] }
    const text = renderExpandedBody(d, 0)
    // 官方 legacy 规则：可转义集仅 _ * ` [（实体外）；']' 与 '\' 不转义——'\' 直接剔除（D1）
    expect(text).toContain('pathend BERT\\_base \\[CLS]')
    expect(text).toContain('a\\_b \\[c] \\`d\\`')
    expect(text).toContain('💡 x\\_y')
    // 剔除后不得残留孤立反斜杠
    expect(text).not.toContain('\\\\')
  })

  it('why 限长 200（D1：截断根因），超长不进入消息', () => {
    const d: Digest = { id: 'd', generatedAt: 0, domain: 'ai', clusters: [
      { ref: 'd:0', title: 't', summary: 's', why: 'x'.repeat(500), items: [mk('1', 't')] },
    ] }
    const text = renderExpandedBody(d, 0)
    expect(text.includes('x'.repeat(201))).toBe(false)
  })

  it('L1 与 L2 各自必短于 Telegram 4096 上限（8 簇极限装填仍各发各的，无截断语义）', () => {
    const clusters = Array.from({ length: 8 }, (_, i) => ({
      ref: `d:${i}`, title: `簇${i} ${'长'.repeat(80)}`, summary: 's'.repeat(300), why: 'w'.repeat(200),
      items: [mk(String(i), `簇${i}`)],
    }))
    const d: Digest = { id: 'd', generatedAt: 0, domain: 'ai', clusters }
    for (let i = 0; i < clusters.length; i++) {
      expect(renderHookCard(d, i, 1000).length).toBeLessThanOrEqual(4096)
      expect(renderExpandedBody(d, i).length).toBeLessThanOrEqual(4096)
      expect(renderExpandedBody(d, i)).not.toContain('已截断')
    }
  })

  it('expandDigestMessage：editMessageText 定位钩子卡消息，出口按钮带原文 URL 与「不感兴趣」', async () => {
    const bodies: string[] = []
    await expandDigestMessage(
      { token: 't', chatId: 42, messageId: 77, fetchFn: async (_u, init) => { bodies.push(String(init?.body)); return { ok: true, status: 200, text: async () => '{}' } } },
      { ref: 'd:0', title: 't', summary: 's', why: 'w', url: 'https://en.wikipedia.org/wiki/Foo_Bar(baz)', isNew: true },
    )
    expect(bodies).toHaveLength(1)
    const body = JSON.parse(bodies[0]!) as {
      chat_id: number; message_id: number; text: string; reply_markup: { inline_keyboard: Array<Array<{ text?: string; url?: string; callback_data?: string }>> }
    }
    expect(body.chat_id).toBe(42)
    expect(body.message_id).toBe(77)
    expect(body.text).toContain('💡 w')
    const kb = body.reply_markup.inline_keyboard
    expect(kb).toHaveLength(1) // 只剩「↗ 原文」——不感兴趣按钮取消，负信号改行为推断
    expect(kb[0]![0]!.url).toBe('https://en.wikipedia.org/wiki/Foo_Bar(baz)') // 按钮走原生 URL，不再过 Markdown 链接转义
    expect(kb[0]![0]!.text).toBe('↗ 原文')
  })

  it('parseExpandCallbackData 解析 ex: 展开回调', () => {
    expect(parseExpandCallbackData('ex:d1:0')).toEqual({ digestId: 'd1', index: 0 })
    expect(parseExpandCallbackData('ex:d1:12')).toEqual({ digestId: 'd1', index: 12 })
    expect(parseExpandCallbackData('fb:u:d1:0')).toBeUndefined()
    expect(parseExpandCallbackData('vb:d1')).toBeUndefined()
    expect(parseExpandCallbackData('junk')).toBeUndefined()
  })
})

describe('已读回执（agy 三审 P0）', () => {
  it('parseViewCallbackData 解析 vb: 回调', async () => {
    const { parseViewCallbackData } = await import('../src/push/telegram.js')
    expect(parseViewCallbackData('vb:d1')).toEqual({ digestId: 'd1' })
    expect(parseViewCallbackData('fb:u:d1:0')).toBeUndefined()
    expect(parseViewCallbackData('junk')).toBeUndefined()
  })

  it('L1 键盘不再有 👀/👍 显式按钮——展开即已读（vb: 仅保留兼容旧消息）', async () => {
    const bodies: string[] = []
    await sendDigestTelegram(digest, {
      token: 't', chatId: 'c',
      fetchFn: async (_u, init) => { bodies.push(String(init?.body)); return { ok: true, status: 200, text: async () => '{}' } },
    }, 1000)
    const kb = JSON.parse(bodies[0]!).reply_markup.inline_keyboard as Array<Array<{ callback_data: string }>>
    const allCallbacks = kb.flat().map((b) => b.callback_data)
    expect(allCallbacks).not.toContain('vb:d1')
    expect(allCallbacks.filter((c) => c.startsWith('fb:'))).toHaveLength(0)
  })
})
