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
/**
 * 黑名单分组。分组 id 供质量看板逐层归因（1396→750→703 的漏斗必须可复算）。
 *
 * `hype` 单列一组的理由：标题党/情绪炒作对**两个 bot 都不可接受**，属跨 persona 的
 * 全局禁忌，不该写在 persona.rejectRules 里（实测踩过：clickbait 只配在 newsline，
 * 于是「GPT-6 Astra横空出世，全网彻底炸锅了！」从 deepthought 产线泄漏）。
 * persona.rejectRules 只放两个 bot 各自特有的红线。
 */
export type BlacklistGroup = 'damaged' | 'adRecruit' | 'crossDomain' | 'nonTech' | 'hype'

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
    /** 标题 jaccard 超此值判同一通稿原样转发（补充判据，不是主判据） */
    jaccardThreshold: number
    /** 同一事件在主信息流最多占几个坑 */
    maxPerEvent: number
    /**
     * 批内文档频率上限（绝对值）。一个实体词在本批出现于超过该数量的条目里，
     * 就不可能是事件标识，不作为聚类连接依据。缺省 20。
     *
     * 真跑实测依据（2026-09-04）：1184 条 arXiv/HF 采集，闸门后 128 条被单链接
     * 传递闭包塌缩成 18 个事件，109 条被 eventSaturated 误杀。静态词表拦不住这个，
     * 因为每个领域的高频术语无法预先穷举；df 是自调的。
     */
    maxEntityDf?: number
    /** 文档频率上限（占**背景批**即全量采集的比例），缺省 0.02。与绝对值取 max，两侧都不能少。 */
    maxEntityDfRatio?: number
    /**
     * 实体词聚类的通用词表（必需输入，不是可选装饰）。
     *
     * 为何不能用标题 jaccard 做主判据（实测，2026-09-04）：取 DB-03 报告里 GPT-6 Astra
     * 同一事件的 10 条真实报道标题，45 个配对中最大 jaccard 仅 0.313、中位 0.105，
     * ≥0.75 命中 0、≥0.50 命中 0；K2 Horizon 5 条最大 0.500，≥0.75 同样 0。
     * 记者刻意给同一事件写不同标题，阈值不可调成有用。
     * 改用「非通用 token 共享」并查集后：Astra 8/10 聚一簇、K2 5/5 聚一簇、3 条干扰项零误并。
     * 而「非通用」的定义就靠本表：不剔除 openai/model/new 这类词，全部条目会被并成一坠。
     */
    eventStopwords: string[]
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
  /**
   * 宽通道召回（DB-08，老张 2026-09-05 批「用关键词搜索内容会限制信息渠道」整改）。
   * 关键词积分闸门是召回边界而非质量判断——词表外内容结构性不可见。开启后，
   * relevance 未过但预筛达标的条目进待定池，由 reviewer 做二元判定（include/exclude，
   * 不打分、不做终审）捞回词表漏网的高价值内容。质量底线（黑名单/十条断言）不放松。
   */
  recall?: RecallConfig
}

export interface RecallConfig {
  enabled: boolean
  /** 每轮进入 LLM 判定的条目上限（成本护栏，不设会随采集量线性膨胀） */
  maxPerRound: number
  /** 判定与金标期望的一致率下限（trash→exclude、其余→include）。低于则宽通道自动回退关闭 */
  minAgreementRate?: number
}

// ---------- 闸门产出 ----------

export type GateId = 'blacklist' | 'relevance' | 'fingerprint' | 'persona' | 'gatekeeper' | 'recall'

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
  /**
   * 宽通道待定池（DB-08）：relevance 未过但预筛达标、待 LLM 二元判定的条目。
   * 仅当 persona.recall.enabled 时非空；这些条目**不算被丢弃**（不在 dropped 里），
   * 由 pipeline 的 recallJudge 回调判定后并入或不并入候选。空池 = 宽通道未启用或无漏网。
   */
  recallPool?: RawItem[]
}

/** 相关性积分明细：可解释字段，供看板与调试。 */
export interface RelevanceScore {
  points: number
  hits: Array<{ word: string; tier: 'core' | 'ecosystem' | 'generic'; points: number }>
}

/**
 * 主编终审与发布共用的「渲染后条目」形状。
 *
 * 与 ScoredItem 的区别：ScoredItem 是采集/打分阶段的原始条目（title/body/url/valueScore），
 * GatekeeperInput 是面向读者的渲染产物（hooks/summary/why/lang）。
 * 终审十条断言全部作用于本类型——机械截断 / 碎片钩子 / 浮点回显 这三类缺陷
 * 只有在渲染后才存在，对 ScoredItem 断言无意义。故渲染必须在终审之前。
 */
export interface GatekeeperInput {
  /** 稳定 id，格式 `domain-bot-<persona>:<digestId>:<index>`（对齐 tuna 侧正则 `^[a-z0-9-]+:[a-z0-9]+:\d+$`） */
  id: string
  title: string
  hooks: string[]
  summary: string
  body: string
  why: string
  url: string
  lang: 'zh' | 'en'
  publishedAt: number
  source: string
  /** 事件簇标识（eventCluster 产物），供 gk:eventOversubscribed 跨条目断言使用 */
  eventKey: string
  /** 打分阶段的价值分（看板与排序用；终审断言不读它，防止 LLM/启发式自分自用） */
  valueScore: number
}

export type FetchFn = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status?: number; text: () => Promise<string> }>

export type SpawnFn = (
  cmd: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>
