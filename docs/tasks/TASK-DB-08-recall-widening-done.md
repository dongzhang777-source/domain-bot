# DB-08 完成报告：关键词召回加宽（recall widening）

> 工单来源：老张 2026-09-05 批评「**用关键词搜索内容会限制信息渠道**」→ 整改计划 `docs/plan-recall-widening-2026-09-05.md`（同日老张批「继续」）→ 代理总管自修
> 编号：DB-08（根仓 `NUMBERING.md` 已登记）
> 完成日期：2026-09-05

---

## 一、改了什么（Phase 1+2+3 全部落地）

### Phase 1 止血：词表与查询串

- `config/gates.json`：core 51→**70** 词、ecosystem 20→**37** 词（AI 安全与治理 alignment/safety/guardrail/jailbreak/prompt injection/governance、硬件与算力 nvidia/gpu/算力、蒸馏与 scaling distillation/rlhf/rlaif/scaling law、上下文工程 context window/context engineering/model context protocol、生态经济 open weights/inference cost/copyright/licensing 等）；generic 层不增词（0 分词不贡献入选）
- `config/sources.json`：6 个查询型源查询串加宽——github 3 源 `OR` 扩 topic（llm/large-language-models/ai-tools、ai-agents/autonomous-agents/multi-agent、rag/retrieval-augmented-generation/vector-database），exa 2 源自然语言查询扩域（safety/hardware/economics/open source），yt-llm 查询从「LLM inference optimization explained」扩为「AI LLM agents deep learning explained」

### Phase 2 结构性反转：relevance 降为快通道 + 宽通道召回

- `src/gates/index.ts`：`runGates` 新增 recall 分流——relevance 未过的条目不再被词表一票否决，而是：预筛达标（`recallEligible`：标题 ≥ minTitleChars 且非纯符号、正文非空洞）→ 进 **recallPool**（按 relevance 积分降序截断 `maxPerRound`）；预筛不达标/超上限 → dropped（`recall:ineligible` / `recall:poolOverflow`），**任何不进 passed 的条目都有去处，漏斗恒可复算**
- `src/editorial/recall.ts`（新）：宽通道判定——`buildRecallPrompt`（include/exclude 二元，**不产分数**）+ `judgeRecallPool`（漏答 fail-safe=exclude，落账 `recall:unanswered`）+ `assessRecallCalibration`（金标期望由 DB-03 人工审计派生：剔除→exclude、保留/降权→include）
- `src/pipeline.ts`：`PipelineOptions.recallJudge` 回调注入（管线本体不感知 LLM 端点）；collectStage 步骤 3.5 调用判定，include 条目并入候选走**同一打分/事件聚合/终审链**——质量底线不因召回加宽放松
- `src/cli.ts`：`makeRecallJudge` 工厂——reviewer 端点构造 + 金标校准（落盘 `memory/recall-calibration.json`，24h 缓存，失败同样缓存避免每轮重烧）+ 判定调用；未启用/端点缺失/金标缺失时返回 undefined（宽通道关闭，走词表原语义）
- `src/gatekeeper/board.ts`：QualityBoard 加宽通道汇总（poolSize/included/excluded + 口径说明）——**静默运行是 D-09 式漂移的温床，必须显式暴露**
- `src/memory/observe.ts` + `src/staging.ts`：观测加 `recallPoolSize`/`recallIncluded`（**不并入 candidates/relevant 口径**，判据读数不变——拍板点 3「判据暂冻结」的落地）
- `src/types.ts`：`RecallConfig`、`GateId` 加 `'recall'`、`GateOutcome.recallPool`
- persona 配置：deepthought/newsline `recall.enabled=true, maxPerRound=20, minAgreementRate=0.7`

### Phase 3 调度

- `ops/com.domain-bot.plist`：StartCalendarInterval 单时段 → **数组三时段（03:00 / 12:00 / 19:00）**，指纹库防重放保证不重发；`plutil -lint` OK

## 二、新增测试

| 文件 | 用例 | 关键断言 |
|---|---|---|
| `tests/gates.test.ts`（+5） | 22→27 项 | 宽通道池构造/积分降序截断/`recall:poolOverflow` 落账/预筛 `recall:ineligible`/recall 未启用回归锁（`relevance:belowMinPoints` 原语义）/黑名单命中不得进池 |
| `tests/recall.test.ts`（新，9） | 9 | 解析按 index 对齐、越界/重复/非 JSON 记 missing、漏答 fail-safe exclude、prompt 无打分指令（`not.toMatch(/score/i)`）、校准全对通过/一致率不足回退/漏答率>30% 不可用、**pipeline 集成**：捞回条目与快通道共用终审、黑名单垃圾 judge 看不到也发不出 |
| `tests/wiring.test.ts`（+1） | 28 | `makeRecallJudge` 恰好「定义 1 次 + run/collect 各注入 1 次」；pipeline.ts 不得 import EditorialProvider/judgeRecallPool（判定只经回调，分段契约不破坏） |

## 三、验证输出（2026-09-05 10:20 EDT 复跑）

```
npm run typecheck         → exit=0
npm test                  → Test Files 26 passed (26) | Tests 388 passed (388)  exit=0
npm run build             → exit=0
plutil -lint plist        → OK
scripts/mutation-check.py → ALL_MUTATIONS_PASS（4 变异全红 + 对照组绿 + 还原后 388 复绿）
```

## 四、设计要点（防后续会话改错）

1. **判定在 collect 阶段内完成**：staging 快照即最终候选集，分段契约「分段跑 == 整链跑」（`tests/cli-stages.test.ts` 22 例）零改动继续绿。
2. **校准 24h 缓存**：通过与否都缓存——失败校准每轮重跑只会重复烧钱，24h 后自然重试。
3. **词表防线不可依赖**：本轮实测 Phase 1 加宽后 DB-03 剔除样本 `db03-072`（montycat_rust，此前靠「词表未覆盖」的运气被 relevance 意外拦截）泄漏进产出——证明「词表当防线」是脆弱的。已按黑名单惯例收编 `spam:sdkVariant` 模式（DB-03 审计驱动，同款项目多语言 SDK 绑定变体）。
4. **candidates/relevant 口径含捞回条目**（它们本就是候选），`observations.jsonl` 的 `recallPoolSize`/`recallIncluded` 单独存档——判定线 I 线读数不受宽召回影响（拍板点 3）。

## 五、遗留与后续

- 宽通道 LLM 判定的真实命中率需下一内容高峰（明晨 03:00 首轮三时段）后看 `recall-calibration.json` 与看板数据；校准未过会自动回退关闭（fail-safe），不影响产线
- Phase 3 候选池化（跨轮累积）按计划待 Phase 2 数据后再议
- D-11（huggingface-blog 源未限量）仍待老张裁编辑策略

## 完成署名

- 工单号：DB-08（关键词召回加宽）
- 执行通道：自修（代理总管）
- 执行人标识：小智（ZCode/GLM-5.3-Flash 代理总管）
- 完成日期：2026-09-05
- 派单基线 HEAD：domain-bot @ `a45d732`（npm test 373/373 绿，计划文档入库时点）
- 实际落盘 HEAD：见 commit（根仓 gitlink 同步）
- 验证：`npm test` 388/388 绿 exit=0；typecheck/build exit=0；mutation ALL_MUTATIONS_PASS
- 自测标记：ALL_DB08_PASS
- 改动文件：config/{gates,sources}.json、config/personas/{deepthought,newsline}.json、src/{types,pipeline,staging,cli}.ts、src/gates/index.ts、src/editorial/recall.ts、src/memory/observe.ts、src/gatekeeper/board.ts、ops/com.domain-bot.plist、tests/{gates,recall,wiring}.test.ts、docs/probe-changelog.md
- 关联台账更新：根仓 `NUMBERING.md` DB-08 登记；本仓 `probe-changelog.md` 实时行
- 遗留风险：宽通道真实命中数据待首跑验证（校准 fail-safe 兜底）；D-11 待裁；候选池化待议
