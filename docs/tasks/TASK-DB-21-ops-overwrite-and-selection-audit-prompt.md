# TASK-DB-21：domain-bot 产线「覆盖写丢数据 / 交付选择错位」运营隐患专项审查

> 工单号：DB-21　｜　创建：2026-09-07　｜　创建人：总管小智
> 基线 HEAD：`domain-bot @ 9757a23`（main，vitest 上轮全绿；本单为只读审查，不改码）＋ `tuna @ 5a5f1ba`
> 工作目录：`/Users/aiatwork/Projects/domain-bot`（主）、`/Users/aiatwork/Projects/tuna`（发布器一段）
> 推荐通道：**agy**（gemini-3.8-flash --effort high，免费通道，符合峰谷定价纪律；只读审查无写入风险）
> 预计工时：3–4 小时
> 优先级：**P1**（已发生实际丢稿：2026-09-07 两轮 25 条亲写稿线上仅存活 4 条）
> 所属台账：`domain-bot/docs/tasks/`（本单）；发现的问题逐条回填根仓 `docs/DRIFT-LEDGER.md` 或本仓 IMPROVEMENT 台账
> **单一作答**：本单唯一作答会话为**被指派的 agy 会话**；其他会话不得就同一问题产出平行报告，交叉复审另行指派（固定 cbc hy3）。

---

## 〇、必读（不看会做错）

1. **本单源自 2026-09-07 当天两次实锤事故**，不是理论推演。审查时把每个疑似问题都对照：*"这个问题今天是否已经实际发生或必然会发生？"*——没发生且无必然性的，降级为观察项，不冒充发现。
2. **引用档案核至文末**（DISPATCH-RULES §五.4）：`docs/plan-content-quality-overhaul-2026-09-06.md` 文末有 09-06 晚老张裁决附注，引用该计划时必须读到最后一行。
3. **跨仓核查禁用 Bash grep**（DISPATCH-RULES §四.1），用 Grep 工具；「零命中」须换单词重查+读文件终审。
4. domain-bot 产线分两仓：`domain-bot`（生产端，产出 `outbox/tuna/feed-pack-*.json`）与 `tuna`（发布器 `scripts/publish-domainbot-pack.cjs`，推送公开仓 tuna-pack）。两仓都要看，别只查一半。
5. 终审闸 `gk:hookEntity` 要求**每个钩子**命中原文实体词，且停用词表（`config/gates.json` 的 `dedupe.eventStopwords`）里含 `openai/agent/survey/reasoning/nvidia/benchmark/models/anthropic/memory` 等常见词——审查文案相关问题时先读这张表再下结论。

## 一、背景（为什么做）

2026-09-07 的编辑部生产（每日 11/15/19 三轮，见 `scripts/xiaozhi-copy.mjs` 头注释）暴露了两类运营事故：

**事故 A（覆盖写丢数据）**：`publish` 对同一 digestId 重跑时，`writePack`（`src/publish/pack.ts:131-137`）按 `<persona>-<digestId>` **整文件覆盖**，而 `store.markPushed`（`src/pipeline.ts:429`）在第一次发布时就已把条目写入指纹库——重跑后被指纹挡掉的条目**已消费但不在任何 pack 里**，对下游永久丢失。当天实测：11:00 轮三次重发导致 pack 只剩最后一轮增量，被迫手动清指纹重发补齐。

**事故 B（交付选择与生产意图错位）**：发布器 `tuna/scripts/publish-domainbot-pack.cjs` 从 22 个历史 pack 合并 265 条候选，质量闸剔 240 条后仅 25 条上线（`:127-130` 排序取 `kept.slice(0, limit)`，limit 默认 200，**实际约束是质量闸而非 cap**）。结果：2026-09-07 两轮 25 条亲写稿（已过 domain-bot 侧终审、llmCopy 全绿）只有 **4 条**在线上 v15 包里；而旧轮次（09-03 的 `mtq0a0lm`，120 条机械稿起家）反而占 13 席。总管最初诊断为「按日期取最新 25」，写单复核时已证伪——**真实的存活账至今没人算清**，这正是要审查的第一个问题。

**不审查的代价**：编辑部每日三轮稳定产稿，交付端持续静默丢稿——老张「每轮 20 篇」的目标在 App 端永远对不上账，且每次丢都表现为「产量又不行了」，误导整改方向。

## 二、目标与验收标准（可证伪）

对下述 **A/B/C 三族隐患**逐条排查，产出报告。每条发现必须满足：

1. **可复现**：附复现命令/脚本 + 实际输出（对 A 族：构造同 digest 两次 publish 场景核对 outbox 与指纹库差集；对 B 族：用 outbox 现存 22 个 pack 重放发布器并逐条列出「被剔/存活 + 命中的闸规则」）；
2. **有实证**：文件路径 + 行号，或命令 + 输出（DISPATCH-RULES §二.1）；
3. **有分级与行动建议**：每条按 P0 即修 / P1 近期 / P2 排期 / 🎯 触发式 分级，并给落点（改哪个文件哪段）+ 双向论证（不修的代价 vs 修了会推翻哪个已验证资产）（§二.2、§七.2）。

### A 族：覆盖写 / 先记账后交付（domain-bot 仓）

排查所有「同 key 覆盖写」与「状态先记账、交付后置」的组合，至少覆盖：

- `writePack`（`src/publish/pack.ts:131`）、`writeBoard`（`src/cli.ts:393`）、`saveDigest`/`registerDigestRef`（`src/pipeline.ts:437`、`:452`）、staging 三段产物（`src/staging.ts:316` `stagePath`）、`memory/` 下 store 的全部 `save*`/`mark*`。
- 判定口径：同一 digestId 重跑 publish / review / copy 任一段时，**哪些已交付数据会丢、哪些账目会与交付物脱钩**。已知实锤：markPushed 先于 pack 落盘的最终一致性（`pipeline.ts:424-429` 注释自称「两步分离」，但 publish 本身可能在 pack 写出前失败吗？查 `emitPublished` 的调用顺序与异常路径）。

### B 族：交付选择与生产意图错位（tuna 发布器 + 产线参数）

1. **【最高优先】重建 09-07 v15 的 25 条存活账**：对 `kept` 的逐条列出「来源 digest + 命中/躲过哪条闸规则」，回答：为什么 `mtq0a0lm` 的机械钩子稿（如 `word · word · word` 型）能过闸，而 `mtrlvrkb`/`mtrm4lhx` 的英文句式机械稿和 9 条亲写稿被剔？闸的正则/判据是什么（`publish-domainbot-pack.cjs:50-130` 附近），是否与 domain-bot 侧终审判据（`gk:*` 断言）**同源不同实现**（两处维护必然漂移，参照 fati 的 `isTitlePrefix` 同源教训，见 `domain-bot/src/gatekeeper/assertions.ts:138-142` 注释）？
2. 盘点产线全部硬编码容量/排序参数与「每轮 20 篇」目标（老张 2026-09-06 裁决，`plan-content-quality-overhaul-2026-09-06.md` 文末附注）的匹配度：`maxItems=10`、`editorialTargetsOf` 的 `maxItems*2`（`staging.ts:251-253`）、事件 cap 与 `eventTrimmed`（当天实测裁掉 1 条达标亲写稿）、`recall.maxPerRound=20`、`FINGERPRINT_LIMIT=20000`（`pack.ts:145`）、发布器 `limit=200`。逐条回答：这个数字今天卡了什么、明天会卡什么。
3. deepthought（720h 时效、arXiv 源日期偏老）与 newsline（当日新闻）**共池排序**的系统性挤压：量化 arXiv 类内容在线上包的期望存活率。

### C 族：跨仓状态机不同步

- domain-bot 的指纹库在 `publish` 即记账，tuna-pack 推送是**另一个仓的另一个脚本**异步做的——中间窗口崩溃/漏跑时，哪些内容永久跳票？manifest 版本单调陷阱（历史教训：09-05 基线 v5）现在由谁守？
- App 端拉取侧（tuna 仓 `packages/feeds/` 与 manifest 校验）对 pack 内 `lang` 字段的消费：当天实测 domain-bot 给中文文案标了 `lang=en`（`buildPack` 的 lang 来自候选原始语言），下游是否有人依赖这个字段做断言/展示分流？

## 三、精确落点

| 位置 | 现状 | 要求 |
|---|---|---|
| `tuna/scripts/publish-domainbot-pack.cjs:50-130` | 质量闸+排序+裁剪约 80 行单文件逻辑 | 逐行读，重建 v15 存活账（B.1） |
| `domain-bot/src/publish/pack.ts:131-137` | writePack 同名覆盖 | A 族逐点核（可只读重放，不改码） |
| `domain-bot/src/pipeline.ts:424-456` | recordItems→markPushed→saveDigest 归档段 | 核对异常路径下的账实脱钩 |
| `domain-bot/src/cli.ts:380-400` | emitPublished 落盘+看板 | 核对 pack 写出失败时指纹是否已入账 |
| `domain-bot/config/gates.json` + `src/gatekeeper/assertions.ts` | 终审判据与停用词 | 与发布器闸比对同源异实现问题（B.1） |

## 四、已知坑点（已核实，勿重复踩）

1. `limit` 默认 200（`publish-domainbot-pack.cjs:28`），**当前 25 条卡点在质量闸不在 slice**——总管 09-07 上午「按日期取最新 25」的诊断已被复核证伪，勿沿用。
2. 同 digest 重跑 publish 时，重跑前已发布条目会被 `gk:alreadyPublished` 拒绝（指纹库生效），这是设计行为；问题在**覆盖写**与**记账时机**，不在指纹去重本身。
3. `eventTrimmed` 裁掉同簇达标稿是设计内多样性闸（09-07 15:00 轮实测裁《Document VLMs》1 条），审查时区分「设计如此但参数可能过紧」与「实现缺陷」。
4. 产线文案语言是中文，但 pack 条目 `lang` 字段是 `en`（来自候选原文语言）——已知现状，审查 C 族时核实下游消费者，不要当新发现报。
5. `evidence/feed-quality-*.json` 与 `staging/*` 每轮新增，git 里大量未跟踪文件属正常生产残留，不是本单发现项。

## 五、硬约束（违反即退回）

- [ ] **只读审查**：禁止修改两仓任何源码/配置/staging/outbox/memory 文件；实验性重放只允许写到 `/tmp`
- [ ] **禁止 commit / push**（入库归总管）
- [ ] 断言必须附实证（路径+行号或命令+输出）；建议必须双向论证；全称量词必须给抽样方法
- [ ] 跨仓核查禁用 Bash grep，用 Grep 工具
- [ ] 报告中一切状态类断言在提交前最后一步重跑复核并带时间戳
- [ ] 不动 `/Users/aiatwork/Projects/domain-bot/memory/`（含指纹库——总管生产在用，动了会丢稿）

## 六、自测要求

本单无代码改动，自测=报告中的复现脚本与输出：

- B.1 必须附：重放命令 + v15 全部 25 条的「存活/被剔 × 闸规则」完整对账表（265 条中对账 25 条存活 + 抽样 30 条被剔，抽样方法写明）。
- A 族必须附：至少一个「同 digest 重跑丢数据」的最小复现（可在 /tmp 复制仓状态后实验）。

**自测标记**：报告末尾输出 `ALL_DB21_PASS`。
**验收方式**：总管会抽查对账表中至少 5 条，亲自重放核对；复现脚本跑不出的条目视为未证实，整条作废。

## 七、交付物

1. 审查报告：`/Users/aiatwork/Projects/domain-bot/docs/tasks/TASK-DB-21-ops-overwrite-and-selection-audit-done.md`（发现逐条编号，每条含：现象、实证、根因、分级、行动建议+双向论证）
2. v15 存活账对账表（可附报告内或独立附件路径）
3. `/tmp` 下的复现脚本无需交付，但报告中必须内联关键命令与输出
4. 若发现本单描述与代码不符（含总管上述诊断的错漏）：明确指出并说明依据，不要将错就错

## 八、禁止事项

- 禁止顺手改码（哪怕是「 obviously 一行就能修」——修复另行派单）
- 禁止把未复现的推断写成发现
- 禁止动 tuna-pack 公开仓与 manifest
