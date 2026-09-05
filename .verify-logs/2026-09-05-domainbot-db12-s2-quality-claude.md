# DB-12：S2 内容质量三项修复（D4 兜底 why / D6 钩子冗余 / D7 近重复事件）

> 工单号：DB-12 ｜ 创建：2026-09-05 ｜ 作答会话：claude（唯一作答）
> 依据：`.verify-logs/2026-09-05-domainbot-tuna-l1l3-e2e-cbc.md` §B5/C8/D7
> 工作目录：`/Users/aiatwork/Projects/domain-bot`，基线 HEAD `830f77d`

## 〇、状态类断言（附命令 + 输出 + 读取时间戳）

```
$ date -u +%Y-%m-%dT%H:%M:%SZ            # 读取于 2026-09-05T21:09:49Z（基线）
2026-09-05T21:09:49Z
$ git rev-parse HEAD                      # 读取于 2026-09-05T21:09:49Z
830f77d...
$ npm test > /tmp/db12/baseline.log 2>&1; echo exit=$?     # 改动前基线
exit=0        # Test Files 25 passed (25) / Tests 400 passed (400)
```

```
$ date -u +%Y-%m-%dT%H:%M:%SZ            # 读取于 2026-09-05T21:34:07Z（收口）
2026-09-05T21:34:07Z
$ npm test > /tmp/db12/final4.log 2>&1; echo exit=$?
exit=0        # Test Files 25 passed (25) / Tests 412 passed (412)   （400 基线 + 12 新增）
$ npx tsc --noEmit; echo exit=$?
exit=0
$ git status --short
 M src/collector/dedupe.ts      M src/gates/eventCluster.ts
 M src/refinery/scorer.ts       M src/render/tuna.ts
 M tests/{eventCluster,gatekeeper,gates,refinery,tuna}.test.ts
?? docs/tasks/TASK-DB-12-s2-quality-prompt.md                      （工单原件，开工前已在）
?? evidence/feed-quality-newsline-newslinemtou7jy5.json            （16:59 产线生成，非本会话产物，未触碰）
```

- 未 commit / 未 push / 未跑 `npm run build`（`dist/` 保持 16:38 的 HEAD 版本，正好用作「改动前」对照）。
- 未触碰 tuna 仓、`memory/`、`staging/`、`outbox/`、`evidence/`、`ops/`（outbox/evidence 仅读）。

## 一、改动清单（4 个源文件，+23/-33 行净变更见 `git diff --stat`）

| 项 | 文件 | 改动 |
|----|------|------|
| D4 | `src/refinery/scorer.ts` | `humanizeReason` 增加 `item` 入参；无关键词/信号命中的兜底改为 `Picked for <主题短语>` / `因「<主题短语>」入选`；新增 `subjectPhrase()` |
| D6 | `src/render/tuna.ts` | 新增 `TITLE_ECHO_OVERLAP = 0.8` 与 `titleOverlap()`；`deriveHooks` 句形候选与标题同源时跳过，首句被跳过时门面位由次句顶上；素材不足时回补 |
| D7 | `src/collector/dedupe.ts` | 新增 `stripOutletSuffix()`（剥标题末尾转载渠道名后缀） |
| D7 | `src/gates/eventCluster.ts` | `entityTokens` 先剥后缀再抽词，剥空则回退原标题（守门，不让条目失去聚类资格） |

**未动**：`src/gatekeeper/assertions.ts` 的十二条既有判据（零改动）、`HOOK_LIMITS`/`SUMMARY_MAX`/`WHY_MAX`/`MIN_HOOK_CHARS` 数值、`maxPerEvent`/`jaccardThreshold` 等产线配置、LLM 打分器的 reason 通路（`LlmScorer.scoreBatch` 里模型自答的 `p.reason` 原样透传，未改）。

---

## 二、D4：兜底 why 有信息量 —— 结论【改】

### 方案

无关键词/信号命中时，`humanizeReason` 不再输出 `与「${domain}」相关` / `Related to your ${domain} feed`，改为从条目自身构造：

```
en:  Picked for <主题短语>          zh:  因「<主题短语>」入选
```

`subjectPhrase()` 取材：`stripOutletSuffix(标题)` → `firstSentence` → 掐句末标点 → 剥小数 → `truncateWhy(_, 28)`（预算 28 码点，模板拼上后 ≤ WHY_MAX=40）。标题为空才退正文，短语剥空才退**旧领域模板**（永不空串的铁律只在真正退化的分支上兑现）。

### 铁律逐条兑现

| 铁律 | 兑现位置 |
|------|----------|
| 永不空串 | `subjectPhrase` 返回空串时调用方退回领域模板（`tests/refinery.test.ts` 用 `item('','')` 断言） |
| 永不回显浮点分数 | `subjectPhrase` 源头剥 `\d+[.,]\d+`；测试断言 `not.toMatch(/\d\.\d/)`；渲染层 `fallbackWhy` 的小数守卫是第二道保险 |
| ≤40 码点 + 词边界截断 | 主题短语预算 28，模板后仍 ≤40；最终走既有 `truncateWhy` |
| 双语（detectLang） | 沿用既有 `detectLang(title+\n+body)` 分支；测试断言 en 产 `/^Picked for /`、zh 产 `/^因「/` |
| 永不抛错 | 纯字符串运算，无正则回溯陷阱、无下标访问 |
| 不动 LLM reason 通路 | `LlmScorer` 命中时 `reason: p.reason ?? ''` 原样透传，未改 |

> 附注（唯一波及面）：`LlmScorer` **漏答降级**路径会用 HeuristicScorer 的 reason 拼「（llm 漏答，已降级启发式）」——该路径本来就是启发式文案，改它不属于「动 LLM reason 通路」。

### 实测效果（DB-11 主材 56 条：deepthought 40 + newsline 16，`config/domain.json` 产线词表）

```
TOTAL=56  why模板: 16 -> 0
  #28 old="与「ai-llm」相关" -> new="Picked for GeoJSON Map Viewer"
  #29 old="与「ai-llm」相关" -> new="Picked for Anthropic's best AI model s…"
  #36 old="与「ai-llm」相关" -> new="Picked for Record, train, and deploy f…"
  #39 old="与「ai-llm」相关" -> new="Picked for Understanding ChatGPT Work"
```

（测量方式：临时 vitest 探针读 `outbox/tuna/` 两包、跑 `HeuristicScorer` + `truncateWhy(·,40)` 对比 `brief.items[].why`；探针已删，复算命令见本节脚本。）

### 测试证据（`tests/refinery.test.ts` + `tests/gatekeeper.test.ts`）

1. `HeuristicScorer 词边界` 既有用例更新：`expect(res.reason).toBe('Picked for cloud storage optimization…')` ——原断言钉的是**被修缺陷本身**（`'Related to your ai feed'`），随 D4 语义更新，语言随条目的用意（DB-11/D2）不变。
2. `DB-12/D4：无命中的兜底 why 带内容指向，不同条目互相可区分`：两条无命中条目 why 互异、各含自身实体词、均 ≠ 旧模板。
3. `DB-12/D4：中文条目产中文 why`：`not.toBe('与「ai」相关')` 且含自身主题词。
4. `DB-12/D4：标题含小数时剥离；完全退化时仍回领域模板`：`not.toMatch(/\d\.\d/)` + 空条目退 `Related to your ai feed`（永不空串）。
5. `gatekeeper.test.ts` `DB-12/D4：…走完 打分→渲染 后，why 非空、≤40 码点、语言随条目、不再是通用模板`：真实路径 `HeuristicScorer → renderPost`，逐条断言 `0 < 码点 ≤ WHY_MAX`、无浮点、en/zh 前缀。

---

## 三、D6：钩子去冗余 —— 结论【改，判据换了口径（字符级→词级），依据如下】

### 判据（工单允许「自定，须写明阈值与依据」）

`titleOverlap(hook, title)` = |钩子词元 ∩ 标题词元| / |钩子词元|，**复用 `tokenize()`**（`src/collector/dedupe.ts`，CJK 2-gram 行为在那里，不另立分词口径），阈值 `TITLE_ECHO_OVERLAP = 0.8`。

**为什么不用工单第一选项「字符重叠率」**：实测字符级对英文散文饱和——`Federated search across every public ARD registry…` 与标题共享 0.92 的去重字母，却带来 6 个新词。用字符级判据跑 56 条主材：33 → 25，且**剩余 25 条全是信息增量真实的句子被误杀后**跌到实体卡。换词级后同一批主材 31 → 15，且被误杀的句子（0.14）与真复读（1.0）判然分开。阈值沿用 0.8 与审计同值，修的是同一人群。

### 联动约束（动手前已通读三条断言）

- `gk:mechanicalTruncation`：`isTitlePrefix` 仍对所有候选生效，未动；
- `gk:hookEntity`：递补候选为次句（来自正文）与实体卡/领域卡（词元取自 title+body），天然命中；
- 恒 3 条互异 + 限长：候选池 4-5 个，两轮收集；**新增唯一放宽**——非同源候选凑不满 3 条时同源候选回补。理由：冗余钩子只损失信息增量，条目被 `gk:shapeViolation` 否决损失整条内容 + 递补成本，孰轻孰重明确。
- 实体卡豁免同源判定（`sentence: false` 标记）：实体卡词元本就抽自标题，覆盖率恒接近 1，判它会把自己误杀。

### 实测效果（同一批 56 条主材，新旧用同一词级判据对齐口径）

```
hook[0] 与标题词级覆盖 >0.8：31 -> 15
剩余 15 条的构成：14 条 summary 只有 1 句（标题即全部正文，无次句可递补）
                 1 条 #34 的前两句都是标题的子串（GitHub 仓库标题自带描述）
新钩子满 3 条：56/56（无一因去冗余而掉到 3 条以下）
```

即：**凡存在非标题素材的条目，门面钩子不再是标题复读**；剩余 15 条是「标题即正文」的内容形态问题（属 DB-11/D3 空壳域，不是钩子替换能解的），且其三钩子仍互异、仍过终审。

### 测试证据（`tests/tuna.test.ts` + `tests/gatekeeper.test.ts`）

1. `DB-12/D6：首句与标题同源时换视角递补，钩子不再是标题复读`——夹具取 DB-11 §B5 #0 真实形态；断言 `hooks[0]` 覆盖 < 0.8、同源首句本体整体消失、递补含次句素材、3 条互异、全部非前缀、∈[12, 95] 码点。
2. `DB-12/D6：素材不足时同源候选回补`——断言放宽路径真实触发（`hooks.some(ov >= 0.8)` 为真）且各钩子仍合法。
3. `DB-12/D6：titleOverlap 判据本身可复算`——复读 >0.9、异源句 <阈值、空串=0、尾部省略号不影响判定。
4. `gatekeeper.test.ts` `DB-12/D6：首句同源的条目走机械兜底后仍过终审`——`renderPost → runAssertions` 全 12 条断言通过，证明去冗余没把 `gk:hookEntity`/`gk:shapeViolation`/`gk:mechanicalTruncation` 改红。

---

## 四、D7：近重复事件 —— 结论【改，但修的不是工单猜测的那一层】

### 诊断（先复现，再动手）

**工单猜测的「聚类没合并」不成立**。用 6 变体标题直接跑 `clusterByEntity`（产线词表）：5/6 本就聚成一簇，`capEvents` 也本就把超额的降到 `maxPerEvent=2`。词法上孤立的那条（`#6 Discovery of a new OpenAI agent message board`，实体集仅 `{discovery}`）与 Astra 那条不含 "Astra" 的 The Verge 报道同类，归 DB-05 reviewer 的语义归并，不在词法聚类能力内。

**真正的两层根因**：

1. **词层缺陷（已修）**：两个**独立事件**被缝成一簇。连接边是转载渠道名——
   `#9 … - IBTimes India`（GPT-6 Astra）与 `#11 … - India Today`（德国 wiki 劫持）共享实体词 `india`。
   outlet 名同样是专有名词，`capitalizedTokens` 的大小写信号区分不了「事件标识」与「来源词汇」。
   ```
   BEFORE (HEAD): clusters=7  sizes=[9,2,1,1,1,1,1]  最大簇=[1,2,9,10,11,12,13,14,15]
                  entityTokens(#9) 含 india = true     capEvents: kept=9 demoted=7
   AFTER        : clusters=8  sizes=[5,4,2,1,1,1,1,1] 最大簇=[1,11,12,13,14]
                  entityTokens(#9) 含 india = false    capEvents: kept=11 demoted=5
   ```
   （对照物：`dist/` 是 HEAD 的编译产物、未重build，作 BEFORE；AFTER 为当前 src。）

2. **编排层机制（未修，属显式设计决策）**：该轮最终 16 条里 6 变体并存，不是聚类没拦，而是
   `eventFillMode=true`——evidence 实录 `collected=52 → afterDedupe=48 → afterGates=16 → published=16`，
   `eventCount=7 / eventDemoted=7 / eventFillMode=true / poolExhausted=true / rejectCounts={}`，且
   `maxItems=80` 远大于候选 16。`gatekeep` 的「回填一」在候选不足 target 时**刻意**放行同事件超额条目
   （`src/gatekeeper/index.ts`：「宁发重复不发薄包」），并有 `tests/gatekeeper.test.ts` `事件复检·候选薄分支`
   把它钉为已知取舍、看板显式记 `eventFillMode`。**改它 = 推翻 2026-09-04 的产品裁决**，超出本工单
   「最小改动」授权，故不动。`stripOutletSuffix` 修的是词层，所以它改变的是簇的正确性与
   `kept/demoted` 的分配（9/7 → 11/5），不是那一轮的发布条数。

### 最小改动

`entityTokens` 先 `stripOutletSuffix(title)` 再抽词；剥完实体集为空则回退原标题抽词（守门：宁可带着 outlet 词聚类，也不让条目失去聚类资格——与「无实体词自成一体」的既有语义相接）。判据刻意收窄：只剥**末尾一段**、分隔符须前带空白的 `-`/`–`/`—`/`|`、后接 1-4 个首字母大写词。

**已知代价（记录在案）**：末段恰为真实实体的标题（`Apple unveils M4 - MacBook Pro`）会丢末段实体；不引入 outlet 名单缓解（名单漏一个即漏一条边）。已用 K2 Horizon 夹具验证传递闭包仍把 5 条聚成一簇（`k1` 剥掉 `| Institute of Foundation Models` 后经 `k5` 的 institute/foundation 中转），**DB-04 语义基准无一移动**。

### 测试证据（`tests/eventCluster.test.ts` + `tests/gates.test.ts`）

1. `DB-12/D7：词级不同、实体相同的同事件变体聚成一簇（5/6）`——**工单验收本体**：真实洗稿形态（词级不同、实体相同）合并成功。
2. `DB-12/D7：转载渠道名后缀不再是事件实体：两个独立事件不得被缝成一簇`——**误并回归锁**：Astra 4 条与 wiki 5 条两簇互斥，且 `entityTokens(…IBTimes India…).has('india') === false`。
3. `DB-12/D7：守门：剥完后缀若一个实体都不剩，退回原标题抽词`——防「剥过头导致条目永不合并」。
4. `tests/gates.test.ts` `DB-12/D7：同事件词级变体合并降权到 maxPerEvent 内，且不挤占其他事件配额`——`eventCount=2`、两事件各保留 `maxPerEvent=2`、超额 4 条全在 demoted（总数守恒）、两簇 eventKey 互异。该用例**读产线词表** `config/gates.json`（本文件内联精简词表缺 `agents/safety/report`，会把它们当实体词制造跨事件假边——同 `tests/eventCluster.test.ts` 读产线词表的理由）。

### 双向论证（工单要求的「不改」选项）

「不修词层」的代价：两个独立事件共用 2 个坑 → 厚候选轮里 Astra 与 wiki 互相挤占配额，多样性选择失真；`eventCount`/`eventDemoted` 观测口径失真。修它的代价：末段实体可能被剥（守门兜住退化情形，K2 夹具证明传递闭包补回连接）。结论：修。

「修 fill mode」（能真正压掉那 6 变体里的 4 条）不属本工单，建议另开任务，方案二选一：给填充模式加**每事件回填上限**（如 fill 模式下同事件 ≤3）；或 `eventFillMode` 触发时走 DB-05 reviewer 做语义去重后再回填。不修的代价可量化：newsline 这轮 16 条里 9 条属同一词法簇（56.25%）。

---

## 五、遗留 / 建议

1. **15 条「标题即正文」条目**（D6 剩余回声人群）：钩子层无素材可用，属 D3 空壳域的邻接问题；`gk:hollowSummary` 的 chrome 口径（<5 词元）拦不住它们，可考虑把「summary 词元 == title 词元」列为弱信号上板。
2. **fill mode 的每事件上限**（见 D7）。
3. `tests/refinery.test.ts` 一条既有断言随 D4 语义更新（`'Related to your ai feed'` → `'Picked for cloud storage optimization…'`）。**这不是改测试凑绿**：该断言钉的是 DB-11/C8 点名的缺陷本身，DB-12/D4 的工单指令就是替换它；用例的语言随条目用意保留并另加 zh 断言。**其余 399 条既有用例零改动**（含 `e2e.test.ts` 的「聚类先于配额」「事件复检·候选充足/候选薄」三条语义基准，全部保持绿）。
4. `dist/` 未重建，产线下次 `npm run build` 后才会吃到本次修复；生产轮运行期间未动任何产线目录。

## 六、变异抽验（自证测试非摆设）

```
M1 撤销 D4（humanizeReason 退回旧模板）  → tests/refinery.test.ts 2 failed（两条 DB-12/D4 用例红）
M2 撤销 D6（leadEchoes 恒 false）        → tuna/gatekeeper 2 failed（两条 DB-12/D6 用例红）
M3 撤销 D7（不剥后缀）                   → eventCluster/gates 2 failed（两条 DB-12/D7 用例红）
还原后全量：exit=0，Tests 412 passed (412)
```

ALL_DB12_PASS
