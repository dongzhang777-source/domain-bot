# domain-bot 开跑前终审工单（判定线签字前外部审查 · 外贴版）

> 本工单由老张亲自外贴。作答身份默认 **opencode-muse**（opencode 内置模型 muse-spark-1.2-contributor-free）；若实际作答的是其他工具/模型，请把下文所有落盘名与身份标识中的 `opencode-muse` 替换为你的实际身份。
> 并行另有独立审查线（agy、cbc-hy3）在跑同一靶子，**禁止读取任何其他线的报告**；交叉比对由总管在验收时统一做。你的报告必须独立成稿。

## 0. 边界（硬性，违反即废稿）

- 工作目录：`/Users/aiatwork/Projects/domain-bot`（HEAD 应为 `b0fd280`，`main` = `origin/main`；开工先核实并记录）。
- **只读审查**：禁 commit / push / amend / reset / stash / checkout；禁改任何仓库文件（含 `config/`、`docs/`、`.env`）；不得实际执行变异测试（改源码再还原一律禁止——并行共仓）。
- 允许：只读 git 命令、`npm test` 实跑、阅读任意文件。
- **产物落盘**（唯一允许写入的文件）：`.verify-logs/2026-09-03-finalaudit/2026-09-03-domain-bot-finalaudit-opencode-muse.md`。若你的作答环境无文件写入能力，**回退为全文回复**，由总管代为落盘。
- 报告开头写明：身份、开始时间戳、核实到的 HEAD。

## 1. 背景

domain-bot 是 AI 领域需求探针（两周判定线待老张签字，等 09-03–09-08 标定数据）。2026-09-02 已走完：架构诊断（qoder 修订稿）→ 小巴 impl 审查 D1–D10 → 修复批 `b5f7fde`（D1–D9）→ qoder 两条新发现修复 `5b97ff2`（I-3 分母按轮取 + emptyYieldSources + quantile n=3）→ 收尾 `b0fd280`。**这条修复链从未被外部整体终审过**——最后一次外部看代码是小巴（看的是 `d64076c` 时点），此后 3 个代码提交（含全部 D1–D9 修复与签字前硬前置）只有总管自验。判定线签字前，这是最后一道外部审查。

已知信息（申报值，须你实核，不得采信）：
- `npm test` 申报 **119/119 绿**（`5b97ff2` message；`b0fd280` 为纯 docs 提交）。
- 修复链代码提交共 4 个：`d64076c`（B′2 按源观测 + A′3 gen-evidence）、`d6ddb62`（C′9 转义 + C′10 offset 持久化）、`b5f7fde`（D1–D9 修复批）、`5b97ff2`（收尾三项 + quantile n=3）。范围 `6d592e7..b0fd280`，约 11 文件 +542/−49。
- `docs/workplan-2026-09-02.md` §〇 状态快照**已知两处过期**（如「进行中：诊断报告修订」实际已完成），引用时勿照抄。
- `docs/architecture-diagnosis-and-roadmap-2026-09-02.md` 是**双锚**结构：§一–§八 行号锚 `d64076c`，§九 命令锚 `4c6a775`；引用其中行号必须经 §11.5 换算表换到当前 HEAD，直接当现值用就是跨时点混算。

## 2. 任务一：修复链终审（核对表，逐项判 真 / 假 / 部分落地）

对下表每一项：给出**当前 HEAD 上的 `file:line` + 关键代码引文**作为证据（防伪要求：论断必须可被总管逐条 grep 复核，不得以"我测过了"代替引码）：

| # | 申报的修复 | 落点提示 |
|---|---|---|
| D1 | Telegram legacy Markdown 转义集收敛为 `_*` `` ` `` `[`、实体内禁转义、why 限长 200+簇边界装填、截断永不切进实体/转义对 | `src/push/telegram.ts` |
| D2 | applyUpdates offset 逐条确认后推进；毒 update 重试 3 次跳过留痕，不再永久丢失 | `src/feedback/receiver.ts` |
| D3 | sourceYield 三元组 fetched/afterDedupe/afterFilter；纯重复=健康、不计 zeroYield | `src/memory/observe.ts` |
| D4 | I-2 探针期窗口 `--probe-start` | `scripts/gen-evidence.mjs` |
| D5 | P-4 四要素校验 + probeEnd 门控 | `scripts/gen-evidence.mjs` |
| D6 | store 原子写（tmp+rename）+ 坏文件改名留存不静默清零 | `src/memory/store.ts` |
| D7 | quantile 约定写死 + 锁定测试 **n=3**（floor/ceil 在 n=2 下不可区分——核实现测试确实是 n=3 且能区分） | `tests/` |
| D8 | I-1/I-4 观测 <3 轮时 nodata | `scripts/gen-evidence.mjs` |
| D9 | gen-evidence 守卫测试（11 键 + fail/nodata 各一例 + 窗口差验证） | `tests/evidence-script.test.ts` |
| R1 | I-3 分母按轮取（该轮 `enabledSourceIds.length`）；旧观测缺字段→显式 nodata、不回退 config | `scripts/gen-evidence.mjs` |
| R2 | fetched=0 单列 emptyYieldSources、可见但不进 I-3 分子 | `scripts/gen-evidence.mjs` |
| R3 | observe.test 守卫语义同步改写（「暂不单列待标定」） | `tests/observe.test.ts` |
| C9 | C′9 转义（`renderDigestText` 导出可测；`$_[]` 反斜杠、URL 右括号百分号编码） | `src/push/telegram.ts` |
| C10 | C′10 offset 持久化 `feedback-offset.json` + 同条同信号去重（👍→👎 双计为已知保留行为） | `src/feedback/receiver.ts` |
| B2 | B′2 按源观测 sourceYield/zeroYieldSources + rawP50/rawTop1 原始分通道落盘 | `src/memory/observe.ts` |

另做：
- `npm test` 实跑，记录读数与 exit code，与申报 119/119 对照。
- `b0fd280` 申报的 quantile 变异复跑（floor→ceil 仅该测试变红）**只许读其留档与测试代码核实结构有效性，不得重演变异**。
- **新发现**：核对表之外主动找新 bug。重点方向：分母/口径边界、重放与去重、转义边界（实体嵌套/截断落点）、原子写竞态、n=3 quantile 在其他调用点的一致性。每条新发现同样要求 file:line+引码。

## 3. 任务二：判定线 ↔ 代码 ↔ 证据脚本 三方一致性

通读 `docs/probe-verdict-criteria.md`（72 行）与 `scripts/gen-evidence.mjs`，逐项回答：**每个判据有没有可测的数据源？行文与实现是否一致？** 三态输出（有仪器可测 / 缺仪器 / 行文需同步）。必查项：
- I-3：criteria:19 行文仍是「skippedSources/enabled 源」，而实现已改为按轮分母 + nodata 语义——行文是否需要签字前同步？
- I-2：X=5% ↔ `--probe-start` 窗口是否真把探针期外数据排除？
- P-1：viewed 四件套（`parseViewCallbackData` / `store.recordView` / 键盘 👀 按钮 / `views.json`）是否存在且接线？
- P-4：四要素 artifact 校验与 probeEnd 门控是否与 §2d 一致。
- §2b 优先级 I->G->P、§2c 文件版不计 viewed、§4 禁手抄（gen-evidence 为唯一数据源）——实现是否支撑。
- 判据数值本身（20%、10 次、30%、5%、N=3）**只可提建议，不得当作缺陷定性**——数值属老张拍板/标定中事项（决策点 11，deadline 09-07）。

## 4. 任务三：开跑就绪判定

对照 `docs/workplan-2026-09-02.md` Phase C 检查单 8 项，逐项标 ✅（已闭环，引证据）/ ⏳（进行中，差什么）/ ❌（未动）。然后给出**三态结论**：可开跑 / 带条件可开跑（列条件与责任方）/ 不可开跑（列阻断项）。已知背景：三 key 与真机联调、双基线、签字属待办；M6 标定数据正在累积（deadline 09-07）——你的职责是核实哪些项**真的**已闭环、哪些被申报闭环但证据不足。

## 5. 报告格式

1. 结论先行：三态判定 + 一句话理由。
2. P0（阻断签字/开跑）/ P1（应修但不阻断）/ P2（建议）分级发现，每条带 file:line+引码+修法建议。
3. 任务一核对表（真/假/部分 + 证据行号）。
4. 任务二三态表。
5. 任务三就绪表。
6. `npm test` 实跑读数。
7. **提交前状态重核**（最后一步做）：重跑 `git log --oneline -1` 与 `git status --porcelain`，原样贴输出并附时间戳——一切状态类断言以此节为准，不得复用开工程度时点的读数。
