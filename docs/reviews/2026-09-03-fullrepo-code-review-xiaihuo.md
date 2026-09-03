# domain-bot 全库代码审查（第三只眼 · 小赫线）

> 日期：2026-09-03　审查人：小赫（DeepSeek Harness 会话）
> 基线：HEAD `fe73be4`（main，工作树仅 `.verify-logs/2026-09-03-finalaudit/` 与 `docs/.DS_Store` 未跟踪）
> 方法：src/ 全部 20 文件 + scripts/ + config/ + tests/（1,732 行测试逐份读）**逐行精读**；
> 疑点全部用 node 实跑或既有测试绿灯基线核实（`npm test` 123/123 绿、`tsc --noEmit` 绿、dist 比 src 新且未入库）。
> 定位纪律：本报告**不重计** D1–D10、B′/C′ 系、§2.6.4、I-3 回写、quantile n=3、offset 原子写等既往审查已闭环项；
> 凡与既往档案重叠处只标「已知」并给指针。全部「新发现」为此前 24 份文档 + 7 份 .verify-logs 产物未列或修复后残留。

---

## 一、结论先行

工程主体质量高：编排层对既往 60+ 项审查修复真实落地，测试有明显红灯纪律（多处注释记录「用例因错误原因通过」的陷阱）。
**残留缺陷集中在三个既往审查的盲区，且全部命中本项目自己最高优先的「仪器有效性」轴**：

1. **全链路零 HTTP 超时**——单条挂死的连接能永久静默探针，launchd 救不了「活着的挂起」；
2. **`.env` 承诺无实现**——照 README/`.env.example` 操作的用户会**无 LLM、无 Telegram** 跑完两周，期末 G-1/P-1 恒 0 → 假判负；
3. **launchd 部署无交付物且缺 PATH 要点**——spawn 类 8/18 源在 launchd 默认环境下必挂 → I-3 连三轮 → 判「探针无效」白烧两周。

另有 8 项 P2 代码缺陷（关键词子串误报、Atom 空 description 兜底失效、Telegram URL 转义覆盖不全、判定脚本脆弱性等），
不构成开跑阻断但每一条都能污染某个判据的读数方向。

**分级汇总：P1 × 4　P2 × 8　P3 × 6　架构级观察 × 5。**

---

## 二、P1——影响「能否有效开跑」的新发现

### P1-1　全链路无 HTTP 超时；单点挂起 = 探针静默停摆（仪器可用性）

`AbortSignal` 全库仅 `fetchUtil.ts:20` 的 AbortController 用于**超体积中止**，无任何定时器；
Node 22 的 `fetch` **无默认超时**。以下路径全部裸奔：

| 调用点 | 位置 | 挂起后果 |
|---|---|---|
| RSS/Atom 抓取 | `collector/adapters/rss.ts:38`（经 `withSizeLimit`） | 整轮 `await` 卡死 |
| GitHub 搜索 | `collector/adapters/github.ts:8` | 同上 |
| V2EX | `agentreach.ts:73` | 同上 |
| Jina 主通道 | `agentreach.ts:224` | 同上 |
| LLM 打分 | `refinery/scorer.ts:81` | 同上 |
| Telegram 推送 | `push/telegram.ts:81` | 同上 |
| Telegram 长轮询 | `feedback/receiver.ts:67` | 反馈接收静默死亡（进程还在，`pollFeedback` 的 for(;;) 永远等不到 resolve） |

采集是**串行 for 循环**（`src/index.ts:56-67`），18 源里任何一个 TCP 半开/服务端不响应，当日轮永不结束；
`launchd KeepAlive` 只救崩溃，不救挂起。**这是两周窗口最致命的单点**：`observations.jsonl` 断更，而没有任何东西会响。

**修法**（半小时内可完成）：所有 `fetchFn` 调用点统一 `signal: AbortSignal.timeout(N)`
（建议：采集 30s、LLM 120s、Telegram 30s；长轮询本身 30s 服务端超时 + 客户端 90s 兜底）。
spawn 类已有 `execFile timeout: 90_000`（`agentreach.ts:21`），对照组现成。

### P1-2　`.env.example` 承诺 `.env` 加载，代码/脚本无实现（文档-代码脱节 → 假判负通道）

`.env.example:2`「复制为 .env 后填入」、README:31「升级路径见 .env.example」——但全库 grep **无 dotenv、无 `--env-file`、无任何 .env 读取**；
`npm run loop` = `npm run build && node dist/index.js`（package.json），Node 不会自动读 .env。
照文档填完 .env 的实际效果 = 什么都没配：

- 打分静默降级 HeuristicScorer（`scorer.ts:113-122`）——I-4 饱和风险由启发式的平方根压缩兜着，尚可；
- **Telegram 通道静默缺失**（`index.ts:221-224` 判空即不传）——无 👍/👎/👀 → `feedback.json`/`views.json` 恒不存在 →
  **期末 I-2 恒 nodata、G-1/P-1 恒 0 次 → G-1 直接触发放弃线 → 假判负**（真因是配置从未生效，不是老张不看）。

这正是 workplan Phase D 花一整段防的「真因是运行方式」类事故的**配置版镜像**，但 Phase D 只防了运行方式、没防配置加载。
**修法**：npm scripts 改 `node --env-file-if-exists=.env dist/index.js`（Node 22 支持），或在 `main()` 顶部手撸 10 行 .env 解析；
同时启动横幅**显式打印**「LLM: on/off，Telegram: on/off」，让缺通道当天就可见而不是期末才发现。

### P1-3　launchd 交付物缺失，且 workplan 的「launchd 要点」漏掉了致命的一条：PATH

`docs/workplan-2026-09-02.md:39` 写了 `WorkingDirectory`（对）但**没写 `EnvironmentVariables.PATH`**，仓库内也没有 plist。
macOS launchd 默认 PATH 为 `/usr/bin:/bin:/usr/sbin:/sbin`：

- 本机实测：本会话 shell 的默认 PATH 连 `npm` 都没有，node/npm 在 `~/.local/bin`——launchd 环境同样找不到；
- 即便 plist 用绝对路径拉起 node + npm，**spawn 子进程继承父进程 PATH**：`mcporter`（3 个 exa 源 + 3 个 jina 兜底通道）、
  `bili`（bili-llm）、`yt-dlp`（yt-llm）全部 ENOENT（`agentreach.ts:18-26` 的 execFile 无 PATH 修正）；
- 结果：**8/18 源恒 skipped** → 6/18=33%（恰好不 > 1/3，若 jina 主通道再因无 key 挂掉任一源即越线）——
  I-3「仪器故障，先修后跑」触发，两周白烧。jina 主通道若因 `DOMAIN_BOT_JINA_API_KEY` 未注入（见 P1-2）也挂，3 个 jina 源同样阵亡。

**修法**：交付 plist 样例（`PATH` 显式含 node、mcporter、bili、yt-dlp 所在目录）；
或适配器侧兜底：`exaSpawn` 用绝对路径表 + 启动时 `which` 探测并对缺失 CLI 打显式告警。
**开跑自检清单应加一条：launchd 环境下空跑 `--once`，检查 `skippedSources` 是否为空。**

### P1-4　推送失败零留痕（已知 D10 的**新影响面**：I-2 假 fail 与 G-1 假触发）

D10「observation 先于推送落盘」既往缓批的是账面语义问题；残留实现里还有两条更具体的：

- `src/index.ts:129-130`：**`markPushed` 在推送动作之前执行**——archive 里 `pushed=true` 与 Telegram 是否送达无关；
- `src/index.ts:164-169`：`sendDigestTelegram` 失败仅 `console.error`，**无重试、无失败标记**，
  而 `gen-evidence.mjs:49` 的 I-2 分母 = 观测里的 `pushed`（应推数）。

后果：Telegram 通道若某几天挂（token 过期/网络/见 P2-3 的转义 400），分母照常涨、分子恒 0——
**I-2 被读成「反馈率 < 5% → 仪器失效」，真因是推送通道死了**；且按 §2b 优先级 I- 触发直接判「探针无效」，
连「用户不要」都判不成，整轮作废重跑。修复不必等 D10 重排序：在 observation 里补 `telegramPushFailed: true|false`
（push 之后再 append 一行增量观测，或把 appendObservation 挪到 push 之后——D10 说的「需重排序另做」正是这件事，建议开跑前一并做）。

---

## 三、P2——代码缺陷（可修不阻断，但每条都会污染读数）

### P2-1　相关性/打分是**子串匹配**，无词边界 → 假通过 + 假信号（已复现）

`refinery/filter.ts:7` 与 `refinery/scorer.ts:27-28` 用 `hay.includes(normalizeText(k))`。实测：

```
"storage"  → 命中关键词 "rag" ✓（假通过）
"average"  → 命中 "rag" ✓
"upbeat"   → 命中信号词 "beat" ✓（分数虚增）
```

`config/domain.json` 的 `rag` 是高频误报源（HN/arXiv 里 storage/average 遍地）。英文关键词需词边界
（如 `new RegExp('\\b'+k+'\\b')` 或对 hay 做 token 集合 `has()`），中文关键词维持子串。**修复须同步 M6 标定纪律：改过滤语义当天重跑基线。**
同一函数还使 `signalWords` 的 `open source` 匹配不到 `open-sourced`（normalizeText 把 `-` 变空格后是 `open sourced`，前缀 `open source` 倒能命中——侥幸正确，属巧合而非设计，测试无锁定）。

### P2-2　Atom 的 `<description></description>` 空串挡住 `summary`/`content:encoded` 兜底（已复现）

`rss.ts:58`：`text(e.description ?? e.summary ?? e['content:encoded'] ?? '')`——fast-xml-parser 对空标签解析为 `''`，
而 `??` 只对 null/undefined 兜底。实测 `{description:"", summary:"SUMMARY"}` → body 为空。
body 丢失连带：`contentHash` 只用标题（同标题跨源碰撞概率升）、启发式打分少一半料、digest 摘要变标题复读。
修法：`text(e.description) || text(e.summary) || text(e['content:encoded'])`。

### P2-3　Telegram legacy Markdown：URL 只转义 `)` 和 `\`，`_`/空格/`(` 全漏 → sendMessage 400 当日推送静默失败

`push/telegram.ts:28-30` 的 `escUrl` 处理了右括号，但 legacy Markdown 下 `_` 是斜体实体字符、空格断链：
`https://en.wikipedia.org/wiki/Foo_Bar`、HN 上大量含 `_` 的 URL 都能让 Telegram 实体配对失败 → **400 Bad Request**，
而 P1-4 说过推送失败只有一行日志。这与 D1/C′9 是**同一类缺陷的未覆盖残余**（那次治的是文本侧转义）。
修法：URL 统一 `encodeURI` 后再把 `(`/`)` 百分号编码；或给 `sendDigestTelegram` 加一次「去转义重试」兜底。
测试 `telegram.test.ts:114-121` 只锁了右括号一例。

### P2-4　gen-evidence.mjs 的脆弱性双连：坏行炸整个判定脚本；坏 feedback.json 把 I-2 打成假 fail

- `gen-evidence.mjs:16`：`observations.jsonl` 逐行 `JSON.parse` **无 try/catch**——appendFileSync 崩溃窗口留下一条截断行，
  **期末判定当天脚本直接 SyntaxError 崩死**（已复现：`Unterminated string in JSON`）。判定数据的唯一权威读取器必须逐行容错并计数报「skipped N 坏行」。
- `gen-evidence.mjs:20`：`feedback.json` 解析失败静默 `return []`，但 `feedbackExists` 仍为 true →
  I-2 读成「0/N = 0% → **fail**」（假 fail，应 nodata）。store 侧 D6 改了名留存，脚本侧没对齐。

### P2-5　`publishedAt` 是死字段——采集侧三套解析逻辑，消费侧零使用

全库 grep：`publishedAt` 在 adapters 里精心解析（含 P2-1 upload_date 守卫），**refinery/memory/observe/digest 无一消费**；
LLM prompt（`scorer.ts:71-78`）也不带发布日期。后果：旧闻与新闻同分（新颖性只有标题 jaccard 一条腿），
「相对已知是否增量」的 LLM 三问之二只能靠模型猜。**探针期可不做时间衰减，但 LLM prompt 应至少附上发布日期**——
这是判「增量」的先决信息，一行改动。

### P2-6　手工编辑记忆库（README 承诺的能力）无 schema 校验 → 可把生产打成崩溃循环

README:20「可导出、可手工修正（直接改 JSON）」。但 `store.load()`（`store.ts:70-79`）JSON.parse 成功即整包接收：
手改 `archive.json` 时删掉 `entries` 字段 → 每轮 `recordItems` 的 `this.archive.entries.map` TypeError →
launchd 重启-崩溃循环（锁被信号钩子正常释放，重启无阻，**循环烧的是探针窗口**）。feedback.json 手改坏（如数组改对象）更阴险：
`feedbackBySource` 静默产出 `undefined` 键，权重学习被污染。修法：load 后 3 行形状校验，坏文件走既有 corrupt 改名路径。

### P2-7　bili 条目缺 `bvid` 时产出 `https://www.bilibili.com/video/` 空尾链接，不被任何环节丢弃

`agentreach.ts:110-128`：条目起始靠 `- id:` 行，但 URL 用 `cur.bvid`；输出格式漂移（bili-cli 升级）时 bvid 恒空 →
digest 里出现坏链接 + `contentHash(title+'')` 改变去重语义。至少应 `filter(i => i.bvid)`。
同类：`agentreach.ts:119` 的 YAML 取值不去引号，`title: "…"` 带引号入库（hash 与展示都受影响，测试 fixture 恰好全不带引号）。

### P2-8　jina 型「盯页面」源的条目身份不稳定（仪器语义缺陷）

`agentreach.ts:192/231`：id = hash(标题 + body 前 200 字)。被盯页面顶部内容变一个词 = 全新条目重新入候选；
页面顶部长期不变 = 永久 dedupe。两个 jina 源（hf-daily-papers/openai-news/anthropic-research 共 3 个）的产出
在 `sourceYield` 里因此呈**全有或全无**分布，I-3 的 zeroYield 判读对它们近乎不可解释。探针期至少在
`probe-changelog.md` 里登记该局限，期末复盘不得由这三个源的读数下结论。

---

## 四、P3——卫生面 / 理论面（登记不催修）

1. **SSRF 名单与纵深不一致**：`fetchUtil.ts:57-79` 缺 CGNAT `100.64/10`、benchmark `198.18/15`、组播/保留段、
   IPv6 ULA `fc00::/7` 与 IPv4-mapped `::ffff:127.0.0.1`（`new URL().hostname` 原样保留）、非点分十进制 IP；
   且 **fetch 跟随重定向，校验只发生在首跳 URL**（`withSizeLimit` 不复查 3xx 落点）、无 DNS rebinding 防护。
   威胁模型是「config 可信 + jina 自守」，故 P3；但 rss/github 源走 `http://`（`config/sources.json` 的
   `http://export.arxiv.org/rss/cs.AI`）——明文 + 无 SSRF 检查双挑站，改 https 一行零成本。
2. **criteria §2c 内部矛盾**：同一节既说「👍/👎 反馈隐含 viewed」又说「viewed 唯一定义 = views.json」；
   `gen-evidence.mjs:101-115` 按后者执行 → **老张只点 👍 忘了点 👀，P-1 恒 0**。这是签字前必须澄清的判据口径，
   代码本身忠实于「唯一定义」句。
3. `feedback/receiver.ts:47`：未知 ref 的 👍/👎 回调不回 `answerCallbackQuery`，Telegram 端按钮转圈几十秒（用户会以为 bot 死了）。
4. `vb:<digestId>` 对**不存在**的 digestId 也记 viewed（`receiver.test.ts:137` 锁定 d9 入账）——重放/伪造 callback 可无成本刷 P-1；单用户自证场景可接受，但判读时知道这层。
5. `store.export()`（`store.ts:227`）漏 views/weights 且返回内部对象引用——agy 终审 P2-2 已知，登记不重计。
6. `lock.ts:68-76` 信号钩子 `process.once` 在测试里随 acquireLock 反复注册（MaxListeners 警告噪音）；
   钩子删除锁文件时不校验持有人（先 release 后收 SIGTERM 的窄窗口会误删他人锁）。

---

## 五、架构级观察（无缺陷级，供判读与加注决策用）

1. **缺「探针还活着」的外置心跳**。I-1..I-4 是被动读数，前提是有人/有脚本定期跑 gen-evidence；P1-1 的挂起 + 无人值守 =
   两周后才发现第 3 天就断更。建议：launchd 每日 `gen-evidence --md` + 一行「最新观测 at 距今 > 36h 则红字」，成本 10 分钟。
2. **编排层容错粒度倒挂**：单源失败细粒度容错（对），但 `startBot` 的 `do { runOnce }`（`index.ts:271-280`）**无逐轮 try/catch**——
   pushFile 磁盘满、P2-6 的坏 archive 等任何非采集异常直接进程退出；feedback 接收器随 `finally` 一起死。加 4 行能把崩溃域收回到单轮。
3. **反馈归因粒度 = 簇代表项**（`index.ts:132` `registerDigestRef(cluster.items[0])`）：👍 只记簇首条目的源；
   聚类质量（CJK bigram jaccard，阈值 0.35）直接决定权重学习的学习信号质量。探针期可接受，**期末 bySource 解读必须带这层折价**
   （与 criteria §3b 位置偏倚条款同列，建议期末复盘一并写）。
4. **单进程 + JSON 文件 + 单实例锁**：两周/单用户规模恰当，不构成缺陷；但 `memory/` 无备份快照节奏（snapshot-evidence 靠手跑），
   判负/判过的证据链完整性依赖纪律。建议 snapshot 与心跳同批排进 launchd。
5. **判定线签字包应新增**（来自 P1-2/P1-3/P2-4/§2c 四条）：配置加载验证、launchd 空跑自检、pushFailed 标记、viewed 口径澄清。

---

## 六、既往档案对账（防重计声明）

已确认**落地**且本次复测未复发的代表项：offset 原子写+corrupt 留存、views 的 probeStart 窗口过滤、P-4 fail 方向守卫、
I-3 分母按轮回写、quantile n=3、D6 原子写、D2 逐条确认、D3 三元组、C′10 去重、D1 转义（文本侧）、B7 空锁接管、
B3 finally 释放、agy-R1 三项。agy 终审 4 项 P1 中前两项已修、P1-3（criteria 文本同步）与 P2-3（overallVerdict）仍开放——
与 `workplan §〇` 「剩余签字包」状态一致，不重计。
**本报告 P1-4 与 D10 的关系**：D10 缓批的是「observation 先于推送」；本次新增的是**它经由 I-2 分母制造假 fail 的具体传导链**与最省修法，非重复立案。

---

## 七、行动排序建议（对齐「开跑前剩余项」）

| # | 动作 | 工作量 | 阻断签字？ |
|---|---|---|---|
| 1 | P1-1 全链路 `AbortSignal.timeout` | ~30 行 | 强烈建议（事实阻断） |
| 2 | P1-2 `--env-file-if-exists` + 启动横幅打印通道开关 | ~10 行 | 强烈建议（事实阻断） |
| 3 | P1-3 plist 样例（含 PATH）+ launchd 空跑自检进 checklist | 文档+验证 | 开跑前必须 |
| 4 | P1-4 observation 补 `telegramPushFailed`（顺势做掉 D10 的重排序） | ~15 行 | 建议 |
| 5 | P2-1/P2-2/P2-4 三小修（词边界、`||` 兜底、脚本逐行容错） | 各 <10 行 | 建议随批 |
| 6 | §五-1 心跳脚本 + snapshot 排期 | ~30 行 | 建议 |
| 7 | P2-5/P2-3 及 P3 组 | 择期 | 不阻断 |

修复批守卫提醒（§2.2 纪律）：P2-1 改词边界 = 改过滤语义，须当天重跑双基线；P2-4 改脚本须同批补「坏行不炸、坏 feedback→nodata」两条守卫测试。

---

## 八、跨项目联系（按工作区指令归档）

本次审查产出的**可迁移结论**（供 fati-server 千 bot 工厂与 tuna 参照，不代表已通知对应线）：

1. **假门探针的「仪器三查」先于判定线本身**：能不能跑（超时/心跳）、配置真的生效了吗（.env 类文档-代码脱节）、
   部署环境与开发环境差异（launchd PATH）。三者任一失守，两周窗口烧掉且**读数方向性撒谎**（假 fail/假判负）。
   fati-server 的内容/分发管线与未来任何假门实验同病同药：每个实验上线前跑「空跑自检 + 通道开关横幅」。
2. **I-2 分母口径教训**：`fati-server` 的分发统计若同样按「应发数」而非「实发数」算互动率，同制造假低互动。
   推送类系统的观测字段应内建 `deliveryFailed`——与 fati-server 「预测账本升格为唯一记账权威」的裁决同向：
   **记账权威的第一原则是只记已发生的事实。**
3. **子串匹配关键词过滤器**是「千 bot 工厂」模板化时最易复制的缺陷（每个领域都会踩）：工厂模板里相关性原语应内置词边界 + 中英分词双轨（本库 CJK 2-gram 已是半成品，`tokenize` 可直接复用为工厂原语）。
4. **判负/判过后的复用清单**（呼应矩阵裁决 #8「合并进 tuna packages」）：本次确认值得优先抽取的可复制件为
   `runtime/lock.ts`（陈旧锁接管）、`memory/store.ts` 原子写+corrupt 留存、`observeRound` 原始分/加权分双通道观测设计、
   `gen-evidence` 的「pass/fail/nodata 三态判据读数」范式；不值得复制的：子串过滤、无超时 fetch、.env 口头支持。

---

*审查覆盖：src 20 文件逐行、scripts 2、config 3、tests 16 份全读、README/.env.example；dist 新鲜度与入库状态核实；
`npm test` 123/123、`tsc --noEmit` 通过（读取时间戳 2026-09-03 10:18-10:40 本地）。*
