# domain-bot 外部运行环境盲区专项审查报告（cbc-hy3 独立审查线）

## 一、基本信息

- **审查身份**：cbc-hy3（腾讯免费通道 `hy3`，独立审查线，唯一作答工单独立成稿）
- **开始时间戳**：2026-09-03T16:44:38Z（开工核实命令执行时间）
- **工作目录**：`/Users/aiatwork/Projects/domain-bot`
- **开工核实 HEAD**：`fe73be4`（`main` = `origin/main`，`git branch -vv` 确认 `* main fe73be4 [origin/main]`）
  - `git rev-parse HEAD` = `fe73be444f3b81dabf3f8579c1aa48ec4ee23587`
- **审查方式**：只读。执行过 `git log/status/branch/rev-parse`、`grep`、全文阅读 14 个源码/配置/文档文件、只读 node 单行探测（含 1 个 `/tmp` 落盘探测脚本，不碰仓库）、`npm test` 实跑一次（exit=0，123/123 绿，见 §8 前）。未执行任何 commit/push/amend/reset/stash/checkout，未修改任何仓库文件。
- **引用档案核至文末声明**：`docs/probe-verdict-criteria.md`（72 行全文）、`docs/workplan-2026-09-02.md`（62 行全文）、`scripts/gen-evidence.mjs`（161 行全文）、`src/index.ts`（292 行全文）、`src/memory/observe.ts`、`src/memory/store.ts`、`src/collector/adapters/` 全目录均已读至文末。

## 二、结论先行

| 盲区 | 定级 | 是否阻断开跑 |
|---|---|---|
| 一、全链路 HTTP 无超时（网络不设防） | **P0（阻断）** | 是。串行 18 源循环任一挂起即停摆整轮；launchd KeepAlive 救不了 hung 进程 |
| 二、`.env` 承诺无实现（配置不生效） | **P0（阻断）** | 是。照文档配 `.env` 跑 `npm run loop` 等于没配；Telegram 静默关闭 → 两周后 G-1 恒 fail → **假判负** |
| 三、launchd 默认 PATH 找不到子进程（托管环境不匹配） | **P0（阻断，条件触发）** | 是。`mcporter/bili` 在 `~/.local/bin`、`yt-dlp` 在 `/opt/homebrew/bin`，均不在 launchd 默认 PATH 内；无 Jina key 时 8/18 源 ENOENT（44.4% > 1/3），连 3 轮即 I-3「仪器故障」，两周白烧 |
| 四、推送失败零留痕（观测账本倒挂） | **P1（高，不立即杀死但污染裁决）** | 修完 P0 后同批修。Telegram 故障 N 天 → I-2 分母涨、分子 0 → I-2 误判 fail（「仪器失效」），与真实「用户不互动」不可区分；且按 criteria §2b 优先级 I- > G-，会先判「探针无效」 |

**总体判定**：四个盲区中三个 P0、一个 P1，**当前 HEAD 不具备开跑条件**。此前审查（内部逻辑 123/123 全绿）结论依然成立，但那只是「实验室自洽」；按当前状态拉起 launchd，探针在数天内以假死 / 静默降级 / 批量 ENOENT / 账本倒挂四种方式之一废掉的概率极高，且失败模式恰好落在判定线 I-3、I-2、G-1 的触发路径上——**不是「可能影响实验」，是「失败时会被判定线误读为结论」**。必须先落一个开跑前修复批（见 §7），复验后再签字开跑。

诚实性备注（两处与工单预设不一致，详见正文）：① Node 22 undici 存在隐含的 headers/body 阶段上限（约 300s），故「无限挂起」严格说是「最长单源数分钟、整轮最长 ~1.5h 的停滞」，但定级不变；② P2-3（Telegram URL 转义）经核查**不成立，属误报**，`escUrl` 现状充分。

## 三、盲区一：全链路 HTTP 超时保护（网络不设防）——P0

### 3.1 引码证据（HEAD `fe73be4`）

全库 `grep -rn "timeout\|AbortSignal\|AbortController" src/ scripts/` 仅命中 3 处，无一处是 HTTP 请求超时：

1. `src/collector/adapters/fetchUtil.ts:13,20`——`AbortController` 仅用于**字节上限**，无定时器：
   ```ts
   /** 包装 fetchFn，用 AbortController 计数字节并在超过上限时中止，避免把整响应读入内存。… */
   const controller = new AbortController()
   const res = await fetchFn(url, { ...init, signal: controller.signal })
   ```
   `controller.abort()` 只在 `total > MAX_BODY_BYTES` 时调用（`:44-47`）。**对端挂起时 `await fetchFn(...)`（`:21`）与 `await reader.read()`（`:41`）均无任何 deadline。**
2. `src/collector/adapters/agentreach.ts:18-26`——`execFile(..., { timeout: 90_000, ... })`：这是**子进程** 90s 上限，仅覆盖 5 个 spawn 源（exa×3、bili、yt-llm），HTTP 路径不受益。
3. `src/feedback/receiver.ts:70`——`body: JSON.stringify({ offset, timeout: 30, ... })`：这是发给 Telegram 服务端的**长轮询等待秒数**，不是客户端超时；`fetchUpdates` 的 `fetchFn` 调用本身（`:67-71`）无 signal、无 deadline。

其余全部 HTTP 出口均裸奔：`rss.ts:38`（6 个 RSS 源）、`github.ts:8`（3 个 GitHub 源）、`agentreach.ts:73`（v2ex）、`agentreach.ts:224`（jina 主通道）、`scorer.ts:81`（LLM `/chat/completions`）、`telegram.ts:81`（sendMessage）、`telegram.ts:96`（answerCallbackQuery）、`receiver.ts:67`（getUpdates）。

### 3.2 挂起传导链推演

1. `src/index.ts:56-67` 是**串行 for 循环**，18 个 enabled 源逐个 `await collectSource(...)`：
   ```ts
   for (const source of enabled) {
     try {
       const items = await collectSource({ ...source, url: resolveSourceUrl(source.url, now) }, opts.fetchFn, opts.spawnFn)
   ```
   任一源的 `fetch` 挂起 → 整轮 `runOnce` 停在该 `await` 上 → `observeRound/appendObservation`（`:135-150`）尚未执行 → **本轮无观测、无推送、无返回**。
2. Node 22 原生 `fetch`（undici）**没有请求级总超时**。严谨起见：undici 有 headers/body 阶段的隐含上限（默认各约 300s，连接建立阶段依赖 OS TCP 超时），所以「永久停摆」的最坏情况是「单源停滞数分钟、18 源串行最坏累计 ~1.5h」，而不是字面永久。但对「每天 1 轮」的探针这已足够致命：某源 TCP 半开（对端防火墙静默丢包是最常见的生产 hanging 模式，不 RST、不 FIN）→ 当天轮次延迟数小时 → 若恰逢 LLM 打分批次也挂起（`scorer.ts:55-64` 串行批循环，同样无超时，且发生在归档写入**之前**，连脏数据都不留），轮次直接跨天。
3. macOS launchd `KeepAlive=true`（workplan Phase D 指定）**救不了 hung 进程**：KeepAlive 只在进程**退出/崩溃**后重启；hung 但活着的进程永远不会被重启，launchd 也没有「单轮执行时长看门狗」语义。`pollMs` 的 `setTimeout`（`index.ts:279`）排在 `runOnce` 之后，挂起的 `await` 让它永远到不了。结果：launchd 显示 job running，一切正常假象，实验静默断档——断档本身又会被 I-1（连续 3 轮 candidates=0……注意是「无观测轮」还是「candidates=0 轮」，见下）或表现为数据缺口。
   - 细节：hung 轮次**不产生 observation 行**，`trailingZeroRounds`（gen-evidence.mjs:44-48）只数「末尾 candidates===0 的连续轮数」，缺轮 ≠ 零轮。于是挂起不会触发 I-1，而是留下观测空洞——每周摘要出现「某几天无数据」，事后无法区分「源枯竭」与「进程 hung」，**可解释性永久丢失**。
4. 好消息（修复可行性依据）：超时抛出的 `DOMException: TimeoutError` 会被现有 `try/catch` 正常吞入：采集层 `index.ts:62-66` catch → `skipped` → `skippedSources`；LLM 层 `scorer.ts:59-63` catch → 单批降级启发式；Telegram 层 `index.ts:167-169` catch → `console.error`。**引入超时不需要改任何错误处理结构，只需在 fetch 调用点注入 signal。**

### 3.3 推荐超时配置与实现方案

- 在 `fetchUtil.ts` 新增 `fetchWithTimeout(fetchFn, url, ms, init?)`：内部 `AbortSignal.timeout(ms)`（Node 22 原生支持），并把 signal 透传给 `withSizeLimit(fetchFn, url, { ...init, signal })`（`withSizeLimit` 已 `{ ...init, signal: controller.signal }`——注意它会**覆盖**传入 signal，需小改：用 `AbortSignal.any([timeoutSignal, init.signal])` 合并，或让 timeout 包在最外层。以后者为最小侵入）。
- 阈值建议（探针场景：每天 1 轮，不抢实时性，取宽松但有界）：RSS/GitHub/v2ex **25s**；jina 主通道 **30s**（r.jina.ai 渲染慢）；LLM 单批 **120s**（大 prompt）；Telegram sendMessage/answerCallbackQuery **20s**；getUpdates 客户端 abort **70s**（服务端 long-poll 30s + 余量，超时后由 `pollFeedback` 的 5s 退避重试接住，本来就有循环）。
- spawn 路径已有 90s，无需动；但建议把 `bili/yt-dlp` 的 90s 收紧到 60s（搜索场景），可选。
- 守卫测试：mock fetchFn 返回永不 resolve 的 Promise，断言 `fetchWithTimeout(..., 50)` 在 ~50ms 抛错且错误被 `runOnce` 计入 `skippedSources`（端到端不断流水线）。**防假通过要点**：测试必须用FakeTimers之外的真实计时断言「确实等了约 50ms 且确实抛了」，并做一个反向变异——把实现改回裸 `fetch` 时该测试必须超时失败（vitest `testTimeout` 会抓）。

## 四、盲区二：配置与环境变量加载（配置不生效）——P0

### 4.1 引码证据

1. `package.json:11-12`：
   ```json
   "start": "npm run build && node dist/index.js --once",
   "loop": "npm run build && node dist/index.js",
   ```
   无 `--env-file`，且 `dependencies` 仅 `fast-xml-parser`——**全库无 `dotenv` 依赖**（grep `dotenv|env-file` 全库仅命中一篇 review 文档的正文提及，无实现）。
2. `.env.example` + `.gitignore`（含 `.env`）+ `README.md:31`「升级路径见 `.env.example`」+ workplan Phase C 第 3 项「三 key 到位（`.env`，参照 `.env.example`）」——文档链完整承诺「复制 `.env.example` 为 `.env` 即生效」。但该承诺**无任何代码实现**：Node 默认不读 `.env`。`node --help` 实测本机 Node v22.23.1 支持 `--env-file-if-exists`，但 scripts 未使用。
3. 环境变量缺失时的三路静默降级（全部实锤）：
   - LLM：`scorer.ts:113-122` `makeScorerFromEnv`——三 key 缺一即 `return new HeuristicScorer()`，**无日志、无横幅**。调用方 `index.ts:81` 直接用，流水线毫无感知。
   - Telegram：`index.ts:221-224`——token/chatId 缺一即 `telegram: undefined`，`runOnce` 内 `if (opts.telegram)`（`:164`）静默跳过推送。用户看到的只是 outbox 多了个 md 文件。
   - Jina：`index.ts:202` `process.env.DOMAIN_BOT_JINA_API_KEY || undefined`——缺 key 时 `fetchJina` 走匿名请求，r.jina.ai 回 401 后转 exa 兜底（spawn）。此路至少「能跑」，但把 3 个 jina 源的命运交给了 mcporter 是否可用（与盲区三耦合）。

### 4.2 假判负传导链推演（精确到判据行）

假设老张照文档配好 `.env` 并用 `npm run loop` + launchd 开跑（此时 `.env` 实际未加载）：

1. Telegram 通道静默关闭 → 两周内零 digest 到达手机 → 老张**无法**点击 👍/👎/👀（§2c 唯一交互路径）→ `memory/views.json` 永不创建，`feedback.json` 永不创建。
2. 期末 `gen-evidence.mjs --probe-end`：G-1（`:99-104`）读 `viewsExists ? ... : 'views.json 不存在'`，probeEnd 且文件不存在 → **`status: 'fail'`**；P-1（`:112-117`）同样 **`fail`**。按 criteria §2「G-1/G-2/G-3 任一触发 → 探针判负」，**G-1 fail 直接判负**。注意这不是「读数恒为 0」，而是比 0 更惨的「文件不存在」分支——但结论相同：判负。
3. I-2（`:84-91`）反而是 `nodata`（`!feedbackExists`），G-2/P-2 也是 `nodata`（`thumbsUpRate === null`）。所以假判负的**唯一载体是 G-1**（连带 P-1 fail），不是 I-2。工单第 4 问的结论方向正确，精确化为：**G-1 fail → 判负；I-2/G-2/P-2 全部 nodata 伴随**——复盘时「恰好 G-1 fail、其余 nodata」的模式就是本次盲区的指纹，届时可据此反查。
4. 最阴险一点：启发式降级本身不产生任何可观测异常——`observations.jsonl` 照常有 `rawP50`、`candidates`、`pushed`，每周摘要看起来一切正常。**两周后才发现「LLM 从没开过、Telegram 从没通过」，实验设计（LLM 打分进化 + 人反馈回路）实际只跑了一半。**

### 4.3 修复方案评估：`--env-file-if-exists=.env` + 启动横幅——足够，但有两处细节

1. `scripts.start/loop` 改为 `node --env-file-if-exists=.env dist/index.js ...`。`if-exists` 变体是正确选择（无 `.env` 的纯启发式本地跑不崩；且本机 Node 22.23.1 已验证支持该 flag）。注意相对路径按 cwd 解析——launchd plist 必须同时写死 `WorkingDirectory`=仓库根（workplan Phase D 已要求，plist 模板里要一起锁死，否则 `--env-file-if-exists` 静默找不到文件，重演本盲区）。
2. 启动横幅（`main()` 或 `startBot` 入口，3 行）：`[boot] LLM: on(heuristic fallback)/off(model=…)`、`[boot] Telegram: on(chatId=…4位掩码)/off`、`[boot] Jina: on/off`。**横幅是本修复真正的验收点**：`--env-file` 修的是机制，横幅修的是「下次再配错时能立刻看见」。建议横幅输出同时也是 `--doctor` 的一部分（见 §5）。
3. 另建议：当 `telegram` 为空且非 `--once` 探针模式时，打印一行显式警告而非静默（`--once` 本地调试不警告，避免噪音）。

## 五、盲区三：生产 launchd 托管与进程 PATH 隔离——P0

### 5.1 引码证据

1. 本机实测（`which -a`）：`node/npm/mcporter/bili` 全部位于 `/Users/aiatwork/.local/bin`，`yt-dlp` 位于 `/opt/homebrew/bin`；`/usr/bin/node`、`/bin/node` **不存在**。macOS launchd job 的默认 `PATH` 为 `/usr/bin:/bin:/usr/sbin:/sbin`（Apple  documented 行为；job 无登录 shell，不读 `.zshrc`/`.zprofile`）。结论：**launchd 下 `node` 本身都找不到**——除非 plist 写绝对路径或注入 PATH，否则连进程都起不来；即使 node 路径解决了，子进程调用全灭。
2. `agentreach.ts:18-26` `exaSpawn` 用裸命令名 spawn：
   ```ts
   execFile(cmd, args, { timeout: 90_000, maxBuffer: 16 * 1024 * 1024 }, ...)
   ```
   `execFile` 无 shell，裸 `mcporter/bili/yt-dlp` 走 `PATH` 查找。调用方 `fetchExa:54`、`fetchBili:106`、`fetchYtSearch:149`、`fetchJinaViaExa:207` 全部默认 `spawnFn = exaSpawn`，**无绝对路径、无 try-which、无 PATH 自检**。
3. 影响计数：硬依赖 spawn 的源 5 个（exa×3、bili-llm、yt-llm）+ jina×3（主通道 r.jina.ai 需 key；无 key 时 401 → 兜底走 `fetchJinaViaExa` 即 spawn）= **8/18 = 44.4%**。ENOENT 抛错 → `index.ts:62-66` catch → 全部计入 `skippedSources`。
4. I-3 口径（gen-evidence.mjs:60-75）：分子 `roundBadSources = skippedSources + zeroYieldSources`，分母按轮取 `enabledSourceIds.length`（=18），连续 3 轮 > 1/3 即 `fail`。44.4% > 33.3%：**开跑第 3 天即触发 I-3「仪器故障，先修后跑」**，且之后每天都触发——两周实验在第 3 天事实上已被宣判，白烧剩下 11 天。旁证：criteria:19 行文仍是旧口径「skippedSources/enabled 源」（「零产出」分子补充分母按轮取是签字包事项①，workplan §〇-11 自认未改），签字前正好连新口径带 PATH 修一起确认。
   - 有 key 的分支：若 Jina key 生效，jina×3 主通道成功，失败 5/18 = 27.8% < 1/3，不触发 I-3，但叠加任意 2 个 RSS 源波动（arXiv 周末无公告、hnrss 限流）即过线。**PATH 问题在任何 key 组合下都是贴线运行。**
5. 仓库内**无任何 `.plist` 交付物**（`ls *.plist` 无匹配；grep workplan 仅 Phase D 一段文字要点：KeepAlive/RunAtLoad/WorkingDirectory/logs，无 `EnvironmentVariables`、无绝对路径要求）。「launchd 托管」目前只是一段自然语言， sociology 上等于没交付。

### 5.2 修复方案：plist 模板 + PATH 注入 + `--doctor`（三件缺一不可）

1. 新增 `ops/com.domain-bot.plist`（或 `launchd/` 目录）模板，必须含：`Label`、`ProgramArguments` 用**绝对路径**（`/Users/aiatwork/.local/bin/node` 脆弱——`.local/bin` 可能是 symlink farm；建议 `ProgramArguments` 直接写 job 语义并用 `EnvironmentVariables.PATH = "/opt/homebrew/bin:/Users/aiatwork/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"` 显式注入——**launchd plist 不展开 `~`，必须写绝对路径**，这是最常见的二次踩坑）、`WorkingDirectory`=仓库绝对路径、`KeepAlive`、`RunAtLoad`、`StandardOutPath/StandardErrorPath` 落 `logs/`。
2. 新增 `--doctor` 自检命令（`main()` 分支，跑在 lock/loop 之前）：逐项 `spawn('mcporter', ['--version'])` / `bili` / `yt-dlp` / `node -e` 探测 + 打印有效 PATH + 打印三 key 有无（掩码）+ 读 config 计数 enabled 源；任一缺失即非零退出并指打印修复行。**开跑 SOP 第一步就是 `--doctor` 全绿**，Phase C 检查单加一项。
3. 可选（P2）：`DOMAIN_BOT_{MCPORTER,BILI,YTDLP}_BIN` 环境变量覆盖可执行文件绝对路径，`exaSpawn` 优先用它。行数小，但 plist PATH 已够用，列为可选。

## 六、盲区四：推送失败零留痕与观测账本倒挂——P1

### 6.1 引码证据（时序实锤）

`src/index.ts:129-150` vs `:152-170`，顺序如下（行号即时序）：

```ts
store.recordItems(candidates, now)          // :129 归档
store.markPushed(pushed.map((s) => s.id))   // :130 标记 pushed=true
for (...) store.registerDigestRef(...)      // :131-133 登记 ref
const observation = observeRound({ ... pushed, ... })  // :135-149，o.pushed = pushed.length
appendObservation(opts.memoryDir, observation)          // :150 落盘 ← 分母在此刻已写死
...
if (opts.telegram) {
  try {
    await sendDigestTelegram(digest, opts.telegram)     // :166 实际发送在后
  } catch (err) {
    console.error('[push] telegram 失败:', ...)         // :168 仅日志，无重试、无标记
  }
}
```

三点全部坐实：① `markPushed` + `appendObservation` 在 `sendDigestTelegram` **之前**；② 发送抛错（断网/超时/400/401-token 失效）仅 `console.error`，归档的 `pushed=true`、digestRef、observation 行**无一回滚或标注**；③ `gen-evidence.mjs:49` `totalPushed = obsForI2.reduce((s, o) => s + (o.pushed ?? 0), 0)`——分母正是这些「发没发出去都算上」的值。

### 6.2 I-2 假 fail 传导链推演

设 Telegram token 在第 5 天失效（或机房断网 N 天、或盲区一的挂起恰好落在 send 上被 kill -9）：

1. 每天 `o.pushed=6` 照常累加（分母 +6/天），`feedback.json` 零新增（分子 0——用户根本没收到东西）。
2. 两周分母 ≈ 84（恰好 criteria:18 注释里的估算），分子 0 → I-2 = 0% < 5% → **`fail`（「反馈率 < 5% 仪器失效」）**。
3. 该 fail 与「用户收到但懒得点」的真实低互动在数据上**完全不可区分**；且按 criteria §2b 优先级 **I- > G- > P-**，I-2 fail 直接判「探针无效」，即使同期 G-1 也是 fail（用户确实没看）——复盘会得出「仪器坏了」而非「需求不存在」，**错误地把一次通道事故洗成「重跑即可」， already烧掉的两周不能提供任何需求信息**。这是本盲区最贵的部分：不是误判本身，而是误判**指向错误的后续动作**（修仪器重跑 vs 止损）。
4. 同一时序 bug 的次生伤害：`markPushed=true` 的条目永不再评（dedupe 屏蔽），`digestRef` 指向用户从没见过的 digest——若通道恢复，`resolveRef` 能解出「用户不可能点过」的 ref，反馈归因错位（小概率但存在）。

### 6.3 修复方案：不选纯重排序，选「送达状态字段 + append 后移」

- **为什么不选纯重排序**（先发再记）：① 发送 hung 时（盲区一未修时）observation 写不进去，回到「缺轮」不可解释问题；② `stats.pushed` 返回值语义混乱；③ 没解决「部分送达」的表达问题。重排序是「把一种倒挂换成另一种」。
- **推荐方案**（最小侵入，约 15 行源码）：
  1. `RoundObservation` 加 `telegram: 'sent' | 'failed' | 'skipped-empty' | 'disabled'` + `pushedDelivered: number`（`observe.ts` 接口 + `observeRound` 输入，默认由调用方传入）。
  2. `runOnce` 把 `observeRound/appendObservation` 移到 Telegram 发送块**之后**，send 的 try/catch 改为记录 `delivery` 结果（成功 `sent`/抛错 `failed`/无 clusters `skipped-empty`/无 telegram 配置 `disabled`），`pushedDelivered = sent ? pushed.length : 0`。
  3. `gen-evidence.mjs` I-2 分母改为 `sum(o.pushedDelivered ?? o.pushed)`（`?? o.pushed` 兼容旧观测行，附 note 标注混合口径；探针期统一用 `--probe-start` 切在修复之后，旧行自然排除——D4 机制恰好能用上）。
  4. 口径文档一句话写进 criteria 签字稿：「I-2 分母 = Telegram 实际送达条数；`disabled` 轮次不计入分母」（否则文件-only 调试轮会稀释分母——另一个小倒挂，顺手堵住）。
- 守卫测试：mock telegram fetchFn 首轮成功、次轮抛错，断言两轮 observation 的 `telegram` 字段分别为 `sent/failed`，且按新口径算的 I-2 分母只含首轮。反向变异：删掉字段赋值（回退到旧时序）时测试必须红。

## 七、伴随发现核实（P2-1 ~ P2-4）

### P2-1 关键词子串匹配无词边界——成立，P2

`refinery/filter.ts:7` 与 `scorer.ts:26-28` 同一写法：`hay.includes(normalizeText(k))`，hay 仅首尾各垫一空格，无词边界。**实测**（只读 node 探测，normalizeText 原样复刻）：hay=`upbeat storage average playback` 时 `rag→true`、`beat→true`。而 `domain.json:13` 关键词含 `"rag"`、`domain.json:30` signalWords 含 `"beat"`——恰好是会被 `"storage"/"average"/"bragging"` 与 `"upbeat"` 误命中的短 token。危害：过滤假阳性（不该进候选的进了）+ 启发式 `kwHits/signalHits` 虚增 → 候选池掺噪，长期会把 G-2（👍率 <20%）往 fail 推一点。定级 P2（精度污染，不杀死探针）。修复：hay 与关键词统一分词后集合匹配（复用 `tokenize`，注意 CJK 2-gram 语义要保持），或正则 `\b` 边界（CJK 关键词无 `\b`，需分两路，推荐前者）。守卫：`"storage server average upbeat"` 对 `keywords:["rag"]` 必须 `isRelevant=false`，且变异（改回 includes）必红。

### P2-2 Atom 空 description 阻断 fallback——成立，P2

`rss.ts:58`：`text(e.description ?? e.summary ?? e['content:encoded'] ?? '')`。**实测**：`<description></description>` 经 fast-xml-parser 解析为 `""`（非 null），`??` 不跳过，`text("")` 返回 `""`——即使 `content:encoded` 有正文也丢失。触发条件是「源输出空标签而非缺标签」，RSS 实践中不少见（模板渲染空字段）。危害：整条 body 为空 → filter 漏检（标题无关键词时该进的没进）→ I-1 方向的小 undercount + 打分失真。修复：`??` 改为判空链（`||` 即可，`text()` 已把 null/非字符串归一为空，可写成按序取首个非空）。守卫：fixture 含 `<description></description><content:encoded>REAL</content:encoded>`，断言 body 含 REAL。

### P2-3 Telegram legacy Markdown URL 转义——不成立（误报），降为 P3 观察项

`push/telegram.ts:28-30` `escUrl` 仅编码 `\` 与 `)`。核查结论：**这恰好是 legacy `Markdown`（注意不是 MarkdownV2）链接 URL 段内唯二必处理的字符**——`)` 会提前闭合 `[text](url)`，`\` 是转义符本身；`(` 不闭合链接、`_`/`*`/`` ` ``/`[` 在 URL 段内不触发实体解析（实体只能从文本段开启），裸空格在真实源 URL 中基本不存在（各源 URL 均为已编码形式）。更关键的是已有测试锁定：`telegram.test.ts`「URL 中的右括号被百分号编码，不提前闭合链接」。把 `_`/空格/`(` 也做百分号编码反而有双编码风险（如把合法 `%20` 的前置字符误伤倒不会，但无收益）。**建议：不修实现，加一条单测锁定「含 `_`、`(`/空格的 URL 原样通过且仅 `)`/`\` 被编码」即可**，防止未来有人「好心」扩转义引入回归。

### P2-4 gen-evidence.mjs 健壮性——成立两半，P2

- **(a) 坏行崩脚本，成立**：`:15-16` `.map((l) => JSON.parse(l))` 无 try/catch。**实测**：截断行 `'{"at":2,"pushed":'` → `SyntaxError: Unexpected end of JSON input`，整个证据脚本崩死（`observations.jsonl` 是追加写，断电/磁盘满/kill -9 落在写窗口即产生截断尾行——概率低但 14 天 × 每天写 × 还要叠人工查看，值得防）。此时不是误判，是**无判据可用**（每周摘要断档）。修复：逐行 try/catch，坏行 `console.error` 留痕并跳过；若坏行数 >0，在 summary 顶层加 `corruptLines: n` 字段。
- **(b) 坏 feedback.json 静默归零致 I-2 误判，成立**：`:20` `catch { return [] }`。**实测**：截断内容 → `[]` → 在 `feedbackExists=true、totalPushed=84` 下 I-2 = `0/84` → **`fail`**。注意 `store.ts` 的 D6 纪律（坏文件改名 `.corrupt-*` + 告警）在 `gen-evidence.mjs` 里**没有对应实现**——同一个坏文件，运行时 store 会抢救，证据脚本会静默判 fail。修复：区分「文件不存在」（nodata，预期）与「存在但解析失败」（新状态 `error` + note 写明文件损坏，既不 pass 也不 fail，且必须非零提示人工介入）。守卫：fixture 分别覆盖「截断 observations 尾行 → 脚本不崩且 corruptLines=1」「截断 feedback.json → I-2=error 而非 fail」。

## 八、开跑前修复批方案建议

### 8.1 执行顺序（按「先让探针活下来，再让账本诚实，最后提精度」）

1. **盲区二（配置加载）**——最先，约 10 行：scripts 加 `--env-file-if-exists=.env` + 3 行启动横幅 + `disabled` 警告。理由：不修它，后面所有联调（key 到位验证、真机联调）都在错误的前提下做。
2. **盲区三（launchd/PATH）**——约 30 行 + 1 个 plist 模板：`ops/com.domain-bot.plist`（PATH 注入绝对路径三段 + WorkingDirectory + 日志）+ `--doctor` 命令（约 60 行含测试替身）。理由：Phase D 的物理前提；且 `--doctor` 是盲区二横幅的超集（一次跑完 environmental 全检查）。
3. **盲区一（超时）**——约 25 行源码：`fetchWithTimeout` + 13 个调用点换（rss/github/v2ex/jina/scorer/telegram×2/receiver）+ 阈值常量表。理由：有了 1+2 才能做真实网络联调，联调时顺手验证超时阈值不误伤慢源（r.jina.ai、arXiv 大 feed）。
4. **盲区四（送达状态）**——约 15 行源码 + evidence 口径 5 行：`telegram/pushedDelivered` 字段 + append 后移 + I-2 分母。理由：依赖 1（`disabled` 语义）和 3（send 超时后 `failed` 才有意义），放最后。
5. **P2-1/P2-2/P2-4**——各约 5-10 行 + 测试：与 4 同批或紧随其后。P2-3 不修，加 1 条锁定测试。
6. **criteria 签字稿同步**：I-2 分母「实际送达」一句话 + I-3 新口径（签字包事项①本来就要改）+ 本报告指纹备注（「G-1 fail + 其余 nodata = 配置未加载指纹」写入运维附录，防未来复现时从零排查）。

总量预估：源码 ~120-160 行，测试 ~200 行，plist/文档 ~80 行。单人约 0.5-1 天（含联调）。

### 8.2 关键测试用例设计（防「自制沙箱假通过」——复盘原文 §四教训）

每个修复配 **正向测试 + 反向变异要求**（审查员复验时亲手做变异，不看测试自述）：

| # | 正向断言 | 反向变异（必须变红） |
|---|---|---|
| 超时 | 永不 resolve 的 fetchFn + 50ms 阈值 → 约 50ms 后抛错，且 `runOnce` 该源进 `skippedSources`、流水线继续 | 把实现改回裸 fetch → 测试因 vitest `testTimeout` 失败（证明测试真在等） |
| env | 删 `--env-file` 改回旧 scripts（用子进程起 `node --help` 级别的装配断言或单测 `makeScorerFromEnv({})` → heuristic + 横幅打印 off）→ 断言「无 key 时横幅明确打印 `Telegram: off`」 | 删掉横幅行 → 测试红（防「修了机制丢了可见性」） |
| PATH/doctor | mock spawnFn 抛 ENOENT → 源进 skipped；`--doctor` 在缺工具时非零退出且输出含工具名 | plist 模板 PATH 删掉一段 → doctor 测试红（模板也要有测试读它并断言含三段路径） |
| 送达 | TG 成功/失败两轮 → observation `telegram` 为 `sent/failed`，新口径 I-2 分母只含送达轮 | 回退旧时序（append 前移）→ 测试红 |
| P2-1 | `"storage average upbeat"` vs `["rag"]` → `isRelevant=false` | 改回 `includes` → 红 |
| P2-2 | 空 description + 有 content:encoded → body 非空 | 改回 `??` 链 → 红 |
| P2-4 | 截断尾行 → 脚本不崩 + `corruptLines=1`；截断 feedback → I-2=`error` | 删 try/catch → 第一例崩（红），第二例回 `fail`（与期望 `error` 不符，红） |

另：`npm test` 保持 123/123 基线全绿（新增测试之外零修改即全绿是回归门槛）；`npm run build`（tsc）必须绿——`RoundObservation` 加字段是跨文件接口变更，evidence 脚本是 mjs 无类型保护，靠测试锁。

## 九、提交前状态重核

执行时间戳：2026-09-03T16:48:56Z（报告落盘前最后一步；本报告落盘位置为工单指定的 `.verify-logs/2026-09-03-envaudit/` 下唯一新增文件，未触碰任何已跟踪文件）。

`git log --oneline -1` 原样输出：

```text
fe73be4 test(evidence): 终审 P1-2（opencode 线）补 P-4 fail 方向守卫——probeEnd 到期 + 零有效 artifact → P-4=fail（gen-evidence:128 分支锁定，D9 纪律 fail/nodata 各锁一例）
```

`git status --porcelain` 原样输出：

```text
?? .verify-logs/2026-09-03-envaudit/
?? .verify-logs/2026-09-03-finalaudit/
?? docs/.DS_Store
?? docs/reviews/2026-09-03-fullrepo-code-review-xiaihuo.md
```

核验结论：HEAD 与开工时一致（`fe73be4`），工作树无已跟踪文件改动（4 项均为 untracked：两个 verify-logs 目录、本报告所在目录即其中之一、`.DS_Store`、一篇他线 review 文档），本报告所有 `file:line` 引文在该 HEAD 上有效。
