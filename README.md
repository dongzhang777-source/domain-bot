# domain-bot —— 自进化领域专家 Bot（探针版）

> 定位：fati-server 千 bot 工厂「需求 50」命题的**假门测试探针**，第一个用户是老张本人。
> 一个 bot 跑通 = 无数 bot 可跑通的最小证据。
>
> **当前形态（2026-09-04 DB-04 改造后）**：双产线批产信息流，供 tuna 三级内容页消费。
> 每日摘要（`maxPerDigest=6`）与 Telegram 推送/反馈链路已退役（老张 2026-09-04 裁决）。
> 探针判定线整体**冻结中**，见 `docs/probe-verdict-criteria.md` 顶部的 DB-04 冻结声明。

## 它做什么

```
                        ┌─ 产线 A：newsline（AI时事快线）  ≤80 条 / 72h 窗
采集(广) ─→ 四层闸门 ─┤
                        └─ 产线 B：deepthought（AI深度思想）≤120 条 / 720h 窗

  采集                闸门                     提炼              终审              发布
RSS/Atom/arXiv ┐   ⓪ persona 前置            启发式/LLM 打分    渲染 → 十条        双产线
GitHub        ─┤      （源白名单/时效/红线）      ↓               客观断言          内容包
Agent-Reach   ─┤   ① 负向黑名单 13 条/5 组   源权重 + 新颖性    一票否决           （tuna-brief-v1）
  Exa 语义搜索 │      （坏数据/招聘/跨域/        ↓               ↓                  ↓
  V2EX/B站/YT  │       非技术/标题党）        实体词并查集      被否决 → 递补      指纹库（跨产线共享）
  Jina(无RSS页)┘   ② 多级关键词积分          事件聚合          填充感知裁剪        ↓
                     core+3/ecosystem+1/     （降权不丢弃）    事件超额复检      sync-tuna
                     generic 0，≥3 分准入                                       （默认 dry-run）
                   ③ 规范 URL 指纹去重
```

两条产线**彻底分离**：各自的源白名单、时效窗、上限、准入分、淘汰红线，各跑一遍完整产线。
唯一的共享件是 `memory/published-fingerprints.json`——防同一事件在两个 bot 里各出现一次。

### 质量是**可自动断言的属性**，不是人肉把关

这是 DB-04 的核心改动。改造前，用户真机刷到的 172 条内容产自**仓库治理之外的三道影子工序**
（`/tmp/tuna-feed-run/edit.mjs` → 人肉主编终审 → 人工拷贝进 tuna 仓），`src/` 生产管线全程未参与，
且 149 个测试全绿——因为那些内容从来不在任何测试的覆盖范围内。归档与证据见
`~/Projects/docs/tool-plans/archive/2026-09-04-shadow-pipeline/README.md`。

现在质量由三层保证：

| 层 | 机制 | 守卫 |
|---|---|---|
| 闸门 | 四层物理拦截，每条被拦都带 `gateId` + `ruleId` + `reason`，漏斗逐层可复算 | `tests/gates.test.ts`、`tests/eventCluster.test.ts` |
| 终审 | 十条客观一票否决断言（坏数据 / 重复规范 URL / 已发布 / 机械截断 / 碎片钩子 / 浮点回显 / 黑名单复跑 / 钩子实体 / 时效 / 形状限长）+ 跨条目事件超额复检 | `tests/gatekeeper.test.ts` |
| 回归 | 用 DB-03 审计里的**真实垃圾**做夹具（`tests/fixtures/`），断言它们一条也进不了产出 | `tests/pipeline-quality.test.ts` |

**LLM 分数不做闸门**：本项目已有「打分饱和使验收标准完全无读数」的前车之鉴，且 LLM 自分自用构成循环。
reviewer 的分数只用于**递补排序**（达标的排前），合格与否一律由上述客观断言定。

### 真跑实测（2026-09-04，非夹具）

| 产线 | 采集 | 过闸门 | 发布 | 入选比 | 事件簇 | 降权 |
|---|---|---|---|---|---|---|
| deepthought | 1184 | 126 | **120** | 0.1014 | 31 | 91 |
| newsline | 46 | 14 | **14** | 0.3043 | — | — |

改造前 deepthought 同口径只发得出 **35** 条。差额不是放宽标准换来的——是修掉了两个真缺陷：
事件聚类过度合并（词法单链接聚类把「同一研究领域」误判成「同一新闻事件」，126 条塌成 18 簇、误杀 109 条），
以及提前按 `maxItems` 截断使多样性选择根本没有发生机会。

**事件聚合是降权不是丢弃**：词法聚类的判别力不可靠（实测扫遍 `maxEntityDf` 阈值 1→20，
簇数从 126 到 24 单调变化，**没有任何阈值能分开**「同一事件」与「同一领域」），
所以超额条目排序靠后而不是被删。候选充足时强制事件多样性，候选薄时宁发重复不发薄包——
这个取舍由看板的 `eventFillMode` 显式暴露，不静默。

## 快速开始

```bash
npm install
npm test          # 370 个测试 / 24 文件（离线，不访问网络）
npm run typecheck # tsc --noEmit
npm start         # 整链批产：双产线依次跑，写 outbox/tuna/ 与 evidence/
npm run doctor    # 环境与配置体检（含三个配置文件的存在性与正则可编译性）
```

无需任何 API key 即可运行（启发式打分 + 机械渲染兜底）。

> ⚠️ **AI 编辑部当前是关着的**（`config/editor.json` 的 `enabled: false`），
> 所以 `npm start` 产出的文案仍是**机械兜底**。这不是遗漏，是实测后的决定：
> 2026-09-05 00:20 复核，`127.0.0.1:8052`（nous-proxy）活着而 `127.0.0.1:8080`（llama-server）未起，
> 此时开启会让 reviewer 降级到与 writer 同一个底座，**违反「写与评分离」裁决**。
> 开启前必须先拉起 8080，或给 reviewer 配另一个异族端点。详见 `config/editor.json` 的 `_enabledNote`。

## 分阶段批产（过夜作业）

writer 实测 ≈53 分钟/200 条，绑在一个进程里中途端点抖动就得从头再来。故产线拆成四段，
每段产物落 `staging/`，可分开排、可续跑：

```bash
npm run collect      -- --persona=deepthought   # 采集+闸门+事件聚合，落快照（不写归档）
npm run review       -- --persona=deepthought   # 只跑 reviewer + 金标自检（≈6 分钟）
npm run edit         -- --persona=deepthought   # 只跑 writer（≈53 分钟，可断点续跑）
npm run publish-feed -- --persona=deepthought   # 终审+发布（不重跑采集、不调端点）
```

> `publish` 在 npm 里叫 `publish-feed`：`publish` 是 npm 的生命周期钩子名，同名 script 会在
> `npm publish` 时被自动触发。本仓 `private: true` 挡着，但不值得留这个坑。

四段与整链 `run` **共用同一段产线代码**（`pipeline.ts` 的 `collectStage` / `finalizeStage`），
`tests/cli-stages.test.ts` 用逐字段比对内容包钉死这件事：分段跑与整链跑产出必须完全相同。
`tests/wiring.test.ts` 另有一组「单一发布路径守卫」，断言 `buildPack` / `appendFingerprints`
在 `cli.ts` 内各只有一个调用点——防止将来就地再写一遍发布逻辑，重新长出第二条产线。

产物对齐有硬校验：`persona.maxItems` 若在 `edit` 与 `publish` 之间被改过，下标会错位，
而错位**不会让任何断言变红**（只会让 A 条目的文案挂到 B 条目上，格式完美、内容张冠李戴），
故 `assertTargetAlignment` 直接拒绝发布并给退出码 6。

## 配置

| 文件 | 内容 |
|---|---|
| `config/personas/newsline.json` | AI时事快线：7 源白名单、`maxAgeHours` 72、`maxItems` 80、`minQualityScore` 6、4 条淘汰红线（`clickbait` 标题党 / `unsourced` 二手无源传闻 / `training` 培训营销 / `listicleClickbait` 清单体标题党） |
| `config/personas/deepthought.json` | AI深度思想：8 源白名单、`maxAgeHours` 720、`maxItems` 120、`minQualityScore` 7、4 条淘汰红线（`nameExplainer` 名词解释 / `hollowOpinion` 无实验支撑的空洞观点 / `conceptComparison` 概念对比体 / `listicleClickbait` 清单体标题党） |
| `config/gates.json` | 闸门：`blacklist` 13 条分 5 组（`damaged` / `adRecruit` / `crossDomain` / `nonTech` / `hype`，各带 id 供看板归因）、`keywordTiers`（core 51 词 +3 / ecosystem 20 词 +1 / generic 7 词 0）、`minPoints` 3、`minTitleChars` 15、`dedupe`（`maxPerEvent` 2、`eventStopwords` 341、`maxEntityDf` 20、`maxEntityDfRatio` 0.02） |
| `config/domain.json` | 词表来源：领域名、关键词、信号词、聚类阈值。**不再有** `maxPerDigest` / `scoreThreshold`（已移入 persona） |
| `config/sources.json` | 源注册表（`id`/`type`/`url`/`weight`/`enabled`），type：`rss`（含 Atom/arXiv）、`github`、`exa`（url=搜索词）、`v2ex`、`bili`（url=搜索词）、`ytsearch`（url=搜索词，需本机装 yt-dlp）、`jina`（url=目标网页） |
| `config/editor.json` | AI 编辑部：`enabled` 开关、writer/reviewer 各自的降级链（端点/key/model 全走环境变量，`baseUrlDefault` 只是实测可用值不是承诺）、批大小与 `max_tokens`（由实测吞吐定，见文件内 `_throughputNote`）、金标自检阈值 |

改 `config/gates.json` 的 `eventStopwords` 后必须跑 `npm run probe:events` 与
`tests/eventCluster.test.ts` 验证召回未退化——通用词表判据是「事件标识必须是专有名词/产品名」，
拿话题词聚类必然误并（实测 `Microsoft Agent Framework` 经 `agent` 与 Astra 报道撞车）。

渠道来自 [Agent-Reach](https://github.com/Panniantong/Agent-Reach) 免登录通道。
需登录态的 Twitter/Reddit/小红书通道**刻意不进**无人值守管线（封号风险），留待人工决策。

## 自进化与行为回流

**Telegram 链路已彻底退役**（`src/push/telegram.ts`、`src/feedback/receiver.ts`、`src/push/file.ts` 已删，
`tests/wiring.test.ts` 有守卫断言它们不得复现）。取而代之的是 **tuna 端侧行为回流**：

```
tuna App（用户展开/划走/收藏/深聊）
   │  packages/brain/signals-export.ts → tuna-signals-v1（带 postId）
   ▼
用户手动导出 JSON
   │  npm run ingest -- --signals=<path>
   ▼
domain-bot：postId 去首段 = ref「<digestId>:<index>」→ resolveRef → itemId + source
   ▼
store.recordView / recordEngagement / recordFeedback
   ▼
weights.ts 源权重（只调排序，不过滤）+ interest.ts Beta 后验
```

归因链的关键是 `publish` 阶段登记的 `registerDigestRef`：没有它，回流的信号无法映射回
itemId 与 source，权重与兴趣就仍然喂不进去。

**自进化 = 记忆库 + 反馈回路，不重训模型。** 记忆库是纯 JSON
（`memory/archive.json` / `feedback.json` / `views.json` / `weights.json` / `published-fingerprints.json`，
另有 `observations.jsonl` 观测流），可导出、可手工修正，防自我固化。

质量看板的 `selfEvolutionActive` **由真实信号存量算出**，不硬编码——回流接通前恒 `false`，
有信号即自动转 `true`，两头都不说谎（`tests/wiring.test.ts` 有守卫）。

## 两周探针的判定标准

判定线共 **11 项**（I-1…4 探针无效判据 / G-1…3 放弃线 / P-1…4 通过线），
唯一口径见 `docs/probe-verdict-criteria.md`；判定数据一律以 `scripts/gen-evidence.mjs` 产出为准，禁止手抄。

**当前状态：整体冻结。** DB-04 改了行为数据的来源与语义，使 I-2 永久 `nodata`
（分母「Telegram 送达数」已无来源）、G-1/G-2 口径已换且 `memory/views.json` 现存 5 条是联调脏数据。
逐项失效机制与 DB-07 的两个前置条件见该文件顶部的 **DB-04 冻结声明**。

## 已知边界（刻意不做 / 欠账）

- **AI 编辑部默认关闭**：见上方 ⚠️。开启的前提是 writer 与 reviewer 有**两个异族端点**同时可用，
  否则违反「写与评分离」。这是当前影响内容观感的头号事项。
- **事件聚类是词法的，不做语义归并**：对不含专有名词的标题（如 The Verge 的
  `next big AI model…AGI era`）召回不到，这类同事件刷屏只能靠终审的 `maxPerEvent` 兜。
  LLM 语义归并是欠账，未排期。
- **tuna 侧 native 持久化只做了 iOS**：`apps/tuna/modules/tuna-signals-store/` 是自建 Expo Module
  封装 `NSUserDefaults`（守宪法「零第三方运行时依赖」，故不能用 AsyncStorage）。
  Android 需另做 SharedPreferences——取舍已列入根仓 `docs/ACCEPTANCE-DEBT.md` 待老张定。
  iOS 未装该模块时 `pickStorage` 回落 Web 端并**如实报告 `persistent=false`**，不假装持久化。
- **不做 X/微博/Reddit/B站 需登录态适配器**（反爬维护黑洞 + 封号风险，跑通后再说）。
- **新颖性判定用标题/实体词，不是向量检索**——量级到了再读 tuna 的 embedding 架构升级。
- **全量候选入档**（`recordItems(candidates)` 而非只入推送条目）：这是「解传送带」纪律，
  只归档推送条目会让去重库只屏蔽推过的 N 条，同一批源内容被逐轮消费，推送质量单调衰减。
- **`memory/views.json` / `feedback.json` 现存的是联调期数据**：判定线开跑前必须清空，
  或用 `gen-evidence.mjs --probe-start` 窗口隔离，否则 G-1/G-2 的读数被污染。

## 验证纪律

- 改代码后必须立即 `npm test`（AGENTS.md 强制），验证不通过禁止 commit。
- **验证命令后禁止直接接管道**：`npm test | tail` 的退出码是 `tail` 的 0，会完全吞掉失败。
  必须 `set -o pipefail` 后再接，或先重定向到文件（`npm test > /tmp/t.log 2>&1; echo "exit=$?"`）。
- **关键断言必须做变异测试**：`python3 scripts/mutation-check.py` 注入 4 处目标变异，
  证明对应断言会红，另跑 1 处对照组（注入注释）证明判定不是恒红，最后逐文件字节比对确认已还原。
  断言在变异下仍绿 = 该断言没有锁定任何东西（本项目踩过：2 元素样本无法区分 floor 与 ceil，
  5 条 quantile 断言全绿而缺陷永存）。
