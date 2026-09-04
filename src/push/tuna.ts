import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Digest } from '../types.js'

/**
 * tuna 分发渠道：把 digest 产出为 tuna 三级瀑布流（docs/MVP.md「交互结构」）可消费的内容包。
 *
 * 层级映射（tuna MVP 定义 → domain-bot 供给）：
 * - tier1 钩子层：hook（标题精简）+ meta（来源 · 新鲜度）+ why 推给你（人话化理由）
 * - tier2 消费层：summary（≤300 字，一屏内读完——「完读率即真实信号」）
 * - tier3 心流层：url（原文跳转；深聊层属 tuna app 形态，探针不供给）
 *
 * ⚠️ schema 为 domain-bot 侧提案（tuna-brief-v0），tuna 侧摄入契约待督阵会话确认后固化为跨项目协议；
 *    在此之前本文件仅是 outbox 产物，不构成任何运行时依赖。
 */

const SCHEMA = 'tuna-brief-v0'

export function renderTunaBrief(digest: Digest, now = Date.now()): string {
  const payload = {
    schema: SCHEMA,
    digestId: digest.id,
    domain: digest.domain,
    generatedAt: digest.generatedAt,
    items: digest.clusters.map((c, i) => {
      const src = c.items[0]!
      return {
        index: i,
        tier1: {
          hook: c.title.slice(0, 90),
          meta: src.source,
          isNew: src.isNew,
          publishedAt: src.publishedAt,
        },
        tier2: {
          title: c.title.slice(0, 120),
          summary: c.summary.slice(0, 300),
          why: c.why.slice(0, 200),
        },
        tier3: { url: src.url },
        score: src.valueScore,
      }
    }),
  }
  return JSON.stringify({ ...payload, now }, null, 2)
}

export function pushTuna(digest: Digest, outDir: string, now = Date.now()): string {
  if (outDir.includes('\0')) throw new Error('outDir 含非法字符')
  mkdirSync(outDir, { recursive: true })
  const safeId = digest.id.replace(/[^a-z0-9]/g, '')
  if (!safeId) throw new Error(`digest id 非法: ${digest.id}`)
  const path = join(outDir, `brief-${safeId}.json`)
  writeFileSync(path, renderTunaBrief(digest, now))
  return path
}
