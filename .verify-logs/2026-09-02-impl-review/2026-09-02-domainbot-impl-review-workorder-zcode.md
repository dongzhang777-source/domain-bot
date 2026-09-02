# 工单｜domain-bot 编码批审查（d6ddb62 + d64076c · 小巴）

- **派单**：总管会话（小智 / ZCode），2026-09-02。老张指派：小巴（WorkBuddy）审查小智的两轮编码。
- **唯一作答**：小巴 / WorkBuddy（本实例）。落盘文件名含身份标识。
- **任务性质**：代码审查 · 数值级交叉核验 · 守卫质量抽验。
- **审查对象**：两个固定 commit——`git show d6ddb62`（A′/C′ 决策无关批：C′9 转义 / C′10 offset+去重 / file.ts 指引 / B′3 changelog / A′2① workplan+README）与 `git show d64076c`（B′2 按源观测 + A′3 证据脚本）。**以 commit 为准，不依赖工作树**——工作树上另有进行中的 qoder 报告修订与后续批，均不在本次范围。
- **利害**：这两批是实现「仪器有效性」修复的第一段，直接决定探针开跑质量；其中 C′9/C′10 各解除了一个被测试锁定的旧行为，B′2 的口径定义影响 I-3 新判据与 I-1 标定。老张已拍板方向（决策不重开），你审**实现质量与完备性**。

## 硬性纪律

1. 只读审查 + 唯一落盘文件 `docs/reviews/2026-09-02-impl-d64076c-review-xiaoba.md`；禁止改 src/tests/config/docs 既有文件；禁止 git add/commit/push。
2. 允许：读任意文件、git 只读命令、`npm test`（写系统 tmpdir）、`node scripts/gen-evidence.mjs`（**不带 --md**，避免覆盖 docs/evidence-latest.md）、python3 只读脚本。
3. **变异抽验**允许且鼓励（守卫质量验证）：仅限本两批涉及的文件，逐次「改→跑测试→记录红→还原」，结束时 `git status --porcelain` 不得留下你的痕迹（既有 untracked 与 qoder 的报告修改除外）。
4. 状态断言在报告最后一步重跑并带时间戳。
5. 复跑 commit message 里声称的验证状态（109/109、110/110），不信自述。

## 必做验证

1. **逐 commit 对照其 message 声称核验**：每条声称（改了什么/为什么/解锁了什么/验证状态）有无虚报或遗漏。
2. **C′9 转义面独立推导**：parse_mode 是 legacy `Markdown`（非 MarkdownV2）——`escMd` 字符集 `_*[]` 与反引号、反斜杠是否充分且不过度？粗体/链接结构标记是否可能被误伤？`text.slice(0,3900)` 截断与转义对的交互？URL 的 `%29`/`%5C` 处理是否完整？用户文本入口是否**全部**被覆盖（title/summary/why/domain/URL——有没有漏网插值点）？
3. **C′10 语义与崩溃窗口**：①去重键 (digestId,itemId,signal) 的全部语义后果——👍→👎 双计是否有据、跨 digest 场景、`receiver.test` 旧断言「第二次👍继续累积」的解锁是否正当（对照诊断报告 §3.5① 的 P-2 防虚增目标）；②offset 崩溃窗口枚举：处理完未落盘 / writeFileSync 中途崩 / 文件损坏——每条路径的兜底（重放→去重）是否真接住，有没有第四条路径；③与 recordView（按 digestId 去重）口径不一致是否合理。
4. **B′2 口径（重点）**：`afterFilter` 定义在 **dedupe 之后**——「返回条目全部已被归档（dedupe 吃掉）」与「返回条目真的零相关」被合并为同一状态。对 I-3 新判据和 I-1 标定（M6）是否引入偏差？是否需要三元组（fetched/afterDedupe/afterFilter）？给出你的裁定。另核：zeroYieldSources 排除 skippedSources 的口径；rawP90 的 quantile 离散分位数约定与 rawP50 是否自洽（4 元素 P90=0.8）。
5. **A′3 状态机**：11 项判据逐行对照 `docs/probe-verdict-criteria.md` 原文（阈值、方向、nodata 条件）；I-2 分母 `totalPushed` 混入 4 轮修复期推送——探针期口径怎么处理才对；I-1 trailing-zero 循环（注意曾有 i++/i-- 方向错误，已修——验修正正确性并查 off-by-one）；P-4 检测正则 `/\|\s*P-4\s*\|/` 是否可被无关注入假触发、是否该校验 {date, digestId, itemId, decision} 字段。
6. **文档改动事实性**：B′3 changelog 四笔回填的日期/commit/动机对照 git log；A′2① workplan Phase D 定案与诊断报告 §2.2 的一致性；README 五处修改的准确性。
7. **流程合规**：`docs/probe-verdict-criteria.md` 是否一字未动；测试是否真锁行为（读测试本身，防「自制沙箱假通过」——W1 教训）；e2e/startup 真实入口覆盖是否仍完整。

## 自查申报（派单方自报的三个已知弱点——请独立复核，但**你的价值在找出我没申报的**）

1. `gen-evidence.mjs` 无自动化测试守卫（脚本不在 vitest 内），「输出含 11 个判据键」的 A′3 红灯断言缺失——未来改动可能静默丢键。
2. B′2 的 zeroYield 口径合并（见必做 4）。
3. A′3 的 I-2 分母混入修复期数据。

## 产出

`docs/reviews/2026-09-02-impl-d64076c-review-xiaoba.md`：

1. 逐项裁定表：验证项 / 裁定（**确认**·有据 | **纠正**·附 file:line 与实测 | **补充**）/ 说明。
2. 新增缺陷清单（P0 阻断 / P1 应修 / P2 可缓），每条附定位与建议修法。
3. 汇总判定（三选一）：**两批可放行** / **需修复后放行**（列清单）/ **有需回滚项**（列理由）。
4. 结尾状态重核：`git log --oneline -2 && git status --porcelain` + 读取时间戳。
