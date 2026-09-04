import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Digest } from '../types.js'

/**
 * tuna 分发渠道（tuna-brief-v1）：产出对齐 tuna `Post`（packages/core，schemaVersion=1，
 * tuna 侧 migrate.ts 负责升级到 2）候选的内容包 + 内嵌简报 why（≤40，对齐 BriefItem.MAX_WHY_CHARS）。
 *
 * v1 契约（DB-02 契约审查报告结论，cbc 2026-09-04）：
 * - domain-bot 向 tuna `Post` 靠拢（生产者适配消费者），摒弃 v0 自创三级嵌套；
 * - 摄入落在 tuna `packages/feeds`（宪法批准的摄入边界，零网络），tuna 侧仅需薄校验 normalizer；
 * - 携带稳定 `id`（domain-bot:<digestId>:<index>）供 tuna `BriefItem.postId` 引用。
 *
 * 钩子/概要限长对齐 tuna normalizers 实作（老张 2026-08-07 拍板，X26）：
 * hooks 恒 3 条互异（zh ≤35 / en ≤50 码点）；summary zh ≤300 / en ≤450。
 */

const SCHEMA = 'tuna-brief-v1'
const HOOK_LIMITS: Record<'zh' | 'en', number> = { zh: 35, en: 50 }
const SUMMARY_MAX: Record<'zh' | 'en', number> = { zh: 300, en: 450 }

/** 语言推断：与 tuna feeds/sanitize.ts detectLang 同族——前 400 码点 CJK 占比 >30% 判 zh。 */
export function detectLang(text: string): 'zh' | 'en' {
  const sample = Array.from(text).slice(0, 400)
  if (sample.length === 0) return 'en'
  let cjk = 0
  for (const ch of sample) {
    const code = ch.codePointAt(0) ?? 0
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) cjk += 1
  }
  return cjk / sample.length > 0.3 ? 'zh' : 'en'
}

function truncateChars(text: string, maxChars: number): string {
  const chars = Array.from(text)
  if (chars.length <= maxChars) return text
  return `${chars.slice(0, maxChars - 1).join('')}…`
}

function firstSentence(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length === 0) return ''
  const match = clean.match(/^[^。！？.!?]*[。！？.!?]/)
  const sentence = match ? match[0] : clean
  return truncateChars(sentence.trim(), maxChars)
}

/** 恒 3 条互异的机械钩子（标题 / 首句 / 组合 / 兜底模板中取前 3）——对齐 tuna placeholderHooks 语义。 */
export function deriveHooks(title: string, summary: string, domain: string, lang: 'zh' | 'en'): string[] {
  const maxHook = HOOK_LIMITS[lang]
  const titlePart = truncateChars(title, maxHook)
  const sentence = firstSentence(summary, maxHook)
  const combo = truncateChars(`${truncateChars(title, 16)}｜${firstSentence(summary, 21)}`, maxHook)
  const candidates = [
    titlePart,
    sentence,
    combo,
    truncateChars(`${domain}：${truncateChars(title, maxHook - domain.length - 2)}`, maxHook),
    truncateChars(`最新更新·${truncateChars(title, maxHook - 6)}`, maxHook),
  ]
  const hooks: string[] = []
  for (const c of candidates) {
    const cleaned = c.trim()
    if (cleaned.length === 0 || hooks.includes(cleaned)) continue
    hooks.push(cleaned)
    if (hooks.length === 3) break
  }
  return hooks
}

/** 产出对齐 tuna Post 候选 + BriefItem why 的 v1 内容包。 */
export function renderTunaBrief(digest: Digest, now = Date.now()): string {
  const generatedAt = new Date(digest.generatedAt || now).toISOString()
  const posts: Array<Record<string, unknown>> = []
  const briefItems: Array<{ postId: string; why: string; source: 'static' }> = []
  digest.clusters.forEach((c, i) => {
    const src = c.items[0]!
    const lang = detectLang(`${c.title}\n${c.summary}`)
    const id = `domain-bot:${digest.id}:${i}`
    posts.push({
      id,
      title: c.title.slice(0, 120),
      hooks: deriveHooks(c.title, c.summary, digest.domain, lang),
      summary: truncateChars(c.summary.trim(), SUMMARY_MAX[lang]),
      body: src.body || c.summary,
      lang,
      author: { id: 'domain-bot', name: 'domain-bot 探针', kind: 'user' },
      provenance: 'human',
      epistemic: 'inference',
      signer: null,
      schemaVersion: 1,
      createdAt: new Date(src.publishedAt || digest.generatedAt || now).toISOString(),
      sourceUrl: src.url,
    })
    briefItems.push({ postId: id, why: truncateChars(c.why, 40), source: 'static' })
  })
  return JSON.stringify(
    {
      schema: SCHEMA,
      digestId: digest.id,
      domain: digest.domain,
      generatedAt,
      posts,
      brief: { generatedAt, items: briefItems },
    },
    null,
    2,
  )
}

export function pushTuna(digest: Digest, outDir: string, now = Date.now()): string {
  if (outDir.includes('\0')) throw new Error('outDir 含非法字符')
  const safeId = digest.id.replace(/[^a-z0-9]/g, '')
  if (!safeId) throw new Error(`digest id 非法: ${digest.id}`)
  mkdirSync(outDir, { recursive: true })
  const path = join(outDir, `brief-${safeId}.json`)
  writeFileSync(path, renderTunaBrief(digest, now))
  return path
}
