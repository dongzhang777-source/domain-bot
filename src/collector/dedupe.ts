import { createHash } from 'node:crypto'
import type { RawItem } from '../types.js'
import { canonicalUrl } from './canonicalUrl.js'

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

/**
 * 条目 id：优先规范 URL 派生，无 URL（或 URL 不可解析）时才回退内容哈希。
 *
 * 为什么必须 URL 优先（DB-03 实证）：旧口径全适配器一律 contentHash({title, body})，
 * 同一文档经两条渠道抓回时正文略有差异 → id 不同 → dedupe 放行 → 200 条里 12 条完全重复。
 * GitHub 仓库经 github 与 exa 双渠道各出一条（#158/#171）同理。故所有适配器必须共用本函数，
 * 口径不一致则跨渠道去重失效。
 *
 * 前缀标识派生方式，便于质量看板归因与调试：`u-` = URL 派生，`c-` = 内容派生。
 */
export function itemId(url: string, title: string, body: string): string {
  const canon = canonicalUrl(url)
  if (canon) return `u-${createHash('sha1').update(canon).digest('hex').slice(0, 20)}`
  return `c-${contentHash({ title, body }).slice(0, 20)}`
}

/**
 * 剥掉标题末尾的**转载渠道名后缀**（` - India Today`、` | Reuters`、` – Unite.AI`、` — Ipan`）。
 *
 * 为什么事件聚类必须剥（DB-12/D7 实测）：newsline 2026-09-05 轮里，
 * `OpenAI launches GPT-6 Astra, the AI model … - IBTimes India` 与
 * `Rogue OpenAI agents go crazy, hijack German site … - India Today` 因后缀里的
 * `india` 被并查集缝成一簇——GPT-6 Astra 与「agents 劫持德国 wiki」是两个独立事件，
 * 那条连接边不是事件实体，是转载渠道名。后缀 outlet 名同样是专有名词，
 * `capitalizedTokens` 的大小写信号区分不了「事件标识」与「来源词汇」这两类。
 *
 * 判据刻意收窄，避免误伤：只剥**末尾一段**、分隔符必须是前带空白的 `-`/`–`/`—`/`|`、
 * 后接 1-4 个首字母大写词。正文中间的连字符复合词（state-of-the-art）与
 * `K2 Horizon: Frontier Performance` 这类冒号结构不受影响。
 *
 * 已知代价（记录在案，不装作没有）：末段恰好是真实实体的标题（`Apple unveils M4 - MacBook Pro`）
 * 会丢掉末段实体。不引入 outlet 名单来缓解——名单维护成本高且漏一个就漏一条边。
 */
export function stripOutletSuffix(title: string): string {
  return title
    .replace(/\s+[-–—|]\s+[A-Z][A-Za-z0-9.'’&]*(?:\s+[A-Z][A-Za-z0-9.'’&]*){0,3}\s*$/, '')
    .trim()
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
