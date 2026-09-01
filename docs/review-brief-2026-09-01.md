# 外部审查工作单 —— domain-bot 自进化领域专家 Bot（假门测试探针）

> 用法：把本文档整体贴给外部评审（LLM 或人）。附录 A/B/C 是配套代码材料，建议一并贴入。
> 评审产出请交回，由项目总管归档至 `domain-bot/docs/reviews/`。

---

## 一、你要审什么

一个已实现并跑通的原型：**domain-bot**——自动抓取某领域高价值信息、推送、并从用户反馈中"自进化"的个人领域专家 bot。

它不是独立产品，而是一个**商业假设的测试探针**。背景：我们的服务端项目（AI 内容生产与分发）有一条"千 bot 工厂"路线，其终审裁决把最大不确定性标为"需求 50"——**用户到底要不要一万个 AI bot**。本探针的逻辑是：把一个 bot 做到真实可用，作者本人当第一个用户，跑两周。

**假门判定标准（已预先定死，防事后合理化）：**

| 待验证命题 | 证据 | 通过线 |
|---|---|---|
| 用户要"AI 帮我盯领域" | 主动查看推送次数 | ≥ 10 次 |
| 推送的东西真有价值 | 👍/👎 反馈率 | 👍 率 ≥ 30% |
| "自进化"可感知 | 源权重收敛、旧闻降权 | 第 3 轮起噪音可感知下降 |
| 可复制性 | 加一个领域=改一份 config | 无需改代码 |

当前实测状态：单轮采集约 1670 条（arXiv/HuggingFace/GitHub/Exa 搜索/V2EX/B站），过滤后约 960 条相关，每轮推 6 簇；去重跨轮生效；测试 35/35 绿。**尚未启用**：Telegram 反馈按钮（缺 token）、LLM 打分（当前用启发式打分器兜底）、Jina 网页阅读（缺免费 key，优雅降级）。

## 二、评审要回答的核心问题

### 定向问题（请逐条给结论 + 理由 + 可证伪的反对意见）

1. **探针逻辑本身**：用一个 bot + 一个用户 + 两周，能否为"千 bot 需求"提供有效证据？这个假门设计有什么致命缺陷？通过线（👍率≥30%、查看≥10次）定得合理吗？
2. **自进化的技术路线**："不重训模型，靠记忆库 + 反馈回路 + 源权重缓慢移动"这条路线，天花板在哪里？Beta(1,1) 平滑 + 步长 0.2 的权重更新，在每周几十次反馈的信号量下是否足够稳健？
3. **价值打分冷启动**：当前启发式打分器（关键词命中数 + 信号词加成）明显偏袒 arXiv 式长摘要，我们加了每源配额硬压。在 LLM 打分接入前，这个过渡方案还有什么更大的坑？
4. **渠道策略**：免登录通道（RSS/Exa/V2EX/B站/Jina）已接入，需登录态通道（Twitter/Reddit/小红书）因封号风险刻意排除在无人值守管线外。这个取舍对"信息质量"的伤害有多大？有没有两全方案？
5. **防自我固化**：记忆库可人工修正、源权重向 0.5 先验回归、ε-greedy 探索已被证明有害并删除（改为全量抓取）。还有什么机制层面的固化风险？
6. **可复制性声明**："无数个 bot 就可以跑通"的前提是新领域只需改 config（关键词、源注册表）。当前实现离这个声明还差什么？
7. **两周后的决策框架**：探针跑完，什么结果该加大投入、什么结果该改设计重跑、什么结果该放弃？请给出可操作的判据。

### 无限定问题（自由发言区）

以上问题不构成对评审的限制。任何你认为我们没问到但更要紧的问题，任何你认为我们听不进去但必须说的话，请直接写。

## 三、偏见声明（评审前必读）

1. **作者是利益相关方**：探针通过 → 千 bot 路线获得投入理由。作者有动机高估早期信号，请优先攻击证据链而非补充赞美。
2. **单人用户 = 最弱证据形态**：作者自己当第一个用户，既是目标用户（AI 从业者）又是设计者，反馈存在天然污染。
3. **评审团全 LLM 的元盲区**：本次评审预计由 LLM 完成。LLM 评审者可能系统性高估"技术架构优雅度"的权重、低估"真实用户惰性"的权重——而本探针验证的恰恰是后者。请有意识地校正这一偏向。
4. **沉没成本陷阱**：代码已写完、测试已绿，这不构成继续投入的理由。评审时请把"已实现"视为零成本选项。

## 四、输出格式要求

- 每个定向问题：**结论（同意/反对/有条件）→ 理由 → 可证伪的反对意见或风险**，三段式。
- 无限定问题区自由发挥。
- 最后给一个总判断：**这个探针值得跑完两周吗？**（值得 / 改设计后值得 / 不值得，三选一并说明）

---

## 附录 A：三环架构与数据流

```
采集(广)               提炼(深)                      进化(闭环)
RSS/Atom/arXiv ┐  内容哈希去重 → 领域关键词过滤 → 价值打分      JSON记忆库(归档+标题jaccard新颖性)
GitHub API    ─┤  (跨轮持久)                  (启发式/LLM可插拔)   ↓
Exa 语义搜索   ─┤                    → jaccard聚类(同事件合一) → 推送(文件+Telegram) ←─ 👍/👎反馈
V2EX/B站/Jina ─┘                    → 每源配额(≤3簇/源)       → 登记ref → 记录反馈
                                                    → 源权重 ← Beta(1,1)后验均值,步长0.2
```

- 全量抓取所有 enabled 源（曾有 ε-greedy 按轮跳源，实测低权重源大部分轮次静默抓瞎，已删除）。
- 单源失败不阻塞管线；无 LLM key 时启发式打分兜底，无 Telegram token 时文件推送兜底。
- 每轮限量 6 簇，每源最多 3 簇（防 arXiv 式关键词密集源霸榜）。

## 附录 B：进化环核心代码（完整）

```typescript
// src/memory/evolve.ts —— 全文
export interface SourceStats { up: number; down: number }

/** Beta(1,1) 后验均值：信号量小时平滑（1 条 👍 不会把权重拉满），信号量大时趋近真实比例。 */
export function sourceValue(stats: SourceStats): number {
  return (stats.up + 1) / (stats.up + stats.down + 2)
}

/** 源权重向后验均值缓慢移动（α 步长）。0 反馈的源保持在 0.5 附近，不会被误杀。 */
export function updateWeights(sources: SourceConfig[], stats: Record<string, SourceStats>, alpha = 0.2): Record<string, number> {
  const next: Record<string, number> = {}
  for (const s of sources) {
    const st = stats[s.id] ?? { up: 0, down: 0 }
    next[s.id] = Math.min(1, Math.max(0, (1 - alpha) * s.weight + alpha * sourceValue(st)))
  }
  return next
}

/** 有效分 = 价值分 × (0.5 + 源权重)：权重只调节放大倍数，好源/噪音源的分差温和累积。 */
export function applySourceWeight(valueScore: number, weight: number): number {
  return valueScore * (0.5 + weight)
}
```

```typescript
// src/index.ts —— runOnce 打分-选择段
const scorer = makeScorerFromEnv()            // LLM 打分器（env 有 key 时）或启发式
const scores = await scorer.score(relevant, opts.domain)
const weightOf = new Map(opts.sources.map((s) => [s.id, s.weight]))
let scored: ScoredItem[] = relevant.map((item, i) => ({
  ...item,
  valueScore: applySourceWeight(scores[i].valueScore, weightOf.get(item.source) ?? 0.5),
  isNew: store.isNovel(item),                 // 标题 jaccard ≥ 0.7 视为旧闻
  reason: scores[i].reason,
}))
scored = scored.filter((s) => s.valueScore >= opts.domain.scoreThreshold * 0.5)
scored.sort((a, b) => b.valueScore - a.valueScore)
// 每源配额：arXiv 类关键词密集源不得霸占全部推送位
const perSourceCap = Math.max(2, Math.ceil(opts.domain.maxPerDigest / 2))
const perSourceCount = new Map<string, number>()
const diversified: ScoredItem[] = []
for (const item of scored) {
  const used = perSourceCount.get(item.source) ?? 0
  if (used >= perSourceCap) continue
  perSourceCount.set(item.source, used + 1)
  diversified.push(item)
  if (diversified.length >= opts.domain.maxPerDigest) break
}
```

## 附录 C：启发式打分器与源注册表

```typescript
// src/refinery/scorer.ts —— HeuristicScorer（冷启动兜底，LLM 接入前的当前主力）
export class HeuristicScorer implements Scorer {
  readonly name = 'heuristic'
  private signals = ['release', 'benchmark', 'sota', 'state-of-the-art', 'outperform',
    'beat', 'open source', 'open-source', 'new model', 'breakthrough', 'surpass']
  async score(items: RawItem[], domain: DomainConfig): Promise<ScoreResult[]> {
    return items.map((item) => {
      const hay = ' ' + normalizeText(item.title + ' ' + item.body) + ' '
      const kwHits = domain.keywords.filter((k) => hay.includes(normalizeText(k))).length
      const signalHits = this.signals.filter((s) => hay.includes(s)).length
      const valueScore = Math.min(1, 0.3 + 0.15 * kwHits + 0.12 * signalHits)
      return { valueScore, reason: `关键词命中 ${kwHits}，信号词命中 ${signalHits}` }
    })
  }
}
```

```jsonc
// config/sources.json（当前 7 源，weight 初始全 0.2~0.6）
[
  { "id": "arxiv-cs-ai",          "type": "rss",    "url": "http://export.arxiv.org/rss/cs.AI", "weight": 0.5, "enabled": true },
  { "id": "huggingface-blog",     "type": "rss",    "url": "https://huggingface.co/blog/feed.xml", "weight": 0.5, "enabled": true },
  { "id": "github-new-llm-tools", "type": "github", "url": "https://api.github.com/search/repositories?q=topic:llm+created:>2026-08-25&sort=stars", "weight": 0.5, "enabled": true },
  { "id": "exa-llm-news",         "type": "exa",    "url": "large language model inference agent news this week", "weight": 0.6, "enabled": true },
  { "id": "hf-daily-papers",      "type": "jina",   "url": "https://huggingface.co/papers", "weight": 0.6, "enabled": true },
  { "id": "v2ex-hot",             "type": "v2ex",   "url": "https://www.v2ex.com/api/topics/hot.json", "weight": 0.2, "enabled": true },
  { "id": "bili-llm",             "type": "bili",   "url": "大模型 最新", "weight": 0.2, "enabled": true }
]

// config/domain.json 打分阈值 0.45（有效分=价值分×(0.5+权重)，实际入选下限 0.225）、每轮 6 簇、聚类阈值 0.35
```
