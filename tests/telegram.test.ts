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
