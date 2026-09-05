import { tokenize, stripOutletSuffix } from '../collector/dedupe.js'

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
 * 从**原始**标题（未经 normalizeText 小写化）抽出首字母大写的词。
 *
 * 为何这是关键信号（2026-09-04 真跑实测）：`normalizeText` 把大小写全抹平，
 * 于是丢掉了区分「事件标识」与「领域词汇」的唯一强信号：
 * - 事件标识是**专有名词**，在句 case 标题里首字母大写：Astra / K2 Horizon / FlashInfer / KC-Bench；
 * - 领域词汇在句 case 标题里是小写：retrieval / inference / benchmark / generation。
 *
 * 实测证据：1184 条 arXiv/HF 采集过闸门后剩 126 条，单链接并查集把它们塌缩成
 * **16 个事件**、误杀 109 条。根因不是阈值没调好，而是**范畴错误**：
 * 126 篇彼此独立的论文共享技术词汇是因为同属一个领域，不是同一个事件。
 * 文档频率无法在 n=126 时区分「15 篇同事件报道」与「15 篇都用 retrieval 的论文」
 *（两者 df 相同），而大小写可以：arXiv 标题是句 case，retrieval 小写；
 * 新闻报道里 Astra 大写。
 */
const CAPITALIZED_WORD = /[A-Z][A-Za-z0-9'\u2019-]*/g

export function capitalizedTokens(original: string): Set<string> {
  const out = new Set<string>()
  for (const m of original.match(CAPITALIZED_WORD) ?? []) {
    // 归一化成与 tokenize 同口径的小写纯字母数字串，才能与它的输出交集
    const norm = m.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (norm.length >= MIN_ASCII_LEN) out.add(norm)
    // 连字/拆号名（KC-Bench、GPT-6）的子段也算：原标题写 KC-Bench，
    // tokenize 会拆成 kc / bench，两边得对得上
    for (const part of m.toLowerCase().split(/[^a-z0-9]+/)) {
      if (part.length >= MIN_ASCII_LEN) out.add(part)
    }
  }
  return out
}

/**
 * 从标题抽实体词。
 *
 * 三层筛选，缺一不可：
 * 1. `tokenize()` 分词（复用，不重写——CJK 2-gram 行为在那里）；
 * 2. 剔除静态通用词表与过短 token；
 * 3. **ASCII token 额外要求「在原标题里首字母大写」**——这是区分专有名词（事件标识）
 *    与领域词汇的关键，见 `capitalizedTokens` 的实测依据。
 *    CJK token 无大小写，不适用本层，交由批内文档频率（df）兼顾。
 *
 * 必须复用 tokenize()（src/collector/dedupe.ts）而不是自己分词——CJK 2-gram 行为在那里，
 * 重写会造成中英文口径分裂（纯中文标题整句变 1 token、jaccard 退化为精确匹配，
 * 这是本项目已修过的 P2-2 缺陷）。
 *
 * 另补抽混合 token 里的 ASCII 段：`normalizeText` 只把非 `\p{L}\p{N}` 换成空格，
 * 而 CJK **属于 `\p{L}`**，所以 `"GPT-6 Astra横空出世"` 会得到 token `astra横空出世`，
 * 英文实体粘在中文里——这就是 DB-03 里中文 Astra 标题与英文报道聚不拢的根因。
 */
/**
 * 抽**主题词**（大小写无关）：tokenize + 剔除静态通用词与过短 token。
 *
 * 用途是「这段文本与那段文本是否谈同一主题」——例如 `gk:hookEntity` 判钩子是否
 * 命中原文实体、`deriveHooks` 生成实体词卡片。这类判定**不该看大小写**：
 * 钩子里写 "bench" 与原文的 "KC-Bench" 显然相关。
 *
 * 与 `entityTokens` 的区别只有一个：本函数不要求 ASCII token 在原文里首字母大写。
 */
export function topicTokens(text: string, stopwords: ReadonlySet<string>): Set<string> {
  return extractTokens(text, stopwords, false)
}

/**
 * 抽**事件实体词**（专有名词口径）：在 topicTokens 基础上，额外要求 ASCII token
 * 在原标题里首字母大写，且先剥掉标题末尾的转载渠道名后缀。
 *
 * 用途只有一个：**事件聚类**。大写要求是区分「事件标识」与「领域词汇」的关键信号，
 * 实测依据见 `capitalizedTokens`；剥后缀是区分「事件标识」与「来源词汇」的补丁，
 * 实测依据（`india` 把 GPT-6 Astra 与德国 wiki 劫持两个独立事件缝成一簇）见
 * `src/collector/dedupe.ts` 的 `stripOutletSuffix`。
 */
export function entityTokens(title: string, stopwords: ReadonlySet<string>): Set<string> {
  const stripped = stripOutletSuffix(title)
  const tokens = extractTokens(stripped, stopwords, true)
  // 守门：剥完后缀若一个实体都不剩，说明这条标题的实体**只**在后缀里——
  // 宁可带着 outlet 词聚类（旧行为），也不让条目失去聚类资格（无实体词 → 自成一体，永不合并）。
  if (tokens.size === 0 && stripped !== title) return extractTokens(title, stopwords, true)
  return tokens
}

function extractTokens(text: string, stopwords: ReadonlySet<string>, requireProperNoun: boolean): Set<string> {
  const proper = requireProperNoun ? capitalizedTokens(text) : null
  const out = new Set<string>()
  for (const tok of tokenize(text)) {
    if (!longEnough(tok)) continue
    if (stopwords.has(tok)) continue
    if (HAS_CJK.test(tok)) {
      // CJK（含 2-gram）无大小写概念，两种口径都直接入选
      out.add(tok)
    } else if (proper === null || proper.has(tok)) {
      // 纯 ASCII：topicTokens 直接入选；entityTokens 要求原标题里首字母大写
      out.add(tok)
    }
    // 混合 token 的 ASCII 段补抽（`astra横空出世` → `astra`），大写要求同上
    for (const m of tok.match(ASCII_RUN) ?? []) {
      if (m.length < MIN_ASCII_LEN || stopwords.has(m)) continue
      if (proper === null || proper.has(m)) out.add(m)
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
 * 批内文档频率上限：一个实体词在本批出现于超过该数量的条目里，就不可能是事件标识。
 *
 * **为何必需（2026-09-04 真跑实测，单测测不出来）**：单链接并查集在小样本上表现很好
 * （Astra 9/10、K2 5/5、干扰项零误并），但真跑一轮 1184 条 arXiv/HF 采集时，
 * 闸门后 128 条被塌缩成 **18 个事件**，109 条被 `eventSaturated` 误杀——
 * 因为传递闭包会把「A 与 B 共享 retrieval、B 与 C 共享 generation」链成 A/B/C 同事件。
 * 千条级同质语料下，任何中频技术词都会把全批缝成几个巨型簇。
 *
 * **阈值取 `max(maxEntityDf, maxEntityDfRatio * n)`，两侧都不能少**：
 * - 只用比例：小批（n=10）时 2% = 0.2，会把 `astra`（df=8）也当通用词剔掉，小样本全坑；
 * - 只用绝对值：大批（n=5000）时 20 条共享一个词仍可能是巧合，拦不住塌缩。
 * 真实事件的上限参考：DB-03 里 GPT-6 Astra 有 15 篇跟风报道，故绝对上限取 20 留有余额。
 */
export const DEFAULT_MAX_ENTITY_DF = 20
export const DEFAULT_MAX_ENTITY_DF_RATIO = 0.02

export interface ClusterOptions {
  /** 文档频率上限（绝对值），缺省 20 */
  maxEntityDf?: number
  /** 文档频率上限（占背景批大小比例），缺省 0.02 */
  maxEntityDfRatio?: number
  /**
   * 背景文档频率表：token → 在**全量采集**（过滤前）里出现的条目数。
   *
   * **分母必须是全量采集，不能是过滤后的子集**（2026-09-04 真跑实测）：
   * 1184 条采集过闸门后只剩 126 条 AI 强相关条目，此时 `language`(df=11)、`multi`(10)、
   * `learning`(8)、`multimodal`(8)、`embedding`(6) 这些**领域词汇**的相对频率被人为抬高，
   * 与真事件标识（15 篇同事件报道 df=15）落在同一量级，任何阈值都分不开：
   * 实测扫 maxEntityDf=2 → 68 簇（真事件也散了），=3 → 46 簇最大簇 66（塌缩），
   * =20 → 24 簇最大簇 101（全塌）。
   * 换到全量 1184 条做分母，`language` 的 df 是数百而 `astra` 仍是 15，两者天然可分。
   *
   * 缺省时退回用本批自身算 df（小批/单测场景），行为与旧版一致。
   */
  backgroundDf?: ReadonlyMap<string, number>
  /** 背景批大小（与 backgroundDf 配套），缺省取本批 items.length */
  backgroundSize?: number
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
  opts: ClusterOptions = {},
): EntityCluster<T>[] {
  const n = items.length
  if (n === 0) return []

  const tokens = items.map((it) => entityTokens(it.title, stopwords))

  // 文档频率闸门：把「在背景语料里太常见」的词当领域词汇剔除，不作为事件连接依据。
  // 这是对静态 eventStopwords 的必要补充：静态词表无法预见每个领域的高频术语，
  // 而 df 是自调的。分母口径见 ClusterOptions.backgroundDf 的实测说明。
  // df 表：优先用背景（全量采集）频率，缺省才用本批自身
  const df: ReadonlyMap<string, number> = opts.backgroundDf ?? (() => {
    const own = new Map<string, number>()
    for (const set of tokens) {
      for (const tok of set) own.set(tok, (own.get(tok) ?? 0) + 1)
    }
    return own
  })()
  const dfBase = opts.backgroundDf ? (opts.backgroundSize ?? n) : n
  const dfLimit = Math.max(
    opts.maxEntityDf ?? DEFAULT_MAX_ENTITY_DF,
    (opts.maxEntityDfRatio ?? DEFAULT_MAX_ENTITY_DF_RATIO) * dfBase,
  )
  const isEventEntity = (tok: string): boolean => (df.get(tok) ?? 0) <= dfLimit

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
        // 背景高频词＝领域词汇，不作为连接依据（防传递闭包塌缩）
        if (large.has(t) && isEventEntity(t)) {
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
  opts: ClusterOptions = {},
): Map<string, string> {
  const out = new Map<string, string>()
  for (const cluster of clusterByEntity(items, stopwords, opts)) {
    for (const it of cluster.items) out.set(it.id, cluster.key)
  }
  return out
}
