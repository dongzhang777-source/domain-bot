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
} from './fingerprint.js'
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
}

export interface RunGatesResult extends GateOutcome {
  /** 配置里写错的正则。不得静默吞掉——一条失效规则等于该规则不存在，闸门会假绿。 */
  compileErrors: Array<{ gate: GateId; ruleId: string; error: string }>
}

export function runGates(items: RawItem[], opts: RunGatesOptions): RunGatesResult {
  const { persona, gates, now, knownCanonical } = opts
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

  // 3. 门禁 2：相关性积分
  const afterRelevance: RawItem[] = []
  for (const item of stage) {
    const v = relevanceGate.check(item)
    if (v.passed) afterRelevance.push(item)
    else dropped.push(relevanceDrop(item, v, gates.minPoints))
  }
  stage = afterRelevance

  // 4. 门禁 3：规范 URL 精确去重
  const { kept, dropped: dupDropped } = dedupeByCanonicalUrl(stage, knownCanonical)
  dropped.push(...dupDropped)

  return { passed: kept, dropped, funnel: buildFunnel(dropped), compileErrors }
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
