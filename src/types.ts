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

export interface SourceConfig {
  id: string
  /** exa 的 url 字段放搜索词；bili 同理；jina 放目标网页 URL */
  type: 'rss' | 'github' | 'exa' | 'v2ex' | 'bili' | 'jina'
  url: string
  weight: number
  enabled: boolean
}

export interface DomainConfig {
  domain: string
  keywords: string[]
  scoreThreshold: number
  maxPerDigest: number
  clusterThreshold: number
}

export type FetchFn = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status?: number; text: () => Promise<string> }>

export type SpawnFn = (
  cmd: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>
