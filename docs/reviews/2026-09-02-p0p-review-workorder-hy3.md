# 二审工作单 —— domain-bot P0' 修复验收（派给 cbc/hy3）

> 评审者身份标识：**hy3**（产物与结论以此身份落盘）
> 产物落盘契约（必须遵守）：你的评审报告写到 `/Users/aiatwork/Projects/domain-bot/docs/reviews/2026-09-02-p0p-review-hy3.md`，文件名不得更改，头部写明「评审者：hy3 · <时间>」。**只读审查 + 运行测试可以，禁止 git commit / push。**

## 审查对象

仓库：`/Users/aiatwork/Projects/domain-bot`（独立 git 仓库，HEAD 起点为 `2ae4b5c`）。
本次审查范围 = P0 修复验收（D 评审）之后的 **P0' 七项修复**，对应提交 `git log f13a6e7..HEAD`：

- A1 修 V1：`src/feedback/receiver.ts` 改持 `memoryDir`、每回调从盘重建 store；`tests/lifecycle.test.ts` 长驻拓扑反测试
- A2 启动链守卫：`tests/wiring.test.ts` 末尾 3 条 + 变异验证记录
- A3 观测补全：`src/memory/observe.ts`（RoundInput、rawP50/rawTop1、saturation 改原始分、collected/relevant/skippedSources/feedbackCount/isNewRate）
- A4 闸门改内容哈希：`src/memory/weights.ts`、`src/memory/store.ts`（WeightsState.feedbackHash）
- A5 补 Task11 红灯 + 日志"簇"→"条"
- A6 `src/collector/urlTemplate.ts`（{{since_days:N}}）+ digestRefs 500 上限 + 删 push.json 死字段
- A7 `scripts/gen-evidence.mjs`

背景材料（按需读）：`docs/p0p-fix-report.md`（执行者自述，**不要采信，一切自行验证**）、`docs/reviews/review-2026-09-02-external.md`（D 评审，本修复针对其三票否决）、`docs/workplan-2026-09-02.md`。

## 必做验证（每条给原始输出）

1. `npm run build && npx vitest run` —— 记录总测试数与结果。
2. **V1 回归验证**：写你自己的临时探针测试（复现"长驻 store + 后续 ref 写入 + 真实回调"），确认新实现下回调 `recorded`；跑完删除，`git status` 须干净。
3. **守卫变异验证**：把 `src/index.ts` 中 `if (telegram && !once) {` 改为 `if (false) {`，跑 `npx vitest run tests/wiring.test.ts`，记录哪条红；恢复后全绿。
4. **闸门哈希验证**：手工改 `feedback.json` 同一条反馈的 signal（条数不变），确认下一次权重重算响应了修改。
5. **观测字段核验**：读 `memory/observations.jsonl` 最后一行，对照 `src/memory/observe.ts` 的 RoundObservation 字段清单。
6. **执行者自述抽查**：`docs/p0p-fix-report.md` 中至少 3 条声称逐条到代码/提交里核实，写明核实结果。

## 评审问题（结论→理由→可证伪的反对意见）

1. D 的三票否决（V1 陈旧 store / 守卫防不住摘链 / 观测自证污染）是否真正闭合？
2. 新引入的代码里还有什么"绿灯但断开"或"仪器再次失灵"的路径？（重点：receiver 每回调 new store 的开销与并发写 weights.json/archive.json 的竞态；refreshWeights 哈希闸门的 TOCTOU）
3. `docs/probe-verdict-criteria.md` 判定线草稿的数值与结构有没有漏洞？
4. 无限定区：任何你认为更要紧的话。

## 输出格式

- 每条必做验证贴原始输出（不接受"已通过"三个字）。
- 末尾总判断三选一：**验收通过 / 带条件通过（列条件）/ 打回（列理由）**。
- 报告控制在 300 行以内。
