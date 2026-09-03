# domain-bot 外部运行环境盲区专项审查工单（cbc-hy3 独立审查线）

你是**独立审查线（cbc-hy3）**，模型为 `hy3`（腾讯免费通道）。
本工单严格执行「单一作答」纪律，本工单为唯一作答工单，报告必须独立成稿并落盘。

## 0. 边界与纪律（硬性，违反即废稿）

- **工作目录**：`/Users/aiatwork/Projects/domain-bot`。
- **开工核实**：开工先核实当前 HEAD（应为 `fe73be4`，`main` = `origin/main`），记录在报告开头。
- **只读审查**：禁 commit / push / amend / reset / stash / checkout；禁修改任何源码、配置或现有文档。不得实际修改源码跑变异测试。
- **允许操作**：只读 git 命令（`git log`, `git status` 等）、`npm test` 实跑、阅读全库文件、执行只读 node 单行探测脚本。
- **产物唯一落盘位置**：`.verify-logs/2026-09-03-envaudit/2026-09-03-domain-bot-envaudit-cbc-hy3.md`。若无落盘权限，以全文回复，由总管代落盘。
- **引用档案核至文末**：引用既有缺陷、文档、诊断或测试时，必须查验全文至文末最新状态。
- **提交前状态重核**：报告最后一节必须重新运行 `git log --oneline -1` 与 `git status --porcelain`，原样贴出输出并附执行时间戳。

## 1. 背景与审查目的

domain-bot 是千 bot 工厂需求假门测试探针，两周判定线即将在老张签字后启动（Phase D，每天 1 轮常驻运行）。
此前经过多轮审查（qoder 诊断修订、小巴 impl 审查 D1–D10、两轮终审与若干修复批），仓库内部核心逻辑（去重、打分、源权重进化、offset 原子写、三态证据脚本）已达到 `npm test` 123/123 全绿，具备很高的自洽性。

然而，最新全库代码复核发现：**此前的审查过度聚焦于仓库内部逻辑，形成了严重的外部运行环境盲区**：
1. **网络不设防（全链路无超时）**
2. **配置不生效（.env 承诺无实现）**
3. **托管环境不匹配（launchd 缺 PATH）**
4. **通道失败假归因（推送失败零留痕导致 I-2 分母虚增）**

如果按当前状态直接拉起 launchd，探针有极高概率在运行数天内因假死、配置失效或通道中断而直接废掉两周实验，甚至产生虚假判负或虚假失效。
本次专项审查的目标是：**对这四大外部运行环境盲区进行严格的传导链核查与技术定性，并给出最小侵入且可靠的修复方案建议与守卫测试设计。**

## 2. 审查任务与核对表（四大盲区逐项审查）

对以下四大盲区，请深入阅读对应源码，给出**当前 HEAD 上的 `file:line` + 关键代码引文 + 传导链推演 + 危险程度定级 + 修复建议**：

### 盲区一：全链路 HTTP 超时保护（网络不设防）
- **重点文件**：
  - `src/collector/adapters/fetchUtil.ts`
  - `src/collector/adapters/rss.ts`
  - `src/collector/adapters/github.ts`
  - `src/collector/adapters/agentreach.ts`
  - `src/refinery/scorer.ts`
  - `src/push/telegram.ts`
  - `src/feedback/receiver.ts`
  - `src/index.ts`（采集串行循环）
- **核查要点**：
  1. 梳理全库全部 HTTP 出口调用点，核实是否没有任何 timeout 设置（`withSizeLimit` 的 AbortController 是否仅用于字节上限而不具备定时器能力）；
  2. Node 22 原生 `fetch` 遇到对端挂起、TCP 半开或握手无响应时的默认行为；
  3. `src/index.ts:56-67` 串行 for 循环遍历 18 个源时，若单个源无限挂起，主进程是否会永久停摆；
  4. macOS launchd 的 `KeepAlive` 能否救助挂起（hung）但未崩溃的进程？
  5. 评估引入 `AbortSignal.timeout(ms)` 的可行性、各环节合理的超时阈值（采集、LLM 打分、Telegram 推送、长轮询客户端兜底），以及超时发生时是否能被现有的 try/catch 正常吞入 `skippedSources` 而不中断流水线。

### 盲区二：配置与环境变量加载（配置不生效）
- **重点文件**：
  - `package.json`（`scripts.start` 与 `scripts.loop`）
  - `src/index.ts`（`main()` 函数与启动参数装配）
  - `.env.example`、`README.md`
- **核查要点**：
  1. 全库是否存在 `dotenv` 依赖，或者在 node 启动参数中是否包含 `--env-file`？
  2. 若用户照文档将 `.env.example` 复制为 `.env` 并填入三 key，通过 `npm run loop` 或 launchd 拉起时，环境变量是否能被 Node 进程加载？
  3. 环境变量未注入时，系统会发生什么？
     - LLM 打分器是否会静默降级为 `HeuristicScorer`？
     - `src/index.ts:221-224` 对 `telegram` 的判空是否会导致 Telegram 通道静默关闭（`undefined`）？
     - Jina 的 API key 是否会缺失？
  4. 推导传导链：当 Telegram 通道静默关闭时，推送无法到达 Telegram，老张无法进行 👍/👎/👀 交互，两周后 `views.json` 不存在，期末判定线 G-1（主动查看 < 10 次）和 P-1 读数恒为 0，是否会直接触发“放弃线”造成**假判负**？
  5. 评估修法：Node 22 原生 `--env-file-if-exists=.env` 与启动横幅显式打印「LLM: on/off，Telegram: on/off」的设计是否足够消除该风险？

### 盲区三：生产 launchd 托管与进程 PATH 隔离（托管环境不匹配）
- **重点文件**：
  - `docs/workplan-2026-09-02.md` Phase D
  - `src/collector/adapters/agentreach.ts`（`exaSpawn`、`fetchBili`、`fetchYtSearch`、`fetchExa`）
- **核查要点**：
  1. macOS launchd 守护进程默认的 `PATH` 是什么？（通常为 `/usr/bin:/bin:/usr/sbin:/sbin`）；
  2. 本机环境下，node、npm、mcporter、bili、yt-dlp 通常安装在什么路径？
  3. `agentreach.ts` 的 `execFile` 在 spawn 子进程时，是否依赖父进程的 `PATH`？若在 launchd 默认 PATH 下运行，8/18 个依赖 spawn 的源是否会报 `ENOENT` 失败并全部计入 `skippedSources`？
  4. 若 8/18 源持续失败，比例达到 44.4%（> 1/3），是否会连续 3 轮直接触发判定线 I-3，导致探针被判定为“仪器故障，先修后跑”，两周实验白烧？
  5. 审查目前仓库内是否缺少实际可用的 `.plist` 交付物模板？评估在 plist 中显式注入 `EnvironmentVariables.PATH` 以及在开跑前增加 `--doctor` 环境自检命令的必要性。

### 盲区四：推送失败零留痕与观测账本倒挂（通道失败假归因）
- **重点文件**：
  - `src/index.ts:129-170`
  - `src/memory/observe.ts`
  - `scripts/gen-evidence.mjs:49, 85-91`
- **核查要点**：
  1. 核查流水线时序：`store.markPushed` 与 `appendObservation` 是否在调用 `sendDigestTelegram` 之前执行？
  2. 核查异常处理：`sendDigestTelegram` 抛错（如网络断开、超时、400 格式错误）时，系统是否仅执行了 `console.error`，未重试且未在归档和观测中做任何失败标记？
  3. 核查下游证据计算：`gen-evidence.mjs:49` 的 `totalPushed` 是否按观测中的 `o.pushed` 累加作为 I-2 的分母？
  4. 推导传导链：如果 Telegram 通道故障若干天（或 Telegram Token 异常），分母 `totalPushed` 正常累加，而分子（收到的真实反馈数）为 0，是否会导致 I-2 反馈率迅速掉至 5% 以下，进而被判为 I-2 fail（“反馈率 < 5% 仪器失效”）？
  5. 评估修复方案：是应该重构执行顺序（先发 Telegram 再记 observation），还是在 observation 中增加推送送达状态字段（例如 `telegramDelivery: 'success' | 'failed' | 'disabled'`），让证据脚本仅以实际送达数为分母？

## 3. 伴随发现与代码卫生核实（P2/P3 辅助核查）

以下几项是伴随发现的代码缺陷，请在审查时顺带核实是否存在、危害程度及修复建议：
1. **P2-1 关键词子串匹配无词边界**：`refinery/filter.ts:7` 用 `hay.includes(normalizeText(k))`，核实 `"storage"`/`"average"` 是否会命中 `"rag"`，`"upbeat"` 是否会命中 `"beat"`？
2. **P2-2 Atom 空 description 阻断 fallback**：`rss.ts:58` 中 `text(e.description ?? e.summary ...)` 是否会被空标签 `""` 截断导致正文丢失？
3. **P2-3 Telegram legacy Markdown URL 转义**：`push/telegram.ts:28-30` 的 `escUrl` 是否遗漏了下划线 `_`、空格和左括号 `(`，从而可能导致 Telegram 400 报错？
4. **P2-4 gen-evidence.mjs 健壮性**：`observations.jsonl` 遇截断坏行是否会抛 SyntaxError 崩死脚本？`feedback.json` 解析错误返回空数组是否会导致 I-2 误判 fail？

## 4. 报告要求与交付格式

审查报告必须包含以下各节：

1. **基本信息**：审查身份（cbc-hy3）、开始时间戳、开工核实 HEAD（必须是 `fe73be4`）。
2. **结论先行**：针对外部运行环境四大盲区的总体判定（严重度评估、是否阻断开跑）。
3. **四大盲区逐项审查**：
   - 盲区一（网络超时）：引码证据、挂起传导链推演、推荐超时配置与实现方案。
   - 盲区二（配置加载）：引码证据、假判负传导链推演、`--env-file` 与横幅实现方案。
   - 盲区三（launchd PATH）：引码证据、8 源挂死推演、plist 模板配置要点与自检方案。
   - 盲区四（推送失败留痕）：引码证据、I-2 假 fail 传导链推演、账本时序与观测字段设计。
4. **伴随发现核实（P2-1 ~ P2-4）**：逐项确认是否存在并给出简要意见。
5. **开跑前修复批方案建议**：建议的修复执行顺序、代码行数预估、关键测试用例设计（如何防止自制沙箱假通过）。
6. **提交前状态重核**：重跑 `git log --oneline -1` 与 `git status --porcelain`，原样贴输出并带时间戳。
