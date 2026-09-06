# domain-bot 代码改动审查报告（过去 24 小时）

- **审查时间**：2026-09-05 20:29–20:45 EDT
- **审查范围**：`main` 分支，基点 `dc47800` → `3cb4d7c`，共 **18 个提交**
- **审查人**：小巴（项目总管）
- **验证基线**：`npm run build` 绿（exit 0）；`npm test` **412/412 全绿**（25 个测试文件，98.8s）

---

## 一、改动规模

| 类别 | 插入 | 删除 | 说明 |
|---|---:|---:|---|
| `src/` 生产代码 | +8058 | −941 | 真实代码主体 |
| `tests/` | +5126 | −766 | 测试先于/同步于实现 |
| `evidence/` + `docs/` | +55012 | −55 | **数据产物，非代码** |
| 合计 | +68196 | −1762 | 115 文件 |

**判读**：+6.8 万行里有 5.5 万行是 evidence JSON 快照，**不要被总量误导**。真实代码改动是 src 的 8 千行新增 —— 这是一次**管线重构**（DB-04 至 DB-12），不是补丁级改动。

### 结构性变更

| 变更 | 内容 |
|---|---|
| 新增 | `src/pipeline.ts`、`src/staging.ts`、`src/cli.ts`、`src/gates/`（8 文件）、`src/gatekeeper/`（5 文件）、`src/editorial/`（6 文件）、`src/render/tuna.ts`、`src/ingest/tuna-signals.ts`、`src/publish/`（2 文件）、`src/collector/canonicalUrl.ts` |
| 删除 | `src/push/telegram.ts`、`src/push/file.ts`、`src/push/tuna.ts`、`src/feedback/receiver.ts` |
| 守卫 | `tests/wiring.test.ts:175` 有守卫测试断言上述四文件已删除，且断言 `src/` 内不得再有 Telegram 推送实现 |

删除干净，无残留引用（Grep 全仓仅命中注释与守卫测试本身）。

---

## 二、代码质量评价

**整体：高。** 这是本工作区近 24 小时里质量最好的一批改动。具体表现：

1. **每个非显然的设计决策都附实测依据**。例如 `pipeline.ts:229-238` 解释"事件聚类的背景词频必须用过滤前全量采集算"，依据是"过滤后 126 条塌成 24 簇、最大簇 101、误杀 100 条"的实测；`render/tuna.ts:145-168` 解释"字符级同源判据换成词级"，依据是"56 条主材里 25 条被误杀"。这类注释不是装饰，是可复核的决策记录。
2. **常量单点维护**。限长常量集中在 `render/tuna.ts`（`HOOK_LIMITS`/`SUMMARY_MAX`/`WHY_MAX`），终审断言 `gk:shapeViolation` 直接复用而非另立数字，注释写明"两处不一致会重现 L1 第二行残字问题"。
3. **拒绝静默降级**。`editorialBoard()` 把 `enabled`（配置意图）与 `active`（实际结果）分开记；`gatekeep` 暴露 `eventFillMode` 并注明"填充模式意味着本轮防刷屏能力降级"。这直接对应本项目反复强调的"格式全绿≠内容合格"纪律。
4. **漏斗恒可复算**。宽通道的每一条落账都有去处（`recall:ineligible` / `recall:poolOverflow` / `recall:excluded` / `recall:unanswered`），不存在"既不通过也不落账、凭空消失"的条目。

---

## 三、缺陷清单

### P0-1　`huggingface-blog` 源采集的是 6.6 年归档，占采集量 91%

**证据**（19:04 轮 evidence `feed-quality-deepthought-deepthoughtmtozjzun.json`）：

```
collected=915 → afterDedupe=860 → afterGates=11 → published=10
dropped 分布：persona/persona:tooOld=833   ← 全部来自 huggingface-blog
```

833 条 `tooOld` 的年龄分布：

| 指标 | 值 |
|---|---|
| 最小 | 743h（31 天） |
| 中位 | **19223h ≈ 2.2 年** |
| p90 | **37727h ≈ 4.3 年** |
| 最大 | **57503h ≈ 6.6 年** |
| 超 1 年 | 653 条（78%） |

**根因**：`config/sources.json` 的 `https://huggingface.co/blog/feed.xml` 返回的是**全站博客归档**而非近期文章。deepthought 的 `maxAgeHours=720`（30 天），于是 833 条必然被砍。

**后果**：
- 每轮白采 833 条（占 91%），全部走完 canonical URL 派生与去重哈希后才被砍，纯浪费；
- 漏斗里 `persona:tooOld` 一项压倒性主导，掩盖其它层的真实读数；
- deepthought 离 `maxItems=120` 的目标差 12 倍，而其中 91% 的"采集量"是假的。

**建议**：先实测该 feed 实际返回条数与时间跨度（确认是全站归档还是 RSS 实现问题）；同时**在采集层加源级时效预筛**——适配器返回后立即按 `persona.maxAgeHours` 砍，不要让 833 条走过 dedupe。后者无论 feed 怎么改都是净收益。

---

### P1-1　`sameEndpoint` 串行保护完全失效，且已实际发作

**位置**：`src/editorial/index.ts:216-257`

```ts
const writerJobPromise = writerUsable ? runJob({...}) : Promise.resolve(null)   // ← 已启动
const reviewerJobPromise = reviewerUsable ? runJob({...}) : Promise.resolve(null) // ← 已启动

if (sameEndpoint) {
  log('[editorial] writer 与 reviewer 同端点，改串执行（避免单槽位互相拖慢）')
  writerJob = await writerJobPromise      // ← 只是等待，不阻止并发
  reviewerJob = await reviewerJobPromise
}
```

`runJob` 是 async 函数，**调用即开始执行**。`await` 只等待，不会让已启动的 Promise 变串行。因此这个分支的"串行"从未生效——两个作业始终并发 2 路。

**已实际发作**（17:56 轮 evidence `...mtowr5h2`）：

```
endpoints: [
  {role:"writer",   endpointId:"nous-proxy",   calls:2, reasoningTokens:6568},
  {role:"writer",   endpointId:"llama-local",  calls:1, reasoningTokens:0},      ← 落到 8080 死端点
  {role:"reviewer", endpointId:"nous-proxy",   calls:1, reasoningTokens:1064}    ← 与 writer 撞车
]
```

writer 主端点 8052、reviewer 主端点 8002，配置首端点不同 → `sameEndpoint=false` → 走并行；但 **reviewer 已从 8002 降级到 8052**，实际与 writer 同端点且并发。这正是配置注释 `_enabledNote` 预警的"降级链撞车必须人工干预"——**不仅没被拦住，连注释里承诺的串行兜底也是空的**。

**修复**（把启动推迟到分支内）：

```ts
const startWriter   = () => runJob<ReturnType<typeof toWriterInput>, WrittenCopy>({...})
const startReviewer = () => runJob<ReturnType<typeof toWriterInput>, ReviewVerdict>({...})

let writerJob: JobResult<WrittenCopy> | null = null
let reviewerJob: JobResult<ReviewVerdict> | null = null
if (sameEndpoint) {
  log('[editorial] writer 与 reviewer 同端点，改串执行（避免单槽位互相拖慢）')
  if (writerUsable)   writerJob   = await startWriter()
  if (reviewerUsable) reviewerJob = await startReviewer()
} else {
  ;[writerJob, reviewerJob] = await Promise.all([
    writerUsable   ? startWriter()   : Promise.resolve(null),
    reviewerUsable ? startReviewer() : Promise.resolve(null),
  ])
}
```

**配套建议**：`sameEndpoint` 只比配置首端点，拦不住降级撞车（这一点配置注释已承认）。建议**在跑完后用实际用量探测撞车**——比对 `writerJob.state.endpointUsage` 与 `reviewerJob.state.endpointUsage` 的键集合，有交集就在看板记一条 warning。把"人工干预"变成自动告警。

---

### P1-2　宽通道已成为唯一召回通道，且是单点依赖

| 产线 | 轮次 | collected | afterGates | recall 捞回 | published |
|---|---:|---:|---:|---:|---:|
| deepthought | 17:56 | 915 | 7 | 7 / 池 20 | **3** |
| deepthought | 19:04 | 915 | 11 | 11 / 池 20 | **10** |
| newsline | 17:59 | 33 | 0 | 0（池 13 全 `endpointFailed`） | **0** |
| newsline | 19:07 | 48 | 0 | 0（池 13 全 `endpointFailed`） | **0** |

两个判读：

1. **快通道（词表 relevance）在 860 条上命中 0 条**。DB-08 引入的宽通道原本定位是"补充召回"，实际已变成**唯一召回通道**。这意味着整个产线的存亡压在单个 LLM 端点上。
2. **宽通道一挂，产线归零**。newsline 两轮 13 条待定池全部 `recall:endpointFailed`，直接 `published=0`。这不是降级，是停产。

**建议**：宽通道端点失败时，看板应有 P0 级告警（目前它只是躺在 dropped 里的一条普通落账）；并考虑给宽通道加"端点失败时退回快通道词表宽松档"的兜底，而不是直接归零。

---

### P1-3　编辑部校准在阈值边缘抖动，导致整轮退回机械兜底

| 轮次 | calibrationPassed | 结果 |
|---|---|---|
| 17:56 | `true` | `active=true`，llmCopyCount=3 |
| 19:04 | `false` | `active=false`，`llmCopyCount=0`，**writer 也不启用** |

19:04 轮的两条 problems：

- 与人工金标一致率 **68.1%** 低于下限 70%（32/47）
- **漏答率 21.3%（10/47）过高，端点或 prompt 有问题**

漏答率 21.3% 与 newsline 的 `recall:endpointFailed=13/13` 指向同一根因：**DeepSeek-V4-Flash（192.168.100.1:8002）端点不稳定**。

判读：这不是代码 bug，是**基础设施问题**，但代码层的反应值得商榷——校准差 1.9 个百分点就整轮放弃 LLM 文案（writer 明明还能用），振荡成本很高。建议区分"灵敏度不足"（分数不可信，应降级）与"端点漏答"（是故障，应重试/换端点而非判定仪器坏了），不要混为一谈。

---

### P2 级（低危，但都值得清）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| P2-1 | jobId 用 UTC 日期 | `editorial/job.ts:226-229` | 实测：本地 2026-09-05 20:31 EDT → jobId 取 `20260906`。波士顿用户晚 8 点后跑批产，staging 文件日期与本地差一天，排查易误判；跨 UTC 午夜的中断续跑会新起作业（浪费至多 53 分钟）。建议改用本地日期 |
| P2-2 | 校准临时目录不清理 | `editorial/index.ts:330` | `mkdtempSync(join(tmpdir(), 'dbot-calibrate-'))` 每轮泄漏一个目录，从不删除。违反本项目"工具产物零容忍"纪律 |
| P2-3 | 注释与实现不符 | `gatekeeper/assertions.ts:13` | 注释称"十条硬断言"，实际 `runAssertions` 返回 **12 条**，加跨条目的 `checkEventOversubscribed` 共 13 条。DB-11/DB-12 新增两条后未同步注释 |
| P2-4 | `model` 字段硬编码为空 | `editorial/index.ts:295` | `lastUsage()` 返回 `model: ''`，看板若展示该字段恒为空——属于"说了但不说真话"的字段 |
| P2-5 | 4 个未跟踪 evidence 未入库 | `evidence/` | 17:56/19:04 两轮真跑产物（4 个文件，最大 316KB）仍在工作区。按本项目已确立惯例（提交 `82c6ea1`「另一会话留下的未跟踪 evidence，按审计证据惯例入库」）应入库 |
| P2-6 | `VIEWER_CHROME` 正则带 `g` 标志 | `gatekeeper/assertions.ts:58` | 当前只用 `.replace()`（会重置 `lastIndex`），**安全**。隐患是带 `g` 的模块级正则一旦被 `.test()` 调用即状态污染。**⚠️ 不可直接删 `g`**——`String.replace` 不带 `g` 时只替换第一处，会把"剥除平台 chrome"变成"只剥第一处"，直接改变 `gk:hollowSummary` 的判定结果。正解是局部 `new RegExp(source,'gi')` 或加禁令注释（已写入 DB-15） |

---

## 四、结论与建议优先级

**代码本身是健康的**：build 绿、412 测试绿、架构重构方向正确、删除无残留、常量单点维护、拒绝静默降级。

**真正的问题不在代码正确性，而在"跑起来的实际效果"**：

1. 91% 的采集量是 6.6 年的归档垃圾（P0-1）——**先修这个，它决定了后面所有读数的意义**；
2. 唯一召回通道依赖单个不稳定端点，一挂就归零（P1-2、P1-3）；
3. 串行保护是空转的，配置撞车已真实发生（P1-1）。

**建议执行顺序**：P0-1（核实源 + 加采集层时效预筛）→ P1-1（修串行 + 加撞车告警）→ P1-2/P1-3（端点稳定性与失败语义分级）→ P2 批量清理。

---

## 五、后续动作：已起外派工单

| 工单 | 覆盖缺陷 | 优先级 | 推荐通道 | 依赖 |
|---|---|---|---|---|
| [`TASK-DB-13-source-staleness-prescreen`](tasks/TASK-DB-13-source-staleness-prescreen-prompt.md) | P0-1（huggingface-blog 归档 + 采集层预筛） | P0 | claude | — |
| [`TASK-DB-14-editorial-serial-and-collision-alert`](tasks/TASK-DB-14-editorial-serial-and-collision-alert-prompt.md) | P1-1（串行失效 + 撞车告警） | P1 | claude | — |
| [`TASK-DB-15-micro-issue-sweep`](tasks/TASK-DB-15-micro-issue-sweep-prompt.md) | P2-1/2/3/4/6 五项清扫 | P2 | agy（免费档） | ⛔ 须在 DB-14 落盘后开工（同改 `src/editorial/index.ts`） |

**未纳入工单的两项**（不属编码范畴，需老张决策）：

- **P1-2 宽通道单点依赖**：快通道词表在 860 条上命中 0 条，宽通道已成唯一召回通道，端点一挂即 `published=0`。涉及召回策略取舍，非纯编码。
- **P1-3 端点不稳定**：ds4（192.168.100.1:8002）漏答率 21.3%，导致校准失败（68.1% < 70%）进而整轮弃用 writer。根因在基础设施，需先确认双机服务状态。

**另有一项不外包**（入库归总管）：4 个未跟踪 evidence（17:56/19:04 两轮真跑产物）待入库。

---

*本报告的所有数据均取自仓库内 evidence 文件与源码实测，未采信任何会话自述。*
