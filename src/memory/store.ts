import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { jaccard, tokenize } from '../collector/dedupe.js'
import type { FeedbackRecord, FeedbackSignal, RawItem, ScoredItem, ViewRecord } from '../types.js'

export interface StoredDigest {
  digestId: string
  generatedAt: number
  clusters: Array<{ ref: string; title: string; summary: string; why: string; url: string; isNew: boolean; source: string }>
}

/** 条目级行为信号：L1→L2 展开记录。「多次推送不展开 = 默认不感兴趣」的数据基础——
 *  视图级（views.json 按 digestId 去重）无法归因到源，负信号推断需要 item 粒度。 */
export interface EngagementRecord {
  digestId: string
  index: number
  source: string
  at: number
}

const MAX_STORED_DIGESTS = 30
const MAX_ENGAGEMENTS = 5000

export interface ArchiveEntry {
  id: string
  title: string
  url: string
  source: string
  firstSeenAt: number
  lastSeenAt: number
  hitCount: number
  /** true = 真的推送过；false = 仅进入过候选池。区分二者才能解传送带并观测候选池分布 */
  pushed: boolean
}

interface Archive {
  entries: ArchiveEntry[]
  /** 推送时登记的 ref → 条目映射，供 Telegram 回调查询 */
  digestRefs: Record<string, { digestId: string; itemId: string; source: string }>
}

export interface WeightsState {
  weights: Record<string, number>
  /** 闸门令牌：参与权重计算时的反馈内容哈希（不是计数——计数在手工编辑语义下会静默吞掉修正） */
  feedbackHash: string
}

// 全量候选入归档后量级从"每轮≤6"升到"每轮数百"；2 万条 ≈ 5MB JSON，两周探针够用。
// 可注入是为了让裁剪测试不必构造 20001 条（见工作单 Task 9 Step 0）。
const DEFAULT_MAX_ENTRIES = 20000
const MAX_DIGEST_REFS = 500

/** JSON 文件记忆库：归档（新颖性判定）+ 反馈信号 + digest 引用。可导出、可人工修正（直接改 JSON）。 */
export class MemoryStore {
  private archive: Archive = { entries: [], digestRefs: {} }
  private feedback: FeedbackRecord[] = []
  private views: ViewRecord[] = []
  private digests: StoredDigest[] = []
  private engagements: EngagementRecord[] = []
  private tokenCache = new Map<string, Set<string>>()
  private weights: WeightsState = { weights: {}, feedbackHash: '' }
  private readonly maxEntries: number

  constructor(private dir: string, opts: { maxEntries?: number } = {}) {
    if (dir.includes('\0')) throw new Error('memory dir 含非法字符')
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
    mkdirSync(dir, { recursive: true })
    this.load()
  }

  /** 加载失败不得静默清零（D6，小巴 impl 审查）：坏文件改名留存（.corrupt-<ts>），从空状态继续并告警。
   *  此前 catch 全静默——崩溃落在写窗口产生的截断文件会被当成「首次运行」，反馈全史无声丢失。 */
  private loadJson<T>(name: string, label: string): T | null {
    const path = join(this.dir, name)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as T
    } catch {
      const bad = `${path}.corrupt-${Date.now()}`
      try {
        renameSync(path, bad)
      } catch {
        /* 改名失败则保留原文件，下次启动再试 */
      }
      console.error(`[store] ${label} 解析失败，坏文件移至 ${bad}（不静默清零）`)
      return null
    }
  }

  private load(): void {
    const a = this.loadJson<Archive>('archive.json', 'archive.json')
    if (a) this.archive = a
    const f = this.loadJson<FeedbackRecord[]>('feedback.json', 'feedback.json')
    if (f) this.feedback = f
    const w = this.loadJson<WeightsState>('weights.json', 'weights.json')
    if (w) this.weights = w
    const v = this.loadJson<ViewRecord[]>('views.json', 'views.json')
    if (v) this.views = v
    const d = this.loadJson<StoredDigest[]>('digests.json', 'digests.json')
    if (d) this.digests = d
    const e = this.loadJson<EngagementRecord[]>('engagements.json', 'engagements.json')
    if (e) this.engagements = e
  }

  /** D6：非原子直写在崩溃窗口会产生截断文件——tmp+rename 原子替换。 */
  private writeFileAtomic(name: string, data: string): void {
    const finalPath = join(this.dir, name)
    const tmp = `${finalPath}.tmp`
    writeFileSync(tmp, data)
    renameSync(tmp, finalPath)
  }

  private saveArchive(): void {
    this.writeFileAtomic('archive.json', JSON.stringify(this.archive, null, 2))
  }

  private saveFeedback(): void {
    this.writeFileAtomic('feedback.json', JSON.stringify(this.feedback, null, 2))
  }

  weightsState(): WeightsState {
    return { weights: { ...this.weights.weights }, feedbackHash: this.weights.feedbackHash }
  }

  saveWeights(weights: Record<string, number>, feedbackHash: string): void {
    this.weights = { weights: { ...weights }, feedbackHash }
    this.writeFileAtomic('weights.json', JSON.stringify(this.weights, null, 2))
  }

  feedbackCount(): number {
    return this.feedback.length
  }

  /** 已读回执落盘（Telegram 👀 按钮）。重复点击去重。 */
  recordView(digestId: string, at: number): boolean {
    if (this.views.some((v) => v.digestId === digestId)) return false
    this.views.push({ digestId, at })
    this.writeFileAtomic('views.json', JSON.stringify(this.views, null, 2))
    return true
  }

  viewCount(): number {
    return this.views.length
  }

  /** 反馈全量内容（闸门哈希与人工审查用）。 */
  feedbackAll(): FeedbackRecord[] {
    return [...this.feedback]
  }

  knownIds(): Set<string> {
    return new Set(this.archive.entries.map((e) => e.id))
  }

  /** 新颖性判定：与归档条目标题的最大 jaccard < 阈值即为新信息。 */
  isNovel(item: RawItem, threshold = 0.7): boolean {
    const tokens = tokenize(item.title)
    for (const e of this.archive.entries) {
      let cached = this.tokenCache.get(e.id)
      if (!cached) {
        cached = tokenize(e.title)
        this.tokenCache.set(e.id, cached)
      }
      if (jaccard(cached, tokens) >= threshold) return false
    }
    return true
  }

  /** 把本轮全部候选写入归档（不只推送的）；已存在的刷新 lastSeenAt/hitCount。 */
  recordItems(items: ScoredItem[], now: number): void {
    const byId = new Map(this.archive.entries.map((e) => [e.id, e]))
    for (const item of items) {
      const existing = byId.get(item.id)
      if (existing) {
        existing.lastSeenAt = now
        existing.hitCount++
      } else {
        const entry: ArchiveEntry = {
          id: item.id,
          title: item.title,
          url: item.url,
          source: item.source,
          firstSeenAt: now,
          lastSeenAt: now,
          hitCount: 1,
          pushed: false,
        }
        byId.set(item.id, entry)
        this.archive.entries.push(entry)
      }
    }
    if (this.archive.entries.length > this.maxEntries) {
      // 优先保留推送过的；其余按最近出现时间淘汰
      this.archive.entries.sort((a, b) => Number(b.pushed) - Number(a.pushed) || b.lastSeenAt - a.lastSeenAt)
      this.archive.entries.length = this.maxEntries
    }
    this.saveArchive()
  }

  /** 把确实推送出去的条目升级为 pushed=true。 */
  markPushed(ids: Iterable<string>): void {
    const byId = new Map(this.archive.entries.map((e) => [e.id, e]))
    let touched = false
    for (const id of ids) {
      const e = byId.get(id)
      if (e && !e.pushed) {
        e.pushed = true
        touched = true
      }
    }
    if (touched) this.saveArchive()
  }

  registerDigestRef(ref: string, digestId: string, itemId: string, source: string): void {
    if (!/^[a-z0-9]+:\d+$/.test(ref)) throw new Error(`ref 非法: ${ref}`)
    this.archive.digestRefs[ref] = { digestId, itemId, source }
    // 无界增长防护：只保留最近 MAX_DIGEST_REFS 条（插入序即时间序）
    const keys = Object.keys(this.archive.digestRefs)
    if (keys.length > MAX_DIGEST_REFS) {
      for (const k of keys.slice(0, keys.length - MAX_DIGEST_REFS)) delete this.archive.digestRefs[k]
    }
    this.saveArchive()
  }

  resolveRef(ref: string): { digestId: string; itemId: string; source: string } | undefined {
    return this.archive.digestRefs[ref]
  }

  /** L1→L2 展开所需的内容档（digests.json，最近 30 份）。回调查询只带 digestId:index，
   *  编辑消息要渲染 summary/why/url——这些不在 digestRefs 里，推送时落一份精简档。 */
  saveDigest(digest: {
    id: string
    generatedAt: number
    clusters: Array<{ ref: string; title: string; summary: string; why: string; items: Array<{ url: string; isNew: boolean; source: string }> }>
  }): void {
    const stored: StoredDigest = {
      digestId: digest.id,
      generatedAt: digest.generatedAt,
      clusters: digest.clusters.map((c) => ({
        ref: c.ref,
        title: c.title,
        summary: c.summary,
        why: c.why,
        url: c.items[0]?.url ?? '',
        isNew: c.items[0]?.isNew ?? false,
        source: c.items[0]?.source ?? '',
      })),
    }
    this.digests = [stored, ...this.digests.filter((d) => d.digestId !== digest.id)].slice(0, MAX_STORED_DIGESTS)
    this.writeFileAtomic('digests.json', JSON.stringify(this.digests, null, 2))
  }

  loadDigest(digestId: string): StoredDigest | undefined {
    return this.digests.find((d) => d.digestId === digestId)
  }

  /** 展开行为落账（条目级，不去重——同一卡展开几次算几次真实交互）。权重衰减（多次不展开 →
   *  默认不感兴趣）待打磨定参后接入，本方法先保证信号数据完整留存。 */
  recordEngagement(e: EngagementRecord): boolean {
    this.engagements.push(e)
    if (this.engagements.length > MAX_ENGAGEMENTS) {
      this.engagements = this.engagements.slice(-MAX_ENGAGEMENTS)
    }
    this.writeFileAtomic('engagements.json', JSON.stringify(this.engagements, null, 2))
    return true
  }

  engagementAll(): EngagementRecord[] {
    return this.engagements
  }

  /** 反馈落盘。同 digestId+itemId+signal 去重（C′10）：重启重放/连点不得虚增「有效反馈 ≥20 条」（P-2）；
   *  改主意（👍→👎）是不同信号，仍各计一次。与 recordView 按 digestId 去重的口径不同——反馈允许同条目正反两票。 */
  recordFeedback(fb: FeedbackRecord): boolean {
    const dup = this.feedback.some(
      (f) => f.digestId === fb.digestId && f.itemId === fb.itemId && f.signal === fb.signal,
    )
    if (dup) return false
    this.feedback.push(fb)
    this.saveFeedback()
    return true
  }

  feedbackBySource(): Record<string, { up: number; down: number }> {
    const stats: Record<string, { up: number; down: number }> = {}
    for (const fb of this.feedback) {
      stats[fb.source] ??= { up: 0, down: 0 }
      stats[fb.source][fb.signal]++
    }
    return stats
  }

  /** 导出全部记忆（人工审查/迁移用）。 */
  export(): { archive: Archive; feedback: FeedbackRecord[] } {
    return { archive: this.archive, feedback: this.feedback }
  }
}
