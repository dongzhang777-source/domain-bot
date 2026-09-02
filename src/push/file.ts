import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Digest } from '../types.js'

export function renderDigestMarkdown(digest: Digest): string {
  const lines: string[] = [
    `# 领域情报 · ${digest.domain} · ${new Date(digest.generatedAt).toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
    `> digest: ${digest.id} · 共 ${digest.clusters.length} 个趋势簇。反馈请在 Telegram 内点 👍/👎 按钮（文件版不计入判定线的 viewed 与反馈统计）。`,
    '',
  ]
  digest.clusters.forEach((c, i) => {
    lines.push(`## ${i + 1}. ${c.title}`, '')
    lines.push(c.summary.slice(0, 800), '')
    lines.push(`- 为什么值得看：${c.why || '（无理由，多为启发式打分）'}`)
    for (const item of c.items) {
      lines.push(`- 来源 [${item.source}](${item.url}) · 分 ${item.valueScore.toFixed(2)}${item.isNew ? ' · 🆕增量' : ''}`)
    }
    lines.push('')
  })
  return lines.join('\n')
}

function sanitizeDigestId(id: string): string {
  if (!/^[a-z0-9]{1,64}$/.test(id)) throw new Error(`digest id 非法: ${id}`)
  return id
}

export function pushFile(digest: Digest, outDir: string): string {
  if (outDir.includes('\0')) throw new Error('outDir 含非法字符')
  mkdirSync(outDir, { recursive: true })
  const safeId = sanitizeDigestId(digest.id)
  const path = join(outDir, `digest-${safeId}.md`)
  writeFileSync(path, renderDigestMarkdown(digest))
  return path
}
