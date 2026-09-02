import { createHash } from 'node:crypto'
import type { RawItem } from '../types.js'

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff]+/g

export function tokenize(s: string): Set<string> {
  const norm = normalizeText(s)
  const tokens = new Set(norm.split(' ').filter((t) => t.length > 1))
  // P2-2（agy-R1）：中文标题字间无空格，纯 split(' ') 只能得到整串 token，
  // 同事件跨源报道（机器之心 vs 量子位）jaccard 恒为 0 聚不拢。
  // 对 CJK 连续段补 2-gram，其余文本的分词行为不变。
  for (const run of norm.match(CJK_RUN) ?? []) {
    if (run.length < 2) continue
    for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2))
  }
  return tokens
}

export function contentHash(item: { title: string; body: string }): string {
  return createHash('sha1').update(normalizeText(item.title + ' ' + item.body)).digest('hex')
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

/** 精确去重：内容哈希已见过的丢弃。近似重复（同事件多源报道）交给聚类环节合并，这里不丢。 */
export function dedupe(
  items: RawItem[],
  knownIds: Set<string>,
): { kept: RawItem[]; droppedExact: number } {
  const kept: RawItem[] = []
  const seen = new Set(knownIds)
  let droppedExact = 0
  for (const item of items) {
    if (seen.has(item.id)) {
      droppedExact++
      continue
    }
    seen.add(item.id)
    kept.push(item)
  }
  return { kept, droppedExact }
}
