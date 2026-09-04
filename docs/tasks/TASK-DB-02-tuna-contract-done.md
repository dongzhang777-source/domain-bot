# TASK-DB-02 完成报告：tuna 端摄入契约可行性验机（tuna-brief-v0 ↔ tuna Post/Brief 对齐）

- **工单号**：DB-02
- **创建**：2026-09-04（总管小智，代理总管）
- **执行通道**：cbc(hy3) 免费模型
- **性质**：只读契约审查，**两仓均只读**、不构建、不测试、不 commit、不 push
- **唯一写入文件**：本报告（其余任何源码/测试/文档未触碰）
- **审查基线**：tuna HEAD `a496aa4`；domain-bot HEAD `9af95c9`
  - 复核时间戳：2026-09-04（git rev-parse 末步重跑，见文末 §七）

---

## 〇、结论速览（可证伪定位）

**结论：双侧各改，但 tuna 侧改动极薄（仅一个摄入 normalizer + 一个 ContentSource kind，零网络、不违宪）。**

- `tuna-brief-v0` **不能直接被 tuna 摄入**——它在结构上与 tuna `Post` 模型存在 4 项硬缺口 + 版本号空间错位 + 简报 why 长度越界，属"单向写文件、无人消费"的死文件风险，**已证实**（见 §二、§三实证）。
- 建议由 **domain-bot 改造产出**，对齐 tuna `Post` 候选结构（domain-bot 侧早已持有全部原料）；tuna 仅增一个 `feeds` 内的本地摄入适配器做格式校验/升级。
- 该路径**不违反 tuna 宪法**：内容摄入落在 `packages/feeds`（宪法批准的三大 fetch/摄入边界之一），新增适配器只读本地文件、不发任何网络请求，`packages/content` 仍保持零网络。

---

## 一、供审查事实材料（已读原文并核对行号）

### 1.1 domain-bot 侧 schema：`domain-bot/src/push/tuna.ts`

`renderTunaBrief`（`:19-46`）产出的 `tuna-brief-v0` 字段集（常量 `SCHEMA='tuna-brief-v0'` 见 `:17`）：

| 字段 | 来源 | 限长/类型 |
|---|---|---|
| `schema` | 常量 | `'tuna-brief-v0'` |
| `digestId` | `digest.id` | string |
| `domain` | `digest.domain` | string |
| `generatedAt` | `digest.generatedAt` | **number（ms 时间戳）** |
| `now` | `Date.now()` | **number（ms 时间戳）** |
| `items[].index` | 聚类序号 `i` | number |
| `items[].tier1.hook` | `c.title.slice(0,90)` | **string ≤90** |
| `items[].tier1.meta` | `src.source` | string（来源名） |
| `items[].tier1.isNew` | `src.isNew` | boolean |
| `items[].tier1.publishedAt` | `src.publishedAt` | number（ms） |
| `items[].tier2.title` | `c.title.slice(0,120)` | string ≤120 |
| `items[].tier2.summary` | `c.summary.slice(0,300)` | **string ≤300** |
| `items[].tier2.why` | `c.why.slice(0,200)` | **string ≤200** |
| `items[].tier3.url` | `src.url` | string（URL） |
| `items[].score` | `src.valueScore` | number |

> 实证：`domain-bot/src/push/tuna.ts:21-45`（字段与限长）；`:30`(`slice(0,90)`)、`:37`(`slice(0,300)`)、`:38`(`slice(0,200)`)、`:45`(`now`)。
> 注意：整个函数**从未引用 `RawItem.body`**（`types.ts:5` 有 `body` 字段，但 `tuna.ts` 未使用），证实 L3 底料缺失（缺口 d）。

### 1.2 tuna 侧核心模型（已逐一读原文）

- **`Post`**：`tuna/packages/core/index.ts:34-73`
  - `hooks: string[]`——`:37-38` 注释：「3 个候选钩子，每个 ≤40 字，视角各不相同（悬念/数据/个人利益……）」
  - `summary`——`:39-40` 注释：「≤200 字一屏摘要（L2 渲染）」
  - `body`——`:41-42` 注释：「正文（L3 深聊的内容底料）」
  - `sourceUrl?`——`:43-44`；`lang`——`:45`（`'zh'|'en'`）；`author`——`:46`；`provenance`——`:47`；`epistemic`——`:48`；`signer`——`:49-50`；`schemaVersion`——`:51-52`（「当前为 2」）；`createdAt`——`:53-54`（「ISO 8601 时间戳」）
- **`BriefItem` / `BriefResult`**：`tuna/packages/brief/index.ts:9-19`
  - `BriefItem = { postId: string; why: string; source: 'model'|'static' }`（`MAX_WHY_CHARS=40` 见 `:36`）——**简报 why ≤40 字**，且简报**不存内容本体，靠 `postId` 引用 `Post`**。
  - `BriefResult = { items: BriefItem[]; generatedAt: string }`
- **`Post` 归一化实作参考**：`tuna/packages/feeds/normalizers.ts`
  - 钩子限长按语言分档 `HOOK_LIMITS = { zh:35, en:50 }`（`:34`）——比 core 注释的「≤40」更紧；
  - 概要限长 `SUMMARY_LIMITS`（`:41-44`）：zh `min200/max300`、en `min300/max450`；
  - 外部源一律 `provenance:'human'`、`epistemic:'inference'`、`signer:null`、`schemaVersion:1`、并 `detectLang` 推断语言（`:182-204` RSS；`:268-285` 搜索）；
  - 三钩子由 `placeholderHooks`（`:76-105`）机械生成（标题/首句/组合），保证恒 3 条互异。

### 1.3 tuna 宪法约束（摄入路径合规性判据）

- `tuna/AGENTS.md:19-21`（宪法第二条、第三条）：**智能私有化**；**私人数据不出端**；`fetch/axios` 只允许出现在 `packages/llm` 与 `packages/feeds`，`packages/content` 保持零网络。
- `tuna/docs/ARCHITECTURE.md:167`：**fetch 全仓仅 `llm`/`feeds`/`remote-update` 三包**，content 零网络。→ 新增"本地文件摄入适配器"应落在 `packages/feeds`（已是外部内容摄入边界）。
- `ContentSource.kind` 仅 `'builtin-pack' | 'rss' | 'byo-search'`（`tuna/packages/core/index.ts:76-80`）——新增本地源需 core 扩一个 kind（tuna 侧极小改动）。

### 1.4 tuna 内是否存在 domain-bot 摄入代码（初勘复核）

- 全仓 Grep `domain-bot|domain_bot|outbox|tuna-brief`：**No matches found**（`tuna/` 递归，含 `packages/*`）。
  → 证实 tuna 当前**零** domain-bot 摄入逻辑，产物确为无人消费的死文件（除非打通）。

---

## 二、字段级映射表（每项附实证）

目标结构分两层：内容本体 → `Post`；推荐理由 → `BriefItem`（经 `BriefResult` 引用 `postId`）。

| tuna-brief-v0 字段 | 映射到 | 实证 | 备注 |
|---|---|---|---|
| `schema` | （tuna 侧版本号空间为 `Post.schemaVersion: number`） | `core:51-52` | **缺口**：字符串 `'tuna-brief-v0'` 与 tuna 数字 `schemaVersion=2` 不兼容，需转换 |
| `digestId` | 无直接字段；可派生为 `Post.id` 前缀或落 `ContentSource.id` | — | 缺口：无稳定 `Post.id` |
| `domain` | `Post.domainId?`（X45/X46 扩展字段）或 `ContentSource.label` | `core:69-70` | 可作领域标签 |
| `generatedAt`(ms) | `Post.createdAt`(需转 ISO) | `core:53-54` | 类型不匹配（number→ISO string） |
| `now`(ms) | 无对应 | — | 冗余/可丢弃（摄入时重新计） |
| `items[].index` | 排序依据（可选） | — | 可丢弃 |
| `items[].tier1.hook`(≤90) | `Post.hooks[]`（**需 3 条 ≤40/≤35zh/≤50en**） | `tuna.ts:30` vs `core:37-38`/`normalizers:34` | **缺口 a**：数量与限长双不符 |
| `items[].tier1.meta` | `Post.author.name` 或 `ContentSource.label` | — | 可落作者名 |
| `items[].tier1.isNew` | 无对应（tuna 用 seen-map 去重） | `pipeline.ts:54-72` | 可丢弃 |
| `items[].tier1.publishedAt`(ms) | `Post.createdAt`(转 ISO) | `core:53-54` | 类型不匹配 |
| `items[].tier2.title`(≤120) | `Post.title` | `tuna.ts:36` vs `core:36` | OK（tuna 标题无硬上限，注入上限 200 见 `brief:50`） |
| `items[].tier2.summary`(≤300) | `Post.summary`(≤200 注释 / zh≤300 en≤450 实作) | `tuna.ts:37` vs `core:39`/`normalizers:41-44` | **缺口 b**：300 vs 200 注释冲突；与实作上限临界 |
| `items[].tier2.why`(≤200) | `BriefItem.why`(≤40) | `tuna.ts:38` vs `brief:36` | **缺口 e（越界）**：200 vs 40 |
| `items[].tier3.url` | `Post.sourceUrl?` | `tuna.ts:40` vs `core:43-44` | OK（可空） |
| `items[].score` | 无对应 `Post` 字段 | — | **缺口**：tuna `Post` 无 valueScore；可并入 `why` 或丢弃 |
| （缺失）`Post.hooks[3]` | — | — | **缺口 a** |
| （缺失）`Post.body` | — | `types.ts:5` 有 `RawItem.body` 但 `tuna.ts` 未用 | **缺口 d** |
| （缺失）`Post.lang` | — | `core:45` | **缺口 c** |
| （缺失）`Post.author` | — | `core:46` | **缺口 c** |
| （缺失）`Post.provenance` | — | `core:47`/`normalizers:200,280` | **缺口 c** |
| （缺失）`Post.epistemic` | — | `core:48` | **缺口 c** |
| （缺失）稳定 `Post.id` | — | `core:35` | 缺口：brief 仅 `digestId`+`index`，无稳定 id 供 `BriefItem.postId` 引用 |

---

## 三、结构性缺口清单（初勘 4 项已核实 + 补全）

- **a. hooks 数量/限长不符** ✅证实
  - tuna：`hooks: string[]`，注释「3 个候选钩子，每个 ≤40 字，视角各不相同」（`core:37-38`）；实作 `HOOK_LIMITS` zh:35/en:50（`normalizers:34`）。
  - brief：仅 **1 条** `tier1.hook`，`slice(0,90)`（`tuna.ts:30`）。
  - 后果：直接摄入会触发「恒 3 条互异」约束失败，或落单钩子损害 L1 渲染。

- **b. summary 限长不符** ✅证实
  - tuna：`summary` 注释「≤200 字」（`core:39-40`）；实作 `SUMMARY_LIMITS` zh max300/en max450（`normalizers:41-44`）。
  - brief：`summary: c.summary.slice(0,300)`（`tuna.ts:37`）。
  - 后果：与 core 注释「≤200」冲突；即便按实作上限勉强可容，也与「按 lang 区间取句」语义不一致（brief 的 summary 是模型输出，非首句区间取样）。
  - 附带发现：**tuna 自身 core 注释(≤200) 与 normalizers 实作(zh≤300/en≤450) 存在内部 drift**，建议两侧据此统一口径（本报告不直接改动）。

- **c. 必需标注字段缺失** ✅证实
  - `lang`（`core:45`）、`author`（`core:46`）、`provenance`（`core:47`）、`epistemic`（`core:48`）在 `Post` 为必填（normalizers 恒赋值，见 `:198-204`/`:278-285`），brief **全无**。
  - 后果：缺 `lang` 钩子分档与概要取句全错；缺 `author/provenance/epistemic` 内容卡无法合法构造。语义上 domain-bot 产出来自公开新闻（human-authored）+ 模型摘要，最贴近 `provenance:'human'`、`epistemic:'inference'`（同 normalizers 外部源约定）。

- **d. body（L3 底料）缺失** ✅证实
  - tuna：`Post.body` 为 L3 深聊内容底料（`core:41-42`），喂食管线以 `body` 区间取句生成 `summary`（`normalizers:125-139` `buildSummary`）。
  - brief：`renderTunaBrief` 从不读 `c.summary` 之外的内容，更不读 `RawItem.body`（`types.ts:5` 存在但 `tuna.ts` 未引用）。
  - 后果：摄入后 `body` 空 → L3 深聊无料；若勉强以 `summary` 当 `body`，则概要/底料同源退化。

- **e. 简报 why 长度越界**（补全项）
  - tuna：`BriefItem.why` `MAX_WHY_CHARS=40`（`brief:36`）。
  - brief：`tier2.why` `slice(0,200)`（`tuna.ts:38`）——**5 倍越界**，且 tuna 简报生成后会按 40 字截断（`brief:302-305`），domain-bot 的长理由会被暴力截断失真。
  - 语义对齐点（工单 §四.4）：tuna `BriefItem.why` 与 domain-bot `tier2.why` 同族——都是"人话化推荐理由"，且 tuna 有 `StaticWhyGenerator` 降级模板（`brief:6,259-265`）。**domain-bot 的 why 应缩到 ≤40 并标注 `source:'static'`（或 `model`）以复用 tuna 简报层**，而非自创 200 字字段。

- **f. 版本号空间错位 + 稳定 id 缺失**（补全项）
  - tuna 用数字 `schemaVersion=2`（`core:7,51-52`），brief 用字符串 `'tuna-brief-v0'`（`:17`）；且 brief 无稳定 `Post.id` 供 `BriefItem.postId` 引用（core:35 / brief:9-14）。需改产出以携带稳定 id（如 `domain-bot:<digestId>:<index>`）。

---

## 四、摄入路径建议（双向论证 + 合规性）

### 路径 X：tuna `feeds` 增本地文件导入适配器（读 `outbox/tuna/*.json` → normalizer 转 Post）

- **做法**：在 `packages/feeds` 新增 `LocalBriefNormalizer`（同 `RssNormalizer`/`SearchNormalizer` 实现 `ContentNormalizer`），读取 domain-bot 产出的 brief JSON，逐条映射为 `Post` 候选；需 core 扩 `ContentSource.kind` 加 `'local-brief'`（`core:76-80`）。
- **不做的代价**：domain-bot 的 tuna 分发永远是单向写文件，无人消费（P1 风险成立）。
- **做了推翻哪个资产**：推翻"brief 是死文件"现状；**推不翻任何 tuna 资产**——仅新增一个 normalizer + 一个 enum 值，不动既有管线。
- **合规性**：✅ `feeds` 是宪法批准的 fetch/摄入边界（`AGENTS.md:21`、`ARCHITECTURE.md:167`）；适配器只读本地文件、零网络，`content` 仍零网络；`ContentSource.kind` 扩 enum 属约定内小改。**不违宪**。
- **缺点**：仍要在 normalizer 内**补齐缺口 a/d/c**（生成 3 钩子、推断 lang、填 author/provenance/epistemic、body 以 summary 兜底）——即把"对齐成本"压到 tuna 侧，且 domain-bot 格式一旦变，tuna normalizer 要跟着修。

### 路径 Y：domain-bot 改产出，直接对齐 `Post` 候选结构

- **做法**：domain-bot 改造 `renderTunaBrief`，产出**已是 `Post` 候选**的 JSON（含 `id`/`title`/`hooks[3]`/`summary`/`body`/`sourceUrl`/`lang`/`author`/`provenance`/`epistemic`/`schemaVersion:2`/`createdAt` ISO），并附 `brief.items[].why`(≤40)。domain-bot 已持有全部原料：`RawItem.body`（`types.ts:5`）→ `body`；可 `detectLang` 推 `lang`；由 `c.title` 机械派生 3 钩子（复用 normalizers `placeholderHooks` 思路）；`author` 设为 `domain-bot` 代理身份；`provenance:'human'`/`epistemic:'inference'`（同外部源约定）。
- **不做的代价**：tuna 摄入适配器要学会 domain-bot 的"三级瀑布"私有格式，耦合反向、易碎。
- **做了推翻哪个资产**：推翻 domain-bot 现有的 `tuna-brief-v0` 三级结构（自创格式）；**tuna 侧仅需一个薄 normalizer 做校验/升级**，几乎零成本。
- **合规性**：✅ domain-bot 是外部项目，产出兼容 JSON 不触发 tuna 任何网络/宪法约束；tuna 摄入仍只在 `feeds`。**不违宪**。
- **缺点**：domain-bot 须跟踪 tuna `Post` schema 演进（schemaVersion 升级时要同步）。

### 路径 Z（推荐，融合 X+Y 的最优解）

- **做法**：**domain-bot 对齐 `Post` 候选产出（路径 Y 主体）** + **tuna 在 `feeds` 加极薄 `LocalBriefNormalizer`（路径 X 执行层）** 做格式校验与 `migratePost` 升级；brief 文件内同时携带 `brief.items[].why`(≤40, `source:'static'`) 供 tuna 简报层直接复用（对齐缺口 e 与工单 §四.4 语义点），省去 tuna 再跑模型生成 why。
- **双向论证**：Y 解决了"格式对齐责任归生产者（新人）"的治理合理性；X 的执行层让 tuna 保持"外部内容统一经 feeds 摄入"的架构纯洁，且零网络。`content` 包零网络不变。
- **合规性**：✅ 全部落在 `feeds`，无网络 fetch，不碰 `content`，`ContentSource.kind` 仅加一个 enum 值。**不违宪**。
- **推翻资产**：仅推翻 domain-bot `tuna-brief-v0` 自有格式（改为对齐 tuna `Post`）；tuna 不推翻既有管线，仅增薄适配层。

---

## 五、schema 版本建议（明确建议 + 理由）

1. **升版本号**：domain-bot 侧 `SCHEMA` 由 `'tuna-brief-v0'` → `'tuna-brief-v1'`（或干脆改用语义名 `tuna-post-v1`）。理由：v0 是"单方面提案、未经确认"的自创三级格式（见 `tuna.ts:13` 注释），与 tuna `Post` 模型不兼容，必须破坏性重塑，故**主版本号进 v1**。
2. **两侧谁向谁靠**：**domain-bot 向 tuna 靠**（domain-bot 是探针 newcomer，tuna `Post` 是已确立的内容存储契约）。理由：tuna 是内容的唯一消费/存储方，生产者适配消费者是标准集成方向，避免 tuna 为每一个上游发明私有解析器。
3. **v1 字段改造清单**（domain-bot 侧）：
   - 删除 `tier1/tier2/tier3` 三级嵌套，改为**平铺 `posts[]`**，每项为合规 `Post` 候选：
     - `id`：`domain-bot:<digestId>:<index>`（稳定，供 `BriefItem.postId` 引用）；
     - `title`（≤120 ok）；
     - `hooks`：**3 条 ≤40（zh≤35/en≤50）**，视角互异；
     - `summary`：**≤200（与 core 注释对齐；或按 lang 取 zh≤300/en≤450，须与 tuna 约定一致）**；
     - `body`：**补 `RawItem.body`**（缺口 d 关闭）；
     - `sourceUrl`、`lang`（推断）、`author`（`{id:'domain-bot',name:'domain-bot 探针',kind:'user'}`）、`provenance:'human'`、`epistemic:'inference'`、`signer:null`、`schemaVersion:2`、`createdAt`（ISO，由 `publishedAt` 转换）；
   - 新增 `brief: { items: [{ postId, why(≤40), source:'static' }], generatedAt }`（对齐 tuna `BriefResult`，关闭缺口 e/f）；
   - 丢弃 `now`、`items[].index`、`tier1.isNew`、`score`（或并入 `why` 文案）；`digestId`/`domain` 提到顶层 metadata。
4. **tuna 侧最小改动**：`core/index.ts:76-80` `ContentSource.kind` 增 `'local-brief'`；`packages/feeds` 增 `LocalBriefNormalizer`（校验 + `migratePost` 兜底）。**不触碰 `content`、不新增网络**。

---

## 六、违宪风险核查

| 建议路径 | 是否违反"content 零网络" | 是否违反"fetch 限 llm+feeds+remote-update" | 是否违反"私人数据不出端" | 结论 |
|---|---|---|---|---|
| X（feeds 本地适配器） | 否（只读本地文件） | 否（落在 feeds） | 否（brief 是公开新闻摘要，非用户私人数据） | ✅ 合规 |
| Y（domain-bot 改产出） | 不涉及 tuna | 不涉及 tuna | 不涉及 tuna | ✅ 合规 |
| Z（融合） | 否 | 否 | 否 | ✅ 合规 |

- 红线提醒（源自 `AGENTS.md:21,26`）：**禁止**把摄入逻辑塞进 `packages/content`、禁止为适配器引入任何遥测/上报、禁止在 `feeds` 之外开网络。新增 `local-brief` 适配器只 `fs.read` 本地目录，零 axios/fetch。

---

## 七、最终结论

**契约可接性：需改 domain-bot（主体，结构对齐到 Post 候选）+ 需改 tuna（极薄摄入适配，零网络）。即"双侧各改"，tuna 侧改动量极小、不违宪。**

- 直接可接：**否**——已证实存在 a/b/c/d/e/f 六项结构/语义缺口，当前 `tuna-brief-v0` 是无人消费的死文件（tuna 全仓 Grep 零 domain-bot 摄入代码）。
- 推荐落地：**路径 Z**——domain-bot 升 `tuna-brief-v1` 并直接产出 `Post` 候选 + 内嵌 ≤40 字 `brief.why`；tuna 在 `feeds` 加 `LocalBriefNormalizer` 做校验/升级。
- 版本与靠向：**domain-bot 向 tuna `Post`(schemaVersion=2) 靠拢**，主版本进 v1。

---

## 八、完成署名块（DISPATCH-RULES §八.2）

```
工单号      ：DB-02
任务类型    ：只读契约审查（tuna-brief-v0 ↔ tuna Post/Brief 对齐）
执行通道    ：cbc(hy3)  免费模型
改动文件    ：仅本报告 /Users/aiatwork/Projects/domain-bot/docs/tasks/TASK-DB-02-tuna-contract-done.md
两仓状态    ：tuna 仓只读、domain-bot 仓只读；未修改任何源码/测试/文档；未 commit/push
审查基线    ：tuna HEAD a496aa4 ｜ domain-bot HEAD 9af95c9
状态断言复核：
  - tuna HEAD = a496aa4   （git rev-parse，复核时间戳 2026-09-04）
  - domain-bot HEAD = 9af95c9   （git rev-parse，复核时间戳 2026-09-04）
  - tuna 全仓 Grep "domain-bot|outbox|tuna-brief" = No matches found  （复核时间戳 2026-09-04）
待两侧总管拍板：domain-bot 代理总管（采纳 v1 改造）／ tuna 督阵会话（采纳 feeds 薄适配器）
```

> 本报告仅作独立验机证据，不构成对任一仓的代码改动。落地决策与施工归两侧总管会话。
