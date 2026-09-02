import { describe, expect, it } from 'vitest'
import { parseCallbackData, sendDigestTelegram } from '../src/push/telegram.js'
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

  it('sendMessage 携带 inline 键盘与 digest 内容', async () => {
    let captured: RequestInit | undefined
    const res = await sendDigestTelegram(digest, {
      token: 'T', chatId: 'C',
      fetchFn: async (_url, init) => {
        captured = init
        return { ok: true, status: 200, text: async () => '{}' }
      },
    })
    expect(res).toBeUndefined()
    const body = JSON.parse(String(captured?.body)) as {
      chat_id: string; text: string; reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> }
    }
    expect(body.chat_id).toBe('C')
    expect(body.text).toContain('llm news')
    expect(body.reply_markup.inline_keyboard[0][0].callback_data).toBe('fb:u:d1:0')
    expect(body.reply_markup.inline_keyboard[0][1].callback_data).toBe('fb:d:d1:0')
  })
})

describe('telegram 增量标记', () => {
  it('Telegram 文案标注增量/旧闻，与 file 通道对齐', async () => {
    let body = ''
    // 模块级已有名为 item / digest 的常量，这里用 mk / d 避免遮蔽。
    const mk = (id: string, title: string, isNew: boolean): ScoredItem =>
      ({ id, source: 's', title, body: '', url: 'u', publishedAt: 0, valueScore: 0.8, isNew, reason: '' })
    const d: Digest = { id: 'd', generatedAt: 0, domain: 'ai', clusters: [
      { ref: 'd:0', title: 'new thing', summary: 's', why: 'w', items: [mk('1', 'new thing', true)] },
      { ref: 'd:1', title: 'old thing', summary: 's', why: 'w', items: [mk('2', 'old thing', false)] },
    ] }
    await sendDigestTelegram(d, {
      token: 't', chatId: 'c',
      fetchFn: async (_u, init) => { body = String(init?.body); return { ok: true, status: 200, text: async () => '{}' } },
    })
    expect(body).toContain('🆕')
    expect(body).toContain('♻️')
  })
})

describe('已读回执（agy 三审 P0）', () => {
  it('parseViewCallbackData 解析 vb: 回调', async () => {
    const { parseViewCallbackData } = await import('../src/push/telegram.js')
    expect(parseViewCallbackData('vb:d1')).toEqual({ digestId: 'd1' })
    expect(parseViewCallbackData('fb:u:d1:0')).toBeUndefined()
    expect(parseViewCallbackData('junk')).toBeUndefined()
  })

  it('Telegram 键盘含 👀 已读按钮', async () => {
    let body = ''
    await sendDigestTelegram(digest, {
      token: 't', chatId: 'c',
      fetchFn: async (_u, init) => { body = String(init?.body); return { ok: true, status: 200, text: async () => '{}' } },
    })
    const kb = JSON.parse(body).reply_markup.inline_keyboard as Array<Array<{ callback_data: string }>>
    expect(kb.at(-1)![0]!.callback_data).toBe('vb:d1')
  })
})
