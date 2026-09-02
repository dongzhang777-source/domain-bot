# 工单｜domain-bot 架构诊断报告 · 二审交叉审计（hy3）

- **派单**：总管会话（小智 / ZCode），2026-09-02。依据：AGENTS.md 外派纪律（二审交叉审计固定 cbc 免费模型 hy3）+ 分析/报告类派单纪律三条（单一作答 / 状态断言提交前重核 / 引用档案核至文末）。
- **唯一作答会话**：本工单的唯一作答者 = **cbc hy3（本次运行实例）**。其他任何会话不得就同一问题产出平行报告；如需交叉复审另行指派。
- **任务性质**：只读二审 · 数值级交叉核验 · 报告可执行性审查。
- **审查对象**：`docs/architecture-diagnosis-and-roadmap-2026-09-02.md` @ HEAD `8965e67`（1,123 行，§〇–§十 + §七完整工单）。文档头部自带别名表（criteria / workplan / matrix / fourparty / external）。
- **利害背景**：该报告是 `docs/probe-verdict-criteria.md`（草稿待老张签字）生效前最后一道仪器有效性闸门；其 §七 Phase A′1–A′4 与 10 个决策点将交老张拍板。**签字后判据冻结、两周内不可修改**——报告若有错，错就会变成两周的实验设计。

## 硬性纪律（违反即废稿）

1. **只读审计**：除本工单指定的报告落盘文件外**零写入**——不改任何源码/配置/测试/既有文档；不写 `memory/`、`outbox/`；**禁止 `npm start` / `npm run loop`**（会写入 memory/ 污染运行时状态，即报告 §2.1 的诊断对象本身）。
2. **禁止 git add / commit / push**（入库归总管）。
3. 允许：读任意文件、git 只读命令（log/show/diff/grep）、`npm test`（写系统 tmpdir，不污染仓库）、python3 只读脚本。
4. 一切"当前状态类"断言（HEAD、工作区脏净、文件存在性）必须在报告**最后一步**重跑命令复核并带读取时间戳（易变事实十几分钟即过期）。
5. 引用既有档案（criteria / workplan / matrix / fourparty / external 五份）必须**核至文末**——文末追加的修复记录/附注最易漏且最代表最新状态。
6. 不确定就写「未验证」，**禁止编造实测值**；与报告结论相反的证据必须给出 `文件:行号` 级反证。
7. 不推翻任何既有裁决（矩阵裁决 #1–#8、⚪ 清单、criteria 数值）——你审的是这份诊断报告，不是判定线本身。

## 必做验证（数值级交叉核验，不直采报告数字）

1. **§九证据附录实跑**：9.2 / 9.3 / 9.4 全部命令逐条实跑；9.5 至少抽 8 条。逐条记录「报告值 vs 实测值」。已知一处命令 bug 请自查：§9.4 的 `grep -o '"scoreThreshold":[0-9.]*'` 因 JSON 冒号后有空格抓不到数值，请改用 `grep -o '"scoreThreshold"[^,]*'` 重验（派单方实测五个 commit 恒 0.45）。
2. **【重点】独立重推 §1.3/§2.1 稳态算术**。派单方预置疑点（请独立验证或反驳，勿盲从）：
   - 管线语义（`src/index.ts` runOnce）：采集 → dedupe（对归档 knownIds 精确去重）→ filterRelevant（≥1 关键词）→ HeuristicScorer 原始分 ≥ 0.45 → candidates → `recordItems(candidates)` 全量入档；`rawP50/rawTop1/saturationRate` 只覆盖 **candidates**（`ranked.map(r => r.raw)`），不覆盖 relevant 全体。
   - 由 relevant(轮4)=338 且归档累计 651=647+1+3 反推：新鲜相关池 FP ≈ 989，**轮 1 新鲜池通过率 ≈ 647/989 ≈ 65%**，而非报告所称 0.88%；轮 3 的 341 条 relevant 几乎全是**构造上低于阈值 0.45 的陈旧残留**（k=1,s=0 → 0.427），3/341 的分母不是代表性样本；交叉验证：非相关数轮1 = 轮3 = 687（1676−989 = 1676−648−341），支持「feed 在四轮窗口内静态」。
   - 由此：「稳态通过率 0.88%」「稳态每天约 3 条」「低于 maxPerDigest=6 即每天都推不满」「比 D 估的低一个量级」依赖 **feed 永不轮换**这一未验证假设（arXiv rss 日轮换行为未核实；报告 §十.6 自己声明未做外部联网核实，但 §2.1 未加此限定）。若 arXiv 批量日轮换，稳态日产量 = 新增率 × ~65%，可能远高于 3 条。
   - 请给出独立裁定：①「全量入档 → 候选池退化为纯新增流」机制是否成立；②上述量化是否成立；③A′1 定性为「开跑前阻断项」是否成立；④A′1 验收判据「连跑 ≥4 轮每轮 candidates>0」在 feed 空窗日（如 arXiv 周五/周六晚无公告）是否会假红。
3. **§1.2 判据×读数可得性表**：11 行逐行对照 `docs/probe-verdict-criteria.md` 原文（编号、阈值、数据源、可得性判定）。
4. **§2.2 / §2.3 / §2.4 三条阻断项证据链复核**：`package.json` start=`--once`；`src/index.ts:247` `telegram && !once`；`tests/wiring.test.ts:71-73`（文本层守卫）；`tests/startup.test.ts:37-47`（运行时层守卫，测试名「与生产行为一致」）；`scripts/gen-evidence.mjs` 零 views 引用；`git show a1bd817 -- src/memory/observe.ts` 的 0.99 原样搬运；`src/memory/observe.ts` saturationRate 原始分口径；f(8,6)=1.0 / f(7,5)≈0.9459 算术。另核一处表述：§2.4 称 a1bd817「diff 只改了两处」，实测该提交是 A2+A3 合并提交（3 文件 +96/−47），「两处」仅对 observe.ts 的 saturationRate hunk 成立——确认报告表述是否需要收窄。
5. **§5.1 与裁决 #5 冲突的证据链**：matrix `:355-361`（⚪：删 v2ex/bili + 声明只验证英文领域）、`:394`（裁决 #5）；`config/sources.json` 5 个中文源（jiqizhixin/qbitai/exa-cn-ai/v2ex-hot/bili-llm）全部 enabled；`src/collector/dedupe.ts` CJK 2-gram（P2-2=C1）；`criteria:64` 英文领域声明原文。
6. **§七工单可执行性**：A′1–A′4 / B′1–B′5 / C′7–11 的依赖序（§7.7）与验收判据是否自洽、有无缺口。派单方预置疑点之二：**I-1 的阈值标定未出现在任何修复任务中**——在归档策略变更（A′1）与通过率认知修正后，I-1（连续 3 轮 candidates=0）是否需要与 A′4 同批重标定并列决策点？
7. **§8.2 声明抽查**：「startup.test.ts 为既有 31 份产物零提及」——grep 全仓文档验证。
8. **§3.2/§3.4/§4.1 抽样复核**：digestRefs 10 键覆盖 3/8、telegram 零转义 + `index.ts` 推送失败仅打日志、`isPublicHttpsUrl` 仅 jina 两调用点而 rss.ts/github.ts 直接 fetch source.url。

## 产出（唯一落盘文件）

`docs/reviews/2026-09-02-archdiag-review-hy3.md`，结构：

1. 逐节裁定表：章节 / 裁定（**确认**·有据 | **纠正**·附 file:line 反证与实测值 | **补充**）/ 说明。
2. 专节：§2.1 稳态算术独立重推全过程（你的推导链与数值，无论同意或反驳派单方疑点）。
3. §七工单审查：必改项清单（如有）+ 新增缺口（如有）。
4. 汇总判定（三选一）：**报告可直接用** / **需修订后可用**（列必改项）/ **不可用**（列理由）。
5. 结尾状态重核：重跑 `git log --oneline -1 && git status --porcelain && ls memory/` 并写明读取时间戳。
6. 报告署名：hy3（按派单纪律命名格式 `日期-项目-主题-身份`，本文件名已含身份标识）。
