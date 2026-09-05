# DB-04 完成报告：信息流产线收编（pipeline consolidation）

> 工单：`docs/tasks/TASK-DB-04-pipeline-consolidation-prompt.md`（`ed47aee`）
> 施工：Qoder 会话（task-77a，老张 2026-09-04 裁决「全做完吧」后继续完成）
> 接手收尾与真仓实跑：小智（ZCode 代理总管），2026-09-05
> 移交细节（设计决策依据、高频坑、违规登记）见根仓 `docs/HANDOFF-DB04-2026-09-05.md`

---

## 一、改动文件（绝对路径清单，三个 commit）

### commit `8519684`——Task 1-7：双产线批产、主编终审、内容包装配、退役 Telegram

**新增**：
- `/Users/aiatwork/Projects/domain-bot/src/pipeline.ts`（编排，runPipeline）
- `/Users/aiatwork/Projects/domain-bot/src/gatekeeper/index.ts`（主编终审编排）
- `/Users/aiatwork/Projects/domain-bot/src/gatekeeper/assertions.ts`（十条客观一票否决断言）
- `/Users/aiatwork/Projects/domain-bot/src/gatekeeper/board.ts`（质量看板数据）
- `/Users/aiatwork/Projects/domain-bot/src/gatekeeper/render.ts`（看板渲染）
- `/Users/aiatwork/Projects/domain-bot/src/gatekeeper/backfill.ts`
- `/Users/aiatwork/Projects/domain-bot/src/gates/eventCluster.ts`（实体词并查集事件聚合）
- `/Users/aiatwork/Projects/domain-bot/src/publish/pack.ts`（内容包装配 + 契约校验）
- `/Users/aiatwork/Projects/domain-bot/src/render/tuna.ts`（tuna 渲染 + 兜底）

**删除（Telegram 退役，老张裁决 5）**：
- `/Users/aiatwork/Projects/domain-bot/src/push/telegram.ts`（−160 行）
- `/Users/aiatwork/Projects/domain-bot/src/feedback/receiver.ts`（−191 行，长轮询反馈回路，由 DB-06 tuna 回流取代）
- `/Users/aiatwork/Projects/domain-bot/src/push/file.ts`（−36 行）
- `/Users/aiatwork/Projects/domain-bot/src/push/tuna.ts` 的发布职责（−119 行，detectLang/truncateChars 保留复用）
- `/Users/aiatwork/Projects/domain-bot/tests/telegram.test.ts`、`tests/receiver.test.ts`（随实现删除）

**改造**：`src/index.ts`（−359 行，退役 runOnce/startBot，改 CLI 转发）、`src/cli.ts`、`src/gates/fingerprint.ts`（规范 URL 指纹）、`src/runtime/doctor.ts`、`config/gates.json`、`config/personas/{deepthought,newsline}.json`

### commit `669e91f`——DB-04 阶段二/三：AI 编辑部、tuna 行为回流、发布同步、质量回归

**新增**：
- `/Users/aiatwork/Projects/domain-bot/src/editorial/{index,provider,job,writer,reviewer,calibrate}.ts`（AI 编辑部全链：端点降级链、分批作业、写与评分离、金标自检硬前置）
- `/Users/aiatwork/Projects/domain-bot/src/ingest/tuna-signals.ts`（tuna 行为信号摄入，恢复 views.json 写入方）
- `/Users/aiatwork/Projects/domain-bot/src/publish/sync-tuna.ts`（内容包同步 tuna，默认 dry-run）
- `/Users/aiatwork/Projects/domain-bot/tests/{editorial,editorial-calibrate,gatekeeper,ingest,pipeline-quality}.test.ts`
- `/Users/aiatwork/Projects/domain-bot/tests/fixtures/gold-standard.json`（DB-03 真实审计 44 条四档夹具）
- `/Users/aiatwork/Projects/domain-bot/scripts/probe-event-cluster.mjs`

**改造**：`config/gates.json`（+503 行：黑名单 13 条/5 组、多级关键词积分）、`src/cli.ts`、`src/pipeline.ts`、`src/gatekeeper/*`、`src/gates/{eventCluster,persona}.ts`

### commit `1e3cc4b`——DB-04 收官：分段批产、事件聚类降权、终审两阶段、plist 修正

**新增**：
- `/Users/aiatwork/Projects/domain-bot/src/staging.ts`（跨进程分段契约，350 行）
- `/Users/aiatwork/Projects/domain-bot/tests/cli-stages.test.ts`（22 用例）
- `/Users/aiatwork/Projects/domain-bot/scripts/mutation-check.py`（4 目标变异 + 1 对照组 + 字节级还原核验）

**改造**：`src/{cli,pipeline,staging}.ts`、`src/gates/{eventCluster,fingerprint}.ts`、`src/editorial/index.ts`（roles 分段）、`src/gatekeeper/*`（两阶段 consider/填充感知裁剪）、`ops/com.domain-bot.plist`（StartCalendarInterval 化）、`package.json`（分段命令 scripts）

## 二、新增测试文件与关键断言

| 测试文件 | 用例数 | 关键断言 |
|---|---|---|
| `tests/cli-stages.test.ts` | 22 | **头号不变量：分段跑（collect→edit→review→publish）与整链 run 产出逐字段一致的内容包**；staging 契约（快照还原、重复 id 抛错、下标对齐硬校验） |
| `tests/wiring.test.ts` | 扩 | **单一发布路径守卫**：`buildPack`/`writePack`/`appendFingerprints`/`writeBoard` 在 cli.ts 各只有一个调用点（run 与 publish 共用 emitPublished）——防第二条产线长回来 |
| `tests/gatekeeper.test.ts` | 新 | 十条客观断言逐条（gk:* ruleId）；事件超额复检；填充感知裁剪 |
| `tests/editorial.test.ts` | 新 | writer 文案硬断言（兜底产物也必须过）；reviewer 判定归一化；端点降级链 |
| `tests/editorial-calibrate.test.ts` | 新 | 金标自检三阈值（distinctBuckets/saturation/agreement）；未校准则 reviewer 分数不参与判定 |
| `tests/pipeline-quality.test.ts` | 新 | 用 DB-03 真实垃圾做夹具（`KNOWN_BAD.length >= 20` 规模守卫）；质量闸门端到端拦截 |
| `tests/ingest.test.ts` | 新 | tuna-signals-v1 摄入校验（带 postId、前缀过滤、坏行拒收） |
| `tests/eventCluster.test.ts` | 新 | 实体词并查集聚类；**降权（demoted）而非丢弃（dropped）** |

## 三、验证输出（交付前最后一步复跑）

2026-09-05 09:00 复跑（`set -o pipefail` 语义，重定向后查退出码）：

```
npm run typecheck  → exit=0
npm test           → Test Files  24 passed (24) | Tests  373 passed (373)  exit=0
npm run build      → exit=0
```

## 四、变异测试（scripts/mutation-check.py，2026-09-05 09:01 复跑）

```
M1 [src/staging.ts] 变红（断言有效）     锁定：下标对齐校验 maxItems 在 edit/publish 间被改过必须拒绝发布
M2 [src/gatekeeper/assertions.ts] 变红  锁定：gk:hookEntity 钩子不含原文实体词必须一票否决
M3 [src/pipeline.ts] 变红（断言有效）    锁定：不得在终审之前按 maxItems 截断
M4 [src/staging.ts] 变红（断言有效）     锁定：restoreStage 候选重复 id 必须抛错
M5 [src/cli.ts] 仍绿（对照组）          注入一行注释不应让任何测试变红——证明判定不是恒红
=== 还原核验 === 逐文件字节比对 4/4 已还原；全量复跑 exit=0 Tests 373 passed (373)
=== 结论 === ALL_MUTATIONS_PASS
```

## 五、真实产线跑批漏斗（2026-09-05 真仓首跑，`run --persona=all`）

**第一轮（07:44，编辑部启用但 calibrate 未过→如实退机械兜底）**：

| persona | collected | afterDedupe | afterGates | afterEventCap | afterTruncate | published |
|---|---|---|---|---|---|---|
| deepthought | 915 | 915 | 40 | 40 | 40 | **40** |
| newsline | 52 | 48 | 16 | 16 | 16 | **16** |

- 事件簇 deepthought 26 / newsline 7；均进填充模式（候选不足以在 maxPerEvent 下填满 maxItems，看板显式警告「防刷屏能力本轮降级」）。
- 被拦条目逐条带 `gate`/`ruleId`/`reason`，漏斗可复算。
- 产物落盘：`outbox/tuna/feed-pack-<persona>-<digestId>.json`（deepthought 40 条 + newsline 16 条），指纹库 +56。
- **第二/第三轮（08:20/08:33 实验轮）**：同窗口重跑验证了两件事——① URL 指纹防重放有效（第一轮发布的 56 条在第二轮全被拦，deepthought 40→1、newsline 16→0）；② 采集窗口滚动（第一轮吃隔夜高峰，白天轮次新列表无 AI 相关→关键词闸门全灭、0 候选）。系正确行为，非缺陷。生产节奏（plist 每日 03:00 单轮）不存在同窗口连跑。

**编辑部能力验证（2026-09-05 08:59 独立 calibrate，reviewer=ds4-local DeepSeek-V4-Flash）**：

```
calibrate：47/47 条有分，漏答 0 ｜ 区分档 4（trash=19 low=8 mid=9 high=11）
         一致率 85.1%（下限 70%）｜ 顶档 23.4%（上限 50%）
✅ 通过：分值域对质量维度有灵敏度，可用于触发递补（不得作为终审闸门）
```

## 六、交付前状态复核（读取时间 2026-09-05 09:00 EDT）

- domain-bot HEAD：`1e3cc4b`（施工三提交 8519684/669e91f/1e3cc4b）+ 本报告后补丁（未 commit，待总管入库）
- 工作区：`src/editorial/{provider,index}.ts`、`config/editor.json`、`tests/{editorial,ingest}.test.ts`、本报告 = 5 个文件有改动，其余干净
- 测试数：373 passed (373)，typecheck/build exit=0
- tuna HEAD：`039e5b9`（`3ba23df` + 台账 `039e5b9`）
- 根仓 HEAD：`34b8928`（`61085a7` DB-04 收尾台账 + `cd6f270` 移交报告 + `34b8928` 代理期台账），已推 backup
- 三仓推送：domain-bot/tuna → origin 已推；根仓 → backup 已推。本报告与后补丁未提交

## 七、Telegram 引用点全量清单（Task 6 Step 1：删除范围已全量清点、零抽样）

2026-09-05 08:00 复核 `grep -rn -i "telegram" src/ --include="*.ts"` 共 **24 处**，全部为以下三类，**运行时零调用**：

| 类别 | 位置 | 性质 |
|---|---|---|
| 历史说明注释 | `src/cli.ts:30`、`src/pipeline.ts:42`、`src/index.ts:5-6` | 说明「取代了什么」，非代码引用 |
| 观测 schema 保留字段 | `src/memory/observe.ts:25-27,66`（`telegram?: 'sent'\|'failed'\|'skipped-empty'\|'disabled'`）+ `src/pipeline.ts:421`（恒写 `telegram: 'disabled'`） | 判定线 I-2 分母的诚实状态值；字段删除会造成 observations.jsonl 新旧行 schema 断裂，保留且恒填 disabled 是有意的 |
| 过程性注释 | `src/pipeline.ts:395` 等 | 说明行为信号改由 tuna 回流入账 |

## 八、与工单的偏差登记

1. **测试 370→372 变化**：验收标准写「≥360」，实际 372（24 文件），达标。
2. **Task 8 的 known-bad 夹具**：工单要求另建 `known-bad.json`；实际从 `gold-standard.json` 过滤 `humanDecision === '剔除'` 派生（同一事实源防两份夹具漂移），并加 `KNOWN_BAD.length >= 20` 规模守卫。有意偏差，已在前手移交报告 §八.7 说明。
3. **DB-03 §3.2 标题 jaccard 门禁未实现**：工单 §八明令禁止（实测真实洗稿标题最大 jaccard 0.313，≥0.75 命中 0 条——实现了只会是死代码加假安全感）。
4. **行号漂移说明**：工单 §三 的行号基于基线 `ed47aee`，施工中代码多轮演进，以 1e3cc4b 落盘代码为准（工单 §七.3 预案）。
5. **2026-09-05 接管收尾补丁**（老张指令：Qwen 已删、改用 start_ds4.sh 的 DeepSeek-V4-Flash 作编辑模型）：`src/editorial/provider.ts` 加 `extraBody` 逐端点透传（配置 `reasoning_effort:"low"` 修 DeepSeek reasoning 吞 max_tokens 导致的 63.8% 漏答率）；`editorial/index.ts` 的 calibrate 改 `mkdtempSync` 唯一 staging 目录（修复完成态 job 被无限续跑、改配置不生效的缓存污染——实测第一轮 34.0% 一致率在改配置后原样复现，正是这个缓存）；契约测试两条语义化改写（历史条款「8002 实测不存在故禁止出现」被老张指令推翻，改为「id+地址双校验写与评分离 + env 缺省可解析不炸」）；`tests/ingest.test.ts` 两处 `ingestTunaSignals` 补显式 `now`（省略时回落真实时钟，会把模拟时钟刚产出的 digest 判定为「24h 前未展开」结算弱负证据，把收藏的正信号稀释回先验——实测 00:39 绿 / 12:00 红，纯时间错位，非产品缺陷）。验证：373/373 绿。

## 完成署名

- 工单号：DB-04（信息流产线收编）
- 执行通道：Qoder 会话（task-77a）施工 + 老张 2026-09-04「全做完吧」授权；小智（ZCode 代理总管）接手收尾、真仓实跑与本报告
- 执行人标识：Qoder(cli-5-max) + 小智(ZCode/GLM-5.3-Flash 代理总管)
- 完成日期：2026-09-05
- 派单基线 HEAD：domain-bot @ `ed47aee`（npm test 149/149 绿，工单入库时点）
- 实际落盘 HEAD：domain-bot @ `1e3cc4b`（372/372）+ 收尾补丁 5 文件（未 commit，待总管入库）｜ tuna @ `039e5b9`（含 3ba23df 回流三项）｜ 根仓 @ `34b8928`
- 验证：`npm test` 373/373 绿 exit=0；`npm run typecheck`/`npm run build` exit=0；`scripts/mutation-check.py` ALL_MUTATIONS_PASS；reviewer calibrate 漏答 0 / 一致率 85.1% 通过
- 自测标记：ALL_DB04_PASS
- 改动文件：见 §一（90 文件次 / 三 commit）
- 关联台账更新：根仓 DRIFT-LEDGER D-09 🟡→🟢；COMMITMENT-LEDGER WS-16 ❌→✅（tuna 侧 `3ba23df`）；ACCEPTANCE-DEBT A-08 ⏸→部分清偿（tuna 侧）；`docs/probe-verdict-criteria.md` 顶部冻结声明
- 遗留风险：D-10 孤儿进程阻塞真仓（已于 2026-09-05 清偿，见 §六）；D-11 huggingface-blog 源未限量（待老张裁编辑策略）；Android native 持久化未做（A-08 待裁）；判定线 DB-07 重写冻结中（两个前置见 criteria 顶部声明）
