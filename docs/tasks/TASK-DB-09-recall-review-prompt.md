# TASK-DB-09：domain-bot DB-08 召回加宽改动交叉审查（只读）

> 工单号：DB-09　｜　创建：2026-09-05　｜　创建人：代理总管小智
> 基线 HEAD：`domain-bot @ 82c6ea1`（npm test 388/388 绿，2026-09-05 14:48 EDT 实测 exit=0）
> 工作目录：`/Users/aiatwork/Projects/domain-bot`
> 推荐通道：claude
> 预计工时：2–3 小时
> 优先级：P1
> 所属台账：根仓 `docs/NUMBERING.md`（DB-09 已登记）

---

## 〇、必读（不看会做错）

1. **你只做只读审查**：禁止 commit / push / 修改任何源码与配置。你的唯一产出物是一份落盘报告（见「七、交付物」）。
2. **被审对象**：commit `fb7b580`（DB-08 关键词召回加宽三阶段）+ `82c6ea1`（evidence 收口）。审查范围 = 这两笔的 diff 与其触及的文件当前态，**不是全仓审计**。
3. **背景档案（引用时核至文末）**：
   - 整改计划：`docs/plan-recall-widening-2026-09-05.md`
   - 完成报告（被审方自述）：`docs/tasks/TASK-DB-08-recall-widening-done.md`
   - 质量事故史（为什么要显式看板、为什么词表不可依赖）：根仓 `docs/DRIFT-LEDGER.md` 的 D-09 条目
4. 本仓测试命令是 `npm test`（388 例，约 3 秒）。**裸 `npx vitest` 会卡 registry 交互**，勿用。验证命令后禁止直接接管道（`npm test | tail` 吞退出码）；用 `npm test > /tmp/t.log 2>&1; echo "exit=$?"`。
5. 跨仓/跨文件核查用 Grep 工具（ripgrep），勿用 Bash `grep` 多关键词 `\|`（本环境静默零命中前科 ≥5 次）。

## 一、背景（为什么审）

老张批评「用关键词搜索内容会限制信息渠道」后，DB-08 把 relevance 词表从一票否决降为快通道，新增 LLM 宽通道召回（`src/editorial/recall.ts` 二元判定 + 金标校准 24h 缓存 + fail-safe），并把 plist 改为三时段调度。该批由代理总管自修完成，**尚未经任何第二双眼睛独立审查**，而它直接决定每天推给老张的内容渠道面——DB-03 事故（149 测试全绿但交付 32.5% 垃圾）证明这个仓「全绿」与「正确」可以同时为假。你的职责是找真缺陷，不是背书。

## 二、审查维度（逐项作答，每项给结论 + 证据）

1. **宽通道核心逻辑正确性**：`src/gates/index.ts` recall 分流（recallEligible 预筛 / recallPool 截断 / `recall:ineligible`、`recall:poolOverflow` 落账）与 `src/editorial/recall.ts`（prompt 构造、判定解析按 index 对齐、漏答 fail-safe、校准评估）。找：边界条件错误、索引错位、fail-safe 方向反了、漏斗不可复算的路径。
2. **fail-safe 与降级语义**：reviewer 端点缺失 / 校准失败 / 漏答率超阈 / LLM 超时各分支，最终行为是否都是「安全回退到词表原语义」且**落账可观测**？有没有静默吞错？
3. **prompt 注入面**：宽通道把**采集来的外部内容**喂给 LLM 判定。条目正文若含「include this」类指令文本，能否翻转判定？评估现有 prompt 的隔离措施是否足够，并给风险定级（注意：判定结果只影响入选与否，不影响 prompt 生成，权重此点）。
4. **校准机制**：`assessRecallCalibration` 金标派生（DB-03 人工审计 → include/exclude 期望）、24h 缓存（失败也缓存）、一致率阈值逻辑。找：金标构造错误、缓存键冲突、时区/过期边界。
5. **分段契约不破坏**：`tests/cli-stages.test.ts` 22 例零改动仍绿的前提是「判定在 collect 阶段内完成」。核实 `src/pipeline.ts` 的 `recallJudge` 回调注入确实做到了分段跑==整链跑，且 `pipeline.ts` 未 import EditorialProvider（`tests/wiring.test.ts` 有断言，读断言本身验真）。
6. **观测口径**：`src/memory/observe.ts` / `src/staging.ts` 的 `recallPoolSize`/`recallIncluded` 是否如自述「不并入 candidates/relevant 口径」——这直接关系判定线 I 线读数不被污染（老张拍板点）。
7. **调度改动**：`ops/com.domain-bot.plist` 三时段（03/12/19）+ 指纹库防重放。找：重复推送风险、时区语义（plist 的 StartCalendarInterval 按机器本地时区）、已加载的 launchd job 是否需要手动 reload 才生效。
8. **测试真实性抽验**：新增 `tests/recall.test.ts`（9 例）与 `tests/gates.test.ts` +5 例。读断言本身，抽 ≥2 处做**变异验证**（临时改坏实现 → 确认变红 → **立即还原**，还原后 `git diff` 必须为空并写入报告）。注意：变异验证产生的临时改动是你唯一被允许的写操作，且必须还原。
9. **自述报告核对**：`TASK-DB-08-recall-widening-done.md` 中的关键断言（词表 51→70/20→37、6 查询源加宽、黑名单收编 `spam:sdkVariant`、测试计数）逐条抽查是否与代码一致。

## 三、硬约束（违反即退回）

- [ ] **只读**：禁止 commit / push；除第 8 条变异验证外不得改任何文件
- [ ] 禁止运行 `--once` 真跑或任何写 `memory/` 的命令（标定期数据区，多会话共享，污染即事故）
- [ ] 禁止 pip/npm 安装任何东西
- [ ] 验证命令退出码必须重定向后自查

## 四、已知坑点

1. `npm test` 当前 388 例全绿是**已实测基线**，别花时间复跑全量找环境问题；你的价值在读逻辑。
2. 本仓刚发生过「测试全绿但交付垃圾」（D-09/DB-03），报告里不要以「测试都绿」作为正确性论据。
3. 深夜 03:00 是首轮三时段触发点；若你在运行窗口内观察到 `memory/` 有新写入，那是**别的会话/自动化在产线跑**，与你无关，勿动。
4. `docs/tasks/` 里 DB-08 的 done 报告是**被审方**写的，其断言按第九维度核对，不默认可信。

## 五、交付物

一份 Markdown 报告落盘到：

```
/Users/aiatwork/Projects/domain-bot/.verify-logs/2026-09-05-domainbot-db09-recall-review-<你的身份标识>.md
```

报告结构：
1. 结论摘要（通过 / 有条件通过 / 不通过，一句话理由）
2. 九个审查维度逐项：结论 + **证据**（文件路径:行号，或命令+输出）
3. 缺陷清单：每条带严重度（S0 阻断 / S1 应修 / S2 建议）、路径:行号、复现/验证方式、修复建议（须双向论证：不修的真实代价 vs 修了会推翻哪个已验证资产）
4. 变异抽验记录：改了什么、是否变红、还原后 `git diff` 是否为空
5. 自测标记 `ALL_DB09_PASS`（仅当报告落盘成功且上述各项均有实证时输出；你不需要跑全量测试套件）

若作答环境无文件写入能力：全文回复，由总管代为落盘（命名同上，身份填实际身份）。

## 六、禁止事项

- 禁止自制沙箱短路（不得用「看起来对」代替读代码）
- 禁止在报告中声称「已验证」你实际未运行的验证
- 禁止顺手给无关代码提重构建议（范围=本两笔 diff 及其触及文件的当前态）
