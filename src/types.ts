export interface RawItem {
  id: string
  source: string
  title: string
  body: string
  url: string
  publishedAt: number
  raw?: unknown
}

export interface ScoredItem extends RawItem {
  valueScore: number
  isNew: boolean
  reason: string
}

export interface DigestCluster {
  ref: string
  title: string
  summary: string
  why: string
  items: ScoredItem[]
}

export interface Digest {
  id: string
  generatedAt: number
  domain: string
  clusters: DigestCluster[]
}

export type FeedbackSignal = 'up' | 'down'

export interface FeedbackRecord {
  itemId: string
  digestId: string
  source: string
  signal: FeedbackSignal
  at: number
}

export interface ViewRecord {
  digestId: string
  at: number
}

export interface SourceConfig {
  id: string
  /** exa 的 url 字段放搜索词；bili/ytsearch 同理；jina 放目标网页 URL */
  type: 'rss' | 'github' | 'exa' | 'v2ex' | 'bili' | 'ytsearch' | 'jina'
  url: string
  weight: number
  enabled: boolean
}

export interface DomainConfig {
  domain: string
  keywords: string[]
  /** 领域无关的"有新闻价值"信号词；缺省时回落到 HeuristicScorer 内置列表 */
  signalWords?: string[]
  /**
   * @deprecated 已移入 PersonaConfig.minQualityScore。保留为可选仅为兼容旧夹具与
   * HeuristicScorer 降级链；新产线（pipeline.ts）一律读 persona，不读此字段。
   */
  scoreThreshold?: number
  /** @deprecated 已移入 PersonaConfig.maxItems（并废除每源均摊配额）。同上，新产线不读。 */
  maxPerDigest?: number
  clusterThreshold: number
}

// ---------- 三层硬闸门（config/gates.json） ----------

/** 黑名单规则分组：分组 id 供质量看板逐层归因（1396→750→703 的漏斗必须可复算）。 */
export type BlacklistGroup = 'damaged' | 'adRecruit' | 'crossDomain' | 'nonTech'

export interface BlacklistRule {
  /** 归因标识，落进 DropRecord.ruleId */
  id: string
  group: BlacklistGroup
  /** 正则源串（不含定界符） */
  pattern: string
  flags?: string
  /** 作用域，缺省 both */
  scope?: 'title' | 'body' | 'both'
  /**
   * 仅在「未命中强 AI 词」时才生效。crossDomain 组必须开此开关——
   * 否则 `neural`/`diffusion`/`agent` 这类跨学科多义词会误杀真正的 AI 论文
   * （DB-03 §2.3 失效模式 1）。
   */
  unlessStrongAi?: boolean
}

/** 多级关键词积分档位：泛词计 0 分，单凭泛词不得通过（DB-03 §3.2 门禁 2）。 */
export interface KeywordTier {
  tier: 'core' | 'ecosystem' | 'generic'
  points: number
  words: string[]
}

export interface GatesConfig {
  blacklist: BlacklistRule[]
  /** 强 AI 词：crossDomain 组的豁免条件 */
  strongAiWords: string[]
  keywordTiers: KeywordTier[]
  /** 积分准入门槛 */
  minPoints: number
  /** 标题最短码点数，短于此判为无意义碎条 */
  minTitleChars: number
  dedupe: {
    /** 标题 jaccard 超此值判同事件 */
    jaccardThreshold: number
    /** 同一事件在主信息流最多占几个坑 */
    maxPerEvent: number
  }
}

// ---------- 双产线 persona（config/personas/*.json） ----------

export interface PersonaRejectRule {
  id: string
  pattern: string
  flags?: string
}

export interface PersonaConfig {
  /** newsline | deepthought */
  id: string
  /** AI时事快线 | AI深度思想 */
  displayName: string
  domain: string
  /** config/sources.json 的 id 白名单；不在表内的源该产线不采 */
  sources: string[]
  /** 时效硬约束（小时）：newsline 72 / deepthought 720。publishedAt=0（源未给时间）不按超时处理 */
  maxAgeHours: number
  /** 内容包条数上限。废除「每渠道 ≥N 条」均摊指标——上限不是配额，凑不满就是凑不满 */
  maxItems: number
  /** 准入质量分下限（0-10，reviewer 打分口径） */
  minQualityScore: number
  clusterThreshold: number
  /** persona 特有淘汰红线，叠加在全局黑名单之上 */
  rejectRules: PersonaRejectRule[]
}

// ---------- 闸门产出 ----------

export type GateId = 'blacklist' | 'relevance' | 'fingerprint' | 'persona' | 'gatekeeper'

/** 被拦条目：必须带 gate + ruleId + reason，否则看板无法归因、漏斗无法复算。 */
export interface DropRecord {
  itemId: string
  title: string
  source: string
  url: string
  gate: GateId
  ruleId: string
  reason: string
}

export interface GateOutcome {
  passed: RawItem[]
  dropped: DropRecord[]
  /** 逐层漏斗计数，按 gate 归组 */
  funnel: Array<{ gate: GateId; ruleId: string; count: number }>
}

/** 相关性积分明细：可解释字段，供看板与调试。 */
export interface RelevanceScore {
  points: number
  hits: Array<{ word: string; tier: 'core' | 'ecosystem' | 'generic'; points: number }>
}

export type FetchFn = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status?: number; text: () => Promise<string> }>

export type SpawnFn = (
  cmd: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>
