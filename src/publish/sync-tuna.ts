import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FeedPack } from './pack.js'

/**
 * 同步内容包到 tuna 仓的内置包路径。
 *
 * 取代的第三道影子工序：此前发布靠**人工拷贝** `domain-bot/outbox/tuna/tuna-feed-200.json`
 * → `tuna/packages/content/data/builtin-pack-ai-feed-v1.json` → commit → rebuild
 * （实测两文件 id 集合 172/172 完全一致，证实是人工搬运）。人工搬运的问题是
 * 没有任何环节校验契约，直到用户真机刷到才发现内容有问题。
 *
 * **默认 dry-run**：tuna 由老张督阵会话推进（根仓 AGENTS.md「分工现状」），
 * 本模块不越权改 tuna 仓。必须显式传 `--sync-tuna` 才真写，且真写后仍由 tuna 侧
 * 会话决定何时 commit + rebuild——本模块只负责把文件放对位置并校验契约。
 */

/** tuna 侧内置包的落点（相对 tuna 仓根）。DB-06 的 T3 接线 LocalBriefNormalizer 后可改为动态加载。 */
export const TUNA_BUILTIN_PACK_REL = 'packages/content/data/builtin-pack-ai-feed-v1.json'

export interface SyncOptions {
  /** tuna 仓根绝对路径 */
  tunaRoot: string
  /** 缺省 false：只打印将要发生的变更，不落盘 */
  dryRun?: boolean
}

export interface SyncReport {
  dryRun: boolean
  targetPath: string
  /** 目标文件原先是否存在（不存在=首次发布） */
  targetExisted: boolean
  /** 原有条数与新条数 */
  beforeCount: number
  afterCount: number
  /** 新增 / 移除 / 保留的 post id 数量（dry-run 时这是唯一的决策依据） */
  added: string[]
  removed: string[]
  kept: string[]
  written: boolean
}

/**
 * 计算同步差异。**dry-run 与真写共用同一份计算**，避免"预览说一套、落盘做另一套"。
 */
export function planSync(pack: FeedPack, opts: SyncOptions): SyncReport {
  const targetPath = join(opts.tunaRoot, TUNA_BUILTIN_PACK_REL)
  const targetExisted = existsSync(targetPath)

  let beforeIds: string[] = []
  let beforeCount = 0
  if (targetExisted) {
    try {
      const prior = JSON.parse(readFileSync(targetPath, 'utf8')) as { posts?: Array<{ id?: string }> }
      beforeIds = (prior.posts ?? []).map((p) => String(p.id ?? ''))
      beforeCount = beforeIds.length
    } catch {
      // 目标文件损坏：不静默覆盖（那会抹掉别人未提交的工作），交由调用方决定
      throw new Error(`tuna 内置包解析失败，拒绝覆盖：${targetPath}`)
    }
  }

  const afterIds = pack.posts.map((p) => String(p['id']))
  const beforeSet = new Set(beforeIds)
  const afterSet = new Set(afterIds)

  return {
    dryRun: opts.dryRun !== false ? Boolean(opts.dryRun) : false,
    targetPath,
    targetExisted,
    beforeCount,
    afterCount: afterIds.length,
    added: afterIds.filter((id) => !beforeSet.has(id)),
    removed: beforeIds.filter((id) => !afterSet.has(id)),
    kept: afterIds.filter((id) => beforeSet.has(id)),
    written: false,
  }
}

/**
 * 执行同步。`dryRun` 时只返回报告不落盘。
 *
 * 落盘前**必须**过 `assertPackContract`（由调用方 writePack 已保证），此处再校验一次
 * 目标路径的 schema 一致性：tuna 侧 `BuiltinPackNormalizer` 会在编译期全量校验，
 * 写入不合规的包会让 tuna 构建失败——那比不写更糟。
 */
export function syncPack(pack: FeedPack, opts: SyncOptions): SyncReport {
  const report = planSync(pack, opts)
  if (opts.dryRun) return report

  if (pack.schema !== 'tuna-brief-v1') {
    throw new Error(`内容包 schema 非法：${pack.schema}（tuna 侧 LOCAL_BRIEF_SCHEMA 要求 tuna-brief-v1）`)
  }
  writeFileSync(report.targetPath, JSON.stringify(pack, null, 2))
  return { ...report, dryRun: false, written: true }
}

/** 人话差异报告，供 CLI 打印。 */
export function formatSyncReport(r: SyncReport, personaDisplay: string): string {
  const lines = [
    `[sync-tuna] ${r.dryRun ? 'DRY-RUN（未落盘，加 --sync-tuna 才真写）' : '已落盘'} → ${r.targetPath}`,
    `  ${personaDisplay}：${r.beforeCount} 条 → ${r.afterCount} 条（新增 ${r.added.length} / 移除 ${r.removed.length} / 保留 ${r.kept.length}）`,
  ]
  if (!r.targetExisted) lines.push('  目标文件原先不存在：这是首次发布')
  if (r.dryRun && r.added.length > 0) lines.push(`  新增样例：${r.added.slice(0, 3).join(', ')}`)
  if (r.dryRun && r.removed.length > 0) {
    lines.push(`  ⚠ 将移除 ${r.removed.length} 条既有条目（tuna 侧的行为信号按 postId 归因，移除后这些信号将无法回流）`)
    lines.push(`    移除样例：${r.removed.slice(0, 3).join(', ')}`)
  }
  if (!r.dryRun) {
    lines.push('  后续动作归 tuna 督阵会话：git diff 复核 → commit → rebuild（本模块不 commit 任何仓）')
  }
  return lines.join('\n')
}
