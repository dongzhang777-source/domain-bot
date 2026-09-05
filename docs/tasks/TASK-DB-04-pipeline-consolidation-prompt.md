# TASK-DB-04：信息流产线收编——阶段一收官（配置文件 + 实体词事件聚类 + 双产线编排 + 主编终审 + 退役 Telegram）

> 工单号：DB-04　｜　创建：2026-09-04　｜　创建人：Qoder 会话（老张指令「制定工作计划，外派给 zcode 执行」）
> 基线 HEAD：`domain-bot @ 767ac81`（`npm test` **191/191** 绿，`npm run typecheck` exit=0）
> 工作目录：`/Users/aiatwork/Projects/domain-bot`
> 推荐通道：**claude**（DISPATCH-RULES §一：重要/困难编码走 claude 或 codex；ZCode 非 TTY 环境实际走 claude 后台派单）
> 预计工时：1 天（8 个 Task，每个 Task 独立可验证）
> 优先级：**P0**
> 所属台账：`/Users/aiatwork/Projects/docs/COMMITMENT-LEDGER.md`
> 上游依据：`docs/tasks/TASK-DB-03-quality-audit-done.md`（agy 200 条全量审计）+ 老张 2026-09-04 五项裁决（见 §〇.3）

---

## 〇、必读（不看会做错）

### 〇.1 已落地的地基——不要重做

基线 `767ac81` 已经把**三层硬闸门的代码**落进 `src/gates/`，并修掉了 12 条完全重复的根因。已存在、已测、不要重写：

| 已落地 | 文件 | 状态 |
|---|---|---|
| 规范 URL | `src/collector/canonicalUrl.ts` | 74 行，`canonicalUrl()` / `sameDocument()` |
| id 派生 | `src/collector/dedupe.ts` 的 `itemId(url,title,body)` | 7 处适配器已统一口径 |
| 门禁 1 黑名单 | `src/gates/blacklist.ts` | `BlacklistGate`，含 `compileErrors` |
| 门禁 2 相关性积分 | `src/gates/relevance.ts` | `RelevanceGate`，含标题加权 |
| 门禁 3 指纹去重 | `src/gates/fingerprint.ts` | `dedupeByCanonicalUrl` / `capEvents` / `collectCanonicalUrls` |
| persona 闸 | `src/gates/persona.ts` | `PersonaGate`（信源白名单/时效/淘汰红线） |
| 四层编排 | `src/gates/index.ts` | `runGates()` / `buildFunnel()` |
| 类型定义 | `src/types.ts` | `GatesConfig` / `PersonaConfig` / `DropRecord` / `GateOutcome` / `RelevanceScore` |
| 闸门测试 | `tests/gates.test.ts` | 42 用例，已跑变异测试确认断言会红 |

**缺的是配置与编排**：`src/gates/` 有代码但 `config/gates.json`、`config/personas/*.json` **不存在**，因此闸门在运行时根本没被调用——生产路径仍是 `src/index.ts` 的旧 `runOnce`（`filterRelevant` + 每源配额 + 6 条摘要）。本工单就是把这条线接上。

### 〇.2 已证伪的旧结论——照它做会白干

**DB-03 §3.2「门禁 3：标题 jaccard > 0.75 判同事件，仅保留权威度最高的 1 篇」——实测推翻，不得实现。**

实测方法：取 DB-03 报告 §1.3 里 GPT-6 Astra **同一事件**的 10 条真实报道标题（#58/#84/#85/#86/#122/#123/#124/#153/#156/#181），用仓库现有 `tokenize()` + `jaccard()`（`src/collector/dedupe.ts:14`、`:31`）两两计算：

| 同事件集 | 配对数 | 最大 jaccard | 中位 | ≥0.75 命中 | ≥0.50 命中 |
|---|---|---|---|---|---|
| GPT-6 Astra 10 条 | 45 | **0.313** | 0.105 | **0** | **0** |
| K2 Horizon 5 条（#32/#33/#103/#144/#191） | 10 | **0.500** | 0.250 | **0** | 1 |

结论：记者**刻意**给同一事件写不同标题，阈值降到 0.50 也只捞到 55 对里的 1 对。`capEvents()` 现有的 jaccard 实现只能治「同一通稿被多家原样转发」（标题逐字相同），**治不了洗稿刷屏**。这条能力边界已经钉进测试：`tests/gates.test.ts` 的用例「已知缺陷：jaccard 聚不拢真实洗稿标题」——**该用例是缺陷钉子，不得删除、不得改断言让它变绿**。Task 2 实现实体词聚类后，按该用例注释里的指示改写它。

**实测有效的替代方案**（Task 2 的依据）：按「非通用 token 共享」做并查集聚类，同一批数据上 Astra **8/10 聚成一簇**、K2 Horizon **5/5 聚成一簇**，且 3 条独立事件干扰项（KC-Bench / FlashInfer / Microsoft Agent Framework）**零误并**。漏掉的 2 条是 The Verge 标题不含 "Astra"（写作 "next big AI model… AGI era"）与一条中文标题——这部分归 DB-05（LLM reviewer 语义事件归并），不在本工单范围。

### 〇.3 老张 2026-09-04 的五项裁决（本工单的设计前提，不得自行更改）

1. **只保留批产线，砍掉每日摘要**：`maxPerDigest=6` 的日推节奏退役，产物是内容包（百条级）。
2. **双 bot 双产线彻底分离**：`AI时事快线` 与 `AI深度思想` 各跑完整产线（各自信源白名单、时效窗、配额、内容包），不共享候选池。
3. **AI 编辑部端点不绑定**：做成配置项 + 自动降级链，**不硬编码任何地址**。（属 DB-05 范围，本工单只需保证 `config/editor.json` 的读取位预留好）
4. **主编终审用双模型交叉，写与评分离**。（属 DB-05 范围）
5. **砍 Telegram，新建 tuna 行为回流通道**：本工单负责**退役** Telegram 链路；回流通道的接收端与 tuna 侧三项属 DB-06。

### 〇.4 老张给的模型端点不存在——不要写进任何配置

老张口述的 `http://192.168.100.1:8002/v1` + api key `local` + model `deepseek-v4-flash` **经实测不存在**：

- `192.168.100.1` 是**本机自己**的雷雳桥 bridge0 地址（`/Users/aiatwork/Projects/docs/ops/local-llm-inference-speedup-2026-09-03.md:15` 记 `.1↔.2`，`.2` 才是 B 机），且本机所有模型服务只 bind `127.0.0.1`；
- 8002 端口在 `.1` 与 `.2` 上均无服务（`curl` 1ms 即拒）；
- `deepseek-v4-flash` 不在任何本地端点的 `/v1/models` 清单里。

本机**实测可用**的 OpenAI 兼容端点（供 DB-05 参考，本工单不用）：`127.0.0.1:8080`（llama-server，本地 Qwen3.8-Flash-Next，实测生成 9.9 tok/s）、`127.0.0.1:8082`（llamacpp-proxy→8080，Claude Code 在用）、`127.0.0.1:8052`（`~/.codex/nous-proxy.py`，实测 4.1s/短请求，但**无视传入 model 参数、一律路由到 `meituan/longcat-2.0:free`**）、`127.0.0.1:11434`（ollama `qwen3:8b`）。

### 〇.5 影子工序——本工单要消灭的东西

老张真机刷到的 172 条内容，产自**仓库治理之外的三道影子工序**：

1. `/tmp/tuna-feed-run/edit.mjs`（仓库外脚本，无版本记录、无测试；`require('/Users/aiatwork/Projects/domain-bot/dist/push/tuna.js')` 复用生产代码的 `deriveHooks`/`detectLang` 与 `dist/refinery/scorer.js` 的 `HeuristicScorer`）
2. 人肉主编终审（`docs/newsroom-board.md` 记：小智 GLM-5.3-Flash 亲审，1396→750→703→200→**172**，裁 28 条）
3. 手工拷贝进 `tuna/packages/content/data/builtin-pack-ai-feed-v1.json` → commit → rebuild（实测 domain-bot `outbox/tuna/tuna-feed-200.json` 与 tuna 该文件 id 集合 **172/172 完全一致**，证实是人工搬运；文件名 `tuna-feed-200.json` 已过期，实际 172 条）

**这就是为什么 149 个测试全绿而内容仍是垃圾**：测试守的是 6 条摘要的格式与接线，用户看到的 200 条从来不在任何测试的覆盖范围内。Task 7 归档影子脚本，Task 8 建质量回归测试堵住这个盲区。

---

## 一、背景（为什么做）

**现在不做会怎样**（DISPATCH-RULES §二 约束 2）：闸门代码已在仓里但**运行时零调用**——`config/gates.json` 不存在，`runGates()` 无调用者。也就是说 `767ac81` 只是把工具造好了放在架子上，下一期内容包仍会由 `/tmp/edit.mjs` + 人肉终审产出，DB-03 查出的 65 条垃圾（32.5%）会**原样长回来**：12 条完全重复、招聘帖、`[object Object]`、卖课视频、2024 年旧闻。老张已冻结探针签字（「等整改后的信息流达到我手写认可的标准再说」），闸门不接通则解冻无期，而 fati-server 台账批次 4（SP-24→SP-34）的硬前置就是这个假门判定。

**做了会推翻哪个已验证资产**（同约束）：

| 被推翻的资产 | 来源 commit | 处置 |
|---|---|---|
| Telegram 推送 + L1-L3 展开交互 | `c5c9ad5` / `0b26a73` / `5fca284` | **退役删除**（老张裁决 5） |
| `src/feedback/receiver.ts` 长轮询反馈回路 | `cbf7247` 同期 | **退役删除**，由 DB-06 的 tuna 回流取代 |
| `runOnce` 每日 6 条摘要 + 每源配额 | 项目初始设计 | **退役**，`src/index.ts` 改为 CLI 入口 |
| 判定线 11 项（`docs/probe-verdict-criteria.md` + `scripts/gen-evidence.mjs`） | `495fc3c` 等 | **本轮冻结不重写**；G/P 判据全依赖 `views.json`，Telegram 退役后必然 `nodata`，须在看板与台账明写 |
| `src/memory/interest.ts` Beta 后验引擎 | `cbf7247`（老张「高明的算法」设计指令） | **不删**。但 Telegram 退役后 `recordView`/`recordEngagement` 失去唯一调用方 → 引擎停摆。实测 `memory/weights.json` 现在就已经是空的 `{"weights":{}}`。质量看板必须明写「自进化未生效，待 DB-06」 |

**保留不动**：`src/memory/store.ts` / `interest.ts` / `weights.ts` / `observe.ts`（DB-06 接活）、`src/refinery/scorer.ts` 的 `HeuristicScorer`（DB-05 降级链末端）、`src/push/tuna.ts` 的 `detectLang`/`truncateChars`（Task 5 复用）。

---

## 二、目标与验收标准（可证伪）

每条都能被一条命令或一个断言判定真假。

1. **闸门真被调用**：`rg -n "runGates" src/ --glob '!*.test.ts'` 至少命中 `src/pipeline.ts`；`config/gates.json` 与 `config/personas/newsline.json`、`config/personas/deepthought.json` 三文件存在且能被 `JSON.parse`。
2. **双产线各自独立跑通**：`node dist/cli.js run --persona=newsline --dry-run` 与 `--persona=deepthought` 各自产出内容包，两者的 `posts[].id` 交集为空（跨产线不重复），且 newsline 全部条目 `publishedAt=0` 或距今 ≤72h、deepthought ≤720h。
3. **主编终审十条硬断言全部生效**：`tests/gatekeeper.test.ts` 对十条断言**各造一个违例样本**并断言被否决；改坏任一条断言的实现能让对应用例变红（变异测试，见 §六）。
4. **零垃圾**：对产出的内容包跑 `tests/pipeline-quality.test.ts`，断言 `[object Object]` 计数 = 0、规范 URL 重复计数 = 0、招聘/卖课黑名单命中 = 0、机械截断钩子（`/^arXiv:\d+\./` 或 hook 为 title 前缀截断）= 0、浮点回显 why（`/价值 0\.|\d\.\d\d/`）= 0。
5. **事件聚类换掉 jaccard**：`tests/gates.test.ts` 里用 DB-03 真实 Astra 10 条标题构造的用例，断言最大簇 **≥8 条**，且 3 条独立事件干扰项**各自独立成簇**（零误并）。原「已知缺陷」钉子用例按注释改写，不得删除。
6. **Telegram 链路彻底退役**：`rg -n "telegram|pollFeedback|sendDigest" src/ --glob '!*.test.ts'` **零命中**；`src/push/telegram.ts`、`src/feedback/receiver.ts`、`src/push/file.ts` 三文件不存在；`npm test` 全绿。
7. **漏斗可复算**：质量看板 JSON 里 `funnel[].count` 之和 == `dropped.length`，且看板记录 `collected → afterGates → afterEventCap → afterGatekeeper → published` 每一跳的绝对数（对齐 `docs/newsroom-board.md` 第一期的 1396→750→703→200→172 格式）。
8. **配置正则写错不静默**：往 `config/gates.json` 塞一条非法正则（如 `"(unclosed"`），CLI 必须**非零退出并打印 ruleId**，不得静默跳过（`runGates` 已返回 `compileErrors`，需在 CLI 层熔断）。
9. **影子工序归档**：`/tmp/tuna-feed-run/edit.mjs` 内容存进根仓 `docs/tool-plans/archive/2026-09-04-shadow-pipeline/edit.mjs` 并附 `README.md` 说明来源与被取代关系（守根仓 AGENTS.md「工具产物零容忍」纪律）。
10. **测试与类型双绿**：`npm run typecheck` exit=0；`npm test` exit=0，用例数 ≥ 191 + 新增（新增测试不得靠删旧测试凑数）。

---

## 三、精确落点

> 行号基于基线 `767ac81`。动手前**先读文件确认**（DISPATCH-RULES §四.2：不得靠 grep 零命中下结论）。

| # | 位置 | 现状 | 要求 |
|---|---|---|---|
| 1 | `config/gates.json` | **不存在** | 新建，见 Task 1 完整内容 |
| 2 | `config/personas/newsline.json`、`deepthought.json` | **不存在** | 新建，见 Task 1 完整内容 |
| 3 | `config/domain.json` | `"scoreThreshold": 0.45, "maxPerDigest": 6, "clusterThreshold": 0.35` | 删 `scoreThreshold` 与 `maxPerDigest`（已移入 persona）；`clusterThreshold` 保留 |
| 4 | `src/gates/fingerprint.ts` 的 `capEvents()` | 按标题 jaccard ≥ `cfg.dedupe.jaccardThreshold` 聚簇 | 改为**实体词并查集**聚类，见 Task 2 完整算法。jaccard 保留为「标题逐字相同」的补充判据，不再作主判据 |
| 5 | `src/types.ts` 的 `GatesConfig.dedupe` | `{ jaccardThreshold, maxPerEvent }` | 增 `eventStopwords: string[]`（通用词表，实体词聚类的必需输入） |
| 6 | `src/pipeline.ts` | **不存在** | 新建，单产线编排，见 Task 3。**聚类必须在配额截断之前**——旧 `src/index.ts` 是先 `perSourceCap` 截断、后才 `buildClusters`，这是同事件刷屏的结构成因 |
| 7 | `src/gatekeeper/assertions.ts`、`backfill.ts`、`board.ts` | **不存在** | 新建，见 Task 4。十条断言全部客观可判定，**不得引入 LLM 打分作为闸门**（DB-05 的 reviewer 分只上看板） |
| 8 | `src/push/tuna.ts` 的 `deriveHooks()` | 纯机械截断（title / 首句 / 组合 / 兜底模板） | 保留但降级为「DB-05 编辑部不可用时的兜底」；**必须过 Task 4 的文案硬断言**：不得产出 title 前缀截断、不得产出 `/^arXiv:\d+\./` 碎片。若现有实现过不了断言，改它 |
| 9 | `src/push/telegram.ts`（160 行）、`src/feedback/receiver.ts`（191 行）、`src/push/file.ts`（36 行） | 存在且在 `src/index.ts` 被调用 | **删除三文件**，同步删 `src/index.ts` 的 import 与调用 |
| 10 | `src/index.ts` 的 `runOnce()` / `startBot()` / `printBootBanner()` | 每日 6 条摘要 + 常驻 Telegram 轮询 | 退役删除；入口移到 `src/cli.ts`，同步改 `package.json` 的 `start`/`loop` |
| 11 | `src/index.ts` 每源配额 `perSourceCap` | `Math.max(2, Math.ceil(maxPerDigest/2))` 均摊 | **废除均摊语义**。新产线用 persona 的 `maxItems` 上限 + 质量入选比，不设每源下限（DB-03 §2.2：均摊指标是「应付差事」的头号制度根因） |
| 12 | `src/cli.ts` | **不存在** | 新建，见 Task 7。命令：`run --persona=<id>|all [--dry-run]`、`collect`、`doctor` |
| 13 | `package.json` scripts | `start`/`loop` 指向 `dist/index.js` | 改为指向 `dist/cli.js`；`loop` 若失去语义则删除（不留指向不存在行为的脚本） |
| 14 | `tests/telegram.test.ts`（12 用例）、`tests/receiver.test.ts`（9 用例） | 存在 | **删除两文件**（被测对象已退役）。`tests/wiring.test.ts`(4)、`tests/lifecycle.test.ts`(1)、`tests/e2e.test.ts`(10)、`tests/startup.test.ts`(6)、`tests/evidence-script.test.ts`(10) 中涉及 Telegram/runOnce 的用例**逐个改写或删除**，不得为了凑绿写成永真断言 |
| 15 | `tests/gates.test.ts` 的「已知缺陷：jaccard 聚不拢真实洗稿标题」用例 | 断言 `eventCount === 4`（缺陷钉子） | Task 2 完成后**改写**为断言实体词聚类的正确行为（见 §二.5），保留注释里的实测数据作为依据 |
| 16 | `scripts/gen-evidence.mjs` | 读 `memory/views.json` 算 G-1/P-1/I-2 | **本轮不改**。Telegram 退役后这些判据必然 `nodata`，在 `docs/probe-verdict-criteria.md` 顶部加冻结声明即可（见 Task 8） |
| 17 | 根仓 `docs/tool-plans/archive/2026-09-04-shadow-pipeline/` | 不存在 | 新建，归档 `/tmp/tuna-feed-run/edit.mjs` + README。注意是**根仓**路径 `/Users/aiatwork/Projects/docs/tool-plans/archive/`，不是 domain-bot 仓 |

---

## 四、已知坑点（均已核实，不是「可能」）

1. **`publishedAt=0` 是常态，不是坏数据**。`src/collector/adapters/agentreach.ts` 的 bili 与 jina 恒返回 `publishedAt: 0`；ytsearch 只在 `upload_date` 是 8 位字符串时才有值。`PersonaGate.check()` 已按「`publishedAt > 0` 才判时效」实现（`src/gates/persona.ts`）——**不要"修"成把 0 当超时**，否则 bili/jina 整源被误杀，且「源没给时间」与「内容过期」在观测上无法区分。

2. **配置正则的 `g` flag 会造成漏判**。`compilePattern()`（`src/gates/textMatch.ts`）已把 flags 白名单限制为 `i/m/s/u`。原因：带 `g` 的 RegExp 复用时 `lastIndex` 前移，同一条规则第二次 `test()` 会返回 false。`tests/gates.test.ts` 有对应用例（连续三次 check 同一条招聘帖）。写 `config/gates.json` 时**不要加 `g`**。

3. **`tokenize()` 会滤掉单字符 token**。`src/collector/dedupe.ts` 是 `.filter((t) => t.length > 1)`，所以 "GPT-6" 规范化后 `6` 被丢弃。实体词聚类（Task 2）依赖 tokenize，别指望单字符实体能参与匹配——"k2" 作为整体 token 是保留的。

4. **CJK 走 2-gram，英文走词边界，两套口径**。`matchesKeyword()`（`src/gates/textMatch.ts`）对含 CJK 的关键词用子串匹配、对纯 ASCII 用 `' '+k+' '` 词边界。这是故意的（`storage` 不得命中 `rag`、`upbeat` 不得命中 `beat`），`tests/refinery.test.ts` 与 `tests/gates.test.ts` 都有覆盖。写关键词表时**中文词不要加空格**。

5. **`src/refinery/filter.ts` 已是 deprecated shim，不要往里加逻辑**。它的 `isRelevant`/`filterRelevant` 就是 DB-03 批的「假闸门」（命中任一关键词即通过），保留只为 `tests/refinery.test.ts` 的词边界覆盖不断供。新代码一律走 `src/gates/`。

6. **`npm test` 后禁止直接接管道**。`npm test | tail` 的退出码是 `tail` 的 0，会完全吞掉测试失败（fati-server `6e6797e` 曾因此带入类型错误）。必须 `set -o pipefail` 或先重定向：`npm test > /tmp/t.log 2>&1; echo "exit=$?"`。

7. **`memory/` 里有真实数据，别当测试夹具写坏**。`memory/archive.json`（61KB）、`digests.json`、`observations.jsonl`、`interest.json`、`views.json`、`engagements.json` 是 09-01 至 09-04 的实跑产物。测试一律用 `mkdtemp` 建临时目录（参照 `tests/store.test.ts` 的写法），**不得读写仓库内 `memory/`**。

8. **`outbox/tuna/tuna-feed-200.json` 文件名已过期**，实际 172 条，且已作为「信息流 v2 存档」入库（commit `ad6687e`）。**不要改它、不要删它**——它是审计证据。新产线输出到 `outbox/tuna/feed-pack-<persona>-<id>.json`（Task 5），文件名带 persona 与 digestId。

9. **`docs/newsroom-board.md` 已标「终止并取消编辑部每日排期」**（commit `68f7989`，老张 09-04 指令），看板保留为第一期审计记录。Task 4 的质量看板落 `evidence/feed-quality-<ts>.json`（机器可读），**不要往 `docs/newsroom-board.md` 追加新期**——那会违反老张的终止指令。

10. **本机 `127.0.0.1:8052` 的 nous-proxy 会改写 model 参数**。传 `qwen3.7-plus`/`stealth/ox-alpha`/`muse-spark-1.2-contributor-free` 三个不同 model 名，返回的 `model` 字段实测**全是 `meituan/longcat-2.0:free`**。DB-05 接编辑部时不能靠 model 参数选模型。本工单不涉及 LLM，但别在配置里假设 model 名生效。

11. **tuna 仓不要碰**。本工单范围只在 domain-bot 仓 + 根仓 `docs/tool-plans/archive/`。tuna 侧三项（native 持久化 / postId 信号导出 / LocalBriefNormalizer 接线）属 DB-06，且 tuna 由老张督阵会话推进（根仓 AGENTS.md「分工现状」）。

---

## 五、硬约束（违反即退回）

- [ ] **禁止 commit / push**（DISPATCH-RULES §三.4：入库归总管）。改动留在工作区，由总管验收后提交。
- [ ] **禁止新增运行时依赖**。`package.json` 的 `dependencies` 现在只有 `fast-xml-parser` 一个，必须保持。并查集、实体词聚类全部手写（工作量 <30 行，引依赖是净负收益）。
- [ ] 验证命令后**禁止直接接管道**（见坑点 6）。
- [ ] 不得修改与本工单无关的文件。**特别地：不得改 `outbox/`、`memory/`、`docs/tasks/TASK-DB-0[123]*`、`docs/probe-verdict-criteria.md` 的判据内容**（只允许在 criteria 顶部加冻结声明，见 Task 8）。
- [ ] 不得改 `tests/gates.test.ts` 里标了「缺陷钉子（不得删）」的注释块所附的实测数据；改写该用例时保留数据、只改断言。
- [ ] **不得引入 LLM 调用**。本工单是无 LLM 依赖的止血阶段；AI 编辑部属 DB-05。
- [ ] 不得为了凑绿写永真断言，也不得 mock 掉被测目标本身（codex「自制沙箱假通过」教训，见 `fati/docs/handoff-report-2026-08-25.md` §四）。
- [ ] 每个 Task 完成后**立即**跑 `npm run typecheck` 与 `npm test`，不得攒到最后一起跑（攒到一起会导致失败无法归因到 Task）。

---

## 六、自测要求

### 6.1 每个 Task 的验证命令

```bash
cd /Users/aiatwork/Projects/domain-bot
set -o pipefail
npm run typecheck > /tmp/tc.log 2>&1; echo "typecheck exit=$?"
npm test > /tmp/t.log 2>&1; echo "test exit=$?"; tail -6 /tmp/t.log
```

期望：两个 exit 都是 `0`。基线是 `typecheck exit=0` + `npm test` **191/191**。

### 6.2 必须新增的测试文件与断言

**`tests/gatekeeper.test.ts`**（Task 4）——十条硬断言**各造一个违例样本**，逐个断言被否决：

| 断言 | 违例样本构造 | 期望 |
|---|---|---|
| 坏数据 = 0 | `summary` 含 `[object Object]` | 否决，`ruleId` 含 `damaged` |
| 规范 URL 唯一 | 两条 `url` 分别为 `https://ex.com/a` 与 `https://ex.com/a?utm_source=x` | 否决第二条，`ruleId` 含 `duplicate` |
| 不在已发布指纹库 | 候选 URL 已在 `memory/published-fingerprints.json` | 否决，`ruleId` 含 `alreadyPublished` |
| 机械截断 = 0 | `hooks[0]` 是 `title` 的前缀截断（`title.slice(0,70)+'…'`） | 否决，`ruleId` 含 `mechanicalTruncation` |
| 碎片钩子 = 0 | `hooks[1] === 'arXiv:2609.'` | 否决，`ruleId` 含 `fragmentHook` |
| 浮点回显 = 0 | `why === 'AI深度思想·rss：价值 0.94'` | 否决，`ruleId` 含 `scoreEcho` |
| 黑名单零命中 | 终审阶段正文含「注册送 $1」 | 否决（终审复跑门禁 1，防编辑环节引入） |
| 钩子实体校验 | `hooks` 三条全是不含原文任何实体词的泛化问句（如 `Is the data reliable?`） | 否决，`ruleId` 含 `hookEntity` |
| 时效 | newsline 条目 `publishedAt` 距今 100h | 否决，`ruleId` 含 `tooOld` |
| 字段完整与限长 | `hooks` 只有 2 条 / 有重复 / zh 超 70 码点；`summary` zh 超 300；`why` 超 40 | 否决，`ruleId` 指明具体字段 |

另需断言 **递补正确**：候补池 5 条、主池 3 条其中 1 条被否决 → 产出仍为 3 条，且递补进来的是候补池里排序最前的那条；**递补进来的条目必须重跑十条断言**（否则候补池里的垃圾会补进坑）。

**`tests/pipeline.test.ts`**（Task 3）——必须包含：

- **聚类先于配额**：构造 8 条同一事件的报道 + 2 条独立事件，persona `maxItems=4`，断言产出里同事件**最多占 `maxPerEvent`（=2）个坑**、独立事件**至少 2 条入选**。这条直接钉死旧管线的顺序缺陷。
- **双产线源白名单互不越界**：同一批候选跑两个 persona，断言 newsline 产出不含 deepthought 独占源（如 `arxiv-cs-ai`）的条目，反之亦然。
- **跨产线指纹共享**：先跑 newsline 并写入 `published-fingerprints.json`，再跑 deepthought，断言同一 URL 的条目在 deepthought 侧被否决。
- **废除均摊**：某源产出 50 条高质量、另一源产出 0 条，断言前者可以占满 `maxItems`（不设每源下限），且看板记录后者为 `zeroYield` 而非报错。

**`tests/cli.test.ts`**（Task 7）——断言 `config/gates.json` 含非法正则时 CLI **非零退出**且 stderr 含出错 `ruleId`（对应 §二.8）。

**`tests/pipeline-quality.test.ts`**（Task 8）——内容质量回归，堵 149 测试的盲区：

- 夹具：把 `/tmp/tuna-feed-run/raw/` 的真实采集数据**筛一份子集**（建议 `rss-arxiv-csai.xml` + `gh-repos.json` + `v2ex-node-ai.json`，控制在 200KB 内）存进 `tests/fixtures/raw/`，附上 DB-03 §1.2 剔除清单里**至少 15 条真实垃圾**的标题/URL（招聘帖、`[object Object]`、卖课、自行车码表、2024 旧闻、Astra 重复组）作为 `tests/fixtures/known-bad.json`。
- 断言：跑完整产线后，`known-bad.json` 里的条目**一条都不在产出中**；产出中 `[object Object]` 计数 = 0、规范 URL 重复 = 0、机械截断钩子 = 0、浮点回显 why = 0。
- **夹具必须是真实数据，不得用合成玩具串**——闸门要拦的就是那 65 条，拿玩具串测等于没测。

### 6.3 变异测试（必做，写进报告）

DISPATCH-RULES §三.1：总管验收会**打开测试文件读断言本身**，确认改坏输入能让它变红。你自己先做一遍并在报告里贴输出。对**至少 3 条不同的终审断言**各做一次变异（建议：机械截断、浮点回显、时效），模式如下：

```bash
cd /Users/aiatwork/Projects/domain-bot
cp src/gatekeeper/assertions.ts /tmp/as.bak
# 变异：把某条断言改成恒过（示意，按你实际实现的函数名/返回结构调整）
perl -pi -e 's/ruleId: "gk:mechanicalTruncation", ok: false/ruleId: "gk:mechanicalTruncation", ok: true/' src/gatekeeper/assertions.ts
npm test > /tmp/mut.log 2>&1; echo "变异后 exit=$?（必须非 0）"; rg -n "× " /tmp/mut.log | head -5
cp /tmp/as.bak src/gatekeeper/assertions.ts
npm test > /tmp/mut2.log 2>&1; echo "还原后 exit=$?（必须为 0）"; tail -4 /tmp/mut2.log
```

报告里贴三次变异各自打红了哪个用例。**若某条断言变异后测试仍全绿 → 该断言没有测试覆盖，必须补。**

### 6.4 自测标记

报告末尾输出 `ALL_DB04_PASS`。**但注意**：只输出标记而无 §6.3 变异测试输出的，视为未通过（DISPATCH-RULES §三.1）。

---

## 七、交付物

1. **代码改动（未 commit）**，按 §三 落点表逐项对应。
2. **自测报告**，落盘 `docs/tasks/TASK-DB-04-pipeline-consolidation-done.md`，含：
   - 改了哪些文件（绝对路径清单）
   - 新增哪些测试文件、各多少用例、关键断言摘录
   - `npm run typecheck` 与 `npm test` 的完整尾部输出 + exit code
   - **§6.3 三次变异测试的实际输出**（哪条断言变异后打红了哪个用例）
   - 一次真实产线跑批的漏斗数据（`collected → afterGates → afterEventCap → afterGatekeeper → published` 各多少条），两个 persona 各一份
   - Task 6 Step 1 的 Telegram 引用点全量清单（作为「删除范围已全量清点、零抽样」的实证）
   - 末尾附 DISPATCH-RULES §8.2 的**完成署名块**（工单号 / 执行通道 / 执行人标识 / 完成日期 / 派单基线 HEAD / 实际落盘 HEAD / 验证 / 自测标记 / 改动文件 / 关联台账更新 / 遗留风险）
3. **若发现本工单描述与代码不符：明确指出并说明依据（路径 + 行号），不要将错就错。** 特别是 §三 的行号——基线之后若有其他会话提交，行号会漂，以实际读到的代码为准并在报告里记一笔。

---

## 八、禁止事项

- 禁止自制沙箱短路（永真断言 / mock 掉被测目标本身 / 把自己的输出当期望值）。
- 禁止顺手重构无关代码（`src/memory/*`、`src/collector/adapters/fetchUtil.ts`、`src/runtime/*` 本工单一律不碰，`doctor.ts` 仅按 Task 6 Step 3 增删自检项）。
- 禁止在报告中声称"已验证"你实际未运行验证的项。
- 禁止实现 DB-03 §3.2 的 jaccard 门禁 3（已实测推翻，见 §〇.2）。
- 禁止改 `docs/probe-verdict-criteria.md` 的判据内容（只允许顶部加冻结声明）。
- 禁止往 `docs/newsroom-board.md` 追加新期（老张已终止每日排期，commit `68f7989`）。
- 禁止碰 tuna 仓。
- 禁止 commit / push。

---

## 九、Task 分解

> 顺序有依赖，不要跳着做：Task 1（配置）→ 2（聚类）→ 3（编排）→ 4（终审）→ 5（发布）→ 6（退役 Telegram）→ 7（CLI + 归档）→ 8（质量回归 + 台账）。
> 每个 Task 收尾必跑 §6.1，两个 exit 均为 0 才进下一个。

### Task 1：配置文件（闸门接上电）

**Files:** 新建 `config/gates.json`、`config/personas/newsline.json`、`config/personas/deepthought.json`、`tests/config.test.ts`；改 `config/domain.json`、`src/types.ts`（`GatesConfig.dedupe` 加 `eventStopwords`）。

- [ ] **Step 1：先写失败测试** `tests/config.test.ts`，断言：
  - 三个配置文件存在且可 `JSON.parse`；
  - `gates.minPoints === 3`；`keywordTiers` 里 `generic` 档 `points === 0`（这是「单凭泛词永不通过」的配置侧守卫）；
  - `blacklist` 每条都有 `id`/`group`/`pattern`，且 `pattern` 能被 `compilePattern()`（`src/gates/textMatch.ts`）成功编译——**这条就是 §二.8 的守卫**；
  - 两个 persona 的 `sources` 都是 `config/sources.json` 里真实存在的 id（防白名单写成不存在的源 → 产线静默零产出）；
  - `newsline.maxAgeHours === 72`、`deepthought.maxAgeHours === 720`；两者 `sources` **交集为空**（双产线彻底分离）。

- [ ] **Step 2：跑测试确认失败**（文件不存在）。

- [ ] **Step 3：写 `config/gates.json`**。词表来源：`config/domain.json` 现有 23 个 keywords 按三档重新归类；黑名单来源：`/tmp/tuna-feed-run/edit.mjs` 的 `TITLE_BLACKLIST` + DB-03 §3.2 门禁 1 四组规则 + §1.2 剔除清单的实际剔除原因。下列一条不能少（可自行补充）：

```json
{
  "minTitleChars": 15,
  "minPoints": 3,
  "strongAiWords": ["llm", "large language model", "transformer", "gpt", "claude", "gemini", "deepseek", "qwen", "llama", "大模型", "智能体", "推理模型"],
  "keywordTiers": [
    { "tier": "core", "points": 3, "words": ["llm", "large language model", "ai agent", "inference", "transformer", "benchmark", "fine-tune", "fine-tuning", "rag", "retrieval", "quantization", "reasoning model", "tokenizer", "multimodal", "on-device ai", "edge ai", "kv cache", "moe", "mcp", "vlm", "serving", "embedding", "大模型", "智能体", "推理模型", "多模态", "端侧"] },
    { "tier": "ecosystem", "points": 1, "words": ["open source", "开源", "api", "prompt", "dataset", "evaluation", "architecture", "optimization", "release", "sota", "state-of-the-art", "outperform", "breakthrough", "人工智能", "机器学习", "深度学习", "神经网络"] },
    { "tier": "generic", "points": 0, "words": ["ai", "model", "neural", "tool", "technology"] }
  ],
  "blacklist": [
    { "id": "ad:recruit", "group": "adRecruit", "pattern": "招聘|求职|兼职|招全栈|hiring|we are hiring|join our team", "scope": "both" },
    { "id": "ad:relay", "group": "adRecruit", "pattern": "中转站|注册送|代充|限时优惠|api 中转", "scope": "both" },
    { "id": "ad:course", "group": "adRecruit", "pattern": "零基础|小白|保姆级|学完即就业|全网最全|入门教程|基础班|小学生|少儿|培训班|点赞收藏", "scope": "title" },
    { "id": "ad:resume", "group": "adRecruit", "pattern": "portfolio|internship|homework|exam|笔试|简历|面试练习|profile for", "scope": "title" },
    { "id": "damaged:objectObject", "group": "damaged", "pattern": "\\[object Object\\]", "scope": "both" },
    { "id": "cross:biomed", "group": "crossDomain", "pattern": "pathogen|antimicrobial|drosophila|molecular diffusion|clinical trial|syndrome|neural crest|reaction-diffusion", "unlessStrongAi": true, "scope": "both" },
    { "id": "nonTech:hardware", "group": "nonTech", "pattern": "bike computer|eink bike|自行车码表", "scope": "title" },
    { "id": "nonTech:chitchat", "group": "nonTech", "pattern": "是不是一个常用语|自救群|拉群|互助群|额度已经消耗完", "scope": "title" }
  ],
  "dedupe": {
    "jaccardThreshold": 0.75,
    "maxPerEvent": 2,
    "eventStopwords": ["openai", "anthropic", "google", "microsoft", "meta", "model", "models", "ai", "new", "launches", "launch", "release", "released", "the", "of", "for", "and", "is", "are", "says", "said", "with", "gpt", "llm", "big", "next", "has", "have", "its", "over", "most", "era", "artificial", "general", "intelligence", "powerful", "chat", "chatgpt", "rivals", "all", "more", "than", "built", "scrutiny", "growing", "amid", "unveils", "hails", "introducing", "overview", "a", "an", "in", "on", "to", "it", "at", "from", "by", "this", "that", "how", "what", "why", "when", "大模型", "人工智能", "发布", "开源", "模型", "全新", "正式", "来了", "一次", "看完"]
  }
}
```

  ⚠️ `eventStopwords` 是 Task 2 实体词聚类的**必需输入，不是可选装饰**。上面这份是从 §〇.2 的实测里跑出来的（实测时用的 STOP 表见该节，结果 Astra 8/10、K2 5/5、干扰项零误并）。可以扩充，但扩充后**必须重跑 Task 2 Step 6 的验证脚本确认召回没退化**。

  ⚠️ 注意 JSON 里正则的反斜杠要双写（`\\[object Object\\]`）。写完用 Step 1 的 `compilePattern` 测试实际编译一遍，**别靠肉眼**。

- [ ] **Step 4：写两个 persona 配置**。信源白名单按 DB-03 §3.1 六渠道方案 + §3.5 双 bot 质量下限表分配：

```json
{
  "id": "newsline",
  "displayName": "AI时事快线",
  "domain": "ai-llm",
  "sources": ["hn-frontpage", "exa-llm-news", "exa-agent-releases", "openai-news", "anthropic-research", "github-new-llm-tools", "v2ex-hot"],
  "maxAgeHours": 72,
  "maxItems": 80,
  "minQualityScore": 6,
  "clusterThreshold": 0.35,
  "rejectRules": [
    { "id": "clickbait", "pattern": "全网彻底炸锅|神级案例|彻底疯了|震惊|炸裂|王炸" },
    { "id": "unsourced", "pattern": "传闻|据说|爆料|消息称|知情人士" },
    { "id": "training", "pattern": "培训|课程|报名|学费|就业班" }
  ]
}
```

```json
{
  "id": "deepthought",
  "displayName": "AI深度思想",
  "domain": "ai-llm",
  "sources": ["arxiv-cs-ai", "huggingface-blog", "simonwillison", "hf-daily-papers", "github-agents", "github-rag", "yt-llm", "bili-llm"],
  "maxAgeHours": 720,
  "maxItems": 120,
  "minQualityScore": 7,
  "clusterThreshold": 0.35,
  "rejectRules": [
    { "id": "nameExplainer", "pattern": "^what is|^什么是|simple explanation|explained for beginners|key concepts explained" },
    { "id": "hollowOpinion", "pattern": "我的想法|一点感想|随便聊聊|个人看法" }
  ]
}
```

  `maxItems` 80/120 的依据：`docs/newsroom-board.md` 第一期人肉分类结果是「深度思想 103 / 时事快线 69」，取整到 80/120 作为**上限**（不是配额，凑不满就是凑不满）。

  ⚠️ `sources` 里的 id 必须在 `config/sources.json` 真实存在。注意 `v2ex-hot`、`bili-llm`、`jiqizhixin`、`qbitai`、`exa-cn-ai` 当前是 `"enabled": false`——**不要为了让白名单好看而改它们的 enabled**，那是另一个决策（根仓 `docs/reviews/2026-09-04-domain-bot-48h-review-and-launch-plan.md` §六 决策 2 建议探针期禁用 v2ex/bili）。Step 1 的测试要断言「白名单 id 存在于 sources.json」而**不是**「白名单 id 都 enabled」。

- [ ] **Step 5：改 `config/domain.json`**——删 `scoreThreshold` 与 `maxPerDigest` 两行，保留 `domain`/`keywords`/`signalWords`/`clusterThreshold`。同步在 `src/types.ts` 做两处改动：
  1. `GatesConfig.dedupe` 加 `eventStopwords: string[]`（Task 2 用）；
  2. **新增 `GatekeeperInput` 类型**（Task 3/4/5 均引用，故必须在本 Task 先定义，不得留到 Task 4 再补——否则 Task 3 会引用一个尚不存在的类型）：

```ts
/**
 * 主编终审与发布共用的「渲染后条目」形状。
 * 与 ScoredItem 的区别：ScoredItem 是采集/打分阶段的原始条目（title/body/url/valueScore），
 * GatekeeperInput 是面向读者的渲染产物（hooks/summary/why/lang）。
 * 终审十条断言全部作用于本类型——机械截断/碎片钩子/浮点回显 这三类缺陷
 * 只有在渲染后才存在，对 ScoredItem 断言无意义。
 */
export interface GatekeeperInput {
  /** 稳定 id，格式 `domain-bot-<persona>:<digestId>:<index>`（Task 5 Step 3 的正则约束） */
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
  /** 事件簇标识（Task 2 聚类产物），供 gk:eventOversubscribed 跨条目断言使用 */
  eventKey: string
}
```

- [ ] **Step 6：跑 §6.1。** 注意 `tests/gates.test.ts` 用的是文件内联的 `gates` 夹具（不读 config），所以不会因为新配置文件而变红；若变红说明你改坏了内联夹具。

### Task 2：实体词并查集事件聚类（替换 jaccard 主判据）

**Files:** 新建 `src/gates/eventCluster.ts`、`tests/eventCluster.test.ts`、`scripts/probe-event-cluster.mjs`；改 `src/gates/fingerprint.ts` 的 `capEvents()`、`tests/gates.test.ts` 的钉子用例。

- [ ] **Step 1：先写失败测试** `tests/eventCluster.test.ts`。用 §〇.2 的**真实数据**作夹具（Astra 10 条 + 3 条干扰项、K2 Horizon 5 条），断言：
  - Astra 10 条 + 3 干扰项 → 最大簇 **≥8 条**，且该簇含全部 8 条带 "Astra" 字样的标题；3 条干扰项（KC-Bench / FlashInfer / Microsoft Agent Framework）**各自独立成簇**；
  - K2 Horizon 5 条 → **聚成 1 簇**（含那条不含 "Horizon" 的 `Institute of Foundation Models Launches the Industry's Largest Open Model`）；
  - `eventStopwords` 里的词单独出现**不构成聚类依据**：两条只共享 `openai`+`model` 的不同事件标题必须**不**被并到一起。

- [ ] **Step 2：跑测试确认失败**（`eventCluster.ts` 不存在）。

- [ ] **Step 3：实现 `src/gates/eventCluster.ts`**。算法（实测验证过的版本）：

```
entityTokens(item) = tokenize(item.title) 去掉 eventStopwords、去掉长度 ≤2 的 token

clusterByEntity(items, stopwords):
  并查集，parent[i] = i
  find(i): 路径压缩 —— parent[i] === i ? i : (parent[i] = find(parent[i]))
  union(a, b): parent[find(a)] = find(b)
  对每对 (i, j)，i < j：若 entityTokens(i) ∩ entityTokens(j) ≠ ∅ 则 union(i, j)
  返回按根分组的簇（保持输入顺序稳定）
```

  实现要点：
  - **必须复用 `tokenize()`**（`src/collector/dedupe.ts`），不要自己写分词——CJK 2-gram 行为在那里，重写会造成中英文口径分裂。
  - 交集判定用 `Set`，不用数组 `includes`。
  - 并查集用路径压缩。1000 条量级 O(n²) 配对可接受（实测 1396 条采集 → 闸门后约 700 条，配对约 24 万次纯 Set 交集，毫秒级）。**若实测超过 2 秒再优化，不要预先优化**（YAGNI）。
  - 导出签名建议：`export function entityTokens(title: string, stopwords: ReadonlySet<string>): Set<string>` 与 `export function clusterByEntity<T extends { title: string }>(items: T[], stopwords: ReadonlySet<string>): T[][]`。Task 4 的 `gk:hookEntity` 断言要复用 `entityTokens`，所以它必须导出。

- [ ] **Step 4：改 `capEvents()`**——主判据换成 `clusterByEntity`，jaccard 降级为补充判据（同簇内若两条标题 jaccard ≥ `jaccardThreshold`，视为同一通稿原样转发，合并计 1 个坑而非 2 个）。

  **返回类型必须扩展（不得保持不变）**：原 `EventCapResult<T>` 只有 `kept`/`dropped`/`eventCount`，**没携带「每条 kept 属于哪个事件簇」**。但 Task 4 的 `gk:eventOversubscribed` 断言与 `GatekeeperInput.eventKey` 都靠这个信息，不扩展就会在 Task 3 Step 9 断数据流。新形状：

```ts
export interface EventCapResult<T> {
  kept: T[]
  dropped: DropRecord[]
  /** 独立事件数（看板用） */
  eventCount: number
  /**
   * 每条 kept 归属的事件簇标识（按 item.id 索引）。
   * 取值：簇内最高分那条的 id（簇代表），同簇所有条目得同一值。
   * 用 item.id 而非数组下标做键：下游经过排序/截断/递补后下标会变，id 不会。
   */
  eventKeyOf: Map<string, string>
}
```

  相应地，`tests/gates.test.ts` 里现有两个 `capEvents` 用例（「保留每事件分最高的 maxPerEvent 条」与 Task 2 Step 5 改写后的钉子用例）**必须加断言**：`eventKeyOf.size === kept.length`，且同簇条目的 `eventKeyOf` 值相等、不同簇不等。否则这个新字段就是无测试覆盖的装饰。

- [ ] **Step 5：改写 `tests/gates.test.ts` 的钉子用例**「已知缺陷：jaccard 聚不拢真实洗稿标题」→ 改名「实体词聚类聚拢真实洗稿标题（jaccard 做不到）」，断言改为 `eventCount === 1`、`kept.length === maxPerEvent`（=2）、`dropped.length === 2`。**保留注释里 §〇.2 的实测数据表**（0.313 / 0.105 / ≥0.75 命中 0），那是这条改动的依据，删了就变成无实证的断言（DISPATCH-RULES §二 约束 1）。

- [ ] **Step 6：把验证脚本存盘** `scripts/probe-event-cluster.mjs`，内容为 §〇.2 那两段实测（jaccard 对照 + 实体词聚类），可 `node scripts/probe-event-cluster.mjs` 复算。这样任何人质疑阈值时能自己跑一遍，不用信报告。在 `package.json` 加 script `probe:events`。

- [ ] **Step 7：跑 §6.1 + 跑 `node scripts/probe-event-cluster.mjs`**，把输出贴进报告。

### Task 3：`src/pipeline.ts` 双产线编排

**Files:** 新建 `src/pipeline.ts`、`tests/pipeline.test.ts`。

- [ ] **Step 1：先写失败测试** `tests/pipeline.test.ts`，四条断言见 §6.2（聚类先于配额 / 双产线源白名单互不越界 / 跨产线指纹共享 / 废除均摊）。用 `mkdtemp` 建临时 memoryDir（坑点 7）。采集层用注入的 `fetchFn`/`spawnFn` 替身（参照 `tests/e2e.test.ts` 现有写法），**不得真联网**。

- [ ] **Step 2：跑测试确认失败。**

- [ ] **Step 3：实现 `src/pipeline.ts`**。签名：

```ts
export interface PipelineOptions {
  persona: PersonaConfig
  gates: GatesConfig
  domain: DomainConfig
  sources: SourceConfig[]          // 全量源表；persona.sources 做白名单筛选
  memoryDir: string
  outDir?: string
  fetchFn?: FetchFn
  spawnFn?: SpawnFn
  now?: number
  /** 已发布指纹库（跨产线共享），由 publish 步骤写入、下一轮读入 */
  knownCanonical?: ReadonlySet<string>
}

export interface PipelineResult {
  persona: string
  candidates: ScoredItem[]         // 过闸门 + 打分后、事件聚合前
  events: number                   // 独立事件数（= capEvents 返回的 eventCount）
  selected: ScoredItem[]           // 事件聚合 + maxItems 截断后，进主编终审
  backfillPool: ScoredItem[]       // 被 maxItems 截掉的，供终审递补
  published: GatekeeperInput[]     // 渲染 → 过终审 → 递补后的最终产出（类型见 Task 1 Step 5）
  funnel: Array<{ stage: string; count: number }>   // collected→afterDedupe→afterGates→afterEventCap→afterGatekeeper→published
  dropped: DropRecord[]
  skippedSources: string[]
  zeroYieldSources: string[]
}

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult>
```

  **执行顺序（这个顺序本身就是本 Task 的核心，不要调换）**：
  1. 采集：遍历 `sources.filter(s => s.enabled && persona.sources.includes(s.id))`，单源失败不阻塞，记入 `skippedSources`（沿用 `src/index.ts` 现有采集循环的模式与注释理由）。
  2. `dedupe(collected, store.knownIds())`（`src/collector/dedupe.ts`）——精确 id 去重，跨轮次。
  3. `runGates(kept, { persona, gates, now, knownCanonical })`——四层闸门。
  4. **`compileErrors` 非空即抛错**（§二.8：配置写错不得静默）。错误信息必须含出错的 `gate` 与 `ruleId`。
  5. 打分：`makeScorerFromEnv()`（`src/refinery/scorer.ts`）。**本工单不接 LLM**，env 未配则自动走 `HeuristicScorer`，这是预期行为。
  6. 源权重 + 新颖性：沿用 `applySourceWeight` / `applyNovelty`（`src/memory/evolve.ts`），以及 `src/index.ts` 里「过滤用原始分、排序用加权分」的纪律与其注释（防反馈死锁：低权源被整体挡在候选池外 → 永远进不了推送 → 永远拿不到反馈 → 权重再也回不来）——**照搬那两段注释的理由，不要简化掉**。
  7. **`capEvents(ranked, gates)`** ← 必须在 `maxItems` 截断之前。这是本 Task 存在的理由。接住返回的 `eventKeyOf`（Task 2 Step 4 新增字段），后续渲染时按 `item.id` 查出 `eventKey` 传给 `renderPost()` 的 `ctx`——**这条数据流不得断**，断了 Task 4 的 `gk:eventOversubscribed` 就无从判定。
  8. `maxItems` 截断（persona 上限，**无每源下限**）；被截掉的进 `backfillPool`。
  9. **渲染 → 主编终审 → 递补**：先用 Task 4 的 `renderPost()` 把 `selected` 渲染为 `GatekeeperInput[]`（本工单无 LLM，渲染走 `src/push/tuna.ts` 的机械兜底），再跑十条断言，被否决的从 `backfillPool` 递补（递补项同样先渲染再过断言）。**渲染必须在终审之前**——机械截断/碎片钩子/浮点回显 这三类缺陷只在渲染后才存在。
  10. 归档：`store.recordItems(全部候选)` + `store.markPushed(实际发布)`，沿用 `src/index.ts` 的「解传送带」两步分离纪律（归档口径是全量候选而非推送条目，否则去重库只屏蔽推过的 N 条，同一批源内容被逐轮消费，推送质量单调衰减）。
  11. `observeRound` + `appendObservation`（`src/memory/observe.ts`），`skippedSources` 必填（否则「源挂掉」与「内容池枯竭」在观测上无法区分）。
  12. 返回 `PipelineResult`。

- [ ] **Step 4：跑 §6.1，两个 exit 为 0。**

### Task 4：`src/gatekeeper/` 渲染 + 主编终审

**Files:** 新建 `src/gatekeeper/render.ts`、`assertions.ts`、`backfill.ts`、`board.ts`、`index.ts`、`tests/gatekeeper.test.ts`。

- [ ] **Step 1：先写失败测试** `tests/gatekeeper.test.ts`，十条断言各一个违例样本 + 递补正确性，见 §6.2 的表格。

- [ ] **Step 2：跑测试确认失败。**

- [ ] **Step 3：实现 `render.ts`**——把 `ScoredItem` 渲染为 `GatekeeperInput`（类型已在 Task 1 Step 5 定义）：

```ts
export function renderPost(
  item: ScoredItem,
  ctx: { persona: PersonaConfig; digestId: string; index: number; eventKey: string },
): GatekeeperInput
```

  实现要点：复用 `src/push/tuna.ts` 的 `detectLang()`、`truncateChars()`、`firstSentence()`、`deriveHooks()`（落点 8：`deriveHooks` 已降级为兜底，本工单无 LLM 所以就走它）。`id` 格式见 Task 5 Step 3 的正则约束（`domain-bot-<persona>:<digestId>:<index>`）。`summary` 取 `item.body || item.title` 并按 `SUMMARY_MAX[lang]` 截断；`why` 取 `item.reason` 并按 40 码点截断。

  ⚠️ **渲染完很可能过不了 Step 4 的断言**（`deriveHooks` 就是 DB-03 批的机械截断，会直接触 `gk:mechanicalTruncation`）。**这是预期的，也是落点 8 要求「若现有实现过不了断言，改它」的意思**。改 `deriveHooks` 的方向：三条 hook 不得是 title 的前缀截断（改为取正文不同句/不同侧面），且不得产出少于 12 码点的碎片。改完必须保证 `tests/tuna.test.ts`（6 用例）仍绿——那个文件测的是 `renderTunaBrief` 的输出形状与限长，不是钩子具体内容；若它的断言与新钩子行为相冲，逐条读清楚再改，**不得直接删用例**。

- [ ] **Step 4：实现 `assertions.ts`**。每条断言返回 `{ ok: boolean; ruleId: string; detail: string }`，签名：

```ts
export interface AssertionInput {
  persona: PersonaConfig
  gates: GatesConfig
  now: number
  knownCanonical: ReadonlySet<string>
  /** 同批全部条目，供跨条目断言（URL 唯一、同事件占位）使用 */
  batch: Array<{ url: string }>
}

export function runAssertions(
  item: GatekeeperInput,
  input: AssertionInput,
): Array<{ ok: boolean; ruleId: string; detail: string }>
```

  `GatekeeperInput` 是待发布的渲染后条目（含 `title`/`hooks`/`summary`/`body`/`why`/`url`/`lang`/`publishedAt`）。十条断言的判据（**全部客观可判定，禁止引入 LLM 打分**）：

  | ruleId | 判据 |
  |---|---|
  | `gk:damagedBody` | `summary`/`body`/`title` 不含 `[object Object]`（复跑门禁 1 的 damaged 组） |
  | `gk:duplicateUrl` | 规范 URL 在 `batch` 内唯一 |
  | `gk:alreadyPublished` | 规范 URL 不在 `knownCanonical` |
  | `gk:mechanicalTruncation` | 任一 hook 不得是 `title` 的前缀截断。判据：`title.startsWith(hook.replace(/…$/, ''))` 且 hook 码点数 ≥ `title` 码点数的 0.6 → 否决 |
  | `gk:fragmentHook` | 任一 hook 不得匹配 `/^arxiv:\d+\.?/i`，且 hook 码点数 ≥ 12（DB-03 实测 `"arXiv:2609."` 只有 11 字符） |
  | `gk:scoreEcho` | `why` 不匹配 `/价值\s*\d\.\d/` 也不匹配 `/\d\.\d{2}/`（内部浮点数回显） |
  | `gk:blacklistRecheck` | 终审复跑 `BlacklistGate.check()`（防编辑环节引入新的违规文本） |
  | `gk:hookEntity` | 每个 hook 必须命中原文至少一个实体词：用 Task 2 的 `entityTokens()` 对 `title + body` 取实体集，hook 的实体集与之交集非空。借鉴 tuna commit `11477b0` 的相关性契约——泛化问句（`Is the data reliable?`）自然被滤除 |
  | `gk:tooOld` | 复跑 persona 时效约束（终审再验一次，防上游漏判） |
  | `gk:shapeViolation` | hooks 恰 3 条且互异、zh ≤70 / en ≤95 码点；summary zh ≤300 / en ≤450；why ≤40。限长常量**沿用 `src/push/tuna.ts` 的 `HOOK_LIMITS`/`SUMMARY_MAX`**，不要另立一套数字（tuna 侧 commit `5fca284` 刚同步过 zh70/en95，两处不一致会重现残字问题） |

  另加一条跨条目断言（不属于单条 `runAssertions`，单独导出）：`gk:eventOversubscribed`——按 `GatekeeperInput.eventKey` 分组，同一事件簇在最终产出中占位 ≤ `maxPerEvent`（Task 2 的聚类结果在终审后再验一次，防递补把同事件补满）。

- [ ] **Step 5：实现 `backfill.ts`**——被否决条目从候补池（Task 3 的 `backfillPool`）按排序递补，杜绝凑数（DB-03 §3.4「动态候补水位线」）。递补流程是「取候补 → `renderPost` → 重跑十条断言」，**不得跳渲染直接入产出**（否则候补池里的垃圾会补进坑），且不得递归无限：候补池耗尽就少发，**宁可少于 maxItems 也不得放垃圾进去**。

- [ ] **Step 6：实现 `board.ts`**——落 `evidence/feed-quality-<persona>-<ts>.json`，含：逐层漏斗绝对数（`collected → afterDedupe → afterGates → afterEventCap → afterGatekeeper → published`）、`dropped` 按 `ruleId` 的计数分布、终审否决按 `ruleId` 的计数、递补条数、候补池耗尽标记、跨产线指纹库大小、`skippedSources`、`zeroYieldSources`，以及一个显式字段 `selfEvolutionActive: false` 与说明「Telegram 已退役，interest/weights 无信号流入，待 DB-06 回流通道」（§一表格里的承诺，不得省）。**不要写 `docs/newsroom-board.md`**（坑点 9）。

- [ ] **Step 7：跑 §6.1 + §6.3 变异测试（至少 3 条断言）。**

### Task 5：`src/publish/pack.ts` 内容包产出

**Files:** 新建 `src/publish/pack.ts`、`tests/publish.test.ts`。

- [ ] **Step 1：先写失败测试**：断言产出 schema 为 `tuna-brief-v1`、`posts[].id` 匹配 tuna 侧正则 `^[a-z0-9-]+:[a-z0-9]+:\d+$`（该正则在 `tuna/packages/feeds/normalizers.ts:370`，**只读参考，不要改 tuna**）、`digestId` 含 persona id、输出路径为 `outbox/tuna/feed-pack-<persona>-<safeId>.json`、`brief.items[].why` ≤40 码点。

- [ ] **Step 2：跑测试确认失败。**

- [ ] **Step 3：实现装配与落盘**——输入是 Task 4 已渲染并已过终审的 `GatekeeperInput[]`，**本 Task 不再做任何渲染或质量判定**（职责边界：渲染与断言归 Task 4，装配与落盘归本 Task；两处都做会造成断言口径漂移）。组装为 `tuna-brief-v1`：顶层 `{ schema, digestId, domain, generatedAt, posts[], brief: { generatedAt, items[] } }`，`posts[]` 直接取 `GatekeeperInput` 的字段，`brief.items[]` 为 `{ postId, why, source: 'static' }`（对齐 `src/push/tuna.ts` 现有 `renderTunaBrief()` 的输出形状）。

  ⚠️ **id 格式是个已核实的坑**：tuna 侧正则 `^[a-z0-9-]+:[a-z0-9]+:\d+$` 只允许**两段冒号**。四段式 `domain-bot:<persona>:<digestId>:<index>` 会校验失败。**用 `domain-bot-<persona>` 作第一段**（连字符，不是冒号），即 `domain-bot-newsline:<digestId>:<index>`；且 `<digestId>` 必须只含 `[a-z0-9]`（参照 `src/push/tuna.ts` 现有 `pushTuna()` 里 `digest.id.replace(/[^a-z0-9]/g, '')` 的做法）。写完**用该正则实测一遍**，别靠推理。

- [ ] **Step 4：实现指纹库写入**——发布成功后把 `collectCanonicalUrls(published)`（`src/gates/fingerprint.ts`）追加进 `memory/published-fingerprints.json`（跨产线共享），带上限裁剪（参照 `src/memory/store.ts` 里 archive 的裁剪写法），写入用原子写（参照 store 现有 `writeFileAtomic`）。`--dry-run` 时**不得写入指纹库也不得写 outbox**。

- [ ] **Step 5：跑 §6.1。**

### Task 6：退役 Telegram 链路

**Files:** 删 `src/push/telegram.ts`、`src/feedback/receiver.ts`、`src/push/file.ts`、`tests/telegram.test.ts`、`tests/receiver.test.ts`；改 `src/index.ts`、`src/runtime/doctor.ts`、`tests/wiring.test.ts`、`tests/lifecycle.test.ts`、`tests/e2e.test.ts`、`tests/startup.test.ts`。

- [ ] **Step 1：先查全部引用点**（用 Grep 工具，**不要用 Bash grep**——DISPATCH-RULES §四.1：本环境 Bash grep 的多关键词 `\|` 转义不可靠、会静默返回零命中）：分别搜 `telegram`、`pollFeedback`、`sendDigestTelegram`、`pushFile`、`receiver`，列出 `src/` 与 `tests/` 的全部命中行。**把这份清单贴进报告**，作为「删除范围已全量清点、零抽样」的实证（DISPATCH-RULES §二 约束 3）。

- [ ] **Step 2：删三个源文件 + 两个测试文件。**

- [ ] **Step 3：改 `src/index.ts`**——`runOnce`/`startBot`/`printBootBanner` 退役，入口移到 `src/cli.ts`（Task 7）。同时删掉 `LEGACY_SCORE_THRESHOLD`/`LEGACY_MAX_PER_DIGEST` 两个兜底常量（它们只为让旧 `runOnce` 编译而存在）。`src/runtime/doctor.ts` 里若有 Telegram 相关自检项，改为检查 `config/gates.json` / `config/personas/*.json` 是否存在且正则可编译（更有用）。

- [ ] **Step 4：改写受影响的测试**。`tests/e2e.test.ts` 现在测的是 `runOnce` 全流程，改为测 `runPipeline`；`tests/startup.test.ts` 的单实例锁用例保留（`acquireLock`/`releaseLock` 仍需要，CLI 并发跑两个 persona 会写同一 memoryDir）、`pollFeedback` 可达性用例删除。**不得为了让文件通过而把它清空成一个 `it('placeholder', () => expect(true).toBe(true))`**——那是永真断言，验收直接退回。`tests/evidence-script.test.ts`（10 用例）测的是 `scripts/gen-evidence.mjs`，该脚本本轮不改，测试**应该保持绿**；若因 `views.json` 不再产生而变红，把用例改成断言 `nodata` 而不是删掉它。

- [ ] **Step 5：跑 §6.1，并确认 §二.6 的零命中断言**：`rg -n "telegram|pollFeedback|sendDigest" src/ --glob '!*.test.ts'` 输出为空（用 Grep 工具复验一次）。

### Task 7：`src/cli.ts` + 影子工序归档

**Files:** 新建 `src/cli.ts`、`tests/cli.test.ts`；改 `package.json`；新建**根仓** `/Users/aiatwork/Projects/docs/tool-plans/archive/2026-09-04-shadow-pipeline/{edit.mjs,README.md}`。

- [ ] **Step 1：先写失败测试** `tests/cli.test.ts`：断言非法正则配置时 CLI 非零退出且 stderr 含 `ruleId`；断言 `--persona` 未知值时报错并列出可选值；断言 `--dry-run` 不写 `outbox/` 也不写 `memory/published-fingerprints.json`。用 `mkdtemp` 造临时配置目录，**不得改仓库内真配置**。

- [ ] **Step 2：跑测试确认失败。**

- [ ] **Step 3：实现 `src/cli.ts`**。命令：
  - `run --persona=<newsline|deepthought|all> [--dry-run] [--now=<ms>]`：跑完整产线（Task 3），打印漏斗，写内容包（Task 5）与质量看板（Task 4）。`--persona=all` 时两条产线**依次**跑，共享同一份 `published-fingerprints.json`（先跑的写入、后跑的读入），跑完打印两包 `posts[].id` 的**交集（必须为空）**，对应 §二.2。
  - `collect --persona=<id>`：只采集 + 过闸门，把候选写 `staging/candidates-<persona>-<ts>.json`（为 DB-05 的分阶段编辑作业预留落点，本轮不实现编辑）。
  - `doctor`：保留现有 `--doctor` 能力（`src/runtime/doctor.ts`），并增检三个配置文件的存在性与正则可编译性。
  - 启动横幅：persona、启用源数、闸门规则数、`compileErrors` 数、LLM 状态（沿用 `printBootBanner` 的口径：`DOMAIN_BOT_LLM_BASE_URL && DOMAIN_BOT_LLM_API_KEY && DOMAIN_BOT_LLM_MODEL` 三者齐备才报 on，否则报 `fallback (heuristic)`；**不要把 `OPENAI_API_KEY` 纳入判定**——那是其他工具的通用变量，纳入会误报）。
  - 保留单实例锁（`acquireLock`/`releaseLock`，`src/runtime/lock.ts`）：`--persona=all` 依次跑两产线写同一 memoryDir，无锁会 last-writer-wins 丢归档。锁必须包在 `try/finally` 里（`src/index.ts` 现有实现已修过这个坑，别退化）。

- [ ] **Step 4：改 `package.json` scripts**：`start` → `npm run build && node --env-file-if-exists=.env dist/cli.js run --persona=all`；`loop` 删除（批产无常驻语义，不留指向不存在行为的脚本）；新增 `probe:events` → `node scripts/probe-event-cluster.mjs`（Task 2）。

- [ ] **Step 5：归档影子工序**（**根仓**路径，不是 domain-bot 仓）：
  ```bash
  mkdir -p /Users/aiatwork/Projects/docs/tool-plans/archive/2026-09-04-shadow-pipeline
  cp /tmp/tuna-feed-run/edit.mjs /Users/aiatwork/Projects/docs/tool-plans/archive/2026-09-04-shadow-pipeline/
  ```
  `README.md` 必须写清三件事（根仓 AGENTS.md「工具产物零容忍」要求每包写清来源与被取代关系）：
  1. **来源**：`/tmp/tuna-feed-run/edit.mjs`，仓库外临时脚本，无版本记录无测试；它 `require('domain-bot/dist/push/tuna.js')` 与 `dist/refinery/scorer.js` 复用生产代码；
  2. **它产出了什么**：`domain-bot/outbox/tuna/tuna-feed-200.json`（实际 172 条，文件名已过期），经人工拷贝进 `tuna/packages/content/data/builtin-pack-ai-feed-v1.json`（id 集合 172/172 实测一致）；
  3. **被谁取代**：DB-04 的 `src/pipeline.ts` + `src/gates/` + `src/gatekeeper/` + `src/publish/`。**不得作为施工依据**。

- [ ] **Step 6：跑 §6.1。**

### Task 8：质量回归测试 + 台账登记

**Files:** 新建 `tests/pipeline-quality.test.ts`、`tests/fixtures/raw/*`、`tests/fixtures/known-bad.json`；改 `docs/probe-verdict-criteria.md`（仅顶部加冻结声明）、`README.md`。

- [ ] **Step 1：建夹具**。从 `/tmp/tuna-feed-run/raw/` 取真实采集数据的子集（建议 `rss-arxiv-csai.xml` + `gh-repos.json` + `v2ex-node-ai.json`，控制在 200KB 内）存 `tests/fixtures/raw/`。从 DB-03 §1.2 的 65 条剔除清单里挑**至少 15 条真实垃圾**写成 `tests/fixtures/known-bad.json`，每条带 `title`/`url`/`reason`（直接拷审计报告里的剔除原因），覆盖六大顽疾：完全重复组（#16/#17 自行车码表、#18/#19 纽约时报）、`[object Object]`（#66/#69）、招聘（#95）、中转站广告（#96）、卖课（#197/#199）、2024 旧闻（#193）、个人简历仓库（#145/#151）、Astra 同事件刷屏组（#153/#156/#157）。

- [ ] **Step 2：先写失败测试** `tests/pipeline-quality.test.ts`：跑完整产线（注入夹具，不联网），断言：
  - `known-bad.json` 里的条目**一条也不在产出中**（按规范 URL 或标题比对）；
  - 产出中 `[object Object]` 计数 = 0、规范 URL 重复 = 0、机械截断钩子 = 0、浮点回显 why = 0（§二.4）；
  - 同一事件簇占位 ≤ `maxPerEvent`；
  - 质量看板 JSON 存在且 `funnel` 逐层递减、各层计数可相加复算（§二.7）。

- [ ] **Step 3：跑测试。** 这一步很可能**不是一次就绿**——夹具是真数据，会暴露闸门词表的真实缺口（某类垃圾没拦住）。**这是预期的，不要为了让它变绿而把夹具换成玩具串**。拦不住就回去补 `config/gates.json` 的规则，并在报告里记下「夹具暴露了哪些缺口、补了哪些规则」——这份清单本身就是交付物。

- [ ] **Step 4：`docs/probe-verdict-criteria.md` 顶部加冻结声明**（不改判据正文）。声明内容必须含：判定线 11 项中 G-1/G-2/G-3/P-1…P-4 与 I-2 依赖 `memory/views.json`，而 `views.json` 的唯一写入方 `src/feedback/receiver.ts` 已随 Telegram 退役而删除（实证：全仓 `store.recordView`/`recordEngagement` 仅在 receiver.ts 被调用），故这些判据自本版本起永久 `nodata`；判定线整体冻结，待 DB-06 回流通道落地后重写；老张 2026-09-04 已确认签字冻结。`scripts/gen-evidence.mjs` **本轮不改**。

- [ ] **Step 5：改 `README.md`**——「它做什么」的流程图重画（采集 → 四层闸门 → 打分 → 事件聚合 → 主编终审 → 双产线内容包）；删 Telegram/👍👎 相关段落；「已知边界」里加两条：① 自进化回路暂停（待 DB-06）；② 事件聚类对不含实体词的标题（如 The Verge 的 `next big AI model…AGI era`）召回不到，待 DB-05 的 LLM 语义归并。

- [ ] **Step 6：跑 §6.1，确认两个 exit 为 0。**

- [ ] **Step 7：写完成报告** `docs/tasks/TASK-DB-04-pipeline-consolidation-done.md`（§七.2 的全部字段 + §8.2 署名块）。**报告里的一切「当前状态类」断言（HEAD / 工作区脏净 / 测试数）必须在交付前最后一步重跑命令复核并带读取时间戳**（DISPATCH-RULES §四.3：多会话并行下易变事实十几分钟即过期）。

---

## 十、后续工单（不属本单范围，仅供上下文）

| 工单 | 范围 | 前置 |
|---|---|---|
| **DB-05** | AI 编辑部：`src/editorial/` 的 provider 抽象（可配置端点 + 自动降级链）、writer（三档钩子/摘要/why）、reviewer（独立模型审读打分）、长时批产作业（进度落盘/断点续跑）、reviewer 灵敏度自检（防打分饱和） | DB-04 完工 |
| **DB-06** | 发布自动化（`sync-tuna`，默认 dry-run）+ tuna 行为回流通道：domain-bot 侧 `src/ingest/`；tuna 侧 T1 native 持久化（Expo Module 自封装，**禁第三方库**）、T2 带 postId 的信号级导出、T3 `LocalBriefNormalizer` 接线 | DB-04 完工；tuna 侧需老张督阵会话或显式授权 |
| **DB-07**（待定） | 判定线 11 项随新产线重写 + `scripts/gen-evidence.mjs` 改造 | DB-06 完工，且老张解冻探针签字 |

DB-05 的实测依据（已验，写工单时直接引用，不要重测）：writer 批=3 / `max_tokens=6000` 实测 47.1s（completion 2500 其中 reasoning 1739），200 条 ≈53 分钟；reviewer 批=10 / `max_tokens=1500` 实测 17.8s（completion 940 其中 reasoning 795），200 条 ≈6 分钟；两角色走不同端点可并行，墙钟由 writer 决定 ≈53 分钟。本地 `127.0.0.1:8080` 实测生成 9.9 tok/s（`docs/ops/local-llm-inference-speedup-2026-09-03.md`），reviewer 换本地约 32 分钟。思考无法用 `reasoning:false` / `chat_template_kwargs.enable_thinking:false` / `reasoning_effort:low` 关闭（三种参数实测 reasoning 不变）。

