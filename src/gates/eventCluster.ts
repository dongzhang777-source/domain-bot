import { tokenize } from '../collector/dedupe.js'

/**
 * 实体词并查集事件聚类。
 *
 * 为什么不用标题 jaccard（实测，2026-09-04）：
 * 取 DB-03 审计报告（docs/tasks/TASK-DB-03-quality-audit-done.md §1.3）里 GPT-6 Astra
 * **同一事件**的 10 条真实报道标题（#58/#84/#85/#86/#122/#123/#124/#153/#156/#181），
 * 用仓库现有 tokenize()+jaccard() 两两计算：45 个配对中最大 jaccard 仅 **0.313**、
 * 中位 0.105，≥0.75 命中 **0**、≥0.50 命中 **0**。K2 Horizon 5 条（#32/#33/#103/#144/#191）
 * 最大 0.500，≥0.75 同样命中 0。
 *
 * 记者**刻意**给同一事件写不同标题，阈值降到 0.50 也只捞到 55 对里的 1 对——
 * 这条路不可调成有用。DB-03 §3.2 门禁 3 提的「jaccard > 0.75 判同事件」因此不成立。
 *
 * 改用「非通用 token 共享」并查集后，同一批数据实测：
 *   Astra 8/10 聚成一簇、K2 Horizon 5/5 聚成一簇、3 条独立事件干扰项零误并。
 * 漏掉的 2 条：The Verge 标题不含 "Astra"（写作 "next big AI model… AGI era"）、
 * 一条中文标题——这部分归 DB-05 的 LLM reviewer 做语义事件归并，不在本模块能力范围。
 *
 * 复算脚本：`npm run probe:events`（scripts/probe-event-cluster.mjs）。
 */

/**
 * 实体 token 的最短码点数，**按语言区分**。
 *
 * 为何不能统一取 3（实测踩过的坑，2026-09-04）：`tokenize()` 对 CJK 连续段产出的是
 * **2-gram**（P2-2 修复：中文标题字间无空格，纯 split 得不到可聚类 token），
 * 统一门槛 3 会把全部 CJK 2-gram 滤掉——中文内容的实体集只剩「整段长串」，
 * 于是中文条目之间永远聚不拢、`gk:hookEntity` 对中文钩子也永远判不过。
 * 实测证据：中文正文的实体集曾是
 * `{bench, reasoning, 是首个评估, 智能体动态知识冲突的交互基准, 实验显示参数知识与检索上下文冲突时性能明显退化}`
 * ——「知识」「冲突」「检索」这些真正有用的 2-gram 全部缺席。
 *
 * 故：含 CJK 的 token 门槛 2（保住 2-gram），纯 ASCII 门槛 3（滤掉 kc/up/of 这类碎片）。
 */
const MIN_ASCII_LEN = 3
const MIN_CJK_LEN = 2
const HAS_CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/

function longEnough(token: string): boolean {
  return token.length >= (HAS_CJK.test(token) ? MIN_CJK_LEN : MIN_ASCII_LEN)
}

/**
 * 从混合 token 里抽连续 ASCII 字母/数字段。
 *
 * 为何必需（实测，2026-09-04）：`normalizeText` 把非 `\p{L}\p{N}` 字符换成空格，
 * 而 CJK 字符**属于 `\p{L}`**，所以不会被切开。于是 `"GPT-6 Astra横空出世"` 会得到
 * token `astra横空出世`——英文实体粘在中文里，`entityTokens` 匹配不到 `astra`。
 * 这就是 DB-03 里那条中文 Astra 标题（#181）与英文报道聚不拢的根因。
 * 补上 ASCII 段抽取后，该 token 额外产出 `astra`，跨语言同事件才能聚到一起。
 */
const ASCII_RUN = /[a-z0-9]{3,}/g

/**
 * 从标题抽实体词：tokenize 后剔除通用词与过短 token，并补抽混合 token 里的 ASCII 实体。
 *
 * 必须复用 tokenize()（src/collector/dedupe.ts）而不是自己分词——CJK 2-gram 行为在那里，
 * 重写会造成中英文口径分裂（纯中文标题整句变 1 token、jaccard 退化为精确匹配，
 * 这是本项目已修过的 P2-2 缺陷）。
 */
export function entityTokens(title: string, stopwords: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const t of tokenize(title)) {
    if (!longEnough(t)) continue
    if (stopwords.has(t)) continue
    out.add(t)
    // 混合 token 的 ASCII 段补抽：`astra横空出世` → 额外得到 `astra`。
    // 根因：normalizeText 只把非 `\p{L}\p{N}` 换成空格，而 CJK **属于 `\p{L}`**，
    // 所以英文实体会粘在中文里成一个 token，跨语言同事件因此聚不拢。
    for (const m of t.match(ASCII_RUN) ?? []) {
      if (m.length >= MIN_ASCII_LEN && !stopwords.has(m)) out.add(m)
    }
  }
  return out
}

export interface EntityCluster<T> {
  /** 簇内条目，保持输入顺序 */
  items: T[]
  /** 簇标识：簇内第一个条目的 id（稳定，且下游排序/截断/递补后仍可回溯） */
  key: string
}

/**
 * 并查集聚类：两条标题共享任一实体词即判同事件。
 *
 * 传递性是刻意的——同一事件的 15 篇报道往往两两之间只共享部分实体，
 * 传递闭包能把它们收进一簇。代价是「实体词撞车」可能过度合并，
 * 这由 eventStopwords 的覆盖度控制：通用词没剔干净就会把全部条目并成一坨。
 *
 * 复杂度 O(n²) 配对 + Set 交集。实测 1396 条采集 → 闸门后约 700 条，
 * 配对约 24 万次，毫秒级。**未做预优化**（YAGNI）：真超 2 秒再改倒排索引。
 */
export function clusterByEntity<T extends { id: string; title: string }>(
  items: T[],
  stopwords: ReadonlySet<string>,
): EntityCluster<T>[] {
  const n = items.length
  if (n === 0) return []

  const tokens = items.map((it) => entityTokens(it.title, stopwords))
  const parent = Array.from({ length: n }, (_, i) => i)

  const find = (i: number): number => {
    // 路径压缩：不用递归，避免 700+ 条链式合并时爆栈
    let root = i
    while (parent[root] !== root) root = parent[root]!
    let cur = i
    while (parent[cur] !== root) {
      const next = parent[cur]!
      parent[cur] = root
      cur = next
    }
    return root
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  for (let i = 0; i < n; i++) {
    const ti = tokens[i]!
    if (ti.size === 0) continue // 无实体词的条目自成一体，不参与合并
    for (let j = i + 1; j < n; j++) {
      const tj = tokens[j]!
      if (tj.size === 0) continue
      // 小集合遍历大集合，减少 has 调用次数
      const [small, large] = ti.size <= tj.size ? [ti, tj] : [tj, ti]
      let shared = false
      for (const t of small) {
        if (large.has(t)) {
          shared = true
          break
        }
      }
      if (shared) union(i, j)
    }
  }

  const groups = new Map<number, T[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const bucket = groups.get(root)
    if (bucket) bucket.push(items[i]!)
    else groups.set(root, [items[i]!])
  }

  return [...groups.values()].map((group) => ({ items: group, key: group[0]!.id }))
}

/** 便捷封装：直接得到 id → 簇标识 的映射（供 pipeline 传给 renderPost 的 ctx.eventKey）。 */
export function eventKeyMap<T extends { id: string; title: string }>(
  items: T[],
  stopwords: ReadonlySet<string>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const cluster of clusterByEntity(items, stopwords)) {
    for (const it of cluster.items) out.set(it.id, cluster.key)
  }
  return out
}
