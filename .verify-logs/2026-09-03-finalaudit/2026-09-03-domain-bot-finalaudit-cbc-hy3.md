# domain-bot 开跑前终审 · 独立审查线 cbc-hy3

- **身份**：cbc-hy3（独立终审线之一，模型 hy3 / 腾讯免费通道）
- **开始时间戳**：2026-09-03 05:35:13 EDT
- **核实到 HEAD**：`b0fd280`（main = origin/main，一致；`git log --oneline -1` 与开工时点同值）
- **边界遵守**：全程只读。未 commit/push/amend/reset/stash/checkout，未改任何仓库文件（含 config/、docs/、.env）。未重演 quantile 变异（仅读其留档 + 测试结构核实）。npm test 为申报允许的实跑。
- **交叉比对**：未读取同目录其他审查线报告；本报告独立成稿，由总管在验收时统一比对。

---

## 1. 结论先行

**三态判定：带条件可开跑（condition-blocked on sign-off）。**

一句话理由：119/119 测试绿、修复链主体（D1–D9、R2、R3、C9、C10、B2、D6、D7、D8）在 HEAD 上**真实落地**且可被 grep 复核；但 **R1（I-3 分母按轮取）在真实数据上永远失效**——`observeRound` 的 `RoundObservation` 输出未回写 `enabledSourceIds`（`src/memory/observe.ts:96-120`），`gen-evidence.mjs` 读到的 `o.enabledSourceIds` 恒为 `undefined`，I-3 对任意真实观测**恒为 `nodata`**。这意味着判定线 I-3（采集故障假阳性防护）是一条**静默假阴性通道**：采集失败 >1/3 不会被看见，直接违反探针「只能证伪」的立身之本。该修复极小（回写一个字段），**老张签字前必须闭合**，否则判定线形同缺一条 I- 项。其余 Phase C 手工项（三 key、真机联调、双基线、签字）属待办/未动，不在此审查的代码 scope 内。

---

## 2. 分级发现（每条带 file:line + 引码 + 修法）

### P0（阻断签字 / 开跑前必须修）

**P0-1｜R1 的「分母按轮取」在真实数据上永远失效（enabledSourceIds 未回写观测）**
- 证据 A（实现缺口）：`src/memory/observe.ts:96-120` 的 `observeRound` 返回对象**不含 `enabledSourceIds`**；其接口 `RoundObservation`（`observe.ts:27-60`）也无该字段。该字段仅作为入参存在（`observe.ts:18` `enabledSourceIds?: string[]`，`:87` 消费）。调用点 `src/index.ts:145` 确实传入 `enabledSourceIds: enabled.map((s) => s.id)`。
- 证据 B（下游永 nomatch）：`scripts/gen-evidence.mjs:65` `if (last3r.some((o) => !Array.isArray(o.enabledSourceIds) || o.enabledSourceIds.length === 0)) return { value: '旧观测缺 enabledSourceIds——分母无法按轮取', status: 'nodata' }`。因真实 JSONL 的每行都无此字段，I-3 **对任意真实观测恒走 nodata**。
- 证据 C（测试未覆盖该缺口）：`tests/observe.test.ts:42-61` 只在入参传 `enabledSourceIds` 并断言 `sourceYield/zeroYieldSources` 输出，**未断言 `enabledSourceIds` 被回写**；`tests/evidence-script.test.ts:84-101` 手工往 fixture 行里塞了 `enabledSourceIds`，故测试绿但真实路径红。
- 证据 D（诊断原本就预期它出现在观测里）：`docs/architecture-diagnosis-and-roadmap-2026-09-02.md:386`「取它的 `length` 作为该轮的 `enabledCount` 即可」、`:461`「`gen-evidence.mjs:52` 的 `enabledCount` 改为取该轮观测的 `enabledSourceIds.length`」——诊断的验收口径就是「观测带该字段」，实现漏了回写。
- 修法：在 `RoundObservation` 接口与 `observeRound` 返回值中加 `enabledSourceIds: input.enabledSourceIds ?? []`（与 `bySource` 等并列）。一行改动即闭合 R1。
- 影响：不修则 I-3 全期 `nodata`，采集故障不可见 → 判定线 I- 防护缺一项，签字无效。

### P1（应修但不阻断开跑）

**P1-1｜判定线 I-3 行文与实现分子口径不一致（criteria 漏「零产出」）**
- 证据：`docs/probe-verdict-criteria.md:19` 标题为「**采集失败**源占比（skippedSources/enabled 源）」；实现分子为 `skippedSources + zeroYieldSources`（`scripts/gen-evidence.mjs:58` `roundBadSources = (o) => (o?.skippedSources?.length ?? 0) + (o?.zeroYieldSources?.length ?? 0)`），gen-evidence 的 I-3 行名也是「**采集失败+零产出源占比**」（`gen-evidence.mjs:90`）。criteria 行文的分子只列 `skippedSources`，漏了 `zeroYieldSources`。
- 修法：签字前把 `criteria:19` 改为「采集失败+零产出源占比（skippedSources ∪ zeroYieldSources，分母取该轮 enabledSourceIds.length）」，与实现/行名对齐。否则签字后「采集失败」与「零产出」的边界会因行文被事后重新解释。
- 注：criteria `:19` 分母「enabled 源」与实现「该轮 `enabledSourceIds.length`」一致（不矛盾），仅分子漏项。

**P1-2（连带 P0-1）｜I-3 nodata 守卫在 P0 修复前等于「静默吞掉采集故障」**
- 见 P0-1。列为 P1 仅强调：即便不视为「bug」，在签字语境下 I-3 永久 nodata 也构成判定线缺口。修复即同步消解。

### P2（建议，不阻断）

**P2-1｜C9 申报字符集 `$_[]` 与实际转义集不符（实现是对的，措辞错）**
- 证据：`src/push/telegram.ts:23-25` `escMd` 实际转义集为 `_ * \` [`（Telegram legacy Markdown 官方 4 字符集，见 `telegram.ts:15-22` 注释引 Bot API 原文）；`$` 与 `]` 在 Telegram legacy Markdown **不需转义**。申报核对表 C9 写「`$_[]` 反斜杠、URL 右括号百分号编码」——`$_[]` 非实际字符集。
- 实质项均真：`renderDigestText` 已导出（`telegram.ts:32`）；反斜杠剔除（`escMd` 第 24 行 `s.replace(/\\/g, '')`）；URL `)` 百分号编码（`escUrl` 第 29 行 `u.replace(/\)/g, '%29')`）。
- 修法：核对表/工单措辞改为官方 4 字符集 `_*[\``，避免事后被人按 `$_[]` 去「补」转义而引入回归。非代码缺陷。

**P2-2｜D2 注释「offset 只在该条成功后推进」与代码不符（行为按设计可接受）**
- 证据：`src/feedback/receiver.ts:116-117` 在 `for (const u of updates)` 内**无条件**推进 `offset = Math.max(offset, u.update_id + 1); saveOffset(...)`，即便 3 次重试后仍 `!done`。注释 `receiver.ts:94-96` 首句写「offset 只在该条成功后推进」字面不成立；但同注释第二段已说明「跳过即该条反馈丢失（日志留痕，宁丢一条不丢一队）」，与代码一致。
- 判定：行为正确（毒 update 推进 offset 以 ACK Telegram、避免死循环重放），申报 D2「毒 update 重试 3 次跳过留痕，不再永久丢失」的「不再永久丢失」措辞偏松——实际是「丢但留痕（console.error）」，非「可重放保留」。
- 修法：注释首句改为「offset 在该条处理完（成功或 3 次失败）后推进」，与代码及「宁丢一条不丢一队」设计一致。

**P2-3｜P-4 artifact 行强依赖字面 `decision=` 令牌，criteria 2d 未给出精确行格式**
- 证据：`scripts/gen-evidence.mjs:57` 校验正则含 `/decision\s*[=:]/i`；`gen-evidence.mjs:127` 注释给出精确格式 `| P-4 | <date> | digestId=<id> | itemId=<id> | decision=<一句话> |`。但 `docs/probe-verdict-criteria.md:59`（§2d）只写「记一行 `{date, digestId, itemId, decision}`」，**未要求字面 `decision=`**，若操作员写成「影响决策：…」则正则不命中、P-4 假 fail。
- 修法：§2d 补一行精确行格式（或指向 gen-evidence 注释），消除实现/行文耦合风险。

**P2-4（边角）｜D6 空文件被视为 corrupt 并重命名**
- 证据：`src/memory/store.ts:53-68` `loadJson` 对 `readFileSync` 返回 `''` 时 `JSON.parse('')` 抛错 → 进入 catch → 重命名为 `.corrupt-<ts>`。当前 `writeFileAtomic`（`store.ts:82-87`，tmp+rename）不会写出空文件，故仅外部截断会触发；重命名空文件无数据损失，危害低。知悉即可，不强制修。

---

## 3. 任务一：修复链终审核对表

> 判级：真 / 假 / 部分落地。证据为当前 HEAD 的 `file:line` + 关键引码。

| # | 申报修复 | 判级 | 证据（HEAD） |
|---|---|---|---|
| D1 | Telegram legacy Markdown 转义集收敛为 `_*[\``、实体内禁转义、why 限长 200+簇边界装填、截断永不切进实体/转义对 | **真** | `src/push/telegram.ts:23-25` `escMd` 转义 `_*[\`` 且先 `replace(/\\/g,'')`；`:38` `c.why.slice(0,200)`/`title.slice(0,120)`/`summary.slice(0,300)`；`:43-46` 整体超 3880 才在簇边界后追加 `…（已截断）`；实体 `*${i+1}. ${tag}*` 只包受控序号/标签，用户文本在实体外。截断落点安全（切片在前、escMd 在后，反斜杠已剔除，无悬挂转义）。 |
| D2 | applyUpdates offset 逐条确认后推进；毒 update 重试 3 次跳过留痕 | **真**（措辞见 P2-2） | `src/feedback/receiver.ts:97-119`：逐条 `for (const u of updates)`；`:106-114` 3 次重试退避 1x/2x/3x；`:115` 失败 `console.error` 留痕；`:116-117` 推进 offset 并 `saveOffset`。注：offset 在成功与失败均推进（设计「宁丢一条不丢一队」），非「仅成功后」，见 P2-2。 |
| D3 | sourceYield 三元组 fetched/afterDedupe/afterFilter；纯重复=健康、不计 zeroYield | **真** | `src/memory/observe.ts:84-95`：`:92` 写入三元组；`:93` `zeroYield = fetched>0 && afterDedupe>0 && afterFilter===0`；纯重复 `afterDedupe===0` 不入 zeroYield（健康）。`tests/observe.test.ts:42-61` 锁语义。 |
| D4 | I-2 探针期窗口 `--probe-start` | **真** | `scripts/gen-evidence.mjs:30-34`（解析 `--probe-start`，`obsForI2`/`fbForI2` 按 `o.at/f.at >= probeStart` 过滤）；`:87` I-2 分母 `totalPushed` 用 `obsForI2`。`tests/evidence-script.test.ts:60-82` 验窗口真生效（值串 2/12 vs 2/2 不同）。 |
| D5 | P-4 四要素校验 + probeEnd 门控 | **真** | `scripts/gen-evidence.mjs:55-57`：四要素 `/\d{4}-\d{2}-\d{2}/` + `digestId=` + `itemId=` + `decision=` 齐备才算 `p4Valid`；`:126` `status: probeEnd ? (p4Valid.length >= 1 ? 'pass' : 'fail') : 'nodata'`。 |
| D6 | store 原子写（tmp+rename）+ 坏文件改名留存不静默清零 | **真** | `src/memory/store.ts:53-68` `loadJson`：解析失败→`renameSync` 为 `.corrupt-<ts>` 并 `console.error`，不静默；`:82-87` `writeFileAtomic`：`writeFileSync(tmp)`→`renameSync(tmp, finalPath)`。 |
| D7 | quantile 约定写死 + 锁定测试 n=3（floor/ceil 在 n=2 不可区分） | **真** | `src/memory/observe.ts:69-72` `quantile` 写死 `sortedAsc[Math.min(n-1, Math.floor(q*n))]`；`tests/observe.test.ts:63-71` 用 n=3 `[0.1,0.5,0.9]` 断言 `rawP50=0.5`（floor）/ `rawP90=0.9`。**未重演变异**（边界约束）：结构有效性已核——若改 ceil，`P50=sorted[ceil(1.5)=2]=0.9≠0.5` 即红；n=2 时 floor/ceil 同取 index1 不可区分，故 n=3 必要。`b0fd280` 留档声明 floor→ceil 仅该测试变红、还原复绿。 |
| D8 | I-1/I-4 观测 <3 轮时 nodata | **真** | `scripts/gen-evidence.mjs:79` `I-1: observations.length < 3 ? 'nodata'`；`:94` `I-4: observations.length < 3 ? 'nodata'`。`tests/evidence-script.test.ts:51-58` 锁 1 轮时二者均 nodata。 |
| D9 | gen-evidence 守卫测试（11 键 + fail/nodata 各一例 + 窗口差） | **真** | `tests/evidence-script.test.ts:36-41`（11 键齐全）、`:43-49`（fail/nodata 例）、`:60-82`（窗口差）。 |
| R1 | I-3 分母按轮取（该轮 `enabledSourceIds.length`）；旧观测缺字段→显式 nodata、不回退 config | **部分落地（逻辑在、观测缺口→见 P0-1）** | 逻辑真：`gen-evidence.mjs:62-73` 分母取 `o.enabledSourceIds.length`、缺字段显式 nodata 不回退 config。但**真实观测不含该字段**（`observe.ts:96-120` 未回写）→ 真实数据下恒 nodata。修复见 P0-1。 |
| R2 | fetched=0 单列 emptyYieldSources、可见但不进 I-3 分子 | **真** | `src/memory/observe.ts:94` `if (fetched === 0) emptyYieldSources.push(id)`；`gen-evidence.mjs:58` `roundBadSources` 只计 `skippedSources + zeroYieldSources`，**不含** `emptyYieldSources`。`tests/observe.test.ts:60` 锁 `emptyYieldSources = ['bili','empty']`。 |
| R3 | observe.test 守卫语义同步改写（「暂不单列待标定」） | **真** | `tests/observe.test.ts:42-61`：注释「dead-src 属 skippedSources（源挂了）；bili/empty 返回空——暂不报警、单列 emptyYieldSources 可见」「是否并入 I-3 报警待 M6 标定」。语义与 R2 落地一致。 |
| C9 | C′9 转义（renderDigestText 导出可测；`$_[]` 反斜杠、URL 右括号百分号编码） | **真**（字符集措辞见 P2-1） | `src/push/telegram.ts:32` `export function renderDigestText`；`:24` 反斜杠剔除；`:29` `escUrl` `u.replace(/\\/g,'%5C').replace(/\)/g,'%29')`。字符集实现为官方 4 字符 `_*[\``，与申报 `$_[]` 措辞不符（P2-1）。 |
| C10 | C′10 offset 持久化 `feedback-offset.json` + 同条同信号去重 | **真** | `src/feedback/receiver.ts:77-92` `loadOffset`/`saveOffset` 读写 `feedback-offset.json`；`src/memory/store.ts:207-215` `recordFeedback` 按 `digestId+itemId+signal` 去重（👍→👎 不同信号各计，见 `store.ts:205-206` 注释）；`store.ts:111-116` `recordView` 按 `digestId` 去重。 |
| B2 | B′2 按源观测 sourceYield/zeroYieldSources + rawP50/rawTop1 原始分通道落盘 | **真** | `src/memory/observe.ts:40-52`：`RoundObservation` 含 `sourceYield`/`zeroYieldSources`/`emptyYieldSources`/`rawP50`/`rawP90`/`rawTop1`（均原始分，注释明确「判定进化只看原始分」）；`:107-112` 由 `rawScores` 计算。 |

**npm test 实跑读数**：`Test Files 16 passed (16)`、`Tests 119 passed (119)`、exit code 0（与申报 119/119 一致）。注：`tests/startup.test.ts` 的 stderr `telegram sendMessage: HTTP 404` 为测试桩无真实 key 的预期噪声，非失败。

**新发现（核对表之外，主动找 bug）**：
- **P0-1**（R1 真实失效，见上）——最高优先。
- 其余见 P1-1 / P2-1~P2-4，无额外独立新 bug。
- 重点方向复核结论：分母/口径边界（P0-1、P1-1）；重放与去重（C10 已正确，offset 重启续拉 OK，👍→👎 双计为设计保留）；转义边界（实体嵌套无——实体只包受控文本，用户文本恒在实体外；截断落点安全）；原子写竞态（D6 tmp+rename 在 POSIX 原子，单实例写无竞态，仅空文件边角见 P2-4）；n=3 quantile 一致性（全部调用点 `candidateP50/P90/rawP50/P90` 共用同一 `quantile` 约定，一致）。

---

## 4. 任务二：判定线 ↔ 代码 ↔ 证据脚本 三方一致性

三态：有仪器可测 / 缺仪器 / 行文需同步。

| 判据 | 数据源是否存在 | 行文 vs 实现一致？ | 三态 | 证据 |
|---|---|---|---|---|
| I-1 连续 3 轮 candidates=0 | observations.jsonl（有） | 一致 | **有仪器可测** | `gen-evidence.mjs:42-46,79`；`criteria:17` |
| I-2 反馈率<5% + --probe-start 窗口 | feedback.json / observations.jsonl（有） | 一致（窗口已接 I-2 分母） | **有仪器可测** | `gen-evidence.mjs:30-34,47,87`；`tests/evidence-script.test.ts:60-82`；`criteria:18` |
| I-3 采集失败+零产出源占比 | observations.jsonl（**缺 enabledSourceIds 字段**） | 分子口径不一致（criteria 漏「零产出」） | **部分：行文需同步 + 仪器当前恒 nodata（P0-1/P1-1）** | `gen-evidence.mjs:58,62-73` vs `criteria:19`；`observe.ts:96-120` 未回写 |
| I-4 saturationRate>0.5 | observations.jsonl（有） | 一致（criteria 现行文=saturationRate；案 B P90 型待签字稿改文后同步） | **有仪器可测**（改文待同步，非缺陷） | `gen-evidence.mjs:91-96`；`criteria:20`；脚本注释 `:6-7` 声明「criteria 签字稿改文后本脚本 I-4 行随之更新——两者必须同批改」 |
| G-1 主动查看<10 次 | views.json（有，Telegram 👀 按钮） | 一致 | **有仪器可测** | `gen-evidence.mjs:99-102`；`criteria:26,50-55` |
| G-2 👍率<20% | feedback.json（有） | 一致 | **有仪器可测** | `gen-evidence.mjs:104-108`；`criteria:27` |
| G-3 戒断测试 | 无自动源（人工判读） | 一致（明示需人工） | **缺仪器（设计如此）** | `gen-evidence.mjs:109` status 恒 nodata；`criteria:28` |
| P-1 主动查看≥10 次 | views.json（有，四件套齐：parseViewCallbackData / store.recordView / 👀 按钮 / views.json） | 一致 | **有仪器可测** | `telegram.ts:60,72-76`、`store.ts:111-116`、`gen-evidence.mjs:21-22,111-115`；`criteria:38,50-55` |
| P-2 👍率≥30% 且有效反馈≥20 | feedback.json（去重后） | 一致 | **有仪器可测** | `gen-evidence.mjs:116-121`（注释「有效反馈已按 C′10 同条同信号去重」）；`criteria:39` |
| P-3 戒断通过 | 无自动源（人工） | 一致 | **缺仪器（设计如此）** | `gen-evidence.mjs:122`；`criteria:40` |
| P-4 定性证据≥1 条 | probe-changelog.md artifact 行（四要素校验） | 一致（但精确行格式耦合，见 P2-3） | **有仪器可测** | `gen-evidence.mjs:55-57,123-128`；`criteria:41,57-59` |

**必查项专项结论**：
- **I-3 criteria:19 行文**：分母「enabled 源」=实现「该轮 `enabledSourceIds.length`」一致；但分子 criteria 写「采集失败」、实现为「采集失败+零产出」，**需签字前同步**（P1-1）。且真实数据因 P0-1 恒 nodata。
- **I-2 X=5% ↔ --probe-start**：窗口确实把探针期外数据排除（分母 `obsForI2`、分子 `fbForI2` 均按 `at>=probeStart` 过滤），实测 2/12 vs 2/2 差验证真生效。**通过**。
- **P-1 viewed 四件套**：全部存在且接线（见上）。**通过**。
- **P-4 四要素 + probeEnd 门控**：`gen-evidence.mjs:55-57,126` 齐备，`probeEnd` 才评估。**通过**（行格式耦合见 P2-3）。
- **§2b 优先级 I->G->P**：裁决纪律，未写入代码（由 gen-evidence 报状态、人工裁决），属设计预期，非缺陷。
- **§2c 文件版不计 viewed**：`pushFile` 不记 viewed，viewed 仅 Telegram 👀 按钮；gen-evidence 只读本。`snapshot-evidence.mjs` 仅复制原始 memory/ 与计数，不重算判据、不引入第二手抄源。**实现支撑 §4 禁手抄**。
- **判据数值（20%/10 次/30%/5%/N=3）**：仅建议，属老张拍板/标定中（决策点 11，deadline 09-07），**不当作缺陷定性**，不列发现。

---

## 5. 任务三：开跑就绪判定（Phase C 8 项）

| # | Phase C 检查单项 | 状态 | 证据 / 差什么 |
|---|---|---|---|
| 1 | Phase A 完成且 hy3 二审通过 | **⏳ 进行中（本审查即二审之一，待收口）** | 修复链终审本报告；并行另有独立线，交叉比对由总管做。 |
| 2 | push 完成 | **✅ 已闭环** | `src/push/telegram.ts` + `src/push/file.ts` 实现；`tests/telegram.test.ts`、`tests/startup.test.ts` 锁运行时可达性（常驻真调 `pollFeedback`）。 |
| 3 | Telegram/LLM/Jina 三 key 到位（.env） | **❌ 未动（待办）** | 不在代码 scope；属签字前手工项。注：缺 key 时 I-2 恒 nodata（设计预期）。 |
| 4 | 生产级验收：常驻真实点一次 👍，feedback/weights.json 原文贴验收记录 | **❌ 未动（待办）** | 手工验收项，非代码。 |
| 5 | 双基线录完（内容/行为/系统） | **❌ 未动（待办）** | `workplan:32` 定义；手工录制项。 |
| 6 | 判定线已签字 | **❌ 未动（待办，且被 P0-1/P1-1 阻断）** | criteria 仍为「草稿待签字」（`criteria:3`）。签字前须先闭合 P0-1（否则 I-3 形同虚设）与 P1-1（行文同步）。 |
| 7 | Telegram 真机联调：含 BERT_base/[CLS]/反引号/尾部\ /超3900字 why，确认不 400、无字面反斜杠、截断落簇边界 | **❌ 未动（待办）** | 手工项；代码侧 C9/D1 已提供正确转义（P2-1 措辞外），真机验证待 key 到位后做。 |
| 8 | A′3 收尾三项 + quantile n=3 变异复跑已绿 | **✅ 已闭环（代码侧）** | `b0fd280` 落 A′3 三项；quantile n=3 锁定测试 `tests/observe.test.ts:63-71` 绿；变异复跑留档（floor→ceil 仅该测试红、还原复绿）见 `b0fd280` message。**未重演变异**（边界约束）。 |

**三态结论：带条件可开跑。**
- **必须前置条件（阻断签字）**：闭合 **P0-1**（回写 `enabledSourceIds` 到 `RoundObservation`，一行），否则 I-3 在真实数据上恒 nodata、判定线缺一条 I- 防护；并同步 **P1-1**（criteria:19 分子补「零产出」）。
- **责任方**：P0-1/P1-1/P2 为代码/文档小改，归总管在签字前闭环（不在本审查 scope 内代修——只读约束）。
- **其余 Phase C 3/4/5/7 为手工待办**：三 key、真机联调、双基线、签字本身，依赖老张/小智在标定窗口（M6 deadline 09-07）前完成；不影响代码开跑能力，但为「开跑」正式前置。
- **可开跑含义**：运行时代码 119/119 绿、push/反馈/观测/证据脚本链路完整；修复 P0-1 后，判定线 11 项判据方可全部「有仪器可测」（I-3 不再恒 nodata）。

---

## 6. npm test 实跑读数

```
Test Files  16 passed (16)
     Tests  119 passed (119)
  Duration  1.77s
exit code = 0
```
与申报 119/119 一致。补充：测试期 `tests/startup.test.ts` stderr `telegram sendMessage: HTTP 404` 为无真实 token 的桩噪声，不计入失败。

---

## 7. 提交前状态重核（最后一步，原样贴出）

```
=== git log --oneline -1 ===
b0fd280 docs: qoder 留言收尾三项——①workplan Phase C 第 7/8 项并入连续编号列表（修复两种 Markdown 载体渲染脱节）；②README 归档处置行更新为已拍板态（开跑前重置 memoryDir，决策点 6 落定）；③quantile n=3 变异复跑实测变红（floor→ceil 仅该测试 fail，还原复绿）——#11 验收要求「复跑变异确认会红」闭环。#6/8 裁定：报告引 README:56 属 8965e67 时代史实锚（现 README 53 行）、缩写基名由别名表兜底，均不回改。4c6a775 message「两份工单」实为三份：留档不改推送历史

=== git status --porcelain ===
?? .verify-logs/2026-09-03-finalaudit/
?? docs/.DS_Store

=== timestamp ===
Thu Sep 3 05:41:11 EDT 2026
```

- 状态断言以此节为准：自开工（05:35:13）至收尾（05:41:11）**未改动任何仓库文件**（仅新增本审查落盘目录 `.verify-logs/2026-09-03-finalaudit/`，为允许的唯一写入产物；`docs/.DS_Store` 为既有未跟踪文件，非本审查产生）。HEAD 仍为 `b0fd280`，与开工核实时一致。
- 全程遵守只读边界：无 commit/push/amend/reset/stash/checkout，无改源码、config、docs、.env，无重演变异测试。
