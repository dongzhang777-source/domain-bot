# P0' 修复交付报告（Phase A）

> 执行：ZCode/小智 · 2026-09-02 · 依据：`docs/workplan-2026-09-02.md` Phase A
> 二审：hy3 **带条件通过**（报告 `docs/reviews/2026-09-02-p0p-review-hy3.md`；工单 `2026-09-02-p0p-review-workorder-hy3.md`，含落盘契约）
> **条件闭环状态**：条件 1（可达性测试）✅ 696885d；条件 2（单实例锁）✅ 696885d；条件 3（判定线定稿）→ 草稿已按 hy3 意见补漏洞，**待老张签字**；条件 4（真实反馈流过）→ 待 Telegram key。
> hy3 六条必做验证全部复现自述（75/75、V1 探针 recorded、变异 1 failed|10 passed、哈希闸门响应编辑、观测字段全命中、自述抽查零虚报）。

## hy3 条件处置明细

1. **条件 1（V2 文本守卫天花板）**：`main` 拆出可测的 `startBot`（`tests/startup.test.ts`）：注入 `pollFeedbackFn` 替身，断言常驻+token 时轮询**真被调用**、`--once` 不被调用——从"文本存在"升级为"运行时可达"。
2. **条件 2（多实例竞态）**：`src/runtime/lock.ts` PID 锁（memory/.lock），stale 锁自动接管；同目录第二进程启动即抛错。防 `npm run loop` 重复启动 + cron `--once` 叠加导致 feedback/weights last-writer-wins 丢数据。
3. **条件 3（判定线漏洞，hy3 Q3 五条全部采纳）**：`probe-verdict-criteria.md` 已补 ①中间地带处置（§2b 判据分数表）②I-/G-/P- 冲突优先级（I > G > P）③I-2 阈值 10%→5% 并补"被动消费者"说明 ④主动查看的测量机制（digest 文件含 tracking pixel 式阅读确认链接，点击即记 viewed）⑤P-4 定性证据改为可核查 artifact（决策引用链接 + 日期落 changelog）。**仍待老张签字，签字前不开跑。**
4. **条件 4（真实反馈）**：代码侧就绪，等 Telegram token。

## hy3 遗留登记（不阻断，探针期观察）

- 盲区4（源活但结构性零产出）无独立仪器——`relevant/isNewRate` 间接辅助，v2ex/bili 两源本就低产出，两周后按源产出表评估。
- 每回调 new MemoryStore 全量读盘——人类反馈频率下可忽略，扩展性债。
- `candidateP50` 仍记加权分（与 raw 并存作对照）——判定线 §4 已写死"混淆即作废"。


## A1 修 V1（长驻拓扑）

- 反测试 `tests/lifecycle.test.ts` 先红：长驻 store 看不见 runOnce 后续写入的 ref → `ignored`。
- 修法：`ReceiverDeps` 去掉 `store`、改持 `memoryDir`；`processTelegramUpdate` 每次回调 `new MemoryStore(deps.memoryDir)` 从盘重建。`main()` 同步改传 `memoryDir`。
- 绿灯：`Tests 68 passed`（含新测试）。

## A2 启动链守卫

- `tests/wiring.test.ts` 新增 3 条：main 体内必须调用 `runOnce(`、`pollFeedback(`、启动条件必须含 `telegram && !once`。
- **变异验证留档**：`if (telegram && !once)` → `if (false)` → `Tests 1 failed | 10 passed`（第三条守卫红）；恢复 → 11 passed。**局限如实声明**：前两条守卫是文本存在性检查，变异只改条件不删调用时不红——文本守卫的天花板如此，进程级保证靠 A1 的 lifecycle 测试补位。

## A3 观测补全 + 原始分

- `observeRound` 改 RoundInput 签名：新增 `rawScores`（与 candidates 一一对应的原始分）、`collected/relevant/skippedSources/feedbackCount`。
- 新字段：`rawP50/rawTop1`（进化判定读数）、`saturationRate` **改按原始分算**（修 D 盲区3：加权分会被学到的权重自己推高造成误报）、`isNewRate`。
- 真实一轮验证（gen-evidence 生成，非手抄）：`skippedSources: ["hf-daily-papers"]`（Jina 401 正确入账）、`saturationRate: 0`、`rawP50/rawTop1 = 0.5/0.604`。
- 过程偏差：重构时曾把 candidates 误改为截断后列表（破坏全量归档语义），e2e 传送带测试当场抓住 → 修正为 candidates=全量、pushed=配额后。

## A4 闸门改内容哈希

- `WeightsState.feedbackHash`（sha256 of feedback JSON）替代 `processedFeedback` 计数；`feedbackContentHash` 导出。
- 新测试：手工把同一条 👎 改成 👍（条数不变）→ 权重必须响应（计数闸门下被静默吞掉，V 场景 A）。
- 测试锚点修正两处（如实记录）：单条 👎 从 0.6 先验只移到 0.547（Beta+α=0.2 温和步长），断言改 `wDown<0.6 且 wUp>wDown`；`processedFeedback` 断言改 `feedbackHash` 非空。

## A5 补 Task11 独立红灯 + 日志文案

- **红灯留档**：回滚 `skipped.push(source)` → `Tests 1 failed | 9 passed`（skippedSources 测试红）→ 恢复 → 72 passed。
- `index.ts` 日志"推送 N 簇"→"推送 N 条"（D 偏差 b 裁决：stats.pushed 已是条数）。

## A6 源模板 + 裁剪 + 死字段

- `{{since_days:N}}` URL 模板（`src/collector/urlTemplate.ts` + 2 测试）；`config/sources.json` GitHub 源改 `created:%3E{{since_days:7}}`（修 A2/矩阵：窗口冻结成静态名单）。
- `digestRefs` 无界增长加 500 上限（淘汰最旧）；`config/push.json` 删死字段 `channel`。

## A7 证据脚本

- `scripts/gen-evidence.mjs [--md]`：从 artifacts 生成报告数据块与 `docs/evidence-latest.md`。本轮起一切报告数据由脚本产出，禁止手抄（D §七.1 教训：上次工单引用数据手抄错两字段）。

## 全量验证

- `npx vitest run` → **13 files / 75 tests 全绿**（P0 修复后 67 → +8）。
- 真实一轮：`采集 1676 → 去重删 644 → 相关 341 → 推送 3 条`，observations 新字段全部落盘（见 `docs/evidence-latest.md`，脚本生成）。

## deviations

1. A3 重构曾引入 candidates 语义错误（截断后列表冒充全量候选），被既有 e2e 传送带测试当场抓住并修正——**测试有效性的正面证据**。
2. A4 两处测试锚点修正见上（数学锚点定错，非放宽断言；语义保持"闸门关闭时原样返回、有新反馈时重算"）。
3. `observeRound` 签名破坏性变更（RoundInput），observe.test 同步重写，字段语义保留。
4. A2 文本守卫的天花板如实声明（见上）。
