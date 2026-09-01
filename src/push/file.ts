import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Digest } from '../types.js'

export function renderDigestMarkdown(digest: Digest): string {
  const lines: string[] = [
    `# 领域情报 · ${digest.domain} · ${new Date(digest.generatedAt).toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
    `> digest: ${digest.id} · 共 ${digest.clusters.length} 个趋势簇。有价值请 👍，噪音请 👎（Telegram 内点按钮，或向 feedback.json 追加记录）。`,
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

export function pushFile(digest: Digest, outDir: string): string {
  mkdirSync(outDir, { recursive: true })
  const path = join(outDir, `digest-${digest.id}.md`)
  writeFileSync(path, renderDigestMarkdown(digest))
  return path
}
