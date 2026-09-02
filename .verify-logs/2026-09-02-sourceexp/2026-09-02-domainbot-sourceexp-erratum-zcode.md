# 勘误与交叉核验记录（执行者小智，2026-09-02）

## 勘误：新增源计数口径（cbc-R1 抓到，属实）

commit `437365c` 标题与执行者早期表述写"**8 新源入册**"，实际 `config/sources.json` 为 **7→18（净增 11 源）**：

- 档位一配置新增 10 源：hn-frontpage、simonwillison、jiqizhixin、qbitai、github-agents、github-rag、exa-agent-releases、exa-cn-ai、openai-news、anthropic-research
- 档位二新增 1 源：yt-llm（ytsearch）

错因：把 openai-news/anthropic-research（jina 源）误并入"Jina 原有盯页"口径、漏数 yt-llm。commit 未 push；**不 amend**（两份复审/验机报告的审查对象均锚定 `437365c`，改 hash 会使报告失锚），以本勘误为准。后续若 push，由总管在 PR 说明中带此勘误。

## 执行者交叉核验（数值级）

| 项 | agy-R1 | cbc-R1 | 执行者复核 | 结论 |
|---|---|---|---|---|
| 测试 | 101/101（15 文件，自行跑过） | 101/101（逐文件累加复算） | 本轮开发中两次独立跑均 101/101 | 一致 |
| 烟测 | —（未跑真实烟测） | 1438 采集/733 相关/6 推送，18/18 通 | 自跑两轮：1432/727/6（17/18 通）、1425/727/6（17/18 通，yt 未启） | 推送数 6 精确一致；采集/相关 ±0.4~0.8% 属活源时点波动；hn-frontpage 瞬时失败与 cbc"本轮全通"互补，符合瞬时特征 |
| 源配置 | 18 源 type 契约一致 | 18 源、type 与 switch 一一对应 | node 复数：总数 18、净增 11 | 一致 |
| 零写入 | agy worktree 干净 | cbc worktree 干净 | git status 双双零输出（主仓仅 .verify-logs/ 未跟踪） | 通过 |

## 复审窗口状态（已收口，2026-09-02 老张拍板：修/推/清）

- agy-R1：**通过 95/100**，0 P0 / 0 P1 / 3 P2（P2-1 upload_date 类型收紧、P2-2 中文 2-gram 分词聚类、P2-3 fetchJinaViaExa 独立导出的 SSRF 一致性）。
- cbc-R1：**通过 PASS**，防作弊审查通过（mock 仅在 SpawnFn/FetchFn 边界）。
- **处置结果**：三项 P2 全部修复（回归测试 101→106 绿，真实烟测 18/18 通无回归），随修复 commit 一并 push；worktree 已清。
