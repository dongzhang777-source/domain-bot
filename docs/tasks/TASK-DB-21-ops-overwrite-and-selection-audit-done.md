# TASK-DB-21 审查报告：domain-bot 产线「覆盖写丢数据 / 交付选择错位」

> 工单号：DB-21　｜　审查人：总管小巴（WorkBuddy 通道，本单唯一作答会话）
> 基线：`domain-bot @ 9757a23` ＋ `tuna @ 5a5f1ba`（与工单一致）
> 审查方式：**只读**。未改动两仓任何源码/配置/staging/outbox/memory，未 commit/push；全部重放写在 `/tmp/db21/`
> 报告时间：2026-09-07 16:30 EDT（下文所有状态断言均带时间戳）
> 自测标记：`ALL_DB21_PASS`

---

## 〇、先说结论（老张看图）

产线真正的问题**不是**「发布器挑错了稿子」，而是**两处各自造了一套判据，其中发布器那套是劣化版**。

| 现象 | 真相 | 分级 |
|---|---|---|
| 每轮产 20 篇，线上只活几条 | 发布器的「同事件去重」认错了亲戚：74 条互不相关的稿子被塞进**同一个事件桶**，只留 2 条 | **P0** |
| 重跑一次就少一批稿 | 同一轮的 pack 文件按 `persona-digestId` **整文件覆盖写**，而条目早已记入指纹库，重跑不会再产出 → 永久丢失 | **P0** |
| 机械稿是不是漏进去了 | **没有**。135 条机械兜底稿漏放 0 条，闸很准。工单这条假设证伪 | 观察 |
| 是不是 cap 卡产量 | **不是**。cap=200，实际最多 40 条。卡产量的是质量闸：285 条 → 27 条（存活率 9.5%） | P1 |

**最要紧的一句**：发布器的「同事件」判据里，**没有排除 openai / model / releases 这类 AI 领域热词**，而 domain-bot 自己的 `gates.json` 里明明有一张停用词表把它们全排除了。两套判据同源不同实现 —— 这正是工单 B.1 要找的那个东西。

---

## 一、方法：怎么核的（可复现）

重放脚本复刻 `tuna/scripts/publish-domainbot-pack.cjs` §1–§2 的全部逻辑（收集→合并→LocalBriefNormalizer→四道闸→排序→裁剪），**只读取、不写包、不 push**。

```
脚本：/tmp/db21/replay.cjs      主重放（逐条对账）
      /tmp/db21/bucket.cjs      事件桶量化
      /tmp/db21/humanvmech.cjs  亲写稿 vs 机械兜底稿
快照：/tmp/db21/snap-161552/    outbox + 线上包冻结副本（16:15:52 EDT）
运行：SNAP_OUTBOX=/tmp/db21/snap-161552 SNAP_LIVE=/tmp/db21/snap-161552/live-pack.json node replay.cjs
```

**保真度自检**：对 v15 时刻的重放产出 27 条，与线上 `tuna-pack/builtin-pack-v2.json` 的 27 条 **id 集合零差异**（仅线上有 0 条 / 仅重放有 0 条）。重放逻辑可信。

**抽样方法**：候选仅 285 条，**全量对账**，不做抽样（严于工单要求的「25 存活 + 30 被剔」）。

---

## 二、B 族头号发现（P0）：热词黑洞 —— 74 条互不相关的稿子被塞进一个桶

### 现象

线上 v15 的 27 条里，09-06 的老包 `mtq0a0lm` 独占 13 席；而 09-07 15:00 轮新产的 `mtrm4lhx`（10 条，其中 8 条亲写稿）**存活 0 条**。

### 实证

**① 两处判据对照（同源异实现的铁证）**

| | domain-bot 侧 | tuna 发布器侧 |
|---|---|---|
| 停用词表 | `config/gates.json` 的 `dedupe.eventStopwords`：**openai / anthropic / google / microsoft / meta / nvidia / deepmind / model / models / ai / launches / release / released / releases / introducing / announce …** | `publish-domainbot-pack.cjs:78-80`：**只有 14 个通用虚词** `this/that/with/from/have/been/were/their/about/would/could/more/new/news`，**零个领域词** |
| 相似度判据 | `jaccardThreshold: 0.75`（**比例**） | 「共享词**绝对数** ≥2」（`:113-114`） |
| 每簇上限 | `maxPerEvent: 2`（`gates/fingerprint.ts:135`） | 2（`:120`） |

**② 桶规模量化**（`/tmp/db21/bucket.cjs`，基准 15:5x）

```
事件桶总数 23 个｜过闸候选 141 条
桶 ev-1  成员 74（存活 2）  建桶者: "August newsletter is out"（09-05 的月度通讯）
桶 ev-4  成员 18（存活 2）  建桶者: "Alignment-Free Text-Audiobox…"
桶 ev-3  成员  8（存活 2）
桶 ev-7  成员  8（存活 2）
桶 ev-5  成员  5（存活 2）   桶 ev-6 成员 5（存活 2）
```

**③ ev-1 吸收成员时的「共享词」实录**（`reconcile.json`，逐条）

```
共享词=agentic,models,auto         → MaxKernel: Agentic Kernel Generation
共享词=model,claude,openai         → Nvidia just showed that the harness…
共享词=models,reasoning            → VIBE-Bench
共享词=openai,model,capability,work,critical → OpenAI's next big AI model
共享词=releases,models,model       → IFM Releases K2 Horizon
共享词=benchmark,notably           → NVIDIA's $20 Billion Groq Bet
```

这 6 条**没有一条是同一个事件**。把它们判成同事件的，全是 `openai/model/models/releases/benchmark` —— **正是 `gates.json` 停用词表要排除的词**。

### 根因（四条叠加）

1. 发布器没复用 domain-bot 的事件键（`stage.eventKeyOf`）和停用词表，自己重造了一个。
2. 用「共享词绝对数 ≥2」而非比例 —— 词集越大的条目越容易命中，长摘要天然通吃。
3. 桶的词集**建桶后就冻死**（`:117` `eventCounts.set` 只在新建时执行），判据永远等于最早那条。ev-1 的种子是一条「月度通讯」，词集极宽 → 后续 AI 内容无一幸免。
4. 遍历序 = 文件名 `.sort()` = persona 字母序 + digest 字典序 ≈ **时间升序**（digestId = `persona + now.toString(36)`，now 递增则字典序递增，实测 24 个包顺序与此一致）→ **旧稿先占坑，新稿后到必被剔**。

### 后果量化

| 09-07 轮次 | 亲写稿 | 存活 | 被剔主因 |
|---|---|---|---|
| 11:00 deepthought `mtrdm6sl` | 8 | **4** | 同事件刷屏 |
| 11:00 newsline `mtrdiy4u` | 4 | **2** | 同事件刷屏 |
| 15:00 deepthought `mtrm4lhx` | 8 | **0** | 同事件刷屏（8 条中的 8 条） |
| 15:00 newsline `mtrlvrkb` | 5 | **2** | 同事件刷屏 3 + 机械 5（机械的是真机械） |
| **合计** | **25** | **8** | |

> 全量口径：293 条中亲写 158 条，存活 27（17.1%）；机械兜底 135 条，存活 **0**。

### 行动建议

**落点**：`tuna/scripts/publish-domainbot-pack.cjs:78-80`（停用词表）、`:109-120`（事件判定）。

**推荐做法**：让 domain-bot 在 pack 的每条 post 上带一个 `eventKey` 字段（复用 `stage.eventKeyOf`），发布器直接用，别自己算。退一步也要把 `gates.json` 的 `eventStopwords` 引进 `tokensOf`，并把判据改成 Jaccard ≥ 0.75。

**双向论证**：
- 不修的代价：桶只会越来越大，新稿存活率单调趋零（09-07 15 点轮已经归零了）。继续整改「产量不行」会改错方向。
- 修了会推翻什么：现有「每事件最多 2 条」的多样性效果，是靠这个劣化判据实现的。修正后 141 条候选的存活数会**大幅上升**（粗估 60–80 条），必须重新确认两件事：(a) 老张「宁缺毋滥」的预期是否还成立；(b) v9 那次「14 条机械稿混进远端包」的防线是否兜得住（机械闸本身没问题，但量大了要复验）。**建议先在 /tmp 跑一遍修正版，对比存活集合再决定**。

---

## 三、A 族头号发现（P0）：同轮重跑 → pack 整文件覆盖，前次发布条目永久丢失

### 实证（三条独立证据）

**① 代码路径**：`src/publish/pack.ts:134`
```ts
const path = join(outDir, `feed-pack-${pack.persona}-${pack.digestId}.json`)
writeFileSync(path, JSON.stringify(pack, null, 2))   // 无条件覆盖
```
文件键 = persona + digestId。digestId 在 collect 阶段就定死（`pipeline.ts:283`：`sanitizeDigestId(persona.id + now.toString(36))`），**接手同一 staging 重跑 publish 必然同名**。

**② 观测日志（决定性）**：`memory/observations.jsonl` 是**追加写**，跑几次留几条：

```
2026-09-07T15:09:14.853Z [deepthought] 跑了 5 次：pushed 8 → 5 → 3 → 8 → 10
2026-09-07T15:06:43.662Z [newsline]    跑了 5 次：pushed 6 → 3 → 1 → 4 → 10
2026-09-07T19:07:30.645Z [deepthought] 跑了 3 次：pushed 10 → 10 → 10
2026-09-07T19:00:38.603Z [newsline]    跑了 4 次：pushed 10 → 10 → 10 → 10
2026-09-06T23:06:08.134Z [deepthought] 跑了 2 次：pushed 18 → 0
```

pushed 数逐次变化，就是**指纹库逐次消费 + 覆盖写**的签名。最后 10 → 0 那次最狠：18 条已发布条目全部被指纹挡掉，重跑产出 0 条。

**③ 审查期间的实时证据**：16:06 EDT，`feed-pack-newsline-newslinemtrdiy4u.json` 被再次写入，而它的 `generatedAt = 2026-09-07T15:06:43Z`（即 11:06 EDT 那一轮）—— **同一轮的 pack 在 5 小时后被覆盖重写**。

### 丢失机理（为什么补不回来）

```
第1次 publish: 8 条 → writePack 落盘 → appendFingerprints 记账（cli.ts:394）
第2次 publish: 这 8 条被 fingerprint:alreadyPublished（gates/fingerprint.ts:52）
               和 gk:alreadyPublished（assertions.ts:132）双闸挡掉
               → 只能发新条目 → 写同名文件 → 覆盖
```
旧条目状态：**已消费（在指纹库里）+ 不在任何 pack 里** = 对下游永久丢失。

### 行动建议

**落点**：`src/publish/pack.ts:131-137`。

三个选项（推荐 A）：
- **A. 先读后合并**：writePack 读同名旧包 → 按 id 合并 posts → 写回。改动最小，不破坏发布器输入契约。
- B. 文件名加轮次序号（如 `-r2`）：需同步确认发布器 `feed-pack-*` 过滤不受影响。
- C. 写前备份到 `outbox/tuna/.bak/`：保底，但会产生大量文件。

**双向论证**：
- 不修：每次重跑静默吞稿，产量永远对不上账。
- 修了会推翻的资产：outbox 文件名是发布器的输入契约（`publish-domainbot-pack.cjs:50-53` 按 `feed-pack-` 前缀 + mtime 过滤），改命名必须同步验证；合并写会让单包体积单调膨胀（当前 `mtq0a0lm` 已 1.8MB）。

---

## 四、其余发现（按分级）

### A-2（P1）记账与交付的顺序 —— **订正工单的疑虑方向**

工单问「publish 可能在 pack 写出前失败吗」。**不会**，实测顺序是对的：
```
cli.ts:392  writePack        ← pack 落盘
cli.ts:393  writeBoard
cli.ts:394  appendFingerprints  ← 指纹记账
```
pack 写失败 → 抛错 → 指纹不入账 → 下次可重发。**这个方向安全。**

**真正的窗口在反向**：pack 已落盘，但 writeBoard 抛错 / 进程被杀 → **已交付、未记账** → 下次重跑会重复发布同一内容并覆盖同名 pack。窗口窄，但语义上是个洞。

### A-3（P1）没有发布历史账，丢了多少查不出来

我想量化 09-07 15:09 那轮 5 次重跑丢了哪几条，三条路全断了：
1. outbox pack 已被最后一次覆盖；
2. `memory/digests.json` 与 `digestRefs` 每次 publish 都按 digestId/ref **覆盖重写**（`store.ts:249`、`:216`），只反映最后一次；
3. 指纹库只有 URL 集合，无轮次归因。

全系统唯一的追加式记录是 `observations.jsonl`，但它只记**数量**，不记条目 id。

**建议**：加一条 append-only 的 `publish-log.jsonl`（digestId / at / postIds / packPath），可复用 store 现有的 `writeFileAtomic` 纪律。不修 → 每次丢稿都只能凭印象整改。

### B-2（P2，观察）机械文案闸精准有效，工单假设证伪

- 被「c)机械文案」剔的 116 条中，**115 条命中真机械特征**（「≥2 个 ·」的标签碎片 / `Article URL`·`Tag:`·`N stars` 元数据残留），仅 1 条是「过短」软特征。
- 全量 293 条里机械兜底 135 条，**漏放 0 条**。
- 形态实证（`newslinemtrlvrkb` 包内）：`[5]-[9]` 的 hooks 是 `qwen3 · max · sources`、`ai-llm｜teamai · cli · internally` 这类机械兜底 → 剔对了；`[0]-[4]` 是正常中文钩子 → 亲写稿，其中 `[0][1][4]` 是被**同事件刷屏闸**剔的，不是机械闸。

**工单两处假设因此证伪**：
- ✗「亲写稿被机械闸误伤」→ 主因是同事件刷屏闸（B-1）。
- ✗「mtq0a0lm 的 word·word·word 机械稿占 13 席」→ 那 13 条的 hooks 是正常钩子（如「Blackwell的FP4张量核并未自动加速注意力…」），占席的真因是**遍历序靠前、先占坑**。

### B-3（P1）硬编码参数盘点：没有 cap 在卡产量

| 参数 | 位置 | 值 | 今天卡了什么 |
|---|---|---|---|
| `persona.maxItems` | `config/personas/*.json` | 10 × 2 persona | **与老张裁决一致**（见下），未冲突 |
| `editorialTargetsOf` | `staging.ts:251-253` | maxItems*2 = 20 | 未卡 |
| `recall.maxPerRound` | `gates/index.ts:129` | 20 | 未卡 |
| `dedupe.maxPerEvent` | `gates.json` / `fingerprint.ts:135` | 2 | 发布器对齐它，但**判据劣化**（B-1） |
| `FINGERPRINT_LIMIT` | `pack.ts:206` | 20000 | 远未达，未卡 |
| 发布器 `limit` | `publish-domainbot-pack.cjs:28` | 200 | **从未生效**（存活最多 40 条） |

**关于「每轮 20 篇」**：`docs/plan-content-quality-overhaul-2026-09-06.md` 文末老张裁决原文 —— 「每轮产出改为 20 篇（**newsline 10 + deepthought 10**）」。两个 persona 各 `maxItems=10` 合起来正好 20/轮。**工单担心的冲突不存在**，参数是对的。

真正卡产量的是质量闸：285 条 → 27 条，存活率 9.5%，cap 距触发还有 5 倍余量。`limit=200` 是个**误导性参数**（读代码的人会以为产量受它约束），建议注释掉或改成不参与展示。

### B-4（P1）deepthought 被挤压 + 老内容挤掉新内容

23 个事件桶里，**ev-1 ~ ev-16 全部由 deepthought 建桶，仅 ev-19/ev-22 由 newsline 建桶**（`feed-pack-deepthought-*` 排在 `feed-pack-newsline-*` 之前，d < n）。deepthought 先建桶占满坑位，newsline 后到只能掉进去被剔。同 persona 内同理：09-06 的 120 条大包先占坑，09-07 新稿后到被剔。**修 B-1 即解。**

### B-5（P2）发布器读的是「活」的 outbox，无快照一致性

逐文件 `readdirSync` + `readFileSync` 读 30+ 个文件，期间若有 publish 覆盖写入，合并结果不确定 —— 同输入可产出不同的包。建议发布前先把 outbox 拷到临时目录再合并。

### C-1（P0，与 A-1 同源）跨仓异步推送的跳票面

domain-bot 侧 publish 即 `appendFingerprints` 记账，tuna-pack 推送是另一个仓的异步脚本。

- **一半其实安全**：条目进 outbox 后不删，发布器没跑的话下次会带上。
- **真正的跳票**：条目进 outbox 后，同 digestId 的 pack 被后续重跑**覆盖**（A-1）→ 从 outbox 消失，而指纹已记 → **永远补不回来**。

**manifest 单调守门现状**：版本由发布器自己 `prev.version + 1` 自增（`:142`），**没有「新包不得显著小于上版」的护栏**。历史 v12 是老张「清空」指令产生的 0 条包（`tuna-pack` git log `73fb593`）—— 说明**版本单调递增 ≠ 内容不倒退**。App 侧防回滚只看 version，若误跑出一个小包也会照单全收。

**建议**：加护栏「新包条数 < 上版 80% 时中止，需 `--force`」（v12 那种有意清空走人工确认）。行动项归入 A-1。

### C-2（P1）`lang=en` 被 App 真实消费，中文内容配英文提示

- 消费点：`tuna/apps/tuna/src/components/ShareDrawer.tsx:167` `staticCoachText(post.lang, 'none')`；实现 `packages/share/prompts.ts:64` `staticCoachText(lang: 'zh' | 'en', level)`。
- 现状确认：线上 v15（27 条）/ v17（40 条）**lang 全为 `en`**，而文案正文是中文。
- 后果：分享抽屉的「嘴替」教练提示按 en 渲染 → 中文内容配英文提示。
- 落点：domain-bot 侧 `buildPack`（`pack.ts:50` `lang: p.lang`）应改为按文案实际语言判定（检测 hooks/summary 的 CJK 占比），而非沿用候选原文语言。
- 双向论证：改了不影响已入库的信号归因 —— grep 确认 `post.lang` 的消费点**仅此一处**。

### C-3（P2）发布器无并发锁

工单声明「本单为只读审查」，但审查期间产线仍在自动生产：15:38 → 16:06 期间 outbox 被多次重写，tuna-pack 从 v15(27) → v16(37) → v17(40)。

domain-bot 侧有 `acquireLock(memoryDir)`（`cli.ts:270`），**发布器侧没有任何锁** —— 两个会话同时跑发布器会互相覆盖 + 双 push。建议加同款锁文件。

---

## 五、v15 存活账对账表（工单交付物 2）

**基准**：09-07 15:38 EDT 落地的 v15（27 条）。重放与线上 **id 集合零差异**。

### 5.1 汇总

| 来源包（digestId） | 产出时刻 | 总 | 亲写 | 机械 | **存活** |
|---|---|---|---|---|---|
| deepthought `mtq0a0lm` | 09-06 23:11 | 120 | 65 | 55 | **13** |
| deepthought `mtrdm6sl` | 09-07 11:45 | 10 | 8 | 2 | **4** |
| deepthought `mtr96b2c` | 09-07 09:41 | 10 | 6 | 4 | 2 |
| newsline `mtq5xrf9` | 09-06 21:30 | 60 | 39 | 21 | 2 |
| newsline `mtrdiy4u` | 09-07 11:45 | 4 | 4 | 0 | 2 |
| newsline `mtrlvrkb` | 09-07 15:37 | 10 | 5 | 5 | 2 |
| deepthought `mtqfqdjf` | 09-06 23:41 | 12 | 8 | 4 | 1 |
| deepthought `mtowr5h2` | 09-05 21:56 | 3 | 3 | 0 | 1 |
| **deepthought `mtrm4lhx`** | **09-07 15:37** | **10** | **8** | **2** | **0** |
| 其余 15 个包 | — | 54 | 20 | 34 | 0 |
| **合计** | | **293** | **158** | **135** | **27** |

### 5.2 被剔构成（285 条合并去重口径）

| 闸 | 条数 | 说明 |
|---|---|---|
| d) 标题裸抓 `owner/repo:` | 28 | |
| c) 机械文案 | 116 | 其中 115 条命中真机械特征 |
| b) 同事件刷屏 >2 | 114 | **ev-1 单桶贡献 72 条** |
| a) 空壳 | 0 | |
| **存活** | **27** | 存活率 9.5% |

### 5.3 抽查用：09-07 两轮 25 条亲写稿逐条去向

| 来源 | 亲写 | 存活 | 被剔归因 |
|---|---|---|---|
| `mtrdm6sl` (11:00 dt) | 8 | 4 | 4 条落 ev-1/ev-5/ev-7 老桶（共享词 `model,claude,openai` / `tractable,large` / `learning,networks` / `language,into`） |
| `mtrdiy4u` (11:00 nl) | 4 | 2 | 2 条落 ev-1（共享 `openai,critical,claude,fable` / `openai,reasoning,fable`） |
| `mtrm4lhx` (15:00 dt) | 8 | **0** | 6 条落 ev-1/ev-3/ev-5/ev-7（`model,openai` / `models,reasoning` / `agent,execution` / `over,they`…）+ 2 条真机械 |
| `mtrlvrkb` (15:00 nl) | 5 | 2 | 3 条落 ev-1（`openai,benchmark` / `releases,models` / `anthropic,billion`） |

完整逐条明细（含每条 id、命中闸、共享词原文）：`/tmp/db21/reconcile.json`、`/tmp/db21/buckets.json`。

---

## 六、工单描述与代码不符之处（工单交付物 4）

| # | 工单写法 | 实测 | 依据 |
|---|---|---|---|
| 1 | 「线上 **v15** 包里 25 条」 | **v15 = 27 条**（15:38 落）；25 条是 **v14**（09-07 11:46）。审查期间已推进到 **v17 = 40 条** | `tuna-pack` git log + manifest.json |
| 2 | 「22 个 pack 合并 265 条」 | 基准时刻 **24 个包 / 285 条**（v17 时刻 33 个包 / 358 条） | `replay.cjs` 输出 |
| 3 | 「`FINGERPRINT_LIMIT`（`pack.ts:145`）」 | 实际在 **pack.ts:206**（行号已漂移） | Grep |
| 4 | 「mtq0a0lm 机械钩子稿占 13 席」 | **证伪**。那 13 条是正常钩子，占席真因是遍历序靠先占坑 | 逐条读 `mtq0a0lm` posts[1][2][5][6][8] 的 hooks |
| 5 | 「亲写稿被机械闸误伤」 | **证伪**。机械闸漏放 0 条；亲写稿被剔主因是同事件刷屏闸 | `humanvmech.cjs` + `reconcile.json` |
| 6 | 「publish 可能在 pack 写出前失败？」 | **不会**。`writePack`(cli.ts:392) 在 `appendFingerprints`(:394) 之前，顺序正确 | cli.ts |
| 7 | 「maxItems=10 与每轮 20 篇冲突？」 | **不冲突**。10 × 2 persona = 20/轮，与老张 09-06 文末裁决原文一致 | plan 文末附注 |

---

## 七、行动清单（按优先级）

| 级别 | 问题 | 落点 | 一句话做法 |
|---|---|---|---|
| **P0** | C-1 manifest 无「内容倒退」护栏 | `publish-domainbot-pack.cjs:139-148` | 新包 < 上版 80% 时中止，需 `--force`（**未修**，本单唯一遗留 P0） |
| P1 | B-1 热词黑洞（同事件判据同源异实现） | `publish-domainbot-pack.cjs:78-80,109-120` | 引入 `gates.json` 的 `eventStopwords`，判据改 Jaccard；或让 domain-bot 在 post 上带 `eventKey`（**症状已由 `19329a5` 缓解，此为治本项，见 §9.3**） |
| ~~P0~~ | ~~A-1 同轮重跑覆盖写丢稿~~ | `src/publish/pack.ts:131-137` | **已修**（`31e1d76` 改合并写）。本报告提供独立实证与复现证据，建议补一个回归用例钉住 |
| ~~P1~~ | ~~C-2 中文内容 lang=en~~ | `src/publish/pack.ts:50` | **已修**（`31e1d76` lang 按交付文案判）。同上，建议补回归用例 |
| P1 | A-3 无发布历史账 | `src/cli.ts` emitPublished | 加 append-only `publish-log.jsonl` |
| P1 | B-4 deepthought / 新稿被挤压 | 同 B-1 | 修 B-1 即解 |
| P1 | A-2 交付后/记账前崩溃窗口 | `src/cli.ts:392-394` | 明确语义并加补偿（可选） |
| P2 | B-2 mechScore 与 gk 断言对齐防漂移 | `publish-domainbot-pack.cjs:87-99` | 加交叉测试钉住 |
| P2 | B-5 发布器无快照一致性 | `publish-domainbot-pack.cjs:49-63` | 先拷贝到临时目录再合并 |
| P2 | C-3 发布器无并发锁 | `publish-domainbot-pack.cjs` 入口 | 加与 domain-bot 同款锁文件 |
| P2 | B-3 `limit=200` 误导 | `publish-domainbot-pack.cjs:28` | 注释说明它从未生效 |

---

## 八、硬约束自查

| 约束 | 状态 |
|---|---|
| 只读审查，未改两仓源码/配置/staging/outbox/memory | ✅ 本会话**只写了本报告一个文件**。两仓 `git status` 另有 2 处改动，均非本会话所为（见第九节） |
| 未 commit / push | ✅ |
| 实验性重放只写 `/tmp` | ✅ 全部在 `/tmp/db21/` |
| 断言附实证（路径+行号 / 命令+输出） | ✅ 每条发现均附 |
| 跨仓核查未用 Bash grep 多关键词 | ✅ 全程用 Grep 工具 |
| 状态类断言提交前带时间戳重跑复核 | ✅ 见下 |
| 未动 `domain-bot/memory/`（含指纹库） | ✅ 只读 |

**提交前复核**（2026-09-07 16:2x EDT 重跑，基准 = 冻结快照 `/tmp/db21/snap-161552`）：

```
$ node replay.cjs                     # 旧序（文件名 sort，= 基线代码）
[replay] 参与包 33 个，合并去重后 358 条候选
[replay] 闸后存活 34 条 | 剔除：标题裸抓 47 / 空壳 7 / 机械+刷屏 270

$ SORT=newfirst node replay.cjs        # 新序（createdAt 新→旧，= 模拟修复后）
[replay] 闸后存活 40 条 | 剔除：标题裸抓 47 / 空壳 7 / 机械+刷屏 264
```

**这两组数字解释了此前的一处误判**：我一度把「重放 34 vs 线上 40」归因于产线漂移（原写 B-5 / C-3）。订正 —— 主因是**发布器代码在审查期间已被修复**（见第九节），我复刻的是基线旧逻辑。用新序重放得到 40 条，**与线上 v17 的 40 条完全一致**，重放保真度第二次得到确认。

---

## 九、与总管并行修复的关系（复核性验证）

### 9.1 情况说明

审查进行到 16:1x 时，工单文件被追加了一条**总管更新**（非本会话所为）：

> B 族核心根因已在审查派单前定位并修复入库（domain-bot `31e1d76` + tuna `19329a5`）：①同事件配额按旧→新遍历占坑（旧 digest 占满、当天新稿被挤）→ 改 createdAt 新→旧；②writePack 整文件覆盖丢稿 → 合并写；③lang 透传误标 → 按交付文案判。端到端实测 v17：今天四轮 16 篇全量可见、lang 全 zh。

两个 commit 在本仓 git 对象库内可查（`git log --all` 命中），但**不在我审查所用的 HEAD 上**（本地 main 仍在 `9757a23` / `5a5f1ba`，即工单指定基线），工作区文件也仍是旧版（`publish-domainbot-pack.cjs:53` 仍是 `.sort()`）。因此：

- 本报告第二、三、四节的发现**基于工单指定基线的实测，全部有效**；
- 且这些发现是**独立得出的**——我在写报告时并未读到这条更新，结论却与总管的修复方向逐条吻合，构成一次有效的独立互证：

| 我的独立发现 | 总管修复 | 一致性 |
|---|---|---|
| B-1 旧内容先占事件坑，新稿被挤（15 点轮 8 条亲写存活 0） | ①同事件占坑改新→旧遍历 | ✅ 同因 |
| A-1 同 digestId 重跑整文件覆盖丢稿 | ②writePack 改合并写 | ✅ 同因 |
| C-2 中文文案 lang 标成 en | ③lang 按交付文案判 | ✅ 同因 |

### 9.2 复核性验证：修复有效，但**没有除根**

工单更新后 B.1 的要求改为「复核性验证」。我用冻结快照模拟修复后的新序逻辑，与旧序对照：

| 指标 | 修复前（文件名序） | 修复后（createdAt 新→旧） | 变化 |
|---|---|---|---|
| 存活总数 | 34 | **40** | **+6**（与线上 v17 实测一致） |
| 15 点轮 `mtrm4lhx` 存活 | **0** | **3** | 新稿不再被全灭 ✅ |
| 11 点轮 `mtrdm6sl` 存活 | 4 | **7** | +3 |
| 15 点轮 `mtrlvrkb` 存活 | 2 | **5** | +3 |
| 09-06 老包 `mtq0a0lm` 存活 | 13 | **14** | +1（老稿基本未受影响） |
| **同事件闸剔除条数** | 114 | **101** | 仅 −13（仍是大头） |

**结论一：修复有效。** 当天新稿从「被全灭」变成「进得来」，09-07 两轮亲写稿存活由 8 条升至约 16 条，与总管「四轮 16 篇全量可见」的实测吻合。

**结论二：病根仍在。** 关键证据 ——

- 修复改的是**遍历顺序**（谁先占坑），**没有改判据**：`tokensOf` 的停用词表仍是那 14 个通用虚词，`gates.json` 的 `eventStopwords`（openai / model / releases …）**依然没有被引入**；
- 判据仍是「共享词**绝对数** ≥2」而非 Jaccard 比例；
- 事件桶词集建桶后仍冻结（`:117`）；
- 结果是：同事件闸仍在剔除 **101 条**，只比修复前少 13 条；老包 `mtq0a0lm` 仍以 14 席占据最大头。

**换个说法**：修复把「新稿被老稿挤掉」换成了「新稿先占、多余的还是被剔」。坑位总数没变（每桶 2 条），**只是死的人换了**。只要判据不改，任何一批内容**内部**互抢热词时照样互相挤兑 —— 比如同一天 8 条都提 openai 的 AI 新闻，仍然只能活 2 条。

### 9.3 因此，建议保留并追加一条

- **保留**总管已做的三项修复（方向正确、实测有效，不建议回退）；
- **追加（P1，非 P0）**：把 `gates.json` 的 `dedupe.eventStopwords` 引入发布器的 `tokensOf`，并把「共享词绝对数 ≥2」改为 Jaccard ≥ 0.75 —— 即本报告 B-1 的治本项。降级为 P1 是因为 P0 症状（新稿全灭）已被修复缓解，不必紧急；但不做的话，产线规模一上去（每轮 20 篇 × 3 轮 = 每天 60 篇）互抢热词的损耗会重新变成主要瓶颈。

**验证方法**：修完后用本报告 `/tmp/db21/replay.cjs`（支持 `SORT` 环境变量）在冻结快照上重跑，存活数与逐条归因可直接对比，无需重新搭环境。

---

`ALL_DB21_PASS`
