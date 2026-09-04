# TASK-DB-01：domain-bot L1-L3 行为范式实现验机（独立复核）

> 工单号：DB-01　｜　创建：2026-09-04　｜　创建人：总管（小智，代理总管）
> 基线 HEAD：`domain-bot @ cbf7247`（npm test 143/143 绿）
> 工作目录：`/Users/aiatwork/Projects/domain-bot`
> 推荐通道：agy（gemini-3.8-flash --effort high）
> 预计工时：1~2 小时
> 优先级：P1（产品形态打磨循环的质量闸门）
> 所属台账：`docs/HANDOFF-DEPUTY-2026-09-04.md` 附录（代理期动作台账）

---

## 〇、必读（不看会做错）

1. **你只验机，不修改、不 commit、不 push**（DISPATCH-RULES §三.4 红线）。发现问题写进报告，修复归总管。
2. 本仓 `npm test` **禁用裸 `npx vitest`**（会卡 registry 交互）；一律 `npm test > /tmp/t.log 2>&1; echo "exit=$?"`（退出码自查，管道吞码教训）。
3. 本仓近期经历了交互范式切换（静态 digest + 👍/👀 按钮 → L1-L3 渐进展开 + 行为信号）。**旧的 fb:u/vb: 回调协议仍保留在解析层（兼容已发出的旧消息），但新推送不再产生它们**——不要把「parseCallbackData 还支持 fb:u」报成缺陷。
4. 跨仓/跨文件核查用 **Grep 工具**（ripgrep），勿用 Bash grep 多关键词 `\|`（本环境静默零命中，假阴性史）。
5. 任何「缺失/未做/有缺陷」断言必须附 **grep 命令+输出 或 文件:行号**（DISPATCH-RULES §二.约束 1），无实证的断言不会被打收。

## 一、背景（为什么做）

domain-bot 是「千 bot 工厂」路线的假门探针（第一个用户=设计者老张本人）。2026-09-04 老张决断：产品形态打磨认可后才进入判定线签字与探针开跑。当天已完成三轮迭代（提交 `c5c9ad5` / `a6086e0` / `cbf7247`）：L1 钩子卡 + ▽ 展开交互 + 行为→兴趣 Beta 后验引擎 + tuna 双渠道分发。真实点击的全链路数据断言已通过（engagements/interest 落账 + editMessageText 200）。现在需要**第三方独立复核实现质量**——人肉验机已废止，你（agy）就是质量闸门。

## 二、目标与验收标准（可证伪）

逐条执行并在报告中给出**命令 + 输出摘要**：

1. **测试复跑**：`npm test > /tmp/t.log 2>&1; echo "exit=$?"` → 143/143 绿，exit=0。
2. **构建复跑**：`npm run build > /tmp/b.log 2>&1; echo "exit=$?"` → exit=0。
3. **ex: 回调协议三端一致**：核对 `src/push/telegram.ts`（hookKeyboard 生成 `ex:<digestId>:<index>`）↔ `parseExpandCallbackData` 正则 ↔ `src/feedback/receiver.ts` 的 ex 分支处理 ↔ `src/memory/store.ts` saveDigest 落档结构（loadDigest 取 clusters[index]）。三端正则/索引/字段必须严格对齐；report 任一处错位。
4. **行为→兴趣数学正确性**（`src/memory/interest.ts`）：
   - 新源 interest = α₀/(α₀+β₀) = 1/3；
   - settleStaleExposures 幂等（同一 digestId:index 不得重复计负证据）；
   - 已展开条目在 settle 中不得重复计曝光（recordExpand 已计）；
   - 边界：exposures=0 时 interest 恒 1/3，不为 0。
5. **双渠道产物完整性**：`src/push/tuna.ts` 的 `renderTunaBrief` 输出含 schema=tuna-brief-v0 / tier1/tier2/tier3 字段；实跑 `node dist/index.js --once`（带 .env）会产生 `outbox/digest-*.md` 与 `outbox/tuna/brief-*.json` 各一。
6. **回归面**：`git log --oneline -8` 所列提交（2de2b43 应答语义 / b040c35 横幅判定 / 0b26a73 每条目成消息 / cbf7247 兴趣引擎）均未被后续提交破坏——`npm test` 全绿即是回归面总断言，报告只需贴出结果。

## 三、精确落点（只读审查，不改）

| 位置 | 审查点 |
|---|---|
| `src/push/telegram.ts` | renderHookCard/renderExpandedBody 转义链（escMd/escUrl）；hookKeyboard/expandedKeyboard 回调协议；sendDigestTelegram 失败语义（任一条失败整轮抛错） |
| `src/feedback/receiver.ts` | ex 分支（loadDigest→expandDigestMessage→recordView→recordEngagement→interest）；answerQuietly 应答失败不判条目失败 |
| `src/memory/interest.ts` | Beta 后验参数（α₀=1/β₀=2/24h 判定期）；settled 幂等；loadState 坏文件改名留存 |
| `src/memory/store.ts` | saveDigest/loadDigest/digestAll（30 份裁剪）；recordEngagement（5000 条裁剪） |
| `src/push/tuna.ts` | schema 字段完整性；digestId 消毒 |
| `src/index.ts` | settleStaleExposures 每轮调用点；pushTuna 双渠道接线 |

## 四、已知坑点（明确列出）

1. `npm test` 裸跑 vitest 会卡交互（前述）；**必须**重定向自查退出码。
2. `logs/` 下历史日志含旧形态（fb:u/vb 按钮）的记录——以代码与测试为准，勿以旧日志推断现行为。
3. 仓库 `memory/` 目录是运行时数据（observations/engagements/interest/digests），验机跑 `--once` 会追加真实数据——**允许**（探针标定期数据，窗口过滤保护），但不得手改任何 memory/*.json。
4. 不要建议「把 fb:u/vb 兼容解析删掉」——旧消息仍挂在用户聊天里，兼容层是刻意的。

## 五、产物与署名

- 验机报告写到：`docs/tasks/TASK-DB-01-l1l3-verify-done.md`（标题+逐条验收结果+发现的问题清单[每条附实证]+最终结论：通过/有条件通过/不通过）。
- 报告末尾附完成署名块（DISPATCH-RULES §八.2，执行通道=agy，改动文件=无）。
- **禁止修改任何源码/测试/文档；禁止 commit/push。**
