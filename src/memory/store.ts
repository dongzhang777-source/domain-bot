import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { jaccard, tokenize } from '../collector/dedupe.js'
import type { FeedbackRecord, FeedbackSignal, RawItem, ScoredItem } from '../types.js'

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

/** JSON 文件记忆库：归档（新颖性判定）+ 反馈信号 + digest 引用。可导出、可人工修正（直接改 JSON）。 */
export class MemoryStore {
  private archive: Archive = { entries: [], digestRefs: {} }
  private feedback: FeedbackRecord[] = []
  private tokenCache = new Map<string, Set<string>>()
  private weights: WeightsState = { weights: {}, feedbackHash: '' }
  private readonly maxEntries: number

  constructor(private dir: string, opts: { maxEntries?: number } = {}) {
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
    mkdirSync(dir, { recursive: true })
    this.load()
  }

  private load(): void {
    try {
      this.archive = JSON.parse(readFileSync(join(this.dir, 'archive.json'), 'utf8')) as Archive
    } catch {
      /* 首次运行无归档 */
    }
    try {
      this.feedback = JSON.parse(readFileSync(join(this.dir, 'feedback.json'), 'utf8')) as FeedbackRecord[]
    } catch {
      /* 首次运行无反馈 */
    }
    try {
      this.weights = JSON.parse(readFileSync(join(this.dir, 'weights.json'), 'utf8')) as WeightsState
    } catch {
      /* 首次运行无权重 */
    }
  }

  private saveArchive(): void {
    writeFileSync(join(this.dir, 'archive.json'), JSON.stringify(this.archive, null, 2))
  }

  private saveFeedback(): void {
    writeFileSync(join(this.dir, 'feedback.json'), JSON.stringify(this.feedback, null, 2))
  }

  weightsState(): WeightsState {
    return { weights: { ...this.weights.weights }, feedbackHash: this.weights.feedbackHash }
  }

  saveWeights(weights: Record<string, number>, feedbackHash: string): void {
    this.weights = { weights: { ...weights }, feedbackHash }
    writeFileSync(join(this.dir, 'weights.json'), JSON.stringify(this.weights, null, 2))
  }

  feedbackCount(): number {
    return this.feedback.length
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
    this.archive.digestRefs[ref] = { digestId, itemId, source }
    this.saveArchive()
  }

  resolveRef(ref: string): { digestId: string; itemId: string; source: string } | undefined {
    return this.archive.digestRefs[ref]
  }

  recordFeedback(fb: FeedbackRecord): void {
    this.feedback.push(fb)
    this.saveFeedback()
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
