import { createHash } from 'node:crypto'
import type { RawItem } from '../types.js'

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function tokenize(s: string): Set<string> {
  return new Set(normalizeText(s).split(' ').filter((t) => t.length > 1))
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
