# 实现批审查报告｜d6ddb62 + d64076c（小巴 / WorkBuddy）

- **审查时间**：2026-09-02 19:16 EDT（起始 18:50）
- **审查人**：小巴（WorkBuddy 实例）。派单：总管会话（小智/ZCode），老张指派。
- **对象**：`d6ddb62`（A′/C′ 决策无关批）、`d64076c`（B′2 + A′3）。以 commit 快照为准，不依赖工作树（工作树上 qoder 的诊断报告修订与两个 untracked 目录不在本次范围）。
- **方法**：逐 commit diff 对照 message 声称 → 官方文档交叉（Telegram Bot API formatting options，2026-09-02 实抓 core.telegram.org）→ 数值级推导 → `npm test` 与 `gen-evidence.mjs` 实跑复验 → 变异抽验 6 组（M1–M6，逐次改→红→还原，终态无痕）→ 边界探针 3 组（用真实 `renderDigestText` 构造，临时测试文件跑完即删）。
- **纪律遵守**：只读审查 + 本文件唯一落盘；`npm test` 写系统 tmpdir；未执行 `gen-evidence.mjs --md`（防覆盖 evidence-latest.md）；未 git add/commit/push。

---

## 一、逐项裁定表

裁定三档：**确认**（声称属实、实现有据）· **纠正**（声称或实现有误，附 file:line 与实测）· **补充**（属实但有未声明的缺口）。

| # | 验证项 | 裁定 | 说明 |
|---|---|---|---|
| 1 | d6ddb62 改动范围与 message 一致性 | **确认** | 9 文件 diff 逐块对照：C′9/C′10/file.ts/B′3/A′2① 全部落地，无夹带。 |
| 2 | d6ddb62 测试状态 109/109 | **确认**（推演佐证） | 未切工作树，用测试计数推演：d6ddb62^→d6ddb62 净增 3 用例（receiver 改名 1 + offset 1 + telegram 2，抵消删除 1），d64076c 净增 1（observe），HEAD 实测 `npm test` **110/110 绿**（19:05 实跑，15 files）。110−1=109，与声称吻合。「红灯先行 4 新测试先红」无法事后回放，记为不可独立复核（与 diff 结构自洽：4 个新增/改名用例均为行为断言）。 |
| 3 | d64076c 测试状态 110/110 | **确认** | 19:05:37 实跑：`Test Files 15 passed, Tests 110 passed (110)`。 |
| 4 | d64076c「脚本实跑 11 键齐全」 | **确认** | 实跑（无 --md）：11 键 `I-1..I-4, G-1..G-3, P-1..P-4` 齐全；committed `evidence-latest.md` 与当前实跑输出一致。 |
| 5 | C′9 插值点覆盖 | **确认** | 全项目唯一带 parse_mode 的文本出口是 `renderDigestText`（`telegram.ts:74` 全项目孤例）；domain/title/summary/why/URL 五个用户文本插值点全部转义；键盘文案与 callback_data 均为代码常量。无漏网点。 |
| 6 | C′9 escMd 字符集「充分且不过度」 | **纠正** | 官方 legacy Markdown 原文（Bot API §formatting-options，2026-09-02 抓取）：*"To escape characters '_', '*', '`', '[' outside of an entity, prepend the character '\' before them. **Escaping inside entities is not allowed**..."*——可转义集只有 **4 字符** `_*\``[`。现字符集（`telegram.ts:18`）多转义 `]` 与 `\`：过度转义产生字面反斜杠显示噪音；且全部转义文本位于 `*…*` 粗体实体**内部**，与官方"实体内不允许转义"的规范相容性**未经真机验证**（详见缺陷 D1）。 |
| 7 | C′9 URL 的 `%29`/`%5C` 处理 | **确认** | legacy 模式无 URL 段转义手段（反斜杠规则仅对 MarkdownV2 的 `(...)` 段定义），百分号编码是正确替代且对已编码 URL 无歧义；`(` 在 legacy URL 中不构成提前闭合，无需处理。`telegram.ts:22-24` 顺序正确（先 `\` 后 `)`）。 |
| 8 | C′9 slice(0,3900) 与转义对交互 | **纠正** | 现实现**先组装实体、后整体截断**（`telegram.ts:32,36`）。边界探针实证两类破坏：①截断切进粗体实体——前 5 簇 why 长度在 726–751 区间内的 26/91 个自然构造使截断点落在第 6 簇标题（粗体内部），星号计数奇数（未闭合实体，`*…TTTT\n…（已截断`）；②截断切进转义对留下孤立 `\`（C 线实证，cosmetic）。`why` 无长度上限是可达根因。 |
| 9 | C′9「解锁 renderDigestText 可测」 | **确认** | 导出 + 2 个新测试断言真实行为；变异 M1（字符集去 `_`）红、M2（去 `%29`）红——守卫有效。 |
| 10 | C′10 去重键语义（含 👍→👎 双计、跨 digest） | **确认** | 键 `(digestId,itemId,signal)`（`store.ts:192-200`）防的是重放/连点虚增（§3.5① P-2 目标），不覆盖真实改主意——👍→👎 双计有据且注释明示。跨 digest 重复实际不可达：归档后条目被 dedupe 屏蔽，不会重推。与 recordView 按 digestId 去重的口径差异合理（一条回执 vs 每条目正反票），`store.ts:191` 注释与诊断 §3.5① 一致。 |
| 11 | receiver.test 旧断言解锁正当性 | **确认** | 旧断言「第二次 👍 继续累积」确实锁定 §3.5① 的重复入账行为，更名改语义正当；新断言三段式（重复零入账 + feedback 长度 1 + 👎 后长度 2）锁定新语义。变异 M3（去重删除）红。 |
| 12 | C′10 offset 崩溃窗口枚举（3 路径兜底） | **补充** | ①已处理未落盘 → 重放去重 ✓；②writeFileSync 中途崩 → loadOffset catch → 0 → 全量重放 → 去重 ✓；③offset 文件损坏 → 同② ✓。但存在**第④条路径**：feedback.json 自身损坏（saveFeedback 非原子写，`store.ts:78-80`）→ load 静默吞掉 JSON 错误当「首次运行」（`store.ts:57-61`）→ **全部反馈历史静默清零**——重放兜不住丢数据。另有**错误路径**（非崩溃）：`pollFeedback` 在处理前推进 offset（`receiver.ts:105` 先于 `:106`），`processTelegramUpdate` 抛错（answerCallbackQuery 网络失败/磁盘写失败）时下一次 getUpdates 即向 Telegram 确认丢弃该 update——与 `:95` 新注释「重放部分由 recordFeedback 去重兜底」不符（详见缺陷 D2）。 |
| 13 | B′2 afterFilter 口径（重点裁定） | **纠正** | `index.ts:70-74` 实证：`dedupe → filterRelevant → sourceRelevant`，**afterFilter 定义在 dedupe 之后**。「返回条目全部已被归档」与「真的零相关」合并为同一状态。对 I-3 构成假触发通道：排班平稳期（如 arXiv 周末重发已归档条目）全源 afterFilter=0 → 全源进 zeroYieldSources → 连续 3 轮即假判「仪器故障」。**裁定：需要三元组**——`sourceYield[id] = {fetched, afterDedupe, afterFilter}`，zeroYield 判定改为 `fetched>0 && afterDedupe>0 && afterFilter==0`（详见缺陷 D3）。 |
| 14 | B′2 zeroYieldSources 排除 skippedSources | **确认** | `observe.ts:76` 排除逻辑正确（不双计）；变异 M5 红（守卫有效）。源挂/零产出/有产出三态区分在 skipped ∩ zeroYield = ∅ 语义下成立。 |
| 15 | B′2 rawP90 与 rawP50 自洽性 | **补充** | 同一公式 `sortedAsc[min(n-1, floor(q·n))]`（`observe.ts:61-64`），口径自洽 ✓。离散约定下 4 元素 P50=上中位（第 3 位）、P90=max（工单所引 4 元素 P90=0.8 与测试数据 `[0.24,0.4,0.72,0.8]` 完全一致）。变异 M6（floor→ceil）**绿**——现测试对约定的锁定是弱的（对插值法会红，对 floor/ceil 置换不敏感）；约定未写入任何注释/文档（P2-7）。案 B 标定（M6/决策点 7）使用前建议把约定写死在字段注释。 |
| 16 | A′3 11 项判据逐行对照 criteria | **补充** | 阈值/方向全对：I-1 3 轮、I-2 5%、I-3 1/3 连 3 轮、I-4 0.5 持续（last3 全超）、G-1 <10、G-2 <20%、P-1 ≥10、P-2 ≥30% 且 ≥20 条、P-4 ≥1 artifact。nodata 条件大体正确（feedback.json 缺失、views.json 缺失、无反馈均 nodata）。三处偏差：I-4 在 rounds<3 时显示 pass 而非 nodata（`gen-evidence.mjs:78`）；I-1 在 observations 为空时同理（`:63`）；P-4 不受 `--probe-end` 门控且正则可假触发（`:46,110`，见 D5）——均与本脚本自述的「G/P 组中途一律 nodata」纪律冲突（P4 为 P 组）。 |
| 17 | A′3 I-1 trailing-zero 循环修正 | **确认** | `i--` 从尾部倒扫（`gen-evidence.mjs:35-39`）语义正确：只数「直到最新一轮为止的连续零候选」；边界 [0,0,0]→3=fail、[1,0,0]→2=pass 验证无误，无 off-by-one。 |
| 18 | A′3 I-2 分母口径 | **确认**（派单自报弱点 3 成立，且已量化） | `totalPushed`（`gen-evidence.mjs:40`）为 observations 全史求和。当前 memory/observations.jsonl 共 4 轮、**全部为 09-01 修复期数据**（totalPushed=10，零反馈）。探针开跑后这 10 条（及任何后续修复期推送）持续稀释分母，I-2 更易假判「探针无效」。分子（feedback）同样无时间窗。修法见 D4。 |
| 19 | B′3 changelog 四笔回填事实性 | **确认** | 逐笔对照 git log：①`0868c3a`（09-01 18:21）公式 `0.3+0.15k+0.12s` 逐字核对 ✓、`2c03e6b`（09-01 19:52）公式 `0.25+0.5·√(k/8)+0.25·√(s/6)` ✓、scoreThreshold 四个 commit 恒 0.45 ✓；②`437365c` sources 7→18 ✓（commit 时间 14:11，changelog 记 14:09，2 分钟级偏差，非虚报）；③keywords 17→23 同 commit ✓；④`6d592e7` 14:28 与 CJK 2-gram ✓ 精确。criteria:69 引用偏差 3 行（配置变更记录要求实际在 :72，「附近」措辞兜底）；criteria:64 ✓ 精确。 |
| 20 | A′2① workplan Phase D vs 诊断 §2.2 | **确认** | 常驻 `npm run loop` + launchd、禁 cron+`npm start`、`--once` 不启接收导致 I-2 假判的因果链、`index.ts:247` 行号（d6ddb62 时点准确；d64076c 加 8 行后漂移至 255，非缺陷）均与 §2.2 一致。launchd 要点（KeepAlive/RunAtLoad/WorkingDirectory=仓库根）与 `index.ts:205` `process.cwd()` 读 config 的约束一致。 |
| 21 | README 五处修改准确性 | **确认** | 逐条核：源权重只调排序 ✓（与 `applySourceWeight` 仅作用排序一致）；记忆库文件清单 ✓；`npm run loop` 每天 1 轮 ✓（`index.ts:220` 86_400_000）；反馈接收已内置 ✓；判定线 11 项引用替代旧三项简表 ✓；全量候选入档 + Telegram 已内置 ✓。「重放风险已由 C′10 解除」措辞略满（见 D2/D6），可接受。 |
| 22 | criteria 一字未动 | **确认** | `git log -- docs/probe-verdict-criteria.md`：最后触碰 `7f08ab8`（早于两 commit）；d6ddb62/d64076c 均未触及。 |
| 23 | 测试真锁行为（防沙箱假通过） | **确认** | 变异 6 组全部按预期：M1（escMd 去 `_`）红、M2（escUrl 去 %29）红、M3（去重删除）红、M4（loadOffset 恒 0）红、M5（zeroYield 不排 skipped）红、M6（quantile floor→ceil）**绿**（约定弱锁定，见 #15）。测试用 tmpdir 真实读写、断言持久化产物，非自制沙箱。 |
| 24 | e2e/startup 真实入口覆盖 | **确认** | 全量测试绿；「端到端反测试（只走真实入口）」「运行时可达性（hy3 条件 1）」「观测与降级」等用例均在且通过。两 commit 未触碰入口 wiring。 |

---

## 二、新增缺陷清单（派单方未申报的发现）

> 派单自报三点独立复核结论：弱点 1（gen-evidence 无守卫）成立 → P2-7；弱点 2（zeroYield 口径合并）成立且升级为 P1-3；弱点 3（I-2 分母）成立 → P1-4。

### P1（应修——探针开跑质量直接相关，放行前处置）

**D1｜C′9 转义方案与 Telegram 官方 legacy 规范冲突，且整条修复零真机验证**
- 定位：`src/push/telegram.ts:18`（字符集）、`:32`（转义文本位于 `*…*` 实体内部）、`:74`（parse_mode）。
- 依据：官方文档明确 legacy 模式可转义集仅 `_*\``[`（不含 `]`、`\`），且 *"Escaping inside entities is not allowed"*——本方案把全部转义后的用户文本放在粗体实体内部，与规范的相容性是**未经真机验证的假设**。另有两处实测边界：①title/summary/why 以 `\` 结尾时，escMd 输出 `\\` 紧邻模板闭合 `*`，按转义规则闭合星号被消费 → 粗体未闭合（探针 A 线实证输出 `*1. 🆕 path ends with \\*`）；②截断切进粗体实体（探针 B3：26/91 个自然构造命中未闭合星号）与切进转义对（C 线）。
- 后果：C′9 声称消除的「400 Can't parse entities → 整轮静默丢失」（§3.4）在上述边界可能原样复现；且 4 个 artifacts 先写后推的结构性放大仍在。
- 建议修法：(a) 字符集收敛为官方 4 字符 `_*\``[`，`\` 无法转义则直接剔除（`replace(/\\/g, '')`）或在文本尾部防呆；(b) 截断重构为「先按簇装配、逐簇预算长度、超限在簇边界截断」，保证截断点不落进任何实体/转义对（或截断后校验星号/括号配对，不配对则丢弃末簇）；(c) **真机联调列入 Telegram key 到位后的验收清单**：发送含 `BERT_base`、`[CLS]`、反引号、尾部 `\`、超 3900 字 why 的 digest，确认不 400 且无字面反斜杠。

**D2｜pollFeedback 错误路径永久丢失该条 update，与 C′10 新注释的安全声称矛盾**
- 定位：`src/feedback/receiver.ts:104-108`（offset 在 `:105` 处理前推进；saveOffset 仅在批尾 `:108`）。
- 场景：批内第 3 条 update 处理抛错（answerCallbackQuery 网络失败/HTTP 400、saveFeedback 磁盘异常）→ in-memory offset 已 = id3+1 → 下一次 getUpdates(id3+1) 按 Telegram 语义**确认并服务端删除** id3 → 该条 👍/👎/👀 永久丢失（重启也不回来）。非本批引入（结构承自旧代码），但 C′10 改写了此函数并新增注释「重放部分由 recordFeedback 去重兜底」——对错误路径不成立（重放只覆盖 id3 之后的 update）。
- 建议修法：逐条处理——每条 update 单独 try/catch；成功后才推进 offset 并 saveOffset（小文件，逐条落盘成本可忽略）；对 poison update（如 answerCallbackQuery 对过期 query id 恒 400）显式决策「跳过 + 打日志 + 推进」，避免无限重试卡死后续反馈。同步修正 `:94-95` 注释。

**D3｜B′2 afterFilter 混入 dedupe，I-3 获得「平稳期假触发」通道（工单重点裁定）**
- 定位：`src/index.ts:70-74`（dedupe 先于 sourceRelevant 统计）、`src/memory/observe.ts:73-81`、`scripts/gen-evidence.mjs:47,55`（I-3 分子）。
- 偏差机理：已归档条目再抓取即被 dedupe 吃掉 → afterFilter=0 → 该源进 zeroYieldSources。排班平稳期（周末、无新公告）所有源都可能返回纯重复内容 → 全源 zeroYield → 连续 3 轮 > 1/3 → I-3 假判「仪器故障，先修后跑」。I-1 的 note 已意识到同类排班假红（M6 标定），I-3 却被 B′2 的口径合并新开了假红通道。
- 裁定：**需要三元组**。`fetched`（活着）＋`afterDedupe`（有新内容）＋`afterFilter`（新内容相关）三段才能区分「源挂 / 活着但全是已归档 / 活着有新内容但不相关」。zeroYield 判据改为 `fetched>0 && afterDedupe>0 && afterFilter==0`；纯重复（afterDedupe=0）是**健康**状态。实现增量小：`index.ts` 在 dedupe 后按源计数一次即可。
- 备注：I-3 对旧观测（无 zeroYieldSources 字段）的回看口径（仅 skippedSources）已正确处理（`gen-evidence.mjs:49,74`）。

**D4｜A′3 I-2 分母/分子无探针期时间窗，修复期数据永久稀释**
- 定位：`scripts/gen-evidence.mjs:40-44,68-72`；现网数据：4 轮 observations 全为 09-01 修复期，totalPushed=10。
- 后果：探针开跑后 I-2 的分母含 10+ 条非探针推送，反馈率被稀释 → 5% 判据偏严 → 假判「探针无效」的方向性偏差（I 组触发会整体否决探针，代价不对称）。
- 建议修法：探针起点显式化——`--probe-start <ts>` 参数或从 changelog 读探针开跑记录；分子按 `feedback[].at >= probeStart`、分母按 `observations[].at >= probeStart` 过滤。探测期（签字前）保持全史口径亦可，但必须与签字稿口径同批切换（X6 纪律）。

### P2（可缓——记录在案，择批处理）

**D5｜P-4 检测可假触发、不校验字段、不受 --probe-end 门控**
- 定位：`gen-evidence.mjs:46,108-112`。`/\|\s*P-4\s*\|/` 对 changelog 中任何含该表格片段的行都会 pass——而 changelog 本来就会记录与 P-4 相关的判据/配置变更，假触发概率不低（如某行单元格恰为「P-4」）；不校验 `{date, digestId, itemId, decision}` 四字段；且 P 组其他三项都门控 `probeEnd`，唯 P-4 不门控，违反本脚本自述「G/P 组中途一律 nodata」。
- 修法：加 `probeEnd` 门控；正则升级为解析 P-4 artifact 行并校验 4 字段齐备（缺失视为 0 条）。

**D6｜store 全部 JSON 写非原子 + load 静默吞损坏 = C′10 崩溃窗口的第④条路径**
- 定位：`store.ts:74-80,86-89,99`（writeFileSync 直写）、`:51-72`（load catch 全静默）。崩溃落在写 feedback.json 的窗口 → 文件截断 → 下次启动 JSON.parse 失败被 catch 当「首次运行」→ 反馈全史静默清零（P-2 样本归零），重放兜底只防重不防丢。archive/weights/views 同理。
- 修法：tmp + rename 原子写；load 失败时打告警并把坏文件改名留存（不静默清零）。非本批引入，但 C′10 的兜底叙事依赖这些文件的完整性。

**D7｜quantile 离散约定未文档化且弱锁定**
- 定位：`observe.ts:61-64`。floor(q·n) clamp 约定：P50 取上中位、小样本 P90=max（n=4 即如此）。M6 变异（floor→ceil）测试仍绿。I-4 案 B（P90 型）标定将直接消费该值，约定应在字段注释写死并补一条锁定断言（如 2 元素 [a,b] 的 P90=b、P50=b）。

**D8｜I-1/I-4 在观测不足 3 轮时读数为 pass 而非 nodata**
- 定位：`gen-evidence.mjs:63,78`。observations 为空或 <3 轮时「未触发」与「数据不足」混同，违背三态纪律；建议补 `rounds<3 → nodata`（I-3 已有正确先例）。

**D9｜gen-evidence.mjs 零测试守卫（派单自报弱点 1，确认）**
- 最小修法：vitest 内用 child_process 在临时目录（造假 observations/views/feedback/config）跑脚本，断言 stdout JSON 含 11 个判据键、fail/nodata 方向各一例。约 30 行，离线可跑。

**D10｜「推送成功」的账面语义未变（§3.4 放大器仍在）**
- 定位：`index.ts:124-128` 状态先写、`:158-164` catch 只打日志。C′9 降低了 400 概率但未改变「失败时四 artifacts 仍记成功」。建议随 D1 修法同批考虑失败标记（outbox 或 observation 加 pushFailed 字段），使 I-2 判读可区分「没发出去」与「没人理」。

---

## 三、汇总判定

**需修复后放行。** 放行前置清单（按优先序）：

1. **D1**（C′9 重构：字符集收敛 + 反斜杠处置 + 截断重构 + 真机验证项入验收清单）——两批的headline修复，当前方案在常见 arXiv 数据形态下仍有未闭合实体通道，且核心假设未经验证；
2. **D3**（B′2 补 afterDedupe 三元组，zeroYield 判据收窄）——不开此项，I-3 在第一个平稳期就会假红，探针白跑；
3. **D2**（pollFeedback 逐条确认 + offset 后置推进）——C′10 的安全声称才成立；
4. **D4**（I-2 探针期窗口化）——可与签字稿同批，但机制须在开跑前就位。

**无需回滚项**：两批的所有改动方向正确、无破坏性引入（110/110 实测绿、criteria 未动、变异守卫 5/6 有效锁定）。D1–D4 均为增量修复，不涉及推翻已合入结构。修复建议按 D1→D3→D2→D4 顺序切片，可与 A′4/联合标定批合并执行。

---

## 四、结尾状态重核

复跑时间：**2026-09-02 19:16:46 EDT**

```
$ git log --oneline -2
d64076c (HEAD -> main, origin/main, origin/HEAD) feat(observe)+feat(scripts): B′2 按源产出观测 + A′3 判据覆盖表（老张 2026-09-02 拍板批）…
d6ddb62 fix(runtime+push)+docs: A′/C′ 决策无关批（诊断报告 8965e67 派生工单）…

$ git status --porcelain
 M docs/architecture-diagnosis-and-roadmap-2026-09-02.md          ← qoder 报告修订（既有，非本审查产物）
?? .verify-logs/2026-09-02-archdiag-review/                       ← 既有 untracked
?? .verify-logs/2026-09-02-impl-review/                           ← 既有 untracked
?? docs/reviews/2026-09-02-archdiag-review-xiaoba.md              ← 既有（上轮诊断报告审查）
```

本审查变异抽验与探针文件已全部还原/删除，除本报告外无新增工作树痕迹。审查全程只读 + `npm test`（tmpdir）+ `gen-evidence.mjs`（无 --md）。

（报告完 · 小巴 / WorkBuddy · 2026-09-02 19:16 EDT）
