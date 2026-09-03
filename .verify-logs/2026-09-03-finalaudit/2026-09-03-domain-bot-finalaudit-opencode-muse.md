# domain-bot 开跑前终审报告（opencode-muse 独立第三线）

- 身份：opencode-muse（opencode 内置模型 muse-spark-1.3-contributor-free）
- 开始时间戳：2026-09-03T10:26:34Z（`date -u` 实测）
- 开工核实 HEAD：`89ffc2d`（≠ 工单申报 `b0fd280`——见 §0；`HEAD == origin/main`，实测见 §7）
- 方法：只读审查（未做任何 commit/push/checkout/文件修改）；`npm test` 实跑；逐项 grep + 全文阅读引码；**未读取任何其他并行线的报告**（目录列表仅用于确认落盘名不冲突）。

## 0. 状态漂移声明（先于一切结论）

工单 §0 申报 HEAD 应为 `b0fd280`，但开工实测 HEAD 为 **`89ffc2d`**，中间新增两个提交：

- `6afd148 fix(observe+feedback+evidence)+test: 开跑前终审修复批（agy/cbc 双线交叉终审）`——含 P0-1（observeRound 回写 `enabledSourceIds`）、P1-1（receiver offset 原子写 + 坏文件留存）、P1-2（G-1/P-1 viewed 经 `--probe-start` 过滤）、P2-2（D2 注释勘误）+ 3 条新增守卫测试，申报 `npm test 122/122 绿`；
- `89ffc2d docs(workplan)`——纯文档，§〇 快照更新至终审闭环。

本报告**以当前 HEAD（`89ffc2d`，代码等价 `6afd148`）为审查靶子**，任务一核对表逐项在此靶子上取证。效果：工单申报的 15 项（D1–D9/R1–R3/C9/C10/B2）之外，`6afd148` 的 4 项增量修复一并纳入复核（记为 F1–F4）。凡下文"当前 HEAD"均指 `89ffc2d`。

## 1. 结论先行

**三态判定：带条件可开跑。**

一句话理由：修复链 15 项 + 增量 4 项共 19 项全部落地属实（`npm test` 实测 122/122 绿，exit 0），代码侧已无阻断；阻断只剩非代码项——判定线签字（含 I-3/I-4/P-4 三处行文同步）、三 key、双基线、生产验收与真机联调（Phase C 第 3/4/5/6/7 项）。

分级发现：P0 代码项 0 条（`6afd148` 已把 cbc 线抓到的真 P0 修掉，本线独立复核确认修法正确）；P0-签字项 1 条（I-3 行文与实现不一致，签字前必须同步，否则签字即签错口径）；P1 共 2 条；P2 共 5 条。详见 §2。

## 2. 分级发现（P0/P1/P2，均带 file:line + 引码 + 修法）

### P0（阻断签字/开跑）

**P0-S1（签字阻断，非代码）：criteria:19 I-3 行文仍是旧口径，实现已是新口径——签字前必须同步行文。**
- `docs/probe-verdict-criteria.md:19`：`| I-3 | 采集失败源占比（skippedSources/enabled 源）连续 3 轮 > 1/3 |`
- 实现 `scripts/gen-evidence.mjs:60-75`：分子 = `skippedSources.length + zeroYieldSources.length`（`const roundBadSources = (o) => (o?.skippedSources?.length ?? 0) + (o?.zeroYieldSources?.length ?? 0)`），分母 = 该轮 `o.enabledSourceIds.length`（`roundBadSources(o) / o.enabledSourceIds.length > 1 / 3`），旧观测缺字段走显式 nodata。行文"skippedSources/enabled 源"既漏了分子中的 `zeroYieldSources`，又没写"分母按轮取"。
- 修法：签字包中把 criteria:19 改为"采集失败 + 零产出源占比（(skippedSources + zeroYieldSources) / 该轮 enabledSourceIds）连续 3 轮 > 1/3"，并补一句"返回空的源（emptyYieldSources）单列可见、暂不计入分子（待 M6 标定）"。**在改之前签的字，签的是错口径。**

### P1（应修但不阻断开跑）

**P1-1：P-4 §2d 行文未精确到 D5 实施的行格式——签字包同批修。**
- `docs/probe-verdict-criteria.md:59` 只写"记一行 `{date, digestId, itemId, decision}`"，而实现 `scripts/gen-evidence.mjs:55-59` 要求管道行 + 四要素正则（`^\|\s*P-4\s*\|`、`digestId\s*[=:]\s*\S+`、`itemId\s*[=:]\s*\S+`、`decision\s*[=:]`、`decision\s*[=:]`、`d{4}-d{2}-d{2}`），精确格式实际落在 `docs/probe-changelog.md:3`（`` `| P-4 | <date> | digestId=<id> | itemId=<id> | decision=<一句话> |` ``）。
- 修法：criteria §2d 追加一句"行格式以 probe-changelog.md:3 为准（管道行 + `digestId=`/`itemId=`/`decision=`），四要素缺一即 gen-evidence 计无效"。不修不 блоки开跑（探针期内无 P-4 输入），但签字前顺手修掉成本为零。

**P1-2：P-4 fail 方向无测试锁定（D9 只锁了 I-1 fail + I-2/P-4 nodata）。**
- `tests/evidence-script.test.ts:43-49` 锁的是 `I-1=fail`、`I-2=nodata`、`P-4=nodata`（未传 `--probe-end`）；`P-4` 在 `--probe-end` + 零有效 artifact 时应为 `fail`（`scripts/gen-evidence.mjs:128`：`status: probeEnd ? (p4Valid.length >= 1 ? 'pass' : 'fail') : 'nodata'`）——该分支无测试。
- 修法：补一例 `runScript(dir, ['--probe-end'])` 断言 `P-4=fail`（fixture 自带无 artifact changelog，可直接用）。纯测试增量，不阻断开跑。

### P2（建议）

**P2-1：I-2 窗口内外对齐是近似口径（分子按 `f.at`、分母按 `o.at` 切窗）。**
- `scripts/gen-evidence.mjs:33-34`：`obsForI2` 按 `o.at >= probeStart`，`fbForI2` 按 `f.at >= probeStart`。探针窗边界上的反馈（窗前推送、窗内点 👍）会计入分子不计入分母（虚高），反之窗内推送、窗后反馈会被漏计。两周尺度下边界效应可忽略，且"反馈必晚于推送"的系统性偏向对 I-2（下限 5%）是保守方向。修法（可选）：I-2 分子改为"其对应推送轮在窗内"的反馈；不改亦可，但应在签字时口头确认接受近似口径。

**P2-2：I-3 展示值只取末轮，状态看末 3 轮——两者可短暂不一致。**
- `scripts/gen-evidence.mjs:70-74`：`value` 用 `observations.at(-1)`，`status` 用末 3 轮中 `badRounds >= 3`。bad, bad, good 序列下状态 pass 但展示值是 good 轮的 0%，反之 good, good, bad 下状态 pass 但展示值是 bad 轮的高比例。非错误（状态为准），但周报阅读者可能误读。修法（可选）：value 展示 3 轮各自的分式（如 `1/7, 1/7, 0/7`）。

**P2-3：`escMd` 先 slice 后转义 + 按 UTF-16 length 计预算——emoji/代理对边缘。**
- `src/push/telegram.ts:38`：`c.title.slice(0, 120)` 等先截断再 `escMd`；若截断点落在代理对中间会产生孤立代理项，Telegram 可能 400。另预算 `candidate.length > 3880`（`:43`）是 UTF-16 码元数，与 Telegram 的字节/字符口径不完全同。实践中标题多为 ASCII/CJK（CJK 按单码元计反而保守），触发概率极低。修法（可选）：slice 改按 `Array.from(s)`（码点）切；Phase C 第 7 项真机联调用含 emoji 标题+超长 why 的 digest 覆盖一次即可。

**P2-4：首簇即超预算时输出只剩 head + 截断标记（内容全丢）。**
- `src/push/telegram.ts:40-48`：`text` 初值为 `head`，首个 `candidate = head + b` 若 `> 3880` 则 `text += '…（已截断）'` 后 break——单个簇（含 120+300+200 上限文本）实际到不了 3880（约 700 字量级），此分支不可达，属防御性死码。修法（可选）：首簇超预算时至少放行首簇（与"簇边界截断"原则一致），或留原样（无害）。

**P2-5：`recordView` 按 digestId 全局去重 + digestId = `now.toString(36)`（ms 精度）。**
- `src/memory/store.ts:111-112`：`if (this.views.some((v) => v.digestId === digestId)) return false`；`src/index.ts:121`：`const digestId = now.toString(36)`。同 1ms 内跑两轮（测试/重放）会 digestId 碰撞导致第二轮 viewed 记不上；生产每天 1 轮无此风险。修法（可选）：digestId 追加随机后缀或单调计数。现有 `tests/receiver.test.ts:132-144` 的去重语义不受影响（同 digest 重复点击仍去重，符合 criteria §2c"viewed 唯一定义 = 记录存在"）。

### 独立复核 `6afd148` 增量修复（F1–F4，全部确认为真修）

- **F1（P0-1，cbc 线）：observeRound 回写 `enabledSourceIds`——真，且修法正确。** 缺它时真实观测（index.ts 路径此前是否传参？现 `src/index.ts:145` 传 `enabledSourceIds: enabled.map((s) => s.id)`）若未回写，I-3 在真实数据上恒走 `gen-evidence.mjs:67-68` 的 nodata 分支（假阴性，违反"只能证伪"）。现 `src/memory/observe.ts:124`：`enabledSourceIds: input.enabledSourceIds ?? []`，且测试 `tests/observe.test.ts:63` 锁定全量回写（含 skippedSources，注释写明分母须为全量——正确，因分子含 skipped）。独立确认：分子分母口径一致，无稀释/膨胀。
- **F2（P1-1，agy 线）：saveOffset 原子写 + loadOffset 坏文件留存——真，对齐 D6。** `src/feedback/receiver.ts:100-106` tmp+rename；`:84-96` 坏文件改名 `.corrupt-<ts>` + console.error 留痕。测试 `:83-99` 双守卫覆盖。边缘说明：改名用 `Date.now()` 时间戳，两坏文件同 1ms 会碰撞覆盖——offset 文件极小且单实例，接受。
- **F3（P1-2，agy 线）：G-1/P-1 viewed 经 probeStart 窗口过滤——真。** `scripts/gen-evidence.mjs:36`：`viewsForProbe = probeStart ? views.filter((v) => (v.at ?? 0) >= probeStart) : views`，G-1/P-1/summary 三处消费 `:101,114,140` 全切到 `viewsForProbe`。测试 `tests/evidence-script.test.ts:104-120` 锁 3 次 vs 2 次。确认无遗漏引用（grep `views.length`/`viewsForProbe` 全文件：G-1 `:101`、P-1 `:114`、summary `:140`，一致）。
- **F4（P2-2，cbc 线）：D2 注释勘误——真。** `src/feedback/receiver.ts:108-110` 现为"offset 在该条处理完（成功；或 3 次失败留痕后跳过）才推进"，与实现 `:119-131`（逐条 try/3 次重试、`offset = Math.max(offset, u.update_id + 1); saveOffset(...)` 逐条落盘）一致。此前"只在成功后推进"确与"毒 update 跳过也推进"矛盾，勘误成立。

## 3. 任务一核对表（当前 HEAD `89ffc2d`，逐项 真/假/部分 + 证据）

| # | 申报修复 | 结论 | 证据（file:line + 引文） |
|---|---|---|---|
| D1 | Telegram legacy 转义集收敛 + 实体内禁转义 + why 200 + 簇边界截断 | 真 | `src/push/telegram.ts:23-25` `s.replace(/\\/g, '').replace(/([_*[`])/g, '\\\\$1')`（4 字符集 `_*` `` ` `` `[` + 反斜杠剔除）；`:20-22` 注释"粗体只包代码常量…用户文本一律在实体外"；`:38` `c.why.slice(0, 200)`；`:41-48` 整簇装填、`> 3880` 时只加截断标记。测试 `tests/telegram.test.ts:76-112` 四例锁定 |
| D2 | offset 逐条确认；毒 update 3 次跳过留痕 | 真 | `src/feedback/receiver.ts:111-133`：`loadOffset` 一次读入、循环内 `attempt <= 3` 重试、`if (!done) console.error(...连续 3 次处理失败，跳过…)`、逐条 `offset = Math.max(offset, u.update_id + 1); saveOffset(...)`。测试 `tests/receiver.test.ts:102-130` 毒 update 例（errors≥3、offset=3、后续仍处理） |
| D3 | sourceYield 三元组；纯重复=健康不计 zeroYield | 真 | `src/memory/observe.ts:89-97`：`fetched/afterDedupe/afterFilter` 三元组；`if (fetched > 0 && afterDedupe > 0 && afterFilter === 0) zeroYieldSources.push(id)`（纯重复 afterDedupe=0 不进）。测试 `tests/observe.test.ts:42-64`（v2ex 进 zeroYield、bili/empty 进 empty 不进 zeroYield） |
| D4 | I-2 `--probe-start` 窗口 | 真 | `scripts/gen-evidence.mjs:30-34`：`probeStart` 解析（epoch/ISO）、`obsForI2`/`fbForI2` 双过滤。测试 `tests/evidence-script.test.ts:60-82`（2/12 vs 2/2 读数差验证窗口生效） |
| D5 | P-4 四要素校验 + probeEnd 门控 | 真 | `scripts/gen-evidence.mjs:57-59` 管道行 + date/digestId/itemId/decision 四正则；`:125-130` `status: probeEnd ? … : 'nodata'`。changelog 格式源 `docs/probe-changelog.md:3` |
| D6 | store 原子写 + 坏文件留存 | 真 | `src/memory/store.ts:82-87` `writeFileAtomic`（tmp+rename）；`:53-68` `loadJson` 坏文件改名 `.corrupt-<ts>` + console.error。四个落盘点 archive/feedback/weights/views 全经原子写（`:89-95,102,114`） |
| D7 | quantile 约定写死 + 锁定测试 n=3 | 真 | `src/memory/observe.ts:71-74` `sortedAsc[Math.min(len-1, Math.floor(q*len))]`；`tests/observe.test.ts:66-74` n=3（0.1/0.5/0.9）：floor→P50=0.5，ceil→min(2,ceil(1.5))=2→0.9，断言可区分。结构有效性确认：b0fd280 申报"floor→ceil 仅该测试变红"在结构上成立（P50 分支区分；P90 floor(2.7)=2 与 ceil(2.7)→min(2,3)=2 同取 0.9，不区分但不断言区分——无矛盾）。**未重演变异**（遵守禁令） |
| D8 | I-1/I-4 观测<3 轮 nodata | 真 | `scripts/gen-evidence.mjs:65` I-3 `observations.length < 3 → nodata`；`:81` I-1 同；`:96` I-4 同。测试 `tests/evidence-script.test.ts:51-58` 单轮观测断言 I-1/I-4=nodata |
| D9 | gen-evidence 守卫（11 键 + fail/nodata + 窗口差） | 真 | `tests/evidence-script.test.ts:36-41` 11 键顺序断言；`:43-49` I-1 fail + I-2/P-4 nodata；`:60-82` 窗口数值差；`:84-101` I-3 按轮分母；`:104-120`（F3 新增）viewed 窗口。共 6 例 |
| R1 | I-3 分母按轮取；旧观测缺字段显式 nodata | 真 | `scripts/gen-evidence.mjs:64-75`：分母 `o.enabledSourceIds.length`；`:67-69` 缺字段→`{ value: '旧观测缺 enabledSourceIds…', status: 'nodata' }`，无 config 回退（`enabledCount` `:54` 已无消费——grep 确认仅定义未用，见 P2 备选注）。测试 `:84-101`（7 源观测 vs 18 源 config，读数 `/7` + `14%`） |
| R2 | fetched=0 单列 emptyYieldSources、不进分子 | 真 | `src/memory/observe.ts:96` `if (fetched === 0) emptyYieldSources.push(id)`；分子函数 `:60` 只加 skipped + zeroYield。展示注释 `:92` 与 I-3 note `:92` 均写"是否并入报警待 M6 标定"——口径一致 |
| R3 | observe.test 守卫语义同步 | 真 | `tests/observe.test.ts:57-58` 注释"返回空——暂不报警、单列 emptyYieldSources 可见（…待 M6 标定…不得静默）"，断言 `:60` 同步。纪律符合（行为+守卫同批） |
| C9 | renderDigestText 导出可测；`$_[]` 反斜杠；URL 右括号编码 | 真 | `src/push/telegram.ts:32` 导出；`:24` 反斜杠剔除、`:29-30` `)`→`%29`（`\`→`%5C`）。测试 `:76-91`（`path\\end BERT_base [CLS]`→`pathend BERT\\_base \\[CLS]`、无孤立反斜杠）、`:114-121` URL 例。`$`/`]` 不转义符合官方 4 字符集（注释 `:15-22` 引 Bot API 原文） |
| C10 | offset 持久化 + 同条同信号去重（👍→👎 双计保留） | 真 | `src/feedback/receiver.ts:77-106` load/saveOffset（F2 后原子化）；`src/memory/store.ts:207-215` 同 digestId+itemId+signal 去重，注释 `:205-206` 写明改主意双计。测试 `tests/receiver.test.ts:58-70`（重复👍零增量、👎仍入账、权重不变） |
| B2 | 按源观测 sourceYield/zeroYield + rawP50/rawTop1 原始分通道 | 真 | `src/memory/observe.ts:40,42` 落盘字段；`:49-51` rawP50/rawP90/rawTop1（rawP90 为决策点 7 额外增益）；生产调用 `src/index.ts:135-150` 全量传参（enabledSourceIds/sourceFetched/sourceAfterDedupe/sourceRelevant）。调用链闭环 |

**核对表小结：15/15 真，无假、无部分落地。** 另 F1–F4（§2）4/4 真。`R1` 附带注：`scripts/gen-evidence.mjs:54` 的 `enabledCount`（config 全局 enabled 数）在 R1 后已无消费，仅定义——死变量，建议签字后顺手删除（未列 P 级，零行为影响）。

`npm test` 实跑：**122/122 绿，exit 0**（`Test Files 16 passed`，Duration ~2s，详见 §6）。与 `6afd148` message 申报一致；与工单申报 119/119 的差值 +3 恰为 F1–F3 的 3 条新增守卫（observe/receiver/evidence 各 1），对得上。

b0fd280 quantile 变异复跑：仅读留档（message"floor→ceil 仅该测试 fail，还原复绿"）+ 上述 D7 结构核实（n=3 floor/ceil 可区分 ⟺ 断言 `rawP50==0.5` 在 ceil 下取 `0.9` 变红），结构有效，未重演变异。

**新发现主动狩猎**（重点方向全覆盖）：分母/口径（R1/F1 已修；残留 P2-1/P2-2 近似与展示问题）、重放与去重（C10 + F2 闭环；残留 P2-5 ms 碰撞）、转义边界（D1/C9 闭环 + 测试覆盖；残留 P2-3 代理对）、原子写竞态（D6/F2 单实例下闭环；多实例本就不支持——pollFeedback 单实例注释 `:136`）、quantile 一致性（全仓唯一实现 `src/memory/observe.ts:71`，P50/P90/rawP50/rawP90 四调用点 `:109-113` 同函数，无分叉）。新猎获即 P2-1–P2-5，无 P0 新 bug。

## 4. 任务二：判定线 ↔ 代码 ↔ 证据脚本 三方一致性

| 判据 | 结论 | 依据 |
|---|---|---|
| I-1（连续 3 轮 candidates=0，N=3） | 有仪器可测（语义待标定，非代码事） | 脚本 `:44-48,79-83` trailingZero + `<3 轮 nodata`；criteria `:17` N=3。M6 标定（arXiv 周末排班假红）属决策点 11 待办，数值本身不定为缺陷（遵工单 §3 约束） |
| I-2（反馈率 < X，X=5%） | 有仪器可测 | 脚本 `:49-53,86-91` 分子分母 + `--probe-start` 双过滤（D4）；criteria `:18` X=5%。真排除探针期外数据（测试 `:60-82` 数值差为证） |
| I-3（采集失败+零产出占比连续 3 轮 > 1/3） | **行文需同步（P0-S1）** | 实现=新口径（分子含 zeroYield、分母按轮、缺字段 nodata），行文=旧口径（criteria:19）。仪器本身可测，签字前必须改行文 |
| I-4（saturationRate > 0.5 原始分口径） | 有仪器可测 + 行文待案 B（留签字包） | 脚本 `:94-97` 现行文口径 + `<3 轮 nodata`；criteria `:20` 现行文。决策点 7 案 B（P90 型）改文后脚本 `:96` 与注释 `:6-7` 须同批改（X6 纪律）——`6afd148` message 已声明留签字包，属已知待办 |
| G-1（viewed < 10 次）/ P-1（viewed ≥ 10 次） | 有仪器可测（F3 修后） | 四件套存在且接线：`parseViewCallbackData`（telegram.ts:72-76）→ 键盘 👀（`:60`）→ `processTelegramUpdate` viewed 分支（receiver.ts:36-42）→ `store.recordView`（store.ts:111-116，去重）→ `views.json`；脚本 `:100-104,112-117` + probeEnd 门控 + probeStart 窗口（F3）。criteria §2c（`:50-55`）"viewed 唯一定义 = views.json 记录存在"与实现一致 |
| G-2（👍率 < 20%）/ P-2（👍率 ≥ 30% 且 ≥ 20 条） | 有仪器可测 | 脚本 `:106-110,119-123` + probeEnd 门控；去重语义（C′10）与 note `:122` 一致。数值 20%/30%/20 条只转述不评价（决策点 11） |
| G-3/P-3（戒断测试） | 缺仪器（预期内，人工判读） | 脚本 `:111,123` 恒 nodata + "需探针期末人工判读"。criteria `:28,40` 一致。非缺陷 |
| P-4（定性证据 ≥ 1 条） | 有仪器可测 + **行文需同步（P1-1）** | 脚本 `:57-59,126-130` 四要素 + probeEnd 门控；与 criteria §2d（`:57-59`）在大意上一致，但精确行格式只在 changelog:3。签字包补一句引用即可 |
| §2b 优先级 I>G>P | 行文需同步（无仪器，预期内） | 优先级是判读规则，gen-evidence 只输出三态不断案——脚本 `:77-131` 各判据独立判定，不做优先级仲裁。正确分工（仲裁在复盘会），但 criteria:47 的"中间地带默认动作（延长 1 周）"无脚本支撑是预期的。**一致，无需改** |
| §2c 文件版不计 viewed | 有仪器可测（实现支撑） | 文件通道 `src/push/file.ts` 只写 md（含"文件版不计入判定线 viewed"提示 `:9`），无任何 recordView 调用（grep 确认：`recordView` 仅 receiver.ts:39 + store.ts 定义 + 测试）。与 criteria `:53` 一致 |
| §4 禁手抄（gen-evidence 唯一数据源） | 有仪器可测（实现支撑） | 脚本直读 observations/archive/feedback/views/weights/sources/changelog 七源（`:15-26`），`--md` 覆盖写 evidence-latest.md（`:146-160`）。禁止手抄是纪律非代码，无更多可验 |

## 5. 任务三：Phase C 检查单 + 三态结论

对照 `docs/workplan-2026-09-02.md:33-35`（8 项连续编号）：

| # | 检查项 | 判定 | 证据 |
|---|---|---|---|
| 1 | Phase A 完成且 hy3 二审通过 | ✅ | workplan §〇（`:8`）+ 诊断修订/回核提交链（f6a609f/822508c）；本报告任务一确认代码态 |
| 2 | push 完成 | ✅ | `git rev-parse HEAD origin/main` 双 `89ffc2d`（§7）；workplan `:9` 一致 |
| 3 | 三 key 到位（Telegram/LLM/Jina，`.env`） | ❌ | 仅 `.env.example` 存在；workplan `:11` 明确列为剩余项。`config/sources.json` 18/18 enabled（实测）——源已配，key 未到 |
| 4 | 生产级验收（常驻真实 👍，feedback/weights 原文贴验收记录） | ❌ | 未找到验收记录落盘（docs 下无生产验收产物；workplan `:11` 列为剩余）。代码路径就绪（receiver + C′10 去重已测），差一次真实执行 |
| 5 | 双基线录完 | ❌ | workplan Phase B（`:31`）仍为计划态；`:11` 列为剩余 |
| 6 | 判定线已签字 | ❌（且被 P0-S1/P1-1 阻断） | criteria 头 `:3` "草稿，待老张签字"；签字前须先修 I-3 行文（P0-S1）+ P-4 引用（P1-1）+ I-4 案 B 改文（已知待办） |
| 7 | Telegram 真机联调（含 BERT_base/[CLS]/反引号/尾部`\`/超长 why） | ❌ | 同为 key 到位后的待办；C′9/D1 测试已覆盖同等价类（telegram.test.ts:76-121），真机是最终验证 |
| 8 | A′3 收尾 + quantile n=3 变异复跑已绿 | ✅ | `5b97ff2` + `b0fd280` 留档；本报告 D7/R1/R2/R3 + §6 确认 122/122 绿 |

**三态结论：带条件可开跑。** 条件（责任方）：①签字包三处行文同步（I-3 分子+分母、I-4 案 B、P-4 格式引用）——总管起草、老张签字前确认；②M6 标定数据（deadline 09-07）——总管；③三 key + ④生产验收 + ⑤双基线 + ⑦真机联调——老张供 key、总管执行。代码侧（本报告范围）无 further 条件；P1-2 测试增量与 P2-1–P2-5 建议均可在探针期并行消化，不卡开跑。

## 6. `npm test` 实跑读数

- 命令：`npm test`（workdir `/Users/aiatwork/Projects/domain-bot`，`> /tmp/opencode-test.log 2>&1`，无管道，exit 码直取）
- exit code：**0**
- 读数：**Test Files 16 passed (16) / Tests 122 passed (122)**，Duration ~2.01s
- 与申报对照：工单申报 119/119（`5b97ff2` 时点）→ 当前 122/122，+3 为 `6afd148` 新增守卫（observe enabledSourceIds 回写 / receiver 坏 offset + 原子 roundtrip / evidence viewed 窗口），增量对账一致。

## 7. 提交前状态重核（最后一步执行，原样贴出）

- 时间戳：2026-09-03T10:28:55Z（本节命令执行时刻；开工 10:26:34Z，审查耗时约 3 分钟）
- `git log --oneline -1`：`89ffc2d docs(workplan): §〇 状态快照更新至 2026-09-03——开跑前终审闭环（HEAD 6afd148，P0-1 I-3 回写已修，剩余签字包/标定/三 key/双基线/真机联调）`
- `git status --porcelain`：`?? .verify-logs/2026-09-03-finalaudit/` / `?? docs/.DS_Store`（仅本报告目录 + 系统文件，无跟踪文件修改）
- `git rev-parse HEAD origin/main`：`89ffc2d` / `89ffc2d`（一致，干净同步；工作区 `main = origin/main` 成立）
- 一切状态类断言以本节为准。审查期间 HEAD 无变化（开工与收工同为 `89ffc2d`）。
