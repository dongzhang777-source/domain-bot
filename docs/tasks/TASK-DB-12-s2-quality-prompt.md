# TASK-DB-12：S2 内容质量三项修复（D4 兜底 why / D6 钩子冗余 / D7 近重复事件）

> 工单号：DB-12　｜　创建：2026-09-05　｜　创建人：代理总管小智（老张指令「S2 外派 CLAUDE」）
> 基线 HEAD：`domain-bot @ 830f77d`（npm test 400/400 绿，2026-09-05 16:5x 实测）
> 工作目录：`/Users/aiatwork/Projects/domain-bot`
> 推荐通道：claude
> 优先级：P2（S2 收尾，老张点名外派）
> 依据：`.verify-logs/2026-09-05-domainbot-tuna-l1l3-e2e-cbc.md`（DB-11 验机报告 D4/D6/D7 条目）

---

## 〇、必读（不看会做错）

1. **只改 domain-bot 仓**，禁 commit/push（入库归总管）；tuna 仓由总管另线改动，**禁止触碰 `/Users/aiatwork/Projects/tuna`**。
2. **禁止写 `memory/`、`staging/`、`outbox/`、`evidence/`**（生产数据区，且有生产轮正在跑——16:51 已 kickstart，你的改动不得与运行中的产线互扰）。禁止 `npm run build`（dist 归总管管理）。
3. 测试命令 `npm test`（400 例，约 3 秒）；验证后必须重定向自查退出码（`npm test > /tmp/t.log 2>&1; echo exit=$?`），禁止裸 `npx vitest`（卡 registry 交互）。
4. 相关既font代码：`src/render/tuna.ts`（HOOK_LIMITS/SUMMARY_MAX/WHY_MAX/MIN_HOOK_CHARS/deriveHooks/truncateWhy/detectLang/stripHtml）、`src/gatekeeper/render.ts`（renderPost/fallbackWhy）、`src/refinery/scorer.ts`（humanizeReason）、`src/gates/eventCluster.ts`（topicTokens/entityTokens/capEvents 聚类判据）、`src/gatekeeper/assertions.ts`（十二条终审断言）。
5. 三项缺陷的真实证据在 DB-11 报告 §B5/C8/D7：兜底 why 16/56 条、钩子与标题重叠 >0.8 共 33 条、newsline 同事件 6 变体（#1/6/11/12/13/14）。

## 一、任务与验收标准（逐项可证伪）

### 1. D4：兜底 why 有信息量（现状 16/56 条是零信息模板）

- 现状：`humanizeReason` 无关键词/信号命中时产「与「ai-llm」相关」/「Related to your ai feed」。
- 要求：兜底分支改为从**条目自身**构造（首句 / 实体词 / 领域信号组合，由你定具体方案），使无命中条目的 why 可区分、有内容指向。
- 铁律（违反即退回）：永不空串、永不回显浮点分数、`truncateWhy` 词边界截断且 ≤WHY_MAX=40 码点、双语（detectLang）、永不抛错、**不得动 LLM 打分器的 reason 通路**。
- 验收：新增 ≥1 测试——无关键词命中条目产出的 why ≠ 旧通用模板、非空、≤40 码点、语言随条目；全量 npm test 绿。

### 2. D6：钩子去冗余（现状 33 条 hook[0]≈标题子串）

- 现状：`deriveHooks` 的首句钩子与标题字面重叠 >0.8（cbc 口径），信息增量低。
- 要求：首句钩子若与标题高度重合（用可复算判据：去省略号后与标题的字符重叠率，或复用 `isTitlePrefix` 同族思路自定，须写明阈值与依据），换用次句/实体卡递补。
- 联动约束（最易翻车处）：改后钩子仍须过终审——`gk:mechanicalTruncation`（不得是标题前缀截断）、`gk:hookEntity`（须含原文实体词，topicTokens 口径）、恒 3 条互异、每条 ≥MIN_HOOK_CHARS=12 且 ≤HOOK_LIMITS[lang]。**先读这三条断言再动手**。
- 验收：新增 ≥1 测试——构造「标题与其首句同源」的真实形态样本（可仿 DB-11 报告 #0 neuronto 条），断言产出钩子与标题重叠低于阈值且三条互异；全量绿。
- 双向论证：若你评估后认为「换钩子」会系统性降低钩子质量（如次句比首句更差），允许改为「不改」结论，但必须给量化论证与替代建议。

### 3. D7：近重复事件合并（现状同事件 6 变体并存）

- 先诊断：用 newsline 6 变体（cbc 报告 §D7 列的 id）复现聚类为何未合并——读 `eventCluster.ts` 的判据（jaccard 阈值 / token 口径 / 事件键），找到未合并的具体原因，写进报告。
- 要求：最小改动方案（调阈值 / token 归一化加数字掩码 / 事件键加宽，择一），**禁止推倒 DB-04 事件聚类语义**（`tests/e2e.test.ts` 的「聚类先于配额」「事件复检」用例是语义基准，必须保持绿——若你论证它们需要随语义微调，须逐条列出并说明为何不属于「改测试凑绿」）。
- 验收：新增 ≥1 测试——同事件词级变体（真实洗稿形态：词级不同、实体相同）被合并/降权到 maxPerEvent 内；全量绿。
- 双向论证：若诊断后认为「不合并」的代价可接受（如 capEvents 已限占坑），允许「不改」结论 + 论证。

## 二、硬约束（违反即退回）

- [ ] 禁止 commit / push / `npm run build`；禁止触碰 tuna 仓、memory/、staging/、outbox/、evidence/、ops/
- [ ] 不得改十二条终审断言的既有判据（新增判据可以）；不得改 HOOK_LIMITS/SUMMARY_MAX/WHY_MAX 数值（tuna 侧对应值，改了必漂移）
- [ ] 验证退出码必须重定向自查；报告内一切「状态类」断言附命令+输出+读取时间戳
- [ ] 交付物落盘：报告 `/Users/aiatwork/Projects/domain-bot/.verify-logs/2026-09-05-domainbot-db12-s2-quality-claude.md`（改了什么/为什么/每项验收命令输出/遗留）

## 三、自测标记

报告末尾输出 `ALL_DB12_PASS`（三项各：结论[改/不改]+论证+测试证据）。总管会读你的测试断言本身并做变异抽验——只写 ALL_PASS 无真实断言视为未通过。
