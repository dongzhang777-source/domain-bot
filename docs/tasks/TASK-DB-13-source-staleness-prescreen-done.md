# TASK-DB-13 完成报告：源级时效预筛

> 执行：代理总管小智自修（小巴工单分派 claude，因代理总管已在同一工作树完成核心改动，
> 为避免同仓双写改为会话内续完，改动全程对齐工单验收标准）
> 日期：2026-09-05｜commit `b305254`｜ALL_DB13_PASS

- **诊断（工单 §二.1）**：curl 实测 huggingface.co/blog/feed.xml（2026-09-05 21:0x EDT）——859 条、最早 2020-02-14、最新 2026-09-03、跨度 2393 天；近 30 天仅 27 条；无分页/近期参数。**治本（改 URL）不可行，预筛为正解**。
- **实现**：collectStage 采集循环后、去重前按 persona.maxAgeHours 预筛；判据与 persona 闸同口径（publishedAt>0 才判，=0 不误伤）。
- **记账铁律兑现**（工单 §二.3 选 A）：漏斗新增 `afterSourcePrescreen` 层（0 条被砍也保留，形状稳定）+ 观测字段 `stalePrescreened`/`stalePrescreenedBySource`（staging 快照与 observations.jsonl 全链落盘）。
- **三问回答（工单 §一）**：①collected 口径不变（仍是原始采集量，新层纯增量插入）——历史 35 份快照可比性保持；②zeroYieldSources 定义未动（仍按 afterDedupe>0 且 relevant=0）——全陈旧源经新字段 stalePrescreenedBySource 可查，不混入 zeroYield 也不消失；③漏斗形状断言一处更新（cli-stages.test.ts 漏斗层数组）——新层是工单要求的记账机制本身，非改测试凑绿。
- **测试**：tests/source-prescreen.test.ts 3 例（剔除+漏斗可查 / publishedAt=0 不误伤 / auditBoard 零 fatal）；变异验证（撤预筛→红→还原绿）；全量 **424/424** exit=0（412 基线 + 12）。
