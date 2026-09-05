import type { DropRecord, GateId, GateOutcome, GatesConfig, PersonaConfig, RawItem } from '../types.js'
import { BlacklistGate, toDropRecord as blacklistDrop } from './blacklist.js'
import { PersonaGate, toDropRecord as personaDrop } from './persona.js'
import { RelevanceGate, toDropRecord as relevanceDrop } from './relevance.js'
import { dedupeByCanonicalUrl } from './fingerprint.js'

export { BlacklistGate } from './blacklist.js'
export { PersonaGate } from './persona.js'
export { RelevanceGate } from './relevance.js'
export {
  capEvents,
  collectCanonicalUrls,
  dedupeByCanonicalUrl,
  type CapEventsOptions,
} from './fingerprint.js'
export { capitalizedTokens, clusterByEntity, entityTokens, eventKeyMap, topicTokens , type ClusterOptions } from './eventCluster.js'
export { compilePattern, matchesKeyword, toHaystack } from './textMatch.js'

/**
 * 三层硬闸门编排（外加 persona 前置闸）。
 *
 * 顺序有讲究，不是随便排的：
 * 1. **persona 前置**——信源白名单是 Set 查找，最便宜，且双产线彻底分离时能先砍掉大半候选；
 *    时效硬约束也在这层（DB-03 #193：2024 年 10 月的 B 站旧闻混进 2026 年信息流）。
 * 2. **门禁 1 黑名单**——结构性损坏（`[object Object]`、标题过短）先出局，否则后续正则判定
 *    的是不可读的垃圾正文，白算。
 * 3. **门禁 2 相关性积分**——过了黑名单才谈相关不相关。
 * 4. **门禁 3 精确去重**——放最后：前三层每砍掉一条，去重的比对量就少一条。
 *
 * 事件聚合（capEvents）**不在这里**——它需要分数才能保留每事件最高分的那几条，
 * 必须在打分之后、配额截断之前跑，由 pipeline.ts 调用。这正是旧管线的顺序缺陷
 * （`src/index.ts:106-115` 先截断、`:128` 才聚类）导致同事件刷屏的原因。
 */

export interface RunGatesOptions {
  persona: PersonaConfig
  gates: GatesConfig
  now: number
  /** 跨产线共享的已发布指纹库；命中即一票否决 */
  knownCanonical?: ReadonlySet<string>
  /**
   * 宽通道（DB-08）：给出即启用。relevance 未过的条目不再直接 drop，而是——
   * 预筛达标 → 进 recallPool（待 LLM 二元判定）；预筛不达标或超出池上限 → drop
   * （ruleId: recall:ineligible / recall:poolOverflow），保证漏斗恒可复算。
   */
  recall?: { maxPerRound: number }
}

export interface RunGatesResult extends GateOutcome {
  /** 配置里写错的正则。不得静默吞掉——一条失效规则等于该规则不存在，闸门会假绿。 */
  compileErrors: Array<{ gate: GateId; ruleId: string; error: string }>
}

/** 宽通道预筛：relevance 未过的条目要进待定池，至少得是「可读的一条内容」。
 *  黑名单已在更早一步把结构性垃圾拦掉，这里只挡「标题过短/正文空洞」的残次品——
 *  刻意不做相关性判断（那正是宽通道要交给 LLM 的事）。 */
export function recallEligible(item: RawItem, gates: GatesConfig): boolean {
  const title = (item.title ?? '').trim()
  if (title.length < gates.minTitleChars) return false
  const body = (item.body ?? '').trim()
  // 纯符号/纯大写噪音标题（如 "!!!..." "ASDF ASDF"）没有判定价值
  const alpha = title.replace(/[^\p{L}\p{N}]/gu, '')
  if (alpha.length < Math.max(4, Math.floor(gates.minTitleChars / 2))) return false
  // RSS 无正文是常态（bili/jina 部分条目），正文存在但空洞（<30 字符）才算不合格
  return body.length === 0 || body.length >= 30
}

export function runGates(items: RawItem[], opts: RunGatesOptions): RunGatesResult {
  const { persona, gates, now, knownCanonical, recall } = opts
  const personaGate = new PersonaGate(persona)
  const blacklistGate = new BlacklistGate(gates)
  const relevanceGate = new RelevanceGate(gates)

  const compileErrors: RunGatesResult['compileErrors'] = [
    ...personaGate.compileErrors.map((e) => ({ gate: 'persona' as GateId, ...e })),
    ...blacklistGate.compileErrors.map((e) => ({ gate: 'blacklist' as GateId, ...e })),
  ]

  const dropped: DropRecord[] = []
  let stage: RawItem[] = items

  // 1. persona 前置闸
  const afterPersona: RawItem[] = []
  for (const item of stage) {
    const v = personaGate.check(item, now)
    if (v.passed) afterPersona.push(item)
    else dropped.push(personaDrop(item, v))
  }
  stage = afterPersona

  // 2. 门禁 1：负向黑名单
  const afterBlacklist: RawItem[] = []
  for (const item of stage) {
    const v = blacklistGate.check(item)
    if (!v.blocked) afterBlacklist.push(item)
    else dropped.push(blacklistDrop(item, v))
  }
  stage = afterBlacklist

  // 3. 门禁 2：相关性积分。DB-08 起它只是**快通道**：未过的条目若宽通道开启且预筛
  //    达标，进 recallPool 交 LLM 二元判定，而不是被词表一票否决——词表是召回信号，
  //    不是入选标准（老张 2026-09-05 批「用关键词搜索内容会限制信息渠道」）。
  const afterRelevance: RawItem[] = []
  const recallScored: Array<{ item: RawItem; points: number }> = []
  for (const item of stage) {
    const v = relevanceGate.check(item)
    if (v.passed) {
      afterRelevance.push(item)
      continue
    }
    if (!recall) {
      dropped.push(relevanceDrop(item, v, gates.minPoints))
      continue
    }
    if (!recallEligible(item, gates)) {
      dropped.push({
        itemId: item.id, title: item.title, source: item.source, url: item.url,
        gate: 'recall', ruleId: 'recall:ineligible',
        reason: `宽通道预筛不达标（${v.reason}）`,
      })
      continue
    }
    recallScored.push({ item, points: v.score.points })
  }
  // 池按积分降序（2 分的比 0 分的更接近相关），同分保持采集顺序。上限截断的进 dropped
  // （recall:poolOverflow），任何不进 passed 的条目都有去处，漏斗恒可复算。
  const recallPool: RawItem[] = recallScored
    .sort((a, b) => b.points - a.points)
    .slice(0, recall?.maxPerRound ?? 0)
    .map((r) => r.item)
  if (recall) {
    const overflow = recallScored.length - recallPool.length
    if (overflow > 0) {
      dropped.push({
        itemId: '(batch)', title: `${overflow} 条宽通道候选超池上限`, source: '(multiple)', url: '',
        gate: 'recall', ruleId: 'recall:poolOverflow',
        reason: `待定池上限 ${recall.maxPerRound}，按积分降序截断 ${overflow} 条`,
      })
    }
  }
  stage = afterRelevance

  // 4. 门禁 3：规范 URL 精确去重
  const { kept, dropped: dupDropped } = dedupeByCanonicalUrl(stage, knownCanonical)
  dropped.push(...dupDropped)

  return { passed: kept, dropped, funnel: buildFunnel(dropped), compileErrors, recallPool }
}

/** 逐层漏斗计数：看板必须能复算 1396→750→703→… 的每一跳，否则漏斗只是修辞。 */
export function buildFunnel(dropped: DropRecord[]): GateOutcome['funnel'] {
  const counts = new Map<string, { gate: GateId; ruleId: string; count: number }>()
  for (const d of dropped) {
    const key = `${d.gate}\u0000${d.ruleId}`
    const cur = counts.get(key)
    if (cur) cur.count += 1
    else counts.set(key, { gate: d.gate, ruleId: d.ruleId, count: 1 })
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)
}
