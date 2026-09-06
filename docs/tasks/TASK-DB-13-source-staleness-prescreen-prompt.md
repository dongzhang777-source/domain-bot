# TASK-DB-13：huggingface-blog 源时效根治 + 采集层源级预筛

> 工单号：DB-13　｜　创建：2026-09-05　｜　创建人：总管小巴（源自同日 24h 代码审查）
> 基线 HEAD：`domain-bot @ 3cb4d7c8c885e0babaea75b0865afca938d4ffe1`（npm test 412/412 绿，2026-09-05 20:33 EDT 实测）
> 工作目录：`/Users/aiatwork/Projects/domain-bot`
> 推荐通道：claude
> 优先级：**P0**
> 预计工时：2–4 小时（诊断约 1h，施工约 1–2h）
> 上游依据：`docs/review-2026-09-05-24h-code-changes.md`（2026-09-05 24h 代码审查报告 P0-1）
> 所属台账：`domain-bot/docs/tasks/`

---

## 〇、必读（不看会做错）

1. **只改 domain-bot 仓**，禁 commit/push（入库归总管）。禁止触碰 `/Users/aiatwork/Projects/tuna`。
2. **生产区禁写**：`memory/`、`staging/`、`outbox/`、`evidence/`、`ops/`、`dist/`。这些目录有生产轮正在跑（最近一轮 evidence 落盘于 2026-09-05 19:07），你的改动不得与运行中的产线互扰。禁止 `npm run build`（dist 归总管管理）。
3. **测试必须在沙箱外跑**（本条极易误判为代码问题）：本环境在沙箱内执行 `npm test` 时，vite 启动阶段 `loadEnv` 读 `.env` 会触发文件代理拒绝（`CODEBUDDY_BROKER_DENY: Sensitive content approval timed out`），**表现为 Startup Error 而非测试失败**。若遇此错误，这是环境问题不是你的改动导致，改用放开沙箱的方式重跑，不要用改配置的方式绕过。
4. **验证退出码必须自查**：`npm test | tail` 的退出码是 `tail` 的 0，会完全吞掉失败。必须 `npm test > /tmp/t.log 2>&1; echo "exit=$?"` 后查看文件。
5. 相关既有代码：`src/pipeline.ts`（`collectStage` 步骤 1 采集循环在 154-164 行）、`src/gates/persona.ts`（`PersonaGate.check`，时效判定在 49-78 行）、`src/gates/index.ts`（`runGates`，三层闸门编排）、`src/gatekeeper/board.ts`（`buildBoard` / `auditBoard`）。
6. 编号纪律：本工单属 domain-bot `DB-nn` 族，与 fati-server `SP-nn`、tuna `X-nn` 不同族，报告里引用编号一律写全 `DB-13`。

## 一、背景（为什么做）

deepthought 产线单轮采集 915 条，其中 **833 条（91%）来自单一源 `huggingface-blog`，全部因 `persona:tooOld` 被拒**。这些条目的年龄中位 **19223h ≈ 2.2 年**、p90 **37727h ≈ 4.3 年**、最大 **57503h ≈ 6.6 年**，而 deepthought 的 `maxAgeHours=720`（30 天）——它们从采集那一刻起就注定被砍。

**不做的代价（量化）**：

- 每轮白采 833 条，全部走完 `canonicalUrl` 派生与去重哈希后才被拒，纯属浪费；
- 漏斗里 `persona:tooOld` 一项（833）压倒性主导（占 dropped 总量 849 的 98%），**掩盖其余各层的真实读数**——`blacklist:damaged:scrapeFragment=3`、`titleTooShort=2` 这类真正的质量信号被淹没；
- deepthought 目标 `maxItems=120`、实际发布 10 条，**91% 的"采集量"是虚假的产能读数**，任何基于 `collected` 的产能判断都不可信。

**会推翻哪个已验证资产（必须回答）**：本改动会影响三项已验证口径，你必须在报告中逐条回答如何处置：

1. `collected` 计数口径变化 → 与历史 evidence（35 份已入库快照）的对比会断裂；
2. `zeroYieldSources` 语义：某源条目被时效预筛全部砍光时，它该算 `zeroYieldSources` 还是 `skippedSources`？现有定义在 `pipeline.ts:246-248`（"采集到但闸门后为 0"）；
3. `tests/startup.test.ts`、`tests/cli-stages.test.ts`、`tests/pipeline-quality.test.ts` 中存在漏斗相关断言（`auditBoard` 校验漏斗单调不增、末层等于发布数），改 `collected` 可能打红——**若需调整这些断言，必须逐条列出并说明为何不属于"改测试凑绿"**。

## 二、任务与验收标准（逐项可证伪）

### 1. 诊断：确认 feed 实际返回什么

用 `curl` 实测 `https://huggingface.co/blog/feed.xml`，在报告中给出（附命令 + 输出摘要 + 读取时间戳）：

- 实际返回条目数；
- 最早/最新条目的发布时间，及时间跨度；
- 是否支持分页或"仅近期"参数（若支持，给出可用 URL 形式）。

**验收**：报告含上述三项实测数据。若网络不通，明确写"无法实测"并说明，不得据推测下结论。

### 2. 治本：让源不再返回归档（若诊断结果支持）

若第 1 项发现该 feed 有"仅近期"参数或更合适的 URL，**修改 `config/sources.json` 中 `huggingface-blog` 的 `url`**。

**验收**：修改后的 URL 实测返回的条目时间跨度显著收窄（给出对比数字）。

### 3. 防护：采集层加源级时效预筛

在 `collectStage` 的采集阶段（persona 闸门**之前**）按 `persona.maxAgeHours` 剔除必然超时的条目。

**铁律（违反即退回）——时效损失不得从漏斗里消失**：
预筛掉的条目**必须记账**，否则"多少内容因时效被丢弃"这个读数会从看板上彻底消失，那是又一次静默。记账方式二选一，你论证后选择并说明理由：

- (A) 作为新的 funnel 阶段（如 `afterSourcePrescreen`）；
- (B) 作为 dropped 记录（如 `gate: 'source'`、`ruleId: 'source:tooOld'`）。

无论选哪种，`auditBoard` 的漏斗单调不增检查必须保持绿。

**验收**：新增 ≥1 测试——构造一条 `publishedAt` 超过 `persona.maxAgeHours` 的 RawItem，断言它在采集阶段后即被剔除，且**在漏斗/dropped 中仍可查到**（证明记账生效）。

### 4. 边界：源未给时间的情况不得误伤

`persona.ts:47-78` 现有逻辑：`publishedAt > 0` 才判时效，`publishedAt === 0`（jina/bili/ytsearch 常态）走 `staleYearInTitle` 判据。**预筛必须沿用同一口径，不得把 `publishedAt === 0` 的条目当超时砍掉**——否则这些源会被整体误杀。

**验收**：新增 ≥1 测试——`publishedAt === 0` 且标题无过期年份的条目，预筛后仍在候选集中。

## 三、精确落点

| 位置 | 现状 | 要求 |
|---|---|---|
| `config/sources.json` | `huggingface-blog` 的 `url` 为 `https://huggingface.co/blog/feed.xml` | 依诊断结果决定是否改 URL |
| `src/pipeline.ts:154-164` | 采集循环，`collected.push(...items)` 后无时效处理 | 加入源级时效预筛（用 `opts.persona.maxAgeHours`），预筛掉的条目记账 |
| `src/pipeline.ts:265-271` | `funnelPrefix` 现有 4 层：collected / afterDedupe / afterGates / afterEventCap | 若选方案 (A)，在此插入预筛层 |
| `src/pipeline.ts:275-285` | `observed` 对象含 `collectedCount` 等源级明细 | 预筛计数须纳入观测口径 |
| `src/gates/persona.ts:47-78` | 时效判定，`publishedAt > 0` 判 ageHours，否则走 `staleYearInTitle` | **不得改动判据本身**；预筛须复用同一口径 |

## 四、已知坑点（已核实，不是"可能"）

1. **当前两条产线的 sources 不重叠**（`config/personas/deepthought.json` 8 源、`newsline.json` 7 源，交集为空），故按 `persona.maxAgeHours` 预筛不会跨产线误伤。**但你要在代码里确认这个前提**，若发现共用源则预筛口径需另议并在报告中提出。
2. **`recallPool` 的完整性依赖闸门顺序**：宽通道待定池的条目来自 relevance 未过者，而时效在更前面的 persona 闸。**预筛不得让"过旧但 relevanc 达标"的条目凭空消失**——它们本就会被 persona 闸砍，预筛只是提前，记账即可。
3. `persona:tooOld` 现有 833 条的源分布是**单一源 100%**（huggingface-blog），非普遍现象。不要据此外推为"所有源都有时效问题"。
4. 本仓 `npm test` 基线 **412 例、约 99 秒**（非 DB-12 时期的 400 例）。改后只增不减。

## 五、硬约束（违反即退回）

- [ ] 禁止 commit / push / `npm run build`；禁止触碰 tuna 仓、`memory/`、`staging/`、`outbox/`、`evidence/`、`ops/`、`dist/`
- [ ] 禁止新增运行时依赖（本仓唯一依赖 `fast-xml-parser`，此约束是项目红线）
- [ ] 验证命令后禁止直接接管道；必须重定向后 `echo "exit=$?"` 自查
- [ ] 不得修改与本工单无关的文件
- [ ] **不得改动 `persona.ts` 的时效判据本身**（`maxAgeHours` 数值、`staleYearInTitle` 阈值），预筛只复用不改写
- [ ] 不得让时效损失从漏斗/看板中消失（见 §二.3 铁律）

## 六、自测要求

运行：`npm test > /tmp/db13.log 2>&1; echo "exit=$?"`（须 exit=0，且用例数 ≥412）

新增测试落 `tests/` 下（文件名自定，建议 `tests/source-prescreen.test.ts`），须包含以下断言：

1. 构造 `publishedAt` 超过 `persona.maxAgeHours` 的条目 → 断言采集阶段后不在候选中；
2. 同一条目 → 断言**在漏斗或 dropped 中仍可查到**（证明记账生效，非静默丢弃）；
3. 构造 `publishedAt === 0` 且标题无过期年份的条目 → 断言仍保留在候选中（防误杀）；
4. `auditBoard` 对该场景产出零 `fatal`。

**自测标记**：报告末尾输出 `ALL_DB13_PASS`。

**验收方式**：总管会**打开你的测试文件读断言本身**，并做变异抽验（改坏输入看它是否真的会红）。只输出 `ALL_PASS` 而无真实断言的，视为未通过——本仓有过 codex「自制沙箱假通过」的前车之鉴。

## 七、交付物

1. 代码改动（未 commit）
2. 自测报告，落盘 `/Users/aiatwork/Projects/domain-bot/.verify-logs/2026-09-05-domainbot-db13-source-prescreen-claude.md`，含：
   - §二.1 三项实测数据（命令 + 输出 + 时间戳）
   - §一「会推翻哪个已验证资产」三问的逐条回答
   - 每项验收的测试输出与退出码
   - 遗留与风险
3. 若发现本工单描述与代码不符：**明确指出并说明依据**（路径 + 行号），不要将错就错

## 八、禁止事项

- 禁止自制沙箱短路（不得写永真断言 / 不得 mock 掉被测目标本身）
- 禁止顺手重构无关代码
- 禁止在报告中声称"已验证"你实际未运行验证的项
- 禁止用改测试的方式让红灯消失（如需调整既有断言，按 §一.3 逐条论证）
