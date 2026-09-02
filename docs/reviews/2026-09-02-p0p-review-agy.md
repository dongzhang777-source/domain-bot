# 评审报告：domain-bot P0' 修复 + hy3 二审交叉复核（三审）

**评审者：agy · 2026-09-02 · 模型：Gemini 3.7 Flash**
审查方式：只读审查 + 运行测试 + 源码审计 + 变异测试 + 跨轮盲区推演。**未 git commit / push**。
审查对象：HEAD（`8d17d13`），覆盖 P0' 修复（`f13a6e7..2ae4b5c`）、hy3 二审条件闭环（`696885d`）、判定线补丁（`8d17d13`）。

---

## 一、必做验证（原始输出）

### 1. `npm run build && npx vitest run`

```
> domain-bot@0.1.0 build
> tsc -p tsconfig.json

 RUN  v2.1.9 /Users/aiatwork/Projects/domain-bot

 ✓ tests/wiring.test.ts (11 tests) 14ms
 ✓ tests/evolve.test.ts (7 tests) 6ms
 ✓ tests/receiver.test.ts (3 tests) 8ms
 ✓ tests/telegram.test.ts (4 tests) 4ms
 ✓ tests/agentreach.test.ts (5 tests) 16ms
 ✓ tests/refinery.test.ts (12 tests) 8ms
 ✓ tests/e2e.test.ts (10 tests) 43ms
 ✓ tests/observe.test.ts (3 tests) 4ms
 ✓ tests/dedupe.test.ts (5 tests) 4ms
 ✓ tests/adapters.test.ts (4 tests) 9ms
 ✓ tests/urlTemplate.test.ts (2 tests) 3ms
 ✓ tests/lifecycle.test.ts (1 test) 5ms
 ✓ tests/startup.test.ts (3 tests) 833ms
 ✓ tests/store.test.ts (8 tests) 1284ms

 Test Files  14 passed (14)
      Tests  78 passed (78)
```
总测试数 **78**（相比 hy3 二审 75 个，新增 `startup.test.ts` 3 个测试）。构建无类型错误。

### 2. 复核 hy3 条件 1（注入式测试与变异验证）

读 `src/index.ts`（`startBot` 注入 `pollFeedbackFn`）与 `tests/startup.test.ts`。
**变异实测**：将 `src/index.ts:243` 的 `startFeedback(...)` 调用注释掉：

```
 ❯ tests/wiring.test.ts (11 tests | 1 failed) 17ms
   × 启动链守卫：startBot 必须把采集与反馈接收真正跑起来 > startBot 内必须在常驻分支调用反馈接收 3ms
     → expected 'export async function startBot(opts: …' to match /startFeedback\s*\(/
 ❯ tests/startup.test.ts (3 tests | 1 failed) 702ms
   × 运行时可达性（hy3 条件 1） > 常驻 + 有 telegram 时，startBot 必须真的调用 pollFeedback（不只是文本存在） 391ms
     → expected false to be true // Object.is equality

 Test Files  2 failed | 12 passed (14)
      Tests  2 failed | 76 passed (78)
```
**结论**：`tests/startup.test.ts` 的注入式测试与 `wiring.test.ts` 双重变红，确实能抓住"轮询器在运行时未被调用"（测试已恢复，`git status` 干净）。

### 3. 复核 hy3 条件 2（`src/runtime/lock.ts` 攻防诚实评估）

| 攻击 / 异常场景 | 防御现状 | 严重性与机理分析 |
|---|---|---|
| 顺序重复启动（同用户） | ✅ **防得住** | 读取 `.lock` 内 PID，`kill(pid, 0)` 确认存活则主动抛错拒绝启动。 |
| 正常崩溃后重启 | ✅ **防得住** | 旧进程已死，`kill(pid, 0)` 抛 `ESRCH`，`alive = false` 自动接管陈旧锁。 |
| 单进程内部重入调用 | ✅ **防得住** | 同一进程再次 acquire 会检出当前 PID 存活并抛错。 |
| **并发启动竞态（TOCTOU）** | ❌ **防不住** | `existsSync` 到 `writeFileSync` 非原子操作（未用 `fs.openSync(path, 'wx')` / `flock`），毫秒级并发时两实例可同时判定无锁并双写。 |
| **PID 复用 / 假死锁** | ❌ **防不住** | 若进程异常终止且其 PID 随后被 OS 回收分配给其他常驻进程，`kill(pid, 0)` 判活，导致永久死锁，必须人工 `rm .lock`。 |
| **EPERM 异常误判** | ❌ **防不住** | `kill(pid, 0)` 遇 root 或其他用户进程时抛 `EPERM`，当前 `catch` 通配处理为 `alive = false`，会将活进程误当死锁覆盖。 |
| **异常退出信号残留** | ⚠️ **脆弱** | 依赖循环退出时释放；若遇 `SIGINT/SIGTERM/uncaughtException`，无信号钩子清理，必留 `.lock` 靠下次启动探测。 |

### 4. 抽查执行者自述（代码与产物核实）

1. **A6（URL 模板 + 裁剪 + 死字段）**：`src/collector/urlTemplate.ts` 存在 `{{since_days:N}}` 实现；`config/sources.json:19` 已改用 `{{since_days:7}}`；`src/memory/store.ts:33` 确有 `MAX_DIGEST_REFS = 500`；`config/push.json` 仅保留 `outDir`。✅ 全部属实。
2. **A4（哈希闸门）**：`src/memory/weights.ts:10` 导出 `feedbackContentHash`（sha256），`src/memory/store.ts:27` 记录 `feedbackHash`，替代旧计数。✅ 属实。
3. **A5（日志文案与独立红灯）**：`src/index.ts:255` 确为 `推送 ${result.stats.pushed} 条`；`tests/e2e.test.ts:150-165` 包含独立 `skippedSources` 断言。✅ 属实。
4. **A7（证据生成脚本）**：运行 `node scripts/gen-evidence.mjs --md` 退出码 0，成功生成 `docs/evidence-latest.md`，输出包含 `feedbackCount: 0` 与 4 轮观测。✅ 属实。

### 5. `docs/probe-verdict-criteria.md` 全文审读

- **补得对的地方**：
  - §2b 明确了 `I- > G- > P-` 优先级与中间地带处置（延长 1 周定性复盘，不自动加注），消除了冲突歧义；
  - I-2 降至 5% 契合被动信息消费规律；
  - P-4 改为 `docs/probe-changelog.md` 结构化记录决策链接，杜绝了手抄口头自述。
- **仍然遗漏/严重缺陷**：
  - **§2c（已读回执）与代码脱节**：文档规定"回环 `http://127.0.0.1:8873/read/<digestId>` 点击记 viewed"，但**代码库中零行 HTTP 服务代码，digest 模板也未生成该链接**。开跑即报 404/ECONNREFUSED。
  - **跨端网络断裂**：若在手机端 Telegram 查看 digest，点击 `127.0.0.1` 访问的是手机自身回环，根本连不上跑在电脑上的 domain-bot 服务。

---

## 二、定向问题

### Q1. hy3 "带条件通过"裁决是否同意？是否有"为过审而修"痕迹？

- **结论**：**同意 hy3 的"带条件通过"结论，但在执行者补丁中识别出 2 处明显的"为过审而修 / 契约与实现脱节"。**
- **理由**：
  1. `src/runtime/lock.ts` 仅仅实现了最基础的 PID 文件读写，存在明显的 TOCTOU 并发竞态与 PID 复用缺陷，未采用原子文件创建（`flag: 'wx'`）或进程信号捕获，属于典型的"为满足审查清单而写的低阶补丁"。
  2. 判定线 §2c 写入了 `127.0.0.1:8873` 已读回执，但执行者在 8d17d13 仅改了 markdown 文档，完全未在代码中实现该 HTTP server 或注入推送模版，属于"文档过审但系统未通"。
- **可证伪反对意见**：若有人认为"已读回执可在 Phase C 补齐"，反例是：如果判定线现在签字定稿，当前代码开跑将直接产生零已读数据，导致 I-2/G-1 误判；文档与实现脱节必须在开跑前闭环。

### Q2. 前两轮共同盲区：第三类"测试全绿、仪器全灵、但结论仍会错"的坑

- **结论**：**存在 3 个严重的第三类系统性偏倚：**
- **理由**：
  1. **时间维度的衰减与疲劳混淆（Novelty Decay）**：作者在第 1-4 天因系统刚上线有极高审查与试用热情，高频互动；第 8-14 天进入疲劳期。若仅看 14 天累计聚合（如 P-1 ≥10 次、P-2 ≥20 条），首周的新鲜感会直接"保送"达标，掩盖次周的弃用真相。
  2. **排版顺序带来的注意力偏倚（Position Bias）**：digest 推送 6 条内容，读者注意力天然集中在第 1-2 条。排在前面的内容获得更多 👍/👎，进而强化其源权重；这不是源质量的胜利，而是排版位置的正反馈固化。
  3. **单用户样本（n=1）的主观证实偏差（Effort Justification）**：老张作为设计者和推动者，对 P-4（"影响了一个工作决策"）的定性归因存在心理学上的"付出合理化"倾向，容易将一次普通浏览归因为关键决策支持。
- **可证伪反对意见**：若有人认为"戒断测试能消除主观偏差"，反例是：戒断期（停推 3 天）若恰逢老张出差或攻坚其他项目，零主动打开会被误判为"产品失败"；若恰逢空闲去翻看，又会被误判为"强需求"，无法排除日程干扰。

### Q3. 新设计（new MemoryStore / PID 锁 / 已读回执）哪个最可能实际出问题？

- **结论**：**已读回执（127.0.0.1 回环）最可能出问题（且是必然失效），其次是 PID 锁。**
- **理由**：
  1. **已读回执**：代码根本未实现本地 HTTP 监听服务，且手机 Telegram 无法访问 Mac 的 127.0.0.1，真实点击 100% 网络失败。
  2. **PID 锁**：终端 Ctrl+C 退出留存 `.lock`，一旦操作系统在两周内复用该 PID，下次启动将彻底锁死。
  3. **new MemoryStore**：在数百条 JSON 数据量下单次耗时 <3ms，纯同步读盘无复杂竞态，反而是最稳固的。
- **可证伪反对意见**：若认为"可仅靠 Telegram 👍 记为 viewed 绕过回环"，反例是：在低反馈率但正常阅读的轮次中，回环失效会导致 viewed 漏记，直接击穿 G-1 放弃线。

### Q4. "已读回执"能否存活两周？更省摩擦的替代方案？

- **结论**：**无法存活两周。高摩擦 + 跨端网络不通必然导致读者放弃点击或数据丢失。**
- **理由**：读者阅读信息流追求无摩擦消费，强迫每期点击无意义的"确认已读"链接违背真实使用习惯。
- **低摩擦替代方案**：
  - **方案 A（Telegram Inline Keyboard 原生回执）**：在 Telegram digest 下方除 👍/👎 外，增加一个 `👀 标为已读` 按钮，点击直接走 Telegram Callback Query 由 `pollFeedback` 记入 `memory/views.jsonl`。零跨端网络配置，一键交互。
  - **方案 B（文件访问时间戳/打开检测）**：对本地 outbox 中的 markdown 文件，通过文件系统的 `atime` 或专属轻量 CLI 打开命令记录。

### Q5. 无限定区：比前两轮更要紧的事

1. **与普通 RSS 阅读器的价值隔离盲区**：探针中 arXiv 占 86% 产出，GitHub 占 10%。系统当前未设立"无 AI 过滤的原始 RSS Top-6"对照组。两周后若老张满意，无法证明是"AI 筛选进化"的价值，还是"arXiv 本身内容好"的价值。
2. **中文源与英文关键词的死锁尚未解除**：`v2ex-hot` 与 `bili-llm` 因 `domain.json` 全为英文关键词而结构性 0 产出，当前实际是纯英文推送器。若探针要验证跨源 Bot，需在配置中加入中文关键词或显式移除中文源。

---

## 三、总判断

**带条件通过。**（P0' 代码修复与二审复核在工程层面通过；但必须完成 3 项开跑前置硬性修正。）

### 对 hy3 裁决的同意与修正

- **同意** hy3 的核心裁决：A1-A7 修复属实，V1 彻底闭合，观测与哈希闸门有效，代码主体达到可验收水平。
- **修正** hy3 的条件与判定线评估：
  - 判定线 §2c 的已读回执方案存在严重跨端缺陷且代码未实现，不得以当前形态直接签字；
  - `lock.ts` 需改用原子文件创建（`flag: 'wx'`）以彻底消除 TOCTOU。

### 开跑前置条件清单（Phase C 门禁）

1. **【P0】修复已读回执机制**：在代码中实现 Telegram `👀 标为已读` Callback 交互或轻量 HTTP 回执服务，确保移动端与桌面端均可真实记入 `memory/views.jsonl`。
2. **【P0】获取 Telegram Key 并走通首条真实反馈**：必须产生真实的 `feedback.json` 与 `weights.json` 落盘记录（维持 D 与 hy3 的生产级验收铁律）。
3. **【P1】`lock.ts` 加固**：使用 `openSync(lockPath, 'wx')` 消除并发启动竞态，并注册 `process.on('SIGINT' | 'SIGTERM')` 清理钩子。
