# TASK-DB-22：domain-bot×tuna 交付链整治编码——事件判据治本（B-1）+ 发布安全护栏（C-1/A-3/C-3/B-5/B-2/B-3）

> 工单号：DB-22　｜　创建：2026-09-07　｜　创建人：总管小智
> 依据：`TASK-DB-21-ops-overwrite-and-selection-audit-done.md`（小巴审查报告，总管已抽验采纳）
> 基线 HEAD：`domain-bot @ 22f7395` ＋ `tuna @ dcf2cff`（**均已晚于审查基线**，报告行号有漂移，施工前必须重定位）
> 工作目录：`/Users/aiatwork/Projects/domain-bot` 与 `/Users/aiatwork/Projects/tuna`（**两仓串行施工，禁并行改**）
> 推荐通道：**claude**（后台派单）
> 预计工时：4–6 小时
> 优先级：P1（P0 症状已由 `19329a5` 缓解，本单治本 + 补护栏）
> 所属台账：`domain-bot/docs/tasks/`（本单）；tuna 侧改动回写 `tuna/docs/COMMITMENT-LEDGER.md`
> **单一作答**：本单唯一作答会话为被指派的 claude 会话。

---

## 〇、必读（不看会做错）

1. **先读审查报告全文（含文末）**：`docs/tasks/TASK-DB-21-ops-overwrite-and-selection-audit-done.md`。本单是其 §七行动清单的施工单。报告的行号基于旧基线（`9757a23`/`5a5f1ba`），**当前 HEAD 已前进**，所有落点必须重新 grep 定位，不得照抄行号。
2. **总管已修三项，勿重复施工**：①发布器同事件占坑已改 `createdAt` 新→旧遍历（tuna `19329a5`）；②`writePack` 已改合并写且规则为三分支（同 id 同 URL 刷新新胜 / 同 URL 异 id 跳过 / 同 id 异 URL 不挤占——domain-bot `31e1d76`，回归测试在 `tests/tuna.test.ts` 的「writePack 合并写」describe）；③`buildPack` lang 已按交付文案判。报告 §七中标"已修"的两行即此，**不要再改**。
3. **`/tmp` 是易失的**：报告的 `/tmp/db21/replay.cjs` 若已不在（机器重启），按报告 §一描述自建重放脚本（逻辑：复刻发布器 §1–§2，读 outbox 冻结副本，输出逐条存活/归因）。
4. **发布器是真推送**：`node scripts/publish-domainbot-pack.cjs` 跑一次就 commit+push 公开仓 tuna-pack 并自增线上版本。**编码与测试期间绝对禁止真跑**。测试一律用 `scripts/selftest-remote-pack.cjs` 的 fixture 模式（本地临时目录 + node http fixture），或自建等价 harness。
5. domain-bot 侧验证命令：`npm test`（vitest，455 用例基线）；tuna 侧：`pnpm tsc -b` ＋ `node scripts/selftest-all.cjs`（或逐个 selftest）。退出码纪律见 §五。

## 一、背景（为什么做）

小巴审查（DB-21）实证：交付链的两套质量判据（domain-bot 终审 vs tuna 发布器）同源不同实现，发布器侧是劣化版——停用词表只有 14 个通用虚词（无 openai/model/releases 等领域热词）、相似度用「共享词绝对数 ≥2」而非比例、事件桶词集建桶后冻结。三者叠加造成「74 条互不相关稿子进同一事件桶」，总管已改遍历序缓解症状（新稿先占坑），但**判据未改：同事件闸仍剔除 101 条（修复前 114），坑位总数没变，只是换了一批被剔的**。产线上量后（每天 60 篇）这会重新成为主要瓶颈。同时补齐审查发现的三项安全/可观测缺口（内容倒退护栏、发布历史账、并发锁）。

## 二、目标与验收标准（可证伪）

按优先级施工，每项独立可验收：

### 1.（P1）B-1 事件判据治本 —— `tuna/scripts/publish-domainbot-pack.cjs`

- 1a. `tokensOf` 的停用词改为**从 `../domain-bot/config/gates.json` 的 `dedupe.eventStopwords` 动态读取**（发布器已跨仓读 outbox，同模式：`path.join(root, '..', 'domain-bot', 'config', 'gates.json')`）；文件缺失/解析失败时**熔断退出**（非零 exit + 明确 stderr），不得静默退回内置清单——单一真源，禁止在 tuna 仓复制一份静态词表。
- 1b. 同事件判据从「共享词绝对数 ≥2」改为 **Jaccard ≥ 0.75**（与 domain-bot `config/gates.json` 的 `dedupe.jaccardThreshold` 同源读取，勿写死数字）。
- 1c. 事件桶词集改为**增量合并**（成员入桶时把自身词集并进桶词集），消除"建桶词集冻死"。
- 1d. 保留 `maxPerEvent=2` 与"同事件出现 >2 剔除"语义不变。
- **验收**：
  - [ ] 新增/更新的自测证明：两条仅共享 `openai`+`models` 这类热词、主题不同的条目，修后**不同桶**（修前同桶）；
  - [ ] 用冻结的 outbox 副本重放：`ev-1` 这类超大桶（基线 74 成员）不复存在，最大桶成员数 ≤ 8；
  - [ ] `selftest-remote-pack.cjs` 全过；tuna `tsc -b` 零错。

### 2.（P0）C-1 内容倒退护栏 —— 同文件 §3 写 manifest 前

- 2a. 新包 posts 数 < 上版 posts 数 × 80% 时中止发布（非零 exit + stderr 说明），除非命令行带 `--force`。
- 2b. 上版不存在（首发）或上版 0 条时不触发护栏（允许从 0 重建）。
- 2c. `--force` 路径要在 stderr 显著标注「人为确认内容倒退」。
- **验收**：单测或 harness 证明三种情形（<80% 拦 / ≥80% 放 / --force 放）+ 首发不误伤。

### 3.（P1）A-3 发布历史账 —— domain-bot `src/cli.ts` emitPublished

- 3a. 新增 append-only `memory/publish-log.jsonl`：每次发布追加一行 `{ at, persona, digestId, packPath, postIds }`（postIds = 实际发布的 tuna id 数组）。
- 3b. 用 store 现有的原子写纪律（grep `writeFileAtomic`）；坏行不阻断（读取方容错）。
- **验收**：测试连续发布两次产生两行追加（非覆盖），字段齐备。

### 4.（P2）C-3 发布器并发锁 —— 同 tuna 文件入口

- 与 domain-bot `acquireLock` 同语义：锁文件存在且进程活 → 非零退出；检测到陈旧锁（进程不存在）可清理。锁文件放 tuna-pack 仓外（如 `/tmp`，key 含仓库路径 hash），**不得污染公开仓**。
- **验收**：测试并发第二实例被拒。

### 5.（P2）B-5 outbox 快照一致性 —— 合并前先把 outbox 拷到临时目录再逐文件读，消除"边读边被写"。

### 6.（P2）B-2 交叉钉：新增测试锁住「domain-bot 终审判机械的形态（≥2 个 `·` 的钩子 / `Article URL`·`N stars` 元数据），发布器 mechScore 也判机械」——防未来单侧修改造成漂移。放 tuna 侧 selftest（读 domain-bot 侧样例常量即可，硬编码最小样例集）。

### 7.（P2）B-3：`limit` 参数加注释「cap 从未生效，实际卡点是质量闸」，并删除输出里误导性的「（cap=…）」字样或改为如实描述。

## 三、精确落点

| 位置 | 现状 | 要求 |
|---|---|---|
| `tuna/scripts/publish-domainbot-pack.cjs` `tokensOf` | 14 个虚词静态清单 | 动态读 `eventStopwords`（§1a） |
| 同文件事件判定循环 | 共享词≥2 + 词集冻结 | Jaccard≥0.75 + 增量合并（§1b/1c） |
| 同文件 §3 manifest 写入前 | 无护栏 | 80% 护栏 + `--force`（§2） |
| 同文件入口 | 无锁 | 并发锁（§4） |
| 同文件 §1 收集循环 | 直读 outbox | 先拷快照（§5） |
| `domain-bot/src/cli.ts` emitPublished | 无历史账 | publish-log.jsonl（§3） |

## 四、已知坑点（已核实）

1. 报告行号已漂移（审查基线旧于当前 HEAD），一切落点重新定位。
2. `writePack` 合并写已存在（`31e1d76`）且规则精细（三分支），**改它之前先读 `tests/tuna.test.ts` 的合并写 describe**，改坏任何一条既有断言即回退。
3. 发布器读 `../domain-bot/config/gates.json` 时注意：`root` 是 tuna 仓根，`path.join(root, '..', 'domain-bot', ...)`。
4. `eventStopwords` 与 `jaccardThreshold` 的真实键名以 `domain-bot/config/gates.json` 的 `dedupe` 段为准，先读文件再写代码。
5. selftest-x26/waterfall 等断言与发布器无关，但 selftest-all 会跑全套——提交前必须全绿。
6. domain-bot 的 `memory/published-fingerprints.json` 与 `memory/` 其余文件是生产在用数据，**测试一律用临时目录**（参照 `tests/cli-stages.test.ts` 的 makeRoot 模式），禁改真实 memory。

## 五、硬约束（违反即退回）

- [ ] **禁止 commit / push**（两仓皆然，入库归总管）
- [ ] **禁止真跑 `publish-domainbot-pack.cjs`**（会真实推送公开仓）；禁动 `tuna-pack` 目录与线上 manifest
- [ ] 禁止改 `domain-bot/memory/` 真实数据
- [ ] 两仓串行施工：先 domain-bot（§3）→ 全绿后 → tuna（§1/2/4/5/6/7）
- [ ] 验证命令后禁止直接接管道；必须 `set -o pipefail` 或重定向后 `echo "exit=$?"`
- [ ] 不得修改与本单无关的文件；禁新增运行时依赖
- [ ] 遵守颜色/宪法等既有 selftest 红线（若触 UI；本单预计不触）

## 六、自测要求

- domain-bot：`npm test` 全绿（455 基线 + 新增 publish-log 用例）。
- tuna：`pnpm tsc -b` 零错；`selftest-remote-pack.cjs` 与新增护栏/锁/Jaccard 用例全过；`selftest-all.cjs` 全绿。
- B-1 验收必须含「冻结快照重放对比」数字（修前 vs 修后：最大桶成员数、同事件剔除数、存活数），写进报告。

**自测标记**：报告末尾输出 `ALL_DB22_PASS`。
**验收方式**：总管会抽查重放数字（亲自跑对比）+ 读新增测试断言（改坏输入必须变红）。

## 七、交付物

1. 代码改动（两仓，未 commit）
2. 自测报告落盘：`docs/tasks/TASK-DB-22-publisher-event-and-safety-done.md`（含 §八完成署名块：工单号/通道/两仓 HEAD/验证命令与结果/改动文件/遗留），末尾 `ALL_DB22_PASS`
3. B-1 重放对比数字（修前/修后）
4. 若发现本单与代码现状不符（含审查报告的错漏），明确指出并带实证，不要将错就错

## 八、禁止事项

- 禁止顺手重构无关代码；禁止把「顺手看到的问题」写进改动（单独列出即可）
- 禁止在报告中声称已验证实际未跑的项
- 禁止对 `tests/tuna.test.ts` 既有断言做任何放宽
