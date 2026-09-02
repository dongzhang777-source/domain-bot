# domain-bot 假门探针 P0 修复工作单（派给 ZCode / 小智）

> **For agentic workers:** 按 Task 顺序执行，每个 Task 内含完整代码与验收命令。步骤用 `- [ ]` 勾选跟踪。
> **本工作单自包含**：不需要先读三方评审即可执行。需要背景时再查 `domain-bot/docs/reviews/`。

**Goal:** 把 domain-bot 从"35 个测试全绿但自进化回路在生产路径完全断开"修到"反馈能真实改变持久化权重、且质量变化可被观测"，使两周假门探针的数据可解释。

**Architecture:** 保持现有分层（collector → refinery → memory → push）不变。新增两个模块：`src/memory/weights.ts`（权重策略，与 store 的纯持久化分离）、`src/feedback/receiver.ts`（Telegram 回调接收）。其余改动集中在 `src/index.ts` 的编排层与 `src/refinery/scorer.ts` 的打分公式。

**Tech Stack:** TypeScript (ESM, NodeNext) · vitest · Node 内置 fs/crypto · **无新增依赖**

---

## 一、背景：为什么必须改（全部经实测验证，非纸面推断）

domain-bot 是"千 Bot 生态·需求 50"的假门测试探针：一个自进化的领域情报 bot，跑两周看作者是否真的需要它。
现状 `npx vitest run` → **8 files / 35 tests 全绿**。但三方独立评审 + 实测复核确认：**绿灯与"自进化在工作"无关**。

四个已实测确认的硬事实：

### 1. 反馈回路在生产路径完全断开（最严重）

以下函数在 `src/` 内**只有定义、无任何调用者**（`grep -rn` 逐个确认）：

| 函数 | 定义位置 | 唯一调用点 |
|---|---|---|
| `recordFeedback` | `src/memory/store.ts:112` | `tests/e2e.test.ts:80` |
| `resolveRef` | `src/memory/store.ts:108` | `tests/e2e.test.ts:79` |
| `feedbackBySource` | `src/memory/store.ts:117` | `tests/e2e.test.ts:82` |
| `updateWeights` | `src/memory/evolve.ts:17` | `tests/e2e.test.ts:82` |
| `parseCallbackData` | `src/push/telegram.ts:31` | `tests/telegram.test.ts` |
| `answerCallbackQuery` | `src/push/telegram.ts:54` | **无（连测试都没有）** |
| 权重持久化 | **不存在** | — |
| Telegram 回调接收端 | **不存在** | — |

实测证据：跑了 5 轮真实流水线后，**`memory/feedback.json` 不存在**（0 条反馈）。
Telegram 消息确实带 👍/👎 按钮（`telegram.ts:22-29`），但**没有任何进程在监听回调**——按了也不会发生任何事。
`outbox/digest-*.md` 里还印着"有价值请 👍，噪音请 👎"，属于对用户的失实承诺。

### 2. 打分器对质量维度零灵敏度（观测仪器坏了）

`src/refinery/scorer.ts:28`：`valueScore = Math.min(1, 0.3 + 0.15*kwHits + 0.12*signalHits)`

`config/domain.json` 有 17 个关键词，arXiv 摘要长 → 实测一条典型 arXiv 摘要**命中 7 关键词 + 5 信号词**，直接触顶。
实测 5 份真实 digest：**连续 18 条 arXiv 推送分数全部 = 1.000**，逐轮 mean 变化 `+0.000 / +0.000`。

后果：假门标准 #3「第 3 轮起噪音可感知下降」**根本无读数**——不是假阳性也不是假阴性，是仪器不动。

### 3. `scoreThreshold` 配置项对启发式路径完全无效（可数学证明）

`src/index.ts:72`：`scored = scored.filter((s) => s.valueScore >= opts.domain.scoreThreshold * 0.5)`

- 门槛 = `0.45 * 0.5` = **0.225**
- `isRelevant`（`filter.ts:5-8`）已保证 ≥1 关键词命中 → 原始分下限 = `0.3 + 0.15*1` = **0.45**
- 加权后最低分 = `0.45 * (0.5 + w)`，`w ≥ 0` → 最低 **0.225**
- 反解拒绝条件需 `w < 0.0000`；穷举 `w ∈ [0,1]` 步长 0.01，**仅 w=0 处因浮点误差（0.22499999999999998 < 0.225）触发**

即：**改 `scoreThreshold` 对启发式打分的实际过滤行为零影响**。配置项在骗人。

更深一层：即使去掉 `* 0.5` 让门槛生效，**过滤也不应该作用在加权分上**。源权重的语义是「排序偏好」，一旦拿它做过滤，低权源会被整体挡在候选池外 → 永远进不了推送 → 永远拿不到反馈 → 权重再也回不来，形成**反馈死锁**。所以 Task 5 采用：**过滤用原始分，排序才用加权分**。

### 3.5 两个信号词是死的（实测确认，顺带修）

`scorer.ts:27` 是 `this.signals.filter((s) => hay.includes(s))`——`hay` 已经 `normalizeText` 过（连字符变空格），但**信号词本身没有**。实测：

```
hay = " new model release open source llm beats state of the art sota "
当前代码匹配不到：'state-of-the-art'、'open-source'   ← 11 个信号词里 2 个永远不可能命中
加 normalizeText 后匹配到：'state-of-the-art' ✓、'open-source' ✓
```

Task 3 的新公式对信号词也做 `normalizeText`，顺带修掉这 2 个死词。**副作用**：`open-source` 归一化后等于 `open source`，两者会对同一处文本**重复计数**，所以 Task 4 把 config 里的 `open-source` 删掉（11 → 10 个）。

### 4. 传送带效应：候选池被逐轮永久消耗

`src/index.ts:95` 只归档**配额截断后**的推送条目（≤6 条/轮），而 `dedupe.ts:36` 按 id **无条件永久屏蔽**已归档条目。
两者叠加：arXiv 当日 RSS ~100 条被逐轮消费，第 N 轮推的是排序第 6N 名之后的残渣，**真实质量单调衰减**。

实测：`memory/archive.json` 中 18:31:28 与 18:31:41 两轮**间隔 13 秒**各推 6 条完全不同的 arXiv；29 条归档中 `hitCount > 1` 的为 **0 条**。
而因为事实 2（打分饱和），这个衰减在分数上**完全看不见**。

### 附带确认（不需修，避免误改）

- `isNovel` **有**生产调用者（`index.ts:69`），但结果只用于 `file.ts:17` 的 `🆕增量` 展示标签，**不参与打分/排序/过滤**；`telegram.ts` 通道连标签都没有。
- 实测 29/29 条归档全部 `isNew=true` → `isNovel` 的 0.7 阈值在真实数据上**从未触发过**。
- e2e 的两条 RSS 夹具 jaccard = **0.667** ≥ `clusterThreshold` 0.35 → 确实聚成 2 簇，`clusterItems` 实跑返回 2。**这条断言是对的，不要改。**
- `.gitignore` **已经**忽略 `memory/` 与 `outbox/`（`git ls-files memory outbox` 返回空）。所以"证据落盘隔离"不是待办——反而是 Task 2 要处理的反向风险。

---

## 二、裁决基线（我代老张定的默认值，他可划掉任意一条）

| # | 争议点 | 本工作单采用的裁决 | 依据 |
|---|---|---|---|
| R1 | 学习维度：源级权重 vs 条目特征权重 | **P0 保持源级**，先接通再评估；改条目特征级推迟到 P1 | 探针要尽快开跑；源级接通后至少能观测"权重是否变化"这件事本身 |
| R2 | 源级权重信噪比可能不足（7 个源 vs 几十条推送） | **P0 必须落盘权重轨迹 + 每源反馈计数**，两周后先看方差再决定是否改维度 | 不先落盘，两周后无法回溯判断 |
| R3 | 修复顺序 | **Task 3（打分饱和）必须在 Task 11（观测落盘）之前** | 饱和未修则观测序列恒 1.00，画出来是直线，白做 |
| R4 | `isNovel` 的 0.7 阈值是否要调 | **不动** | 实测该阈值从未触发，调它没有观测依据 |
| R5 | 归档范围 | **改为全量候选池**（带 `pushed` 标记），`MAX_ENTRIES` 2000 → 20000 | 解传送带；同时让候选池分布可观测 |
| R6 | 反馈接收方式 | **新增 Telegram long-polling 常驻接收**，同时保留手工编辑 `feedback.json` 的路径 | 按钮已经发出去了，必须有人接 |
| R7 | 假门通过线（👍率 ≥30% 等） | **本工作单不改**，属 P1（需先建基线对照组） | 无对照组的阈值不可解释 |
| R8 | `scoreThreshold` 作用于原始分还是加权分 | **原始分过滤 + 加权分排序**（矩阵 P0-3 原裁决） | 加权分过滤会造成反馈死锁，见背景 §3 |
| R9 | 运行节奏 | **默认改为每天 1 轮**（`pollMs` 3_600_000 → 86_400_000），可用环境变量覆盖 | 矩阵 P0-4。1 小时一轮在静态 RSS 上只会加速传送带消耗，且真实使用场景是每日简报 |
| R10 | 矩阵 P1-5「反测试」的归属 | **升级进 P0**（本工作单 Task 13），且比原表述更严 | 原表述是「注入反馈后断言 weights.json 变化」；Task 13 改为**只走真实回调/手工入口**，不注入——注入式断言正是本次 35 绿却回路断开的成因 |
| R11 | `MAX_ENTRIES` 2000 → 20000 与现有测试冲突 | **把上限改为可注入**，默认 20000；`store.test.ts:58-63` 改用 `{ maxEntries: 2000 }` 构造 | 见 Task 9 Step 0——红线 3 的**授权例外之一**，理由写在那里 |
| R12 | LLM 漏答的兜底分 | **常数 0.5 → 降级启发式**（矩阵 P0-6 原话：“不是常数 0.5”） | 常数 0.5 会在 `observations.jsonl` 的 P50/top1 序列里造假平台，直接损害假门标准 #3 的读数。**这是红线 3 的另一个授权例外**：需改 `refinery.test.ts:43` 的**标题**（它写着“缺失项取默认 0.5”），但实跑确认**两条断言一字不改仍通过**——详见 Task 12 Step 1 末尾 |

---

## 三、红线（违反则本次派单作废）

1. **禁止 `git push`。** 每个 Task 完成后 `git commit`；全部完成后停下等老张批准推送。
2. **禁止伪造验证结果。** 每个 Task 的验收命令必须真实执行，交付报告里贴**原始输出**，不接受"已通过"三个字。
   > 工作区有前例：codex 曾自制沙箱造出 ALL_PASS 假通过。**验收会读你写的自测代码本身，不只看结论。**
3. **不许为了让测试变绿而放宽断言。** 特别是 `tests/e2e.test.ts` 与 `tests/evolve.test.ts` 的现有断言——它们是正确的，改代码去适配它们，不是反过来。
   关键约束：`applySourceWeight` 的语义必须保持不变（`evolve.test.ts:29-30` 断言 `applySourceWeight(0.8, 1) === 1.2`），所以新颖性因子必须是**独立新函数**（Task 10）。
   **仅有两个授权例外**（均只改构造方式/标题，不改断言）：R11（`store.test.ts:58-63` 的裁剪测试改用 `{ maxEntries: 2000 }` 构造）、R12（`refinery.test.ts:43` 标题里的“默认 0.5”措辞）。除此之外动任何现有断言，先停下来问。
4. **不新增 npm 依赖。** 本工作单全部用 Node 内置能力可实现。
5. **Task 顺序不可调换。** Task 1 的守卫测试必须先看到全红，再逐个转绿——这是本次修复的核心验收手段。

**每轮验证命令**（改完代码就跑）：

```bash
cd /Users/aiatwork/Projects/domain-bot && npm run build && npx vitest run
```

---

## 四、任务清单

### 矩阵 P0 七项 → 本工作单 Task 映射（验收时逐条对照）

| 矩阵编号 | 矩阵要求 | 本工作单 | 验收证据 |
|---|---|---|---|
| **P0-1** | 接通反馈回路（Telegram `getUpdates` 长轮询 → `parseCallbackData` → `resolveRef` → `recordFeedback`） | **Task 7**（新建 `src/feedback/receiver.ts`）+ **Task 8**（`main()` 起常驻循环） | `tests/wiring.test.ts` 里 4 条守卫转绿；Task 13 反测试走**真实回调**而非注入 |
| **P0-2** | 权重持久化（写 `memory/weights.json`，启动时读它覆盖 config 初值） | **Task 6**（`store.ts` 持久化 + 新 `weights.ts` 策略）+ **Task 8**（`runOnce` 读它） | `weights.json` 存在且跨进程可重载；Task 13 反测试 |
| **P0-3** | 修打分饱和 + 解耦过滤与排序（过滤用**原始分**） | **Task 3**（sqrt 压缩公式）+ **Task 5**（原始分过滤 / 加权分排序） | Task 3 四档位可区分测试；Task 5 两条 e2e（门槛生效 + 防死锁守卫） |
| **P0-4** | 节奏改每天 1-2 轮（`pollMs=86400000`）+ 修完 P0-3 后打印 **top1 分数时间序列** | **Task 8**（`pollMs`）+ **Task 11**（`candidateTop1` 字段） | `grep 86_400_000 src/index.ts`；`observations.jsonl` 每行含 `candidateTop1` |
| **P0-5** | 信号词移入 `domain.json` | **Task 4** | `config/domain.json` 含 `signalWords`；refinery 覆盖测试绿 |
| **P0-6** | LLM 打分分批 + 失败降级到 `HeuristicScorer`（**不是常数 0.5**）+ 覆盖崩溃路径 | **Task 12**（分批 + 批级失败降级 + **漏答降级**） | Task 12 三条新测试；特别是 `valueScore != 0.5` 那条 |
| **P0-7** | 证据落盘（`memory/` `outbox/` 移出 `.gitignore`，或加 `npm run snapshot`） | **Task 2**（选 snapshot 方案） | `evidence/<时间戳>/SUMMARY.json` 存在且已入 git |

> **P0-7 的方案选择**：矩阵给了两个选项，本工作单选 **`npm run snapshot`**而不是把 `memory/` `outbox/` 移出 `.gitignore`。理由：那两目录里是**每轮重写的大 JSON**（`archive.json` 提上限后可达 5MB），入 git 会让仓库迅速膨胀且每次 commit 都是二进制式 diff；快照方案只在需要存证时落一份，粒度可控。
>
> 本工作单另外**多做三件矩阵未单列的事**，因为它们与 P0 同源：Task 1（接线守卫，防本次事故回归）、Task 9（归档全量候选池，解传送带）、Task 13（反测试，矩阵 P1-5 升级）。Task 11 Step 5 顺手修了矩阵 P1-2 的前半（`skippedSources` 恒为空）。

### Phase 0 · 先立红灯

#### Task 1: 接线守卫测试（防止"函数定义了但没接线"回归）

**为什么先做这个**：本次事故的根因不是逻辑写错，而是**写了却没接上**，而 35 个测试全绿掩盖了它。这个测试是"读自测代码本身"的自动化版本——它扫描 `src/` 源码文本，断言反馈回路每个函数都有跨文件的生产调用者。它现在必须**全红**，随后被 Task 6/7 逐个转绿。

**Files:** Create `tests/wiring.test.ts`

- [ ] **Step 1: 写守卫测试**

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')

function srcFiles(dir = SRC): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...srcFiles(p))
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

/** 生产调用 = 出现在定义文件之外、处于调用位置（`fn(`）、且不在注释里。 */
function productionCallers(fn: string, definedIn: string): string[] {
  const hits: string[] = []
  const callRe = new RegExp(`(^|[^\\w.$])${fn}\\s*\\(`)
  for (const file of srcFiles()) {
    const rel = relative(SRC, file).split('\\').join('/')
    if (rel === definedIn) continue
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      const code = raw.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '')
      if (callRe.test(code)) hits.push(`${rel}: ${raw.trim()}`)
    }
  }
  return hits
}

const GUARDED: Array<{ fn: string; definedIn: string; why: string }> = [
  { fn: 'recordFeedback', definedIn: 'memory/store.ts', why: '反馈必须落盘，否则进化无输入' },
  { fn: 'resolveRef', definedIn: 'memory/store.ts', why: 'Telegram 回调的 ref 必须能解析回条目' },
  { fn: 'feedbackBySource', definedIn: 'memory/store.ts', why: '权重更新的输入' },
  { fn: 'saveWeights', definedIn: 'memory/store.ts', why: '权重必须持久化，否则每轮从 config 重置' },
  { fn: 'updateWeights', definedIn: 'memory/evolve.ts', why: '进化步骤本身' },
  { fn: 'refreshWeights', definedIn: 'memory/weights.ts', why: '重算入口必须被编排层与接收端调用' },
  { fn: 'parseCallbackData', definedIn: 'push/telegram.ts', why: '回调数据必须被解析' },
  { fn: 'answerCallbackQuery', definedIn: 'push/telegram.ts', why: '不回应则 Telegram 会重复推送同一回调' },
]

describe('接线守卫：反馈回路必须在生产路径接通', () => {
  for (const g of GUARDED) {
    it(`${g.fn}() 有生产调用者 —— ${g.why}`, () => {
      const callers = productionCallers(g.fn, g.definedIn)
      expect(callers, `${g.fn} 在 src/ 内只有定义、无生产调用者`).not.toHaveLength(0)
    })
  }
})
```

- [ ] **Step 2: 跑测试，确认 8 条全红**

Run: `cd /Users/aiatwork/Projects/domain-bot && npx vitest run tests/wiring.test.ts`
Expected: **8 failed**，信息形如 `recordFeedback 在 src/ 内只有定义、无生产调用者`

> ⚠️ 若不是 8 failed，说明守卫本身写错了（例如 `process.cwd()` 不在仓库根）。**必须先修到 8 failed 才能继续**，否则后面无法证明接线成功。

- [ ] **Step 3: 把 Step 2 的完整输出存进交付报告**——这是本次修复的基线证据。

- [ ] **Step 4: Commit**

```bash
cd /Users/aiatwork/Projects/domain-bot
git add tests/wiring.test.ts
git commit -m "test: 接线守卫——断言反馈回路 8 个函数有生产调用者（当前全红）"
```

---

#### Task 2: 证据留存快照（`memory/` 与 `outbox/` 已 gitignore，证据无备份）

**为什么**：本探针的全部价值就是这两周的观测证据，而它们目前只存在本地磁盘，无版本历史、无备份，误删即全失。

**Files:** Create `scripts/snapshot-evidence.mjs`；Modify `package.json`

- [ ] **Step 1: 写快照脚本**

```js
// scripts/snapshot-evidence.mjs
// 把 memory/ 与 outbox/ 当前状态打包到 evidence/（evidence/ 纳入 git 跟踪）。
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const dest = join(root, 'evidence', stamp)
mkdirSync(dest, { recursive: true })

for (const dir of ['memory', 'outbox']) {
  if (existsSync(join(root, dir))) cpSync(join(root, dir), join(dest, dir), { recursive: true })
}

// 附一份人可读摘要，事后不解析 JSON 也能看趋势
const summary = { snapshotAt: stamp, rounds: 0, feedback: 0, archived: 0, pushedEntries: 0, digestFiles: 0 }
const arch = join(dest, 'memory', 'archive.json')
if (existsSync(arch)) {
  const a = JSON.parse(readFileSync(arch, 'utf8'))
  summary.archived = a.entries?.length ?? 0
  summary.pushedEntries = a.entries?.filter((e) => e.pushed).length ?? 0
}
const fb = join(dest, 'memory', 'feedback.json')
if (existsSync(fb)) summary.feedback = JSON.parse(readFileSync(fb, 'utf8')).length
const obs = join(dest, 'memory', 'observations.jsonl')
if (existsSync(obs)) summary.rounds = readFileSync(obs, 'utf8').trim().split('\n').filter(Boolean).length
const out = join(dest, 'outbox')
if (existsSync(out)) summary.digestFiles = readdirSync(out).length
writeFileSync(join(dest, 'SUMMARY.json'), JSON.stringify(summary, null, 2))

console.log(`[snapshot] → evidence/${stamp}`, summary)
```

- [ ] **Step 2: 加 npm script**——`package.json` 的 `scripts` 里加：

```json
    "snapshot": "node scripts/snapshot-evidence.mjs"
```

- [ ] **Step 3: 确认 evidence/ 没被忽略**

Run: `grep -n evidence .gitignore`
Expected: **无输出**

- [ ] **Step 4: 跑一次**

Run: `npm run snapshot`
Expected: 输出 `[snapshot] → evidence/<时间戳>` + summary，其中 `archived` 应为 **29**（当前真实归档条数）、`pushedEntries` 为 **0**（Task 9 才有 `pushed` 字段，此时读不到属正常）。

- [ ] **Step 5: Commit**

```bash
git add scripts/snapshot-evidence.mjs package.json evidence/
git commit -m "chore: 探针证据快照脚本——memory/ 与 outbox/ 已 gitignore，证据需纳入版本"
```

---

### Phase 1 · 修观测仪器（必须在采集观测数据之前）

#### Task 3: 修打分饱和

**Files:** Modify `src/refinery/scorer.ts:19-33`；Test `tests/refinery.test.ts`

**新公式**（下方所有期望值均已实跑确认）：

```
kwPart   = min(1, sqrt(kwHits)     / sqrt(8))
sigPart  = min(1, sqrt(signalHits) / sqrt(6))
valueScore = 0.25 + 0.5*kwPart + 0.25*sigPart      // 值域 [0.25, 1.0]
```

- [ ] **Step 1: 先写失败测试**——在 `tests/refinery.test.ts` 的 `describe('HeuristicScorer', ...)` 内追加：

```ts
  it('打分不饱和：典型 arXiv 摘要不得触顶，且四个质量档位可区分', async () => {
    const scorer = new HeuristicScorer()
    const realDomain: DomainConfig = { ...domain, keywords: [
      'llm', 'large language model', 'inference', 'benchmark', 'transformer',
      'rag', 'retrieval', 'quantization', 'reasoning model', 'tokenizer',
    ] }
    const [arxiv, mid, press, weak] = await scorer.score([
      item('Attention Is All You Need Revisited: Efficient Transformer Inference',
        'We present a new benchmark for large language model inference with quantization and retrieval augmented generation. Our open source release outperforms SOTA on reasoning model tasks.'),
      item('A survey of retrieval augmented generation for llm', 'We review rag pipelines.'),
      item('New model release: open source llm beats SOTA on inference benchmark',
        'breakthrough outperform state-of-the-art open-source release benchmark'),
      item('Notes on tokenizer design', 'Some details.'),
    ], realDomain)
    // 旧公式下 arxiv 与 press 都是 1.000（零区分度）
    expect(arxiv!.valueScore).toBeLessThan(0.99)
    expect(press!.valueScore).toBeLessThan(0.99)
    expect(arxiv!.valueScore).toBeGreaterThan(press!.valueScore)
    expect(press!.valueScore).toBeGreaterThan(mid!.valueScore)
    expect(mid!.valueScore).toBeGreaterThan(weak!.valueScore)
  })

  it('饱和点上移：7 个关键词命中不得触顶 1.0', async () => {
    const scorer = new HeuristicScorer()
    const d: DomainConfig = { ...domain, keywords: ['k1','k2','k3','k4','k5','k6','k7','k8','k9'] }
    const [seven] = await scorer.score([item('k1 k2 k3 k4 k5 k6 k7 release benchmark sota outperform beat', '')], d)
    expect(seven!.valueScore).toBeLessThan(1)
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/refinery.test.ts`
Expected: **2 failed**（新加两条），原有测试仍 pass

- [ ] **Step 3: 改公式**——把 `src/refinery/scorer.ts:23-32` 的 `score` 方法体替换为：

```ts
  async score(items: RawItem[], domain: DomainConfig): Promise<ScoreResult[]> {
    const signals = domain.signalWords?.length ? domain.signalWords : this.signals
    return items.map((item) => {
      const hay = ' ' + normalizeText(item.title + ' ' + item.body) + ' '
      const kwHits = domain.keywords.filter((k) => hay.includes(normalizeText(k))).length
      const signalHits = signals.filter((s) => hay.includes(normalizeText(s))).length
      // sqrt 压缩：命中数边际递减，避免关键词密集源（arXiv 摘要长）一律触顶 1.0
      const kwPart = Math.min(1, Math.sqrt(kwHits) / Math.sqrt(8))
      const sigPart = Math.min(1, Math.sqrt(signalHits) / Math.sqrt(6))
      const valueScore = 0.25 + 0.5 * kwPart + 0.25 * sigPart
      const reason = `关键词命中 ${kwHits}，信号词命中 ${signalHits}`
      return { valueScore, reason }
    })
  }
```

> `domain.signalWords` 的类型在 Task 4 补；本步先用可选链，`tsc` 会报 `DomainConfig` 无此属性——**这是预期的**，Task 4 Step 1 立即修掉。若想本步就干净，可先只做 Task 4 Step 1 的类型声明。
>
> ⚠️ 注意 `signals.filter((s) => hay.includes(normalizeText(s)))` 里的 `normalizeText(s)` 是**新增的**（原代码没有）。它修掉背景 §3.5 的 2 个死信号词，不是笔误，别按原样抄回去。

- [ ] **Step 4: 跑全量测试**

Run: `npm run build && npx vitest run`
Expected: 除 `tests/wiring.test.ts` 的 8 条外全绿

实测对照（17 关键词真实 config）：

| 样本 | kwHits | sigHits | 旧分 | 新分 |
|---|---|---|---|---|
| 类 arXiv 摘要 | 7 | 5 | 1.000 | **0.946** |
| 新闻稿式强命中 | 3 | 8 | 1.000 | **0.806** |
| 中等命中 | 3 | 0 | 0.750 | **0.556** |
| 弱命中 | 1 | 0 | 0.450 | **0.427** |

新饱和点：需 `kwHits ≥ 8` **且** `sigHits ≥ 6` 才触顶 1.000（旧公式 `kwHits ≥ 5` 即触顶）。

- [ ] **Step 5: Commit**

```bash
git add src/refinery/scorer.ts tests/refinery.test.ts
git commit -m "fix(scorer): sqrt 压缩破解打分饱和——arXiv 类摘要从恒 1.000 降到 0.946，四档可区分"
```

---

#### Task 4: 信号词入 config

**为什么**：`signals` 硬编码在 `scorer.ts:21`，换领域必须改代码，违背"千 Bot 可复制"的前提。

**Files:** Modify `src/types.ts:51-57`、`config/domain.json`；Test `tests/refinery.test.ts`

- [ ] **Step 1: 加类型字段**——`src/types.ts` 的 `DomainConfig` 改为：

```ts
export interface DomainConfig {
  domain: string
  keywords: string[]
  /** 领域无关的"有新闻价值"信号词；缺省时回落到 HeuristicScorer 内置列表 */
  signalWords?: string[]
  scoreThreshold: number
  maxPerDigest: number
  clusterThreshold: number
}
```

- [ ] **Step 2: 把内置列表搬进 config**——`config/domain.json` 在 `keywords` 之后、`scoreThreshold` 之前插入：

```json
  "signalWords": [
    "release", "benchmark", "sota", "state-of-the-art", "outperform", "beat",
    "open source", "new model", "breakthrough", "surpass"
  ],
```

> ⚠️ 这是 **10 个**，不是原代码的 11 个——**故意删掉了 `open-source`**。因为 Task 3 起信号词会先 `normalizeText`，`open-source` → `open source`，与已有的 `open source` 完全等价，留着会对同一处文本重复计数、把 `signalHits` 虚高 1。

**顺手修一个配置笔误**：`config/domain.json` 的 `keywords` 最后一项现在是 `" multimodal "`（带前后空格），改为：

```json
    "multimodal"
```

> 实测过：`normalizeText` 的 `trim()` 已吸收这对空格，**改前改后行为完全一致**，所以不会也不应该引起任何测试变化。纯粹是配置卫生（详见第六节“附带”）。
> 如果你发现改了它之后有测试变红，说明你对 `normalizeText` 的理解有误——**停下来查**，不要把空格加回去“修好”它。

- [ ] **Step 3: 写测试**——`tests/refinery.test.ts` 追加：

```ts
  it('signalWords 可从 config 覆盖（换领域不需改代码）', async () => {
    const scorer = new HeuristicScorer()
    const custom: DomainConfig = { ...domain, signalWords: ['涨价', '断供'] }
    const [hit, miss] = await scorer.score([
      item('llm 芯片涨价', ''), item('llm release benchmark sota', ''),
    ], custom)
    // 内置英文信号词已失效，自定义中文信号词生效
    expect(hit!.valueScore).toBeGreaterThan(miss!.valueScore)
  })
```

- [ ] **Step 4: 跑测试**

Run: `npm run build && npx vitest run tests/refinery.test.ts`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/types.ts config/domain.json tests/refinery.test.ts
git commit -m "feat(config): 信号词从硬编码搬入 domain.json——换领域不需改代码"
```

---

#### Task 5: 过滤用原始分、排序用加权分（让 `scoreThreshold` 真正生效且不死锁）

**Files:** Modify `src/index.ts:3, 63-73`；Test `tests/e2e.test.ts`

- [ ] **Step 1: 写两条失败测试**——`tests/e2e.test.ts` 追加：

```ts
  it('scoreThreshold 真的生效：调高门槛必须清空推送', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-th-'))
    // ⚠️ 两轮必须用不同 memoryDir。共用会让第一轮归档把第二轮 dedupe 清零，
    //    测试将因错误的原因通过（改代码前它也是绿的），红灯步骤失效。
    const loose = await runOnce({
      domain: { ...domain, scoreThreshold: 0.1 }, sources,
      memoryDir: join(dir, 'm1'), outDir: join(dir, 'a'), fetchFn: mockFetch(), now: 1000,
    })
    const strict = await runOnce({
      domain: { ...domain, scoreThreshold: 0.99 }, sources,
      memoryDir: join(dir, 'm2'), outDir: join(dir, 'b'), fetchFn: mockFetch(), now: 1000,
    })
    expect(loose.stats.pushed).toBeGreaterThan(0)
    expect(strict.stats.pushed).toBe(0)
  })

  it('过滤用原始分：权重被压到 0 的源仍留在候选池（防反馈死锁）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-dl-'))
    const lopsided: SourceConfig[] = [
      { id: 'rss-1', type: 'rss', url: 'http://e/rss', weight: 0, enabled: true },
      { id: 'gh-1', type: 'github', url: 'https://api.github.com/search/x', weight: 0.9, enabled: true },
    ]
    const r = await runOnce({ domain, sources: lopsided, memoryDir: join(dir, 'memory'), outDir: join(dir, 'o'), fetchFn: mockFetch(), now: 1000 })
    // rss 原始分 0.7282 ≥ 0.45 → 该进候选池；但加权后 0.7282×0.5 = 0.364 < 0.45。
    // 若过滤错用加权分，rss-1 会被整体挡掉 → 永远拿不到反馈 → 权重再也回不来。
    expect(r.stats.relevant).toBe(3)
    const mem = JSON.parse(readFileSync(join(dir, 'memory', 'archive.json'), 'utf8')) as {
      entries: Array<{ source: string }>
    }
    expect(mem.entries.some((e) => e.source === 'rss-1')).toBe(true)
  })
```

> 第二条需要在文件顶部补 `import type { SourceConfig } from '../src/types.js'`——第 6 行已有 `DomainConfig, SourceConfig`，确认即可。

- [ ] **Step 2: 跑测试——只有第一条该红，第二条是设计守卫**

Run: `npx vitest run tests/e2e.test.ts`
Expected:
- **第一条 failed** ✅ —— `strict.stats.pushed` 是 2 而非 0（门槛被 `* 0.5` 削到 0.495，0.7282 与 0.5 都过得去）
- **第二条 pass**（这是对的，不要去「修」它）

> 第二条**不是 TDD 红灯测试，是设计守卫**。算清楚：旧代码门槛 = `0.45 * 0.5 = 0.225`，weight=0 的 rss 加权分 = `0.7282 * 0.5 = 0.364 ≥ 0.225`，所以它**改前就能过**。
> 它的价值在 Step 3：**如果你把过滤实现成「加权分 ≥ scoreThreshold」（即只删 `* 0.5` 而不改成原始分过滤），0.364 < 0.45 → rss-1 被挡 → 这条立即变红。**
> 换句话说：它钉死了 R8 这个设计选择，防止后人把“降权”写成“封杀”。

- [ ] **Step 3: 重构 `index.ts:63-73` 为「原始分过滤 → 加权分排序」两段**

先在 `src/index.ts:3` 的 type import 里补 `RawItem`：

```ts
import type { Digest, DomainConfig, FetchFn, RawItem, ScoredItem, SourceConfig, SpawnFn } from './types.js'
```

把第 63-73 行（从 `const scorer = makeScorerFromEnv()` 到 `scored.sort(...)`）整体替换为：

```ts
  const scorer = makeScorerFromEnv()
  const scores = await scorer.score(relevant, opts.domain)
  const weightOf = new Map(opts.sources.map((s) => [s.id, s.weight]))

  // 过滤用原始分：源权重只应影响排序，不该把低权源整体挡在候选池外，
  // 否则低权源永远进不了推送 → 永远拿不到反馈 → 权重再也回不来（反馈死锁）。
  const passed: Array<{ item: RawItem; raw: number; reason: string }> = []
  for (let i = 0; i < relevant.length; i++) {
    const s = scores[i]!
    if (s.valueScore >= opts.domain.scoreThreshold) passed.push({ item: relevant[i]!, raw: s.valueScore, reason: s.reason })
  }

  // 排序用加权分（Task 8 会把 weightOf 换成持久化权重，Task 10 会在这里插入新颖性因子）
  let scored: ScoredItem[] = passed.map(({ item, raw, reason }) => ({
    ...item,
    valueScore: applySourceWeight(raw, weightOf.get(item.source) ?? 0.5),
    isNew: store.isNovel(item),
    reason,
  }))
  scored.sort((a, b) => b.valueScore - a.valueScore)
```

> ⚠️ `const weightOf = ...` 这一行**本任务保持原样不动**，Task 8 才替换它。别提前改。

- [ ] **Step 4: 跑全量测试**

Run: `npm run build && npx vitest run`
Expected: `tests/e2e.test.ts` 全绿。**逐一确认原有 4 条 e2e 未被打破**（实测值）：

| e2e 夹具 | 新公式分 | ≥ 0.45 ? |
|---|---|---|
| RSS item1 / item2 | 0.7282 | ✓ |
| GitHub item | 0.5000 | ✓ |
| flood item ×8 | 0.7282 | ✓ |
| chocolate cake | — | 被 `isRelevant` 滤掉，走不到门槛 |

所以 `stats.relevant` 仍是 3、`pushed` 仍是 2、配额测试 `rss-1 ≤ 3 / gh-1 ≥ 1` 仍成立。

> e2e 夹具里两个源权重都是 0.5 → 加权因子恰好 1.0 → 原始分 == 加权分，所以门槛改成原始分后这些数字**一个都不用动**。这正是它们能当回归基线的原因。

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/e2e.test.ts
git commit -m "fix(index): 过滤用原始分、排序用加权分——scoreThreshold 生效且不把低权源锁死在候选池外"
```

---

### Phase 2 · 接通反馈回路

#### Task 6: 权重持久化层

**设计要点**：把**持久化**（`store.ts`）与**策略**（新 `weights.ts`）分开——这样 Task 1 的守卫测试对每个函数都有干净的跨文件调用者。

**关键正确性约束**：无新反馈时**不得重算权重**。`updateWeights` 在无反馈时会向 0.5 先验回归（`evolve.test.ts:25` 断言 `next.off ≈ 0.5`，是有意的温和回归），但若每轮都调，1 轮/小时 × 336 轮会把已学到的信号**全部冲淡到 0.5**。用 `processedFeedback` 计数闸门解决。

**Files:** Modify `src/memory/store.ts`；Create `src/memory/weights.ts`；Test `tests/store.test.ts`、`tests/evolve.test.ts`

- [ ] **Step 1: 写失败测试**——`tests/store.test.ts` 追加：

```ts
  it('权重持久化：saveWeights 后新实例能读回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-w-'))
    new MemoryStore(dir).saveWeights({ s1: 0.72 }, 3)
    expect(new MemoryStore(dir).weightsState()).toEqual({ weights: { s1: 0.72 }, processedFeedback: 3 })
  })
```

`tests/evolve.test.ts` 顶部补 import，末尾追加 describe：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../src/memory/store.js'
import { refreshWeights } from '../src/memory/weights.js'

describe('refreshWeights 闸门', () => {
  it('无新反馈时不重算（防止每轮向 0.5 先验漂移冲淡已学信号）', () => {
    const store = new MemoryStore(mkdtempSync(join(tmpdir(), 'dbot-rw-')))
    store.saveWeights({ good: 0.9, noisy: 0.1 }, 0)
    // feedbackCount()=0 == processedFeedback=0 → 闸门关闭，原样返回（off 无存档值 → 回落 config 的 0.5）
    expect(refreshWeights(store, sources)).toEqual({ good: 0.9, noisy: 0.1, off: 0.5 })
  })

  it('有新反馈时重算并落盘，processedFeedback 前移，再调一次结果不变', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-rw2-'))
    const store = new MemoryStore(dir)
    store.recordFeedback({ itemId: 'i', digestId: 'd', source: 'good', signal: 'up', at: 1 })
    const next = refreshWeights(store, sources)
    expect(next.good).toBeGreaterThan(0.6)
    expect(store.weightsState().processedFeedback).toBe(1)
    expect(refreshWeights(store, sources)).toEqual(next)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/store.test.ts tests/evolve.test.ts`
Expected: failed —— `saveWeights`/`weightsState` 不存在、`src/memory/weights.ts` 不存在

- [ ] **Step 3: 给 `store.ts` 加持久化**

在 `Archive` interface（第 16-20 行）之后加：

```ts
export interface WeightsState {
  weights: Record<string, number>
  /** 已参与权重计算的反馈条数；闸门，防止无新反馈时反复向先验回归 */
  processedFeedback: number
}
```

类内 `private feedback: FeedbackRecord[] = []`（第 27 行）之后加：

```ts
  private weights: WeightsState = { weights: {}, processedFeedback: 0 }
```

`load()` 末尾（第 45 行 `}` 之前）追加：

```ts
    try {
      this.weights = JSON.parse(readFileSync(join(this.dir, 'weights.json'), 'utf8')) as WeightsState
    } catch {
      /* 首次运行无权重 */
    }
```

`saveFeedback()`（第 52-54 行）之后加三个方法：

```ts
  weightsState(): WeightsState {
    return { weights: { ...this.weights.weights }, processedFeedback: this.weights.processedFeedback }
  }

  saveWeights(weights: Record<string, number>, processedFeedback: number): void {
    this.weights = { weights: { ...weights }, processedFeedback }
    writeFileSync(join(this.dir, 'weights.json'), JSON.stringify(this.weights, null, 2))
  }

  feedbackCount(): number {
    return this.feedback.length
  }
```

- [ ] **Step 4: 建 `src/memory/weights.ts`**

```ts
import type { SourceConfig } from '../types.js'
import { updateWeights } from './evolve.js'
import type { MemoryStore } from './store.js'

/**
 * 权重刷新的唯一入口：有新反馈才重算并持久化。
 * 无反馈时原样返回当前权重（config 值作首次先验），避免每轮向 0.5 回归冲淡已学信号。
 */
export function refreshWeights(store: MemoryStore, sources: SourceConfig[]): Record<string, number> {
  const state = store.weightsState()
  const current: Record<string, number> = {}
  for (const s of sources) current[s.id] = state.weights[s.id] ?? s.weight
  if (state.processedFeedback >= store.feedbackCount()) return current

  const base = sources.map((s) => ({ ...s, weight: current[s.id]! }))
  const next = updateWeights(base, store.feedbackBySource())
  store.saveWeights(next, store.feedbackCount())
  return next
}
```

- [ ] **Step 5: 跑测试**

Run: `npm run build && npx vitest run tests/store.test.ts tests/evolve.test.ts tests/wiring.test.ts`
Expected: store/evolve 全绿；wiring 中 `saveWeights`、`updateWeights`、`refreshWeights`、`feedbackBySource` **4 条转绿**，其余 4 条仍红

- [ ] **Step 6: Commit**

```bash
git add src/memory/store.ts src/memory/weights.ts tests/store.test.ts tests/evolve.test.ts
git commit -m "feat(memory): 权重持久化 weights.json + refreshWeights 闸门（无新反馈不重算，防先验漂移）"
```

---

#### Task 7: Telegram 反馈接收端

**Files:** Create `src/feedback/receiver.ts`；Test `tests/receiver.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/receiver.test.ts
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { processTelegramUpdate, type TelegramUpdate } from '../src/feedback/receiver.js'
import { MemoryStore } from '../src/memory/store.js'
import type { SourceConfig } from '../src/types.js'

const sources: SourceConfig[] = [
  { id: 's1', type: 'rss', url: '', weight: 0.5, enabled: true },
  { id: 's2', type: 'rss', url: '', weight: 0.5, enabled: true },
]

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'dbot-recv-'))
  const store = new MemoryStore(dir)
  store.recordItems(
    [{ id: 'i1', source: 's1', title: 't', body: '', url: 'u', publishedAt: 0, valueScore: 0.8, isNew: true, reason: '' }],
    1000,
  )
  store.registerDigestRef('d1:0', 'd1', 'i1', 's1')
  const called: string[] = []
  const fetchFn = async (url: string) => {
    called.push(String(url))
    return { ok: true, status: 200, text: async () => '{"ok":true,"result":[]}' }
  }
  return { dir, store, called, fetchFn }
}

describe('processTelegramUpdate', () => {
  it('👍 回调 → 反馈落盘 + 权重上升 + 回应 callbackQuery', async () => {
    const { dir, store, called, fetchFn } = setup()
    const update: TelegramUpdate = { update_id: 7, callback_query: { id: 'cq7', data: 'fb:u:d1:0' } }
    const res = await processTelegramUpdate(update, { token: 'tk', store, sources, fetchFn, now: () => 1100 })

    expect(res).toBe('recorded')
    const fb = JSON.parse(readFileSync(join(dir, 'feedback.json'), 'utf8'))
    expect(fb).toHaveLength(1)
    expect(fb[0]).toMatchObject({ itemId: 'i1', digestId: 'd1', source: 's1', signal: 'up', at: 1100 })

    const w = JSON.parse(readFileSync(join(dir, 'weights.json'), 'utf8'))
    expect(w.weights.s1).toBeGreaterThan(0.5)
    expect(w.processedFeedback).toBe(1)
    expect(called.some((u) => u.includes('answerCallbackQuery'))).toBe(true)
  })

  it('无法解析 / 无对应 ref 的回调被忽略，不落盘', async () => {
    const { dir, store, fetchFn } = setup()
    const deps = { token: 't', store, sources, fetchFn }
    expect(await processTelegramUpdate({ update_id: 1 }, deps)).toBe('ignored')
    expect(await processTelegramUpdate({ update_id: 2, callback_query: { id: 'c', data: 'garbage' } }, deps)).toBe('ignored')
    expect(await processTelegramUpdate({ update_id: 3, callback_query: { id: 'c', data: 'fb:u:nope' } }, deps)).toBe('ignored')
    expect(() => readFileSync(join(dir, 'feedback.json'), 'utf8')).toThrow()
  })

  it('第二次 👍 继续累积，权重单调上升', async () => {
    const { dir, store, fetchFn } = setup()
    const deps = { token: 't', store, sources, fetchFn, now: () => 1200 }
    const upd = (n: number): TelegramUpdate => ({ update_id: n, callback_query: { id: `c${n}`, data: 'fb:u:d1:0' } })
    await processTelegramUpdate(upd(1), deps)
    const w1 = JSON.parse(readFileSync(join(dir, 'weights.json'), 'utf8')).weights.s1
    await processTelegramUpdate(upd(2), deps)
    const w2 = JSON.parse(readFileSync(join(dir, 'weights.json'), 'utf8')).weights.s1
    expect(w2).toBeGreaterThan(w1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/receiver.test.ts`
Expected: failed —— `src/feedback/receiver.ts` 不存在

- [ ] **Step 3: 建 `src/feedback/receiver.ts`**

```ts
import { defaultFetch } from '../collector/adapters/rss.js'
import { refreshWeights } from '../memory/weights.js'
import type { MemoryStore } from '../memory/store.js'
import { answerCallbackQuery, parseCallbackData } from '../push/telegram.js'
import type { FetchFn, SourceConfig } from '../types.js'

export interface TelegramCallbackQuery {
  id: string
  data?: string
}

export interface TelegramUpdate {
  update_id: number
  callback_query?: TelegramCallbackQuery
}

export interface ReceiverDeps {
  token: string
  store: MemoryStore
  sources: SourceConfig[]
  fetchFn?: FetchFn
  now?: () => number
}

export type ProcessResult = 'recorded' | 'ignored'

/** 处理一条 Telegram update：解析回调 → 解析 ref → 落盘反馈 → 刷新权重 → 回应 callbackQuery。 */
export async function processTelegramUpdate(update: TelegramUpdate, deps: ReceiverDeps): Promise<ProcessResult> {
  const cq = update.callback_query
  if (!cq?.data) return 'ignored'
  const parsed = parseCallbackData(cq.data)
  if (!parsed) return 'ignored'
  const resolved = deps.store.resolveRef(parsed.ref)
  if (!resolved) return 'ignored'

  deps.store.recordFeedback({
    itemId: resolved.itemId,
    digestId: resolved.digestId,
    source: resolved.source,
    signal: parsed.signal,
    at: (deps.now ?? Date.now)(),
  })
  refreshWeights(deps.store, deps.sources)
  await answerCallbackQuery(deps.token, cq.id, deps.fetchFn)
  return 'recorded'
}

/** 拉取增量 update。offset 语义：Telegram 只返回 update_id >= offset 的记录。 */
export async function fetchUpdates(
  token: string,
  offset: number,
  fetchFn: FetchFn = defaultFetch,
): Promise<TelegramUpdate[]> {
  const res = await fetchFn(`https://api.telegram.org/bot${token}/getUpdates`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offset, timeout: 30, allowed_updates: ['callback_query'] }),
  })
  if (!res.ok) throw new Error(`telegram getUpdates: HTTP ${res.status}`)
  const data = JSON.parse(await res.text()) as { result?: TelegramUpdate[] }
  return data.result ?? []
}

/** 常驻长轮询：单实例，收到回调即落盘。出错退避 5s 后继续，不退出。 */
export async function pollFeedback(
  deps: ReceiverDeps,
  opts: { onError?: (err: unknown) => void } = {},
): Promise<never> {
  let offset = 0
  for (;;) {
    try {
      for (const u of await fetchUpdates(deps.token, offset, deps.fetchFn)) {
        offset = Math.max(offset, u.update_id + 1)
        await processTelegramUpdate(u, deps)
      }
    } catch (err) {
      opts.onError?.(err)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `npm run build && npx vitest run tests/receiver.test.ts tests/wiring.test.ts`
Expected: receiver 3 条全绿；wiring 中 `recordFeedback`、`resolveRef`、`parseCallbackData`、`answerCallbackQuery` **4 条转绿** → **wiring 8/8 全绿**

- [ ] **Step 5: Commit**

```bash
git add src/feedback/receiver.ts tests/receiver.test.ts
git commit -m "feat(feedback): Telegram 回调接收端——按钮从装饰品变成真实反馈入口（接线守卫 8/8 转绿）"
```

---

#### Task 8: 编排层接线（`runOnce` 读持久化权重 + `main()` 起接收循环）

**Files:** Modify `src/index.ts:12, 65, 154-176`

- [ ] **Step 1: 补 import**——`src/index.ts` 第 12 行 `import { applySourceWeight } ...` 一行改为三行：

```ts
import { applySourceWeight } from './memory/evolve.js'
import { refreshWeights } from './memory/weights.js'
import { pollFeedback } from './feedback/receiver.js'
```

- [ ] **Step 2: `runOnce` 读持久化权重**——把第 65 行：

```ts
  const weightOf = new Map(opts.sources.map((s) => [s.id, s.weight]))
```

替换为：

```ts
  // 权重优先级：memory/weights.json（已学到）> config/sources.json（首次先验）
  const weightOf = new Map(Object.entries(refreshWeights(store, opts.sources)))
```

> 这一行同时打通了**手工编辑 `feedback.json`** 的路径：digest 里印的"或向 feedback.json 追加记录"从此真的生效——下一轮 `runOnce` 会重算权重。

- [ ] **Step 3: `main()` 起常驻接收循环**——把 `src/index.ts:154-176` 的 `main()` 整体替换为：

```ts
async function main(): Promise<void> {
  const root = process.cwd()
  const domain = loadJson<DomainConfig>(join(root, 'config/domain.json'))
  const sources = loadJson<SourceConfig[]>(join(root, 'config/sources.json'))
  const push = loadJson<{ channel: string; outDir: string }>(join(root, 'config/push.json'))
  const memoryDir = join(root, 'memory')

  const once = process.argv.includes('--once')
  const telegram =
    process.env.DOMAIN_BOT_TELEGRAM_TOKEN && process.env.DOMAIN_BOT_TELEGRAM_CHAT_ID
      ? { token: process.env.DOMAIN_BOT_TELEGRAM_TOKEN, chatId: process.env.DOMAIN_BOT_TELEGRAM_CHAT_ID }
      : undefined

  const pollMs = Number(process.env.DOMAIN_BOT_POLL_MS) || 86_400_000   // 默认每天 1 轮（裁决 R9）

  // 常驻反馈接收：Telegram 👍/👎 → feedback.json → weights.json。--once 模式不起。
  if (telegram && !once) {
    pollFeedback(
      { token: telegram.token, store: new MemoryStore(memoryDir), sources },
      { onError: (e) => console.error('[feedback] 轮询异常（5s 后重试）:', e instanceof Error ? e.message : e) },
    ).catch((e) => console.error('[feedback] 循环意外退出:', e))
  } else if (telegram) {
    console.log('[feedback] --once 模式未启动回调接收；本轮的 👍/👎 将在下次常驻运行时入账')
  }

  do {
    const result = await runOnce({ domain, sources, memoryDir, outDir: push.outDir, telegram })
    console.log(
      `[run] 采集 ${result.stats.collected} → 去重删 ${result.stats.deduped} → 相关 ${result.stats.relevant} → 推送 ${result.stats.pushed} 簇`,
      result.pushedPaths,
    )
    if (once) break
    await new Promise((r) => setTimeout(r, pollMs))
  } while (!once)
}
```

- [ ] **Step 4: 跑全量测试**

Run: `npm run build && npx vitest run`
Expected: **全绿**（wiring 8/8 + 其余全部）

- [ ] **Step 5: 手工验证权重能从盘上读回**

```bash
mkdir -p /tmp/wtest && echo '{"weights":{"arxiv-cs-ai":0.05},"processedFeedback":99}' > /tmp/wtest/weights.json
node -e "
const {MemoryStore}=require('/Users/aiatwork/Projects/domain-bot/dist/memory/store.js');
console.log('读回:', JSON.stringify(new MemoryStore('/tmp/wtest').weightsState()));
"
rm -rf /tmp/wtest
```
Expected: `读回: {"weights":{"arxiv-cs-ai":0.05},"processedFeedback":99}`

> 若报 `require` 相关错误（ESM），改用：`node --input-type=module -e "import {MemoryStore} from '/Users/aiatwork/Projects/domain-bot/dist/memory/store.js'; console.log(JSON.stringify(new MemoryStore('/tmp/wtest').weightsState()))"`

- [ ] **Step 4: 确认节奏已改（裁决 R9 / 矩阵 P0-4）**

Run: `grep -n "POLL_MS" src/index.ts .env.example README.md`
Expected: `src/index.ts` 里的默认值是 **`86_400_000`**（每天 1 轮），不是 `3_600_000`。

若 `.env.example` 或 `README.md` 里写了 `DOMAIN_BOT_POLL_MS` 的默认值说明，**同步改成每天 1 轮**。

> 为什么这算 P0：1 小时一轮在静态 RSS 上只会加速传送带消耗（背景 §4 实测的 13 秒连推就是极端例），而真实使用场景是每日简报。节奏错了，两周探针采集到的是“内容池枯竭曲线”而不是“需求信号”。

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): runOnce 读持久化权重 + main 起常驻回调接收 + 节奏改每天 1 轮"
```

---

### Phase 3 · 解混淆变量

#### Task 9: 归档全量候选池（解传送带）

**Files:** Modify `src/memory/store.ts:6-22, 74-101`、`src/index.ts:85-98`；Test `tests/store.test.ts`、`tests/e2e.test.ts`

- [ ] **Step 0: 先给 `MAX_ENTRIES` 冲突开口子（红线 3 的唯一授权例外）**

把上限从 2000 提到 20000 会**打红**现有测试 `tests/store.test.ts:58-63`（它插 2100 条然后断言 `<= 2000`）。这里必须动一条现有测试——理由如下，请老张验收时对照：

- **断言本身是对的**（裁剪行为必须被测），不能删。
- **2100 这个数字是对的**（必须大于上限才能触发裁剪），不能改。
- 变的只是**上限的来源**：从硬编码常量变成构造参数。所以把上限做成可注入，测试显式传 `{ maxEntries: 2000 }`，则 2100 循环、两条断言**一字不改**，测试语义完全等价。

把 `tests/store.test.ts:58-63` 整条替换为（只改了第 2 行的构造方式）：

```ts
  it('归档超过上限时按最近活跃裁剪', () => {
    const store = new MemoryStore(mkdtempSync(join(tmpdir(), 'dbot-')), { maxEntries: 2000 })
    for (let i = 0; i < 2100; i++) store.recordItems([scored(`id-${i}`, `unique title ${i}`)], i)
    expect(store.export().archive.entries.length).toBeLessThanOrEqual(2000)
    expect(store.export().archive.entries.some((e) => e.id === 'id-2099')).toBe(true)
  })
```

> ⚠️ 这一步现在**跑不了**（`MemoryStore` 还不接受第二个参数），Step 3 才加。**不要提前跑测试**，也不要为了让它先过而保留 `MAX_ENTRIES = 2000`。
>
> 另外确认：新的淘汰排序是 `Number(b.pushed) - Number(a.pushed) || b.lastSeenAt - a.lastSeenAt`。该测试里 2100 条全部 `pushed=false` → 第一键均为 0 → 回落到 `lastSeenAt` 降序 → `id-2099`（lastSeenAt 最大）仍被保留，第二条断言成立。

- [ ] **Step 1: 写失败测试**——`tests/store.test.ts` 追加：

```ts
  it('全量候选入归档：未推送条目 pushed=false，markPushed 后升级，且三条都被去重屏蔽', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-pool-'))
    const store = new MemoryStore(dir)
    const mk = (id: string) => ({ id, source: 's1', title: `t-${id}`, body: '', url: '', publishedAt: 0, valueScore: 0.5, isNew: true, reason: '' })
    store.recordItems([mk('a'), mk('b'), mk('c')], 1000)
    store.markPushed(['a'])
    const entries = new MemoryStore(dir).export().archive.entries
    expect(entries).toHaveLength(3)
    expect(entries.find((e) => e.id === 'a')!.pushed).toBe(true)
    expect(entries.find((e) => e.id === 'b')!.pushed).toBe(false)
    expect(new MemoryStore(dir).knownIds().size).toBe(3)
  })
```

`tests/e2e.test.ts` 追加（`readFileSync` 第 1 行已 import；**不要复用第 87-101 行那条测试里的 `rssFlood`**——它是函数内局部变量，提取到模块级需要动现有测试，不值得）：

```ts
  it('传送带已解：归档条数 = 全量候选 > 实际推送条数', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-belt-'))
    // 8 条同构 rss + 1 条 github。必须让候选数(9) > maxPerDigest(6)，配额才会真的截断，
    // 否则「归档条数 > 推送条数」测不出任何东西（现有 mockFetch 只有 3 条候选，正是这个陷阱）。
    const rssFlood = `<?xml version="1.0"?><rss><channel>${Array.from({ length: 8 }, (_, i) =>
      `<item><title>LLM inference benchmark study number ${i} with open source release</title><description>llm inference outperform SOTA benchmark release ${i}</description><link>https://e.com/r${i}</link></item>`).join('')}</channel></rss>`
    const fetchFn = async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => (String(url).includes('api.github.com') ? GH_JSON : rssFlood),
    })
    const r = await runOnce({ domain, sources, memoryDir: join(dir, 'memory'), outDir: join(dir, 'out'), fetchFn, now: 1000 })
    const mem = JSON.parse(readFileSync(join(dir, 'memory', 'archive.json'), 'utf8')) as {
      entries: Array<{ id: string; pushed: boolean }>
    }
    expect(r.stats.relevant).toBe(9)
    expect(mem.entries).toHaveLength(9)                                    // 全量候选都进归档
    expect(mem.entries.filter((e) => e.pushed)).toHaveLength(4)            // perSourceCap=3 → rss 3 条 + gh 1 条
    expect(r.stats.pushed).toBe(4)
    expect(r.digest!.clusters).toHaveLength(2)                             // 8 条 rss 标题只差个位数字 → tokenize 丢弃长度 1 的 token → 同一簇
  })
```

> **这些数字全部实跑确认过**（不是推算）：`relevant=9`、rss 每条新公式分 `0.7282`（kw=2, sig=5，8 条全同）、gh `0.5000`（kw=2, sig=0）、原始分过滤后仍 9 条、`perSourceCap = max(2, ceil(6/2)) = 3` → 推送 4 条、`clusterItems` 返回 2 簇（条数 `[3, 1]`）。
>
> 与现有 e2e「第二轮：同内容不再重复推送」的区别：那条只有 3 条候选，候选集与推送集重合，测不出传送带。新测试断言的是**归档 9 条 vs 推送 4 条**这个差值本身。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/store.test.ts tests/e2e.test.ts`
Expected: 新增两条 failed（`markPushed` 不存在；`pushed` 字段不存在）

- [ ] **Step 3: 改 `store.ts`**

`ArchiveEntry`（第 6-14 行）加字段：

```ts
export interface ArchiveEntry {
  id: string
  title: string
  url: string
  source: string
  firstSeenAt: number
  lastSeenAt: number
  hitCount: number
  /** true = 真的推送过；false = 仅进入过候选池。区分二者才能解传送带并观测候选池分布 */
  pushed: boolean
}
```

`MAX_ENTRIES`（第 22 行）改为可注入：

```ts
// 全量候选入归档后量级从"每轮≤6"升到"每轮数百"；2 万条 ≈ 5MB JSON，两周探针够用。
// 可注入是为了让裁剪测试不必构造 20001 条（见 Step 0）。
const DEFAULT_MAX_ENTRIES = 20000
```

类头部（第 25-33 行）改为：

```ts
export class MemoryStore {
  private archive: Archive = { entries: [], digestRefs: {} }
  private feedback: FeedbackRecord[] = []
  private tokenCache = new Map<string, Set<string>>()
  private weights: WeightsState = { weights: {}, processedFeedback: 0 }   // Task 6 已加
  private readonly maxEntries: number

  constructor(private dir: string, opts: { maxEntries?: number } = {}) {
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
    mkdirSync(dir, { recursive: true })
    this.load()
  }
```

并把 `recordItems` 里的 `MAX_ENTRIES` 两处引用改为 `this.maxEntries`。

现有裁剪测试已在 **Step 0** 改完，本步不再动它。

`recordItems`（第 74-101 行）替换为下面两个方法：

```ts
  /** 把本轮全部候选写入归档（不只推送的）；已存在的刷新 lastSeenAt/hitCount。 */
  recordItems(items: ScoredItem[], now: number): void {
    const byId = new Map(this.archive.entries.map((e) => [e.id, e]))
    for (const item of items) {
      const existing = byId.get(item.id)
      if (existing) {
        existing.lastSeenAt = now
        existing.hitCount++
      } else {
        const entry: ArchiveEntry = {
          id: item.id,
          title: item.title,
          url: item.url,
          source: item.source,
          firstSeenAt: now,
          lastSeenAt: now,
          hitCount: 1,
          pushed: false,
        }
        byId.set(item.id, entry)
        this.archive.entries.push(entry)
      }
    }
    if (this.archive.entries.length > this.maxEntries) {
      // 优先保留推送过的；其余按最近出现时间淘汰
      this.archive.entries.sort((a, b) => Number(b.pushed) - Number(a.pushed) || b.lastSeenAt - a.lastSeenAt)
      this.archive.entries.length = this.maxEntries
    }
    this.saveArchive()
  }

  /** 把确实推送出去的条目升级为 pushed=true。 */
  markPushed(ids: Iterable<string>): void {
    const byId = new Map(this.archive.entries.map((e) => [e.id, e]))
    let touched = false
    for (const id of ids) {
      const e = byId.get(id)
      if (e && !e.pushed) {
        e.pushed = true
        touched = true
      }
    }
    if (touched) this.saveArchive()
  }
```

- [ ] **Step 4: 改 `index.ts` 的归档调用**

把 `src/index.ts:85-98`（从 `scored = diversified` 到 `registerDigestRef` 循环结束）替换为：

```ts
  // 全量候选入归档（配额截断前），再由 markPushed 升级真正推送的那些。
  // 这样 dedupe 屏蔽的是整批已评估内容，而不是只屏蔽推过的 6 条 —— 解传送带。
  const candidates = scored
  scored = diversified

  const digestId = now.toString(36)
  const digest: Digest = {
    id: digestId,
    generatedAt: now,
    domain: opts.domain.domain,
    clusters: buildClusters(scored, opts.domain.clusterThreshold, digestId),
  }

  store.recordItems(candidates, now)
  store.markPushed(scored.map((s) => s.id))
  for (const cluster of digest.clusters) {
    store.registerDigestRef(cluster.ref, digestId, cluster.items[0].id, cluster.items[0].source)
  }
```

> ⚠️ 原第 85 行是 `scored = diversified`、第 87 行是 `const digestId = ...`。替换后顺序变了（先存 `candidates` 再截断），**必须删掉旧的第 85 行**，否则 `candidates` 拿到的已是截断后的数组，传送带照旧。

- [ ] **Step 5: 跑全量测试 + 性能实测**

Run: `npm run build && npx vitest run`
Expected: 全绿

`isNovel` 是 O(归档条数 × 候选数)，归档上限提到 2 万后必须实测：

```bash
node --input-type=module -e "
import {MemoryStore} from '/Users/aiatwork/Projects/domain-bot/dist/memory/store.js';
import {mkdtempSync} from 'node:fs'; import {tmpdir} from 'node:os'; import {join} from 'node:path';
const s = new MemoryStore(mkdtempSync(join(tmpdir(),'perf-')));
const mk = i => ({id:'i'+i, source:'s', title:'title number '+i+' about llm inference', body:'', url:'', publishedAt:0, valueScore:0.5, isNew:true, reason:''});
s.recordItems(Array.from({length:20000},(_,i)=>mk(i)), 1);
const t = Date.now();
for (let i=0;i<200;i++) s.isNovel(mk(30000+i));
console.log('2 万归档 × 200 次 isNovel =', Date.now()-t, 'ms');
"
```
Expected: **< 3000ms**。若超过，把实测值写进交付报告并**停下来问老张**——不要自行改 `isNovel` 语义（`tests/store.test.ts` 对它有断言）。

- [ ] **Step 6: Commit**

```bash
git add src/memory/store.ts src/index.ts tests/store.test.ts tests/e2e.test.ts
git commit -m "fix(memory): 归档全量候选池而非仅推送条目——解传送带逐轮消耗，候选池分布从此可观测"
```

---

#### Task 10: `isNew` 参与排序 + Telegram 通道展示对齐

**为什么**：`isNovel` 目前只驱动 `file.ts:17` 的展示标签，不影响任何排序；`telegram.ts` 连标签都没有。"旧闻降权"是零实现。

**约束（红线 3）**：不得改 `applySourceWeight`。

**Files:** Modify `src/memory/evolve.ts`、`src/index.ts`（import 行 + Task 5 重构出的 `passed.map` 块）、`src/push/telegram.ts:12-17`；Test `tests/evolve.test.ts`、`tests/telegram.test.ts`

- [ ] **Step 1: 写失败测试**——`tests/evolve.test.ts` 追加（import 补 `applyNovelty`）：

```ts
describe('applyNovelty', () => {
  it('旧闻降权 0.75，增量信息不变；且 applySourceWeight 语义未被动过', () => {
    expect(applyNovelty(0.8, true)).toBeCloseTo(0.8, 10)
    expect(applyNovelty(0.8, false)).toBeCloseTo(0.6, 10)
    expect(applySourceWeight(0.8, 1)).toBeCloseTo(1.2, 10)
  })
})
```

`tests/telegram.test.ts` 追加（文件第 4 行已 `import type { Digest, ScoredItem }`，直接用，**不要用 `as never` 绕过类型检查**）：

```ts
  it('Telegram 文案标注增量/旧闻，与 file 通道对齐', async () => {
    let body = ''
    // 模块级已有名为 item / digest 的常量（第 6 / 11 行），这里用 mk / d 避免遮蔽。
    const mk = (id: string, title: string, isNew: boolean): ScoredItem =>
      ({ id, source: 's', title, body: '', url: 'u', publishedAt: 0, valueScore: 0.8, isNew, reason: '' })
    const d: Digest = { id: 'd', generatedAt: 0, domain: 'ai', clusters: [
      { ref: 'd:0', title: 'new thing', summary: 's', why: 'w', items: [mk('1', 'new thing', true)] },
      { ref: 'd:1', title: 'old thing', summary: 's', why: 'w', items: [mk('2', 'old thing', false)] },
    ] }
    await sendDigestTelegram(d, {
      token: 't', chatId: 'c',
      fetchFn: async (_u, init) => { body = String(init?.body); return { ok: true, status: 200, text: async () => '{}' } },
    })
    expect(body).toContain('🆕')
    expect(body).toContain('♻️')
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/evolve.test.ts tests/telegram.test.ts`
Expected: 新增两条 failed

- [ ] **Step 3: 加 `applyNovelty`**——`src/memory/evolve.ts` 末尾追加：

```ts
/**
 * 旧闻降权：isNovel=false（与归档某条标题 jaccard >= 0.7）的条目乘 0.75，
 * 让首发排在跟进报道之前，而不是二者同分靠插入顺序决定。
 * 独立于 applySourceWeight —— 后者语义被 evolve.test.ts 锁定，不可混入。
 */
export function applyNovelty(valueScore: number, isNew: boolean): number {
  return isNew ? valueScore : valueScore * 0.75
}
```

- [ ] **Step 4: `index.ts` 排序键接入**

import 行（Task 8 已拆成三行）的**第一行**改为：

```ts
import { applyNovelty, applySourceWeight } from './memory/evolve.js'
```

> 下面两行（`refreshWeights`、`pollFeedback`）Task 8 已加，**不要动**。

把 Task 5 重构出的 `passed.map` 块（从 `// 排序用加权分` 注释到 `scored.sort(...)`）整体替换为：

```ts
  // 排序用加权分 + 新颖性因子（Task 11 会把 weights 变量抽出来给观测用）。
  // 注意：applyNovelty 只作用于**排序用的加权分**，不影响 passed（过滤用原始分）。
  // 若把它误接到过滤上，旧闻会被整体挡在候选池外，重犯背景 §3 的反馈死锁。
  let scored: ScoredItem[] = passed.map(({ item, raw, reason }) => {
    const novel = store.isNovel(item)
    const weighted = applySourceWeight(raw, weightOf.get(item.source) ?? 0.5)
    return { ...item, valueScore: applyNovelty(weighted, novel), isNew: novel, reason }
  })
  scored.sort((a, b) => b.valueScore - a.valueScore)
```

> **为何不会打破 Task 9 的 flood 测试**：那条测试用全新 `mkdtempSync` 目录，归档为空 → `isNovel` 的 `for` 循环（`store.ts:63`）不执行 → 恒返回 `true` → `applyNovelty(x, true) === x` 是恒等变换，排序、`pushed=4`、`clusters=2` 全部不变。
> 同理，`isNovel` 全在 `recordItems` **之前**调用（index.ts 构造 `scored` 在第 66-71 行，`recordItems` 在第 95 行），所以本轮归档不会污染本轮的新颖性判定。

- [ ] **Step 5: Telegram 文案对齐**——`src/push/telegram.ts:12-17` 替换为：

```ts
  const body = digest.clusters
    .map((c, i) => {
      const src = c.items[0]!
      const tag = src.isNew ? '🆕' : '♻️'
      return `*${i + 1}. ${tag} ${c.title.slice(0, 120)}*\n${c.summary.slice(0, 300)}\n[src](${src.url}) · ${c.why}`
    })
    .join('\n\n')
```

- [ ] **Step 6: 跑全量测试**

Run: `npm run build && npx vitest run`
Expected: 全绿。**特别确认 `evolve.test.ts` 原有 3 条断言未被打破。**

- [ ] **Step 7: Commit**

```bash
git add src/memory/evolve.ts src/index.ts src/push/telegram.ts tests/evolve.test.ts tests/telegram.test.ts
git commit -m "feat(evolve): isNew 参与排序（旧闻 ×0.75）+ Telegram 补 🆕/♻️ 标记，与 file 通道对齐"
```

---

### Phase 4 · 观测与兜底

#### Task 11: 观测落盘 `observations.jsonl`

**为什么必须在 Task 3 之后**（裁决 R3）：打分饱和未修时，任何分数时间序列都恒为 1.00，画出来是直线。三方评审中 A 建议的"打印 top1 分数序列来区分进化生效与内容池枯竭"在饱和下**完全无效**。现在饱和已修，序列才有意义。

**最关键的指标是 `saturationRate`**——它是"仪器是否还灵敏"的自检。持续 > 0.5 说明打分器又饱和了，**此时其他所有观测数据都不可信**。

**Files:** Create `src/memory/observe.ts`；Modify `src/index.ts`（`RunResult` + `runOnce` + 采集循环的 `catch`）；Test `tests/observe.test.ts`、`tests/e2e.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/observe.test.ts
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendObservation, observeRound } from '../src/memory/observe.js'
import type { ScoredItem } from '../src/types.js'

const mk = (id: string, source: string, valueScore: number): ScoredItem =>
  ({ id, source, title: id, body: '', url: '', publishedAt: 0, valueScore, isNew: true, reason: '' })

describe('observeRound', () => {
  it('记录候选池分布、推送均值、饱和度与权重快照', () => {
    const cands = [mk('a', 's1', 1.0), mk('b', 's1', 0.9), mk('c', 's2', 0.5), mk('d', 's2', 0.3)]
    const obs = observeRound(cands, [cands[0]!, cands[2]!], { s1: 0.6, s2: 0.4 }, 1000)
    expect(obs.candidates).toBe(4)
    expect(obs.pushed).toBe(2)
    expect(obs.saturationRate).toBe(0.25)          // 1/4 条 >= 0.99
    expect(obs.pushedMean).toBe(0.75)              // (1.0 + 0.5) / 2
    expect(obs.bySource).toEqual({ s1: 1, s2: 1 })
    expect(obs.weights).toEqual({ s1: 0.6, s2: 0.4 })
    expect(obs.candidateP50).toBe(0.9)             // 升序 [0.3,0.5,0.9,1.0] 取 floor(0.5*4)=2
    expect(obs.candidateP90).toBe(1.0)
    expect(obs.candidateTop1).toBe(1.0)            // 候选池最高分
  })

  it('空候选不炸（除零）', () => {
    const obs = observeRound([], [], {}, 1000)
    expect(obs).toMatchObject({ candidates: 0, pushed: 0, saturationRate: 0, pushedMean: 0, candidateP50: 0, candidateTop1: 0 })
  })

  it('appendObservation 追加 JSONL，一行一轮', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-obs-'))
    appendObservation(dir, observeRound([mk('a', 's1', 0.8)], [], {}, 1000))
    appendObservation(dir, observeRound([mk('b', 's1', 0.9)], [], {}, 2000))
    const lines = readFileSync(join(dir, 'observations.jsonl'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!).at).toBe(2000)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/observe.test.ts`
Expected: failed —— 模块不存在

- [ ] **Step 3: 建 `src/memory/observe.ts`**

```ts
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ScoredItem } from '../types.js'

export interface RoundObservation {
  at: number
  /** 阈值过滤后、配额截断前的候选数 —— 传送带消耗的直接读数 */
  candidates: number
  pushed: number
  candidateP50: number
  candidateP90: number
  /**
   * 候选池最高分。矩阵 P0-4 要的 “top1 分数时间序列”就是它：
   * top1 稳定 + candidateP50 上升 → 进化在起作用（整体质量上提）；
   * top1 与 P50 同步下滑 → 内容池在枯竭（传送带未解干净）。
   * 只看 pushedMean 区分不了这两者——它被每源配额与聚类截断扭曲。
   */
  candidateTop1: number
  pushedMean: number
  /** 候选池中 valueScore>=0.99 的比例。持续 > 0.5 说明打分器又饱和了，此时其他观测全部不可信 */
  saturationRate: number
  weights: Record<string, number>
  bySource: Record<string, number>
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(q * sortedAsc.length))]!
}

export function observeRound(
  candidates: ScoredItem[],
  pushed: ScoredItem[],
  weights: Record<string, number>,
  at: number,
): RoundObservation {
  const cs = candidates.map((c) => c.valueScore).sort((a, b) => a - b)
  const bySource: Record<string, number> = {}
  for (const p of pushed) bySource[p.source] = (bySource[p.source] ?? 0) + 1
  return {
    at,
    candidates: candidates.length,
    pushed: pushed.length,
    candidateP50: round3(quantile(cs, 0.5)),
    candidateP90: round3(quantile(cs, 0.9)),
    candidateTop1: round3(cs.length ? cs[cs.length - 1]! : 0),   // cs 已升序，末位即最大值
    pushedMean: round3(pushed.length ? pushed.reduce((s, p) => s + p.valueScore, 0) / pushed.length : 0),
    saturationRate: round3(
      candidates.length ? candidates.filter((c) => c.valueScore >= 0.99).length / candidates.length : 0,
    ),
    weights,
    bySource,
  }
}

/** 追加式 JSONL：一行一轮，不重写全文件，可直接 grep / 画图。 */
export function appendObservation(dir: string, obs: RoundObservation): void {
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, 'observations.jsonl'), JSON.stringify(obs) + '\n')
}
```

- [ ] **Step 4: 接进 `runOnce`**

`src/index.ts` 加 import：

```ts
import { appendObservation, observeRound, type RoundObservation } from './memory/observe.js'
```

`RunResult`（第 27-37 行）加字段：

```ts
export interface RunResult {
  digest?: Digest
  pushedPaths: string[]
  observation: RoundObservation
  stats: {
    collected: number
    deduped: number
    relevant: number
    pushed: number
    skippedSources: string[]
  }
}
```

把 Task 8 Step 2 写入的那两行改为（需要留住 `weights` 对象供观测用）：

```ts
  // 权重优先级：memory/weights.json（已学到）> config/sources.json（首次先验）
  const weights = refreshWeights(store, opts.sources)
  const weightOf = new Map(Object.entries(weights))
```

在 `store.markPushed(...)` 之后、`registerDigestRef` 循环之后，`const pushedPaths` 之前插入：

```ts
  const observation = observeRound(candidates, scored, weights, now)
  appendObservation(opts.memoryDir, observation)
```

两个 return 都加上 `observation`：

```ts
    return {
      digest,
      pushedPaths,
      observation,
      stats: { collected: collectedCount, deduped: collectedCount - kept.length, relevant: relevant.length, pushed: 0, skippedSources: skipped.map((s) => s.id) },
    }
```

```ts
  return {
    digest,
    pushedPaths,
    observation,
    stats: {
      collected: collectedCount,
      deduped: collectedCount - kept.length,
      relevant: relevant.length,
      pushed: digest.clusters.length,
      skippedSources: skipped.map((s) => s.id),
    },
  }
```

> ⚠️ 空推送的提前 return（原第 101-107 行）也必须带 `observation`——**"这轮候选池空了"恰恰是传送带耗尽的最重要信号**，漏掉它等于把关键数据点丢了。

- [ ] **Step 5: 修 `skippedSources` 恒为空的 bug**

`src/index.ts:45` 声明了 `const skipped: SourceConfig[] = []`，但采集循环的 `catch`（第 54-56 行）**只 `console.error`，从未 push**。所以两个 return 里的 `skippedSources: skipped.map((s) => s.id)` **恒为 `[]`**。

后果与本 Task 直接相关：两周探针里某个源挂了（arXiv 限流、GitHub 403 很常见），观测数据里**看不出来**，你只会看到候选池变小，然后把它误读成“内容池枯竭”或“进化生效”。这是又一个“仪器不动”。

先写失败测试——`tests/e2e.test.ts` 追加：

```ts
  it('采集失败的源必须出现在 skippedSources（否则该观测字段恒为空）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-skip-'))
    // rss 返回 ok:false → fetchRss 抛 `rss rss-1: HTTP 503`；github 正常。
    const fetchFn = async (url: string) =>
      String(url).includes('api.github.com')
        ? { ok: true, status: 200, text: async () => GH_JSON }
        : { ok: false, status: 503, text: async () => '' }
    const r = await runOnce({ domain, sources, memoryDir: join(dir, 'memory'), outDir: join(dir, 'out'), fetchFn, now: 1000 })
    expect(r.stats.skippedSources).toEqual(['rss-1'])
    expect(r.stats.collected).toBe(1)   // 只剩 github 一条
  })
```

Run: `npx vitest run tests/e2e.test.ts`
Expected: **1 failed** —— `skippedSources` 实际是 `[]`，期望 `['rss-1']`（`collected` 已经是 1，那半句本来就过）

修复——把 `src/index.ts:54-56` 的 `catch` 块改为：

```ts
    } catch (err) {
      // 必须记入 skipped：否则 skippedSources 恒为空，源挂掉与内容池枯竭在观测上无法区分。
      skipped.push(source)
      console.error(`[collector] ${source.id} 失败:`, err instanceof Error ? err.message : err)
    }
```

Run: `npx vitest run tests/e2e.test.ts`
Expected: 全绿

- [ ] **Step 6: 跑全量测试**

Run: `npm run build && npx vitest run`
Expected: 全绿（若有测试因 `RunResult` 新增必填字段而报类型错，修测试的构造对象，**不要**把 `observation` 改成可选来绕过）

- [ ] **Step 7: Commit**

```bash
git add src/memory/observe.ts src/index.ts tests/observe.test.ts tests/e2e.test.ts
git commit -m "feat(observe): 每轮落盘 observations.jsonl + 修 skippedSources 恒为空（源挂掉不再被误读为池枯竭）"
```

---

#### Task 12: LLM 打分分批 + 降级兜底

**为什么**：`LlmScorer.score`（`scorer.ts:47-83`）把**全部候选拼进一个 prompt**，且 `if (!res.ok) throw`。arXiv 单轮 ~100 条 × 600 字符正文 ≈ 6 万字符，会撞上下文上限或超时；一旦失败整轮崩，探针断档。填 LLM key 之前必须先有兜底。

还有第二个隐性病：`scorer.ts:73` 把 LLM **漏答的条目填常数 0.5**（`reason: 'llm 输出缺失，取默认分'`）。真实 LLM 经常少返回几条，于是候选池里会混进一批假的 0.5 分，在 `observations.jsonl` 的 P50/top1 序列上压出一个**假平台**——而那个序列正是假门标准 #3 的唯一读数。矩阵 P0-6 原话要求“降级到 `HeuristicScorer`（**不是常数 0.5**）”，本 Task 两半都做。

**Files:** Modify `src/refinery/scorer.ts:40-95`；Test `tests/refinery.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
  it('LlmScorer 分批调用：25 条按 batchSize=10 切成 3 批', async () => {
    let calls = 0
    const scorer = new LlmScorer({
      baseUrl: 'http://mock/v1', apiKey: 'k', model: 'm', batchSize: 10,
      fetchFn: async () => {
        calls++
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '[]' } }] }) }
      },
    })
    const items = Array.from({ length: 25 }, (_, i) => item(`t${i} llm`))
    const res = await scorer.score(items, domain)
    expect(calls).toBe(3)
    expect(res).toHaveLength(25)          // 长度必须与输入严格对齐
  })

  it('某一批失败时降级到启发式，不影响其他批，不抛异常', async () => {
    let n = 0
    const scorer = new LlmScorer({
      baseUrl: 'http://mock/v1', apiKey: 'k', model: 'm', batchSize: 2,
      fetchFn: async () => {
        n++
        if (n === 2) return { ok: false, status: 500, text: async () => 'boom' }
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '[{"index":0,"score":0.9,"reason":"llm"},{"index":1,"score":0.9,"reason":"llm"}]' } }] }) }
      },
    })
    // ⚠️ 必须 6 条：batchSize=2 → 3 批，第 2 批失败，第 3 批必须仍正常。
    //    用 4 条只有 2 批，根本测不到“失败不影响后续批”这件事。
    const res = await scorer.score(
      [item('a llm'), item('b llm'), item('c llm'), item('d llm'), item('e llm'), item('f llm')],
      domain,
    )
    expect(res).toHaveLength(6)
    expect(res[0]!.reason).toBe('llm')                    // 批 1 走 LLM
    expect(res[2]!.reason).toContain('关键词命中')         // 批 2 降级到启发式
    expect(res[3]!.reason).toContain('关键词命中')         // 同批也降级（整批失败，不是单条）
    expect(res[4]!.reason).toBe('llm')                    // 批 3 仍正常 —— 这才是本测试的重点
  })

  it('LLM 返回 200 但漏答的条目降级到启发式，不再是常数 0.5（矩阵 P0-6）', async () => {
    const scorer = new LlmScorer({
      baseUrl: 'http://mock/v1', apiKey: 'k', model: 'm',
      // 只答 index 0，故意漏掉 index 1（真实 LLM 很常见的行为）
      fetchFn: async () => ({ ok: true, status: 200, text: async () =>
        JSON.stringify({ choices: [{ message: { content: '[{"index":0,"score":0.9,"reason":"llm"}]' } }] }) }),
    })
    const res = await scorer.score([item('a llm'), item('b inference benchmark release sota')], domain)
    expect(res).toHaveLength(2)
    expect(res[0]).toEqual({ valueScore: 0.9, reason: 'llm' })
    // 旧行为是 { valueScore: 0.5, reason: 'llm 输出缺失，取默认分' }。
    // 常数 0.5 会在 observations.jsonl 的 candidateP50/top1 序列里造假平台，看不出仪器是否失灵。
    expect(res[1]!.valueScore).not.toBe(0.5)
    expect(res[1]!.valueScore).toBeCloseTo(0.6036, 3)   // 实跑值：kw=1, sig=3
    expect(res[1]!.reason).toContain('关键词命中')
    expect(res[1]!.reason).toContain('llm 漏答')
  })
```

> **现有测试 `tests/refinery.test.ts:43` 会怎样**：它的标题是「解析 JSON 输出并夹紧分数；缺失项取默认 0.5」，但**它的两条断言实际上没有一条走 0.5 路径**（LLM 把 index 0 和 1 都答了）。
> 我实跑验证过：改成启发式兜底后，`results[0]` 仍被 LLM 覆盖为 `{ valueScore: 0, reason: '' }`、`results[1].valueScore` 仍为 `1` —— **两条断言一字不改仍然通过**。
> 只把标题里的「缺失项取默认 0.5」改为「缺失项降级启发式（见下条测试）」——**改标题不算放宽断言**，因为断言本身没变。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/refinery.test.ts`
Expected: **新增 3 条全 failed**（`batchSize` 选项不存在 → tsc 报错；失败即抛；漏答仍取 0.5），原有测试仍 pass

- [ ] **Step 3: 改 `LlmScorer`**

构造器（`scorer.ts:43-45`）加 `batchSize`：

```ts
  constructor(
    private opts: { baseUrl: string; apiKey: string; model: string; batchSize?: number; fetchFn?: FetchFn },
  ) {}
```

把 `score`（第 47-83 行）拆成“分批外壳 + 单批实现”。**两个方法全文如下，直接整段替换**：

```ts
  async score(items: RawItem[], domain: DomainConfig): Promise<ScoreResult[]> {
    const batchSize = this.opts.batchSize ?? 20
    const fallback = new HeuristicScorer()
    const out: ScoreResult[] = []
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      try {
        out.push(...(await this.scoreBatch(batch, domain)))
      } catch (err) {
        // 矩阵 P0-6：单批失败不得拖垮整轮（arXiv 单轮 ~100 条，一旦抛异常探针就断档）。
        console.error(`[scorer] llm 第 ${i / batchSize + 1} 批失败，降级启发式:`, err instanceof Error ? err.message : err)
        out.push(...(await fallback.score(batch, domain)))
      }
    }
    return out
  }

  /** 单批调用。方法体 = 原 `score` 从 `const prompt = [` 到 `return results`，**只改兜底那一处**。 */
  private async scoreBatch(items: RawItem[], domain: DomainConfig): Promise<ScoreResult[]> {
    if (items.length === 0) return []
    const prompt = [
      `领域：${domain.domain}。对下列每条信息打价值分（0~1），判断依据：`,
      `1) 对该领域内的人做决策是否有用；2) 是否新信息（而非旧闻复读）；3) 是否反常识或高杠杆。`,
      `只输出 JSON 数组：[{"index":0,"score":0.8,"reason":"一句话理由"}, ...]`,
      ``,
      ...items.map((it, i) => `[${i}] ${it.title}\n${it.body.slice(0, 600)}`),
    ].join('\n')

    const url = this.opts.baseUrl.replace(/\/$/, '') + '/chat/completions'
    const res = await (this.opts.fetchFn ?? defaultFetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify({
        model: this.opts.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
    })
    if (!res.ok) throw new Error(`llm scorer: HTTP ${res.status}`)
    const data = JSON.parse(await res.text()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content ?? ''
    const match = content.match(/\[[\s\S]*\]/)
    const parsed = match ? (JSON.parse(match[0]) as Array<{ index: number; score: number; reason?: string }>) : []

    // 【本 Task 唯一改的地方】旧代码这里填常数 0.5：
    //   items.map(() => ({ valueScore: 0.5, reason: 'llm 输出缺失，取默认分' }))
    // 矩阵 P0-6 明确要求降级到 HeuristicScorer。常数 0.5 是假的“中立分”：
    // 它会在 observations.jsonl 的 candidateP50/top1 序列里造出一个假平台，
    // 而那个序列正是假门标准 #3「噪音可感知下降」的唯一读数。
    const heuristic = await new HeuristicScorer().score(items, domain)
    const results: ScoreResult[] = heuristic.map((h) => ({
      valueScore: h.valueScore,
      reason: `${h.reason}（llm 漏答，已降级启发式）`,
    }))
    for (const p of parsed) {
      if (typeof p.index === 'number' && p.index >= 0 && p.index < results.length) {
        results[p.index] = {
          valueScore: Math.max(0, Math.min(1, Number(p.score) || 0)),
          reason: p.reason ?? '',
        }
      }
    }
    return results
  }
```

> **为何外壳里不需要“长度对齐保护”**：`scoreBatch` 的 `results` 是用 `heuristic.map(...)` 构造的，长度恒等于 `batch.length`，所以 `r.length === batch.length` 永远为真——写了就是**死代码**，还会误导读者以为真有一层保护。按 YAGNI 删掉。
>
> **除兜底那一处，`scoreBatch` 与原 `score` 方法体逐字相同**。不要“顺手优化” prompt 或解析逻辑——它们被 `tests/refinery.test.ts:43` 的夹紧断言锁定（`score: 2.5` → 1、`score: -1` → 0、`reason` 缺失 → `''`）。

- [ ] **Step 4: `makeScorerFromEnv` 支持 batchSize**

```ts
export function makeScorerFromEnv(env: NodeJS.ProcessEnv = process.env): Scorer {
  if (env.DOMAIN_BOT_LLM_BASE_URL && env.DOMAIN_BOT_LLM_API_KEY && env.DOMAIN_BOT_LLM_MODEL) {
    return new LlmScorer({
      baseUrl: env.DOMAIN_BOT_LLM_BASE_URL,
      apiKey: env.DOMAIN_BOT_LLM_API_KEY,
      model: env.DOMAIN_BOT_LLM_MODEL,
      batchSize: Number(env.DOMAIN_BOT_LLM_BATCH_SIZE) || 20,
    })
  }
  return new HeuristicScorer()
}
```

- [ ] **Step 5: 跑全量测试**

Run: `npm run build && npx vitest run`
Expected: 全绿。**确认 `refinery.test.ts` 原有的 LlmScorer 夹紧测试仍通过**（它不传 `batchSize`，走默认 20，2 条输入 → 1 批）

- [ ] **Step 6: Commit**

```bash
git add src/refinery/scorer.ts tests/refinery.test.ts
git commit -m "fix(scorer): LLM 打分分批（默认 20）+ 失败/漏答均降级启发式——不再整轮崩、不再填常数 0.5 假分"
```

---

### Phase 5 · 验收

#### Task 13: 端到端反测试（本次修复的核心验收）

**为什么这条最重要**：现有 `tests/e2e.test.ts:70-85`「反馈回路：👍 后源权重上升」**手工调用** `store.recordFeedback` 和 `updateWeights`——它证明的是"这些函数各自能用"，而不是"生产路径把它们串起来了"。这正是 35 绿却回路断开的成因。

本任务的两条测试**只走真实入口**，绝不手工调 `recordFeedback` / `updateWeights` / `saveWeights`。

**Files:** Modify `tests/e2e.test.ts`

- [ ] **Step 1: 补 import**——`tests/e2e.test.ts` 第 1 行加 `writeFileSync`，并在 import 段加：

```ts
import { mkdtempSync, readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { processTelegramUpdate } from '../src/feedback/receiver.js'
```

- [ ] **Step 2: 写反测试**

```ts
  it('反测试：真实 Telegram 回调路径改变持久化权重，且下一轮 runOnce 自己读到', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-loop-'))
    const memoryDir = join(dir, 'memory')
    const r1 = await runOnce({ domain, sources, memoryDir, fetchFn: mockFetch(), now: 1000 })
    const ref = r1.digest!.clusters[0]!.ref
    const before = r1.observation.weights
    const target = new MemoryStore(memoryDir).resolveRef(ref)!.source

    // 只走真实回调入口：不手工调 recordFeedback / updateWeights / saveWeights
    const res = await processTelegramUpdate(
      { update_id: 1, callback_query: { id: 'cq', data: `fb:u:${ref}` } },
      {
        token: 't',
        store: new MemoryStore(memoryDir),
        sources,
        fetchFn: async () => ({ ok: true, status: 200, text: async () => '{}' }),
        now: () => 1500,
      },
    )
    expect(res).toBe('recorded')

    // 下一轮 runOnce 必须自己从盘上读到新权重（不是测试注入 → 不构成循环论证）
    const r2 = await runOnce({ domain, sources, memoryDir, fetchFn: mockFetch(), now: 2000 })
    const after = r2.observation.weights[target]!
    expect(after).toBeGreaterThan(before[target]!)
    const onDisk = JSON.parse(readFileSync(join(memoryDir, 'weights.json'), 'utf8')).weights[target]
    expect(after).toBeCloseTo(onDisk, 10)          // 读到的就是盘上的，不是重算的
    expect(existsSync(join(memoryDir, 'feedback.json'))).toBe(true)
  })

  it('反测试：手工追加 feedback.json 也驱动进化（无 Telegram 时的兜底路径）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbot-manual-'))
    const memoryDir = join(dir, 'memory')
    const r1 = await runOnce({ domain, sources, memoryDir, fetchFn: mockFetch(), now: 1000 })
    const resolved = new MemoryStore(memoryDir).resolveRef(r1.digest!.clusters[0]!.ref)!

    // 模拟用户照 digest 里的说明手工追加一条 👎
    writeFileSync(join(memoryDir, 'feedback.json'), JSON.stringify([
      { itemId: resolved.itemId, digestId: resolved.digestId, source: resolved.source, signal: 'down', at: 1500 },
    ]))

    const r2 = await runOnce({ domain, sources, memoryDir, fetchFn: mockFetch(), now: 2000 })
    expect(r2.observation.weights[resolved.source]!).toBeLessThan(0.5)   // 👎 使权重下降
  })
```

> `e2e.test.ts` 顶部需要能拿到 `MemoryStore`：现有第 72 行是测试内 `await import(...)`。本测试用了顶层 `new MemoryStore(...)`，请在 import 段加 `import { MemoryStore } from '../src/memory/store.js'`。

- [ ] **Step 3: 跑测试**

Run: `npm run build && npx vitest run tests/e2e.test.ts`
Expected: 两条新测试 **pass**

> 若第一条失败在 `after > before`：检查 Task 8 Step 2 是否真的把 `refreshWeights` 接进了 `runOnce`（而不是只在 `main()` 里读）。
> 若第二条失败：说明 `runOnce` 没调 `refreshWeights`，手工路径未接通。

- [ ] **Step 4: 红绿验证（证明这两条测试真的能抓到回归）**

临时把 `src/index.ts` 里 `refreshWeights(store, opts.sources)` 改回 `Object.fromEntries(opts.sources.map((s) => [s.id, s.weight]))`，然后：

Run: `npx vitest run tests/e2e.test.ts tests/wiring.test.ts`
Expected: **两条反测试 + wiring 的 `refreshWeights` 守卫全部 FAIL**

确认后**改回来**，再跑一次：

Run: `npm run build && npx vitest run`
Expected: 全绿

> 这一步不可跳过。**没看过它红的测试，不能证明它有效**——这正是本次事故的教训。

- [ ] **Step 5: Commit**

```bash
git add tests/e2e.test.ts
git commit -m "test(e2e): 端到端反测试——只走真实回调/手工入口，附红绿验证证明测试有效"
```

---

#### Task 14: 全量回归 + 真实跑一轮 + 交付报告

- [ ] **Step 1: 清空历史记忆，从零开始**

> 现有 `memory/archive.json` 的 29 条是旧代码（打分饱和 + 传送带）产物，混入新数据会污染观测。

```bash
cd /Users/aiatwork/Projects/domain-bot
npm run snapshot          # 先把旧证据存档，不要直接删
git mv memory/archive.json /tmp/old-archive-$(date +%s).json 2>/dev/null || mv memory/archive.json /tmp/old-archive-$(date +%s).json
ls memory/                # 确认已无 archive.json
```

- [ ] **Step 2: 全量测试**

Run: `npm run build && npx vitest run`
Expected: **全绿**，记录总测试数（应为原 35 + 新增约 20 条）

- [ ] **Step 3: 真实跑一轮（无 LLM key，走启发式）**

Run: `node dist/index.js --once`
Expected: 输出 `[run] 采集 N → 去重删 M → 相关 K → 推送 J 簇`

- [ ] **Step 4: 检查观测数据**

```bash
cat memory/observations.jsonl
```
Expected: 恰好 1 行 JSON，其中：
- `saturationRate` **< 0.5**（若 ≥ 0.5，说明 Task 3 的公式对真实数据仍饱和，**停下来报告**，不要继续）
- `candidates` **> `pushed`**（证明 Task 9 生效：归档的是全量候选）
- `candidateP50` 与 `candidateP90` **不相等**（证明分数有区分度）
- `weights` 含 7 个源，值等于 `config/sources.json` 的先验

```bash
python3 -c "
import json
a=json.load(open('memory/archive.json'))
e=a['entries']
print('归档总数:', len(e), '| 其中 pushed=true:', sum(1 for x in e if x.get('pushed')))
"
```
Expected: 归档总数 **明显大于** pushed 数（旧代码下二者相等）

- [ ] **Step 5: 再跑一轮，确认传送带已解**

Run: `node dist/index.js --once`
Expected: 第二轮 `推送 0 簇` 或明显少于第一轮（同一批静态 RSS 已被整批归档屏蔽）。`observations.jsonl` 变成 2 行。

> 若第二轮推送数与第一轮相同，说明 Task 9 的 `candidates` 顺序写错了（见 Task 9 Step 4 的 ⚠️）。

- [ ] **Step 6: 存档证据**

Run: `npm run snapshot && cat evidence/*/SUMMARY.json | tail -20`

- [ ] **Step 7: 写交付报告**

Create `domain-bot/docs/p0-fix-report.md`，必须包含：

1. **Task 1 的红灯原始输出**（8 failed 的完整文本）
2. **Task 14 Step 2 的绿灯原始输出**（含总测试数）
3. **Task 13 Step 4 的红绿验证输出**（改坏后 FAIL、改回后 PASS 各一份）
4. **真实两轮的 `observations.jsonl` 全文**
5. `git log --oneline` 从派单前到完成的全部提交
6. `git diff --stat <派单前 commit>..HEAD`
7. **deviations**：任何与本工作单不一致的实现，逐条写明"改了什么、为什么"。**特别要写清你是否动过任何现有测试断言**——按红线 3，只允许 R11、R12 两处，其余均应在报告里标红

- [ ] **Step 8: Commit（不要 push）**

```bash
git add docs/p0-fix-report.md evidence/
git commit -m "docs: P0 修复交付报告——含红灯基线、红绿验证、真实两轮观测数据"
```

**停在这里。不要 `git push`，等老张批准。**

---

## 五、完成定义（Definition of Done）

逐条勾，全勾才算完成：

- [ ] `tests/wiring.test.ts` 8/8 绿，且**交付报告里留有它最初 8 failed 的原始输出**
- [ ] `npx vitest run` 全绿，总测试数 ≥ 50
- [ ] Task 13 两条反测试做过红绿验证（改坏 → FAIL，改回 → PASS），输出已留档
- [ ] 真实跑一轮后 `observations.jsonl` 存在且 `saturationRate < 0.5`
- [ ] `observations.jsonl` 每行含 `candidateTop1` 与 `candidateP50` 两个字段（矩阵 P0-4 要的 top1 时间序列）
- [ ] 真实跑一轮后 `archive.json` 中 `pushed=true` 的条数 **<** 总条数 —— **这条才是“传送带已解”的真证据**
- [ ] 连跑两轮（RSS 未更新时），第二轮推送数下降甚至为 0 —— 这是**全量归档生效的正常表现**，不是 bug（现有 e2e「第二轮去重 100%」断言的就是 `pushed === 0`）。但必须同时确认 `observations.jsonl` 第二行的 `candidateTop1` **没有比第一行低很多**——若候选池非空而 top1 逐轮下滑，才是传送带未解干净
- [ ] 源采集失败时 `stats.skippedSources` 非空（Task 11 Step 5）
- [ ] LLM 漏答的条目分数不是常数 0.5（Task 12 新增测试绿）
- [ ] `config/domain.json` 含 `signalWords`（10 个，无 `open-source`），`keywords` 里 `" multimodal "` 的空格已清，且 `scoreThreshold` 改动可观测（Task 5 测试绿）
- [ ] 现有 `tests/evolve.test.ts` 的 `applySourceWeight(0.8,1)===1.2` 断言**未被修改**
- [ ] 未新增任何 npm 依赖（`git diff package.json` 只多了 `snapshot` script）
- [ ] 已 commit，**未 push**
- [ ] `docs/p0-fix-report.md` 七项内容齐全

---

## 六、明确不在本工作单内（等老张裁决后再派）

**不要顺手做这些**——它们需要老张先拍板，且做了会拖慢探针开跑。

> 编号**一律沿用矩阵**（`docs/reviews/cross-review-matrix-2026-09-01.md` 第五节），不另编一套，方便对照。

| 矩阵编号 | 内容 | 为何不在本单 |
|---|---|---|
| **P1-1** | 关键词匹配加**词边界**（修 `rag` 误伤 `storage`/`paragraph`/`average`） | **矩阵估“一行”，我实测后认为这个估计是错的**——见下方专项说明。修法有非平凡权衡，需老张先选方案 |
| **P1-2**（后半） | 每轮打印**源级产出表**（源id/采集数/过滤数/入推送数）+ “零产出源”告警 | 前半（`skippedSources` 的 catch push）**已在 Task 11 Step 5 做掉**。后半需改 `observeRound` 签名（多传按源采集计数），且“零产出”判据依赖 P1-3 先定死源去留 |
| **P1-3** | 救活或删掉 3 个死源（v2ex 换 LLM 节点、bili 加中文关键词、jina 补 key）；删 `fetchV2ex` 硬编码 URL | 需老张提供 jina key 并决定 v2ex/bili 去留。矩阵已裁决“保留当前 3，但先执行 P1-3” |
| **P1-4** | 建**双基线**（内容基线：连续 3 天手工挑 6 条记 👍率；行为基线：第三方记录作者当前信息获取习惯） | 三方共识 S15，但需老张本人投入 3 天，不是代码任务 |
| **P1-5** | 反测试 | **已升级进本工作单 Task 13**（裁决 R10），且比矩阵原表述更严 |
| **P1-6** | 重定假门通过线（比例制+留存制、反馈率下限 ≥20%、非对称判据） | 依赖 P1-4 的基线数据；且是文档任务 |
| **P1-7** | 写死**退出条件**（两周到期停 3 天测戒断反应；连续 3 轮无反馈立即停） | 探针末期才做；文档任务 |
| **P1-8** | 反馈归因改**条目级**（修簇级稀释）+ 学习维度改**条目特征权重** | 裁决 R1：先用源级接通，两周后看 `observations.jsonl` 里权重轨迹的方差再定 |
| **P1-9** | `reason` 输出命中的**具体关键词**而非机械统计 | Task 3 保留了 `关键词命中 N，信号词命中 M` 的机械格式。改成输出具体词会动 `tests/refinery.test.ts` 现有断言（它 `toContain('关键词命中')`），且属体验优化非仪器修复 |
| **P2-1** | 中文分词（`tokenize` 按空格切，中文整句成一个 token） | **与 P1-1 强耦合**（见下方方案 C），必须一起裁决。当前 7 个源里只有 bili 是中文，影响面小 |
| **P2-2** | `isNovel` 的 O(N×M) 性能优化（加时间窗） | Task 9 Step 5 已内置实测门（>3000ms 就停下来问）；未超就不动 |
| **P2-3** | 合并进 tuna packages（千 Bot 可复制性） | 探针判“加注”之后的事 |

### 专项：P1-1 词边界——为何不是“一行”（本工作单新增的实测发现）

**误伤本身是真的**，我复验确认：

```
'storage'.includes('rag')   = true      'fragrance'.includes('rag') = true
'paragraph'.includes('rag') = true      'ragdoll'.includes('rag')   = true
'average'.includes('rag')   = true
```

但若把“加词边界”实现成最直觉的**空格包围**（`hay.includes(' ' + normalizeText(k) + ' ')`），实测有两个严重副作用：

1. **打死全部中文关键词/信号词。** 中文不分词：`normalizeText('llm 芯片涨价')` → `'llm 芯片涨价'`，而 `' 涨价 '` 匹配不到（“涨价”前面是“片”不是空格）。实测：**Task 4 那条中文信号词测试（`signalWords: ['涨价','断供']`）会从绿变红**。
   正则 `\b` 同样不行——`\b` 基于 `\w`，中文字符不属于 `\w`。
2. **打死英文词形变化。** 实测 arXiv 样本 `outperforms SOTA`：宽松 sigHits=5，空格词边界 sigHits=4（`' outperform '` 匹配不到 `' outperforms '`），分数 0.9459 → 0.9218。`release/releases`、`beat/beats`、`model/models` 同理。对英文而言前缀包含其实是**特性**（免费覆盖复数与时态）。

三个候选修法（请老张选一个再派单）：

| 方案 | 做法 | 代价与实测依据 |
|---|---|---|
| **A（最小）** | 只改 config：把 `rag` 写成 `rag pipeline` 之类，不动代码 | 零风险；但每换一个短词都要人工排查，不通用 |
| **B（推荐）** | 只对**纯 ASCII 且长度 ≤3** 的关键词加空格词边界，其余保持宽松 | 约 5 行 + 4 条测试。精准命中误伤高风险区（只有短词才可能是长词的子串），保住中文与英文词形变化 |
| **C（彻底）** | 先做 P2-1 中文分词，再统一按 token 集合匹配 | 需新增依赖或自写分词，**与红线 4 冲突**，工作量最大 |

方案 B 的一个实测细节（证明它反而修正了另一个隐形 bug）：真实 config 里 `fine-tune` 与 `fine-tuning` 是**两个独立关键词**。宽松模式下文本 `fine-tuning a model` 会**同时命中两者**（`'fine tuning'` 包含 `'fine tune'`），kwHits 虚高 1；严格模式下各自只匹配自己。所以 B 不只是修 `rag`，还修了同义关键词重复计数。

### 附带：一个零风险配置卫生修正（已入 Task 4）

`config/domain.json` 的 `keywords` 最后一项是 `" multimodal "`——**带前后空格**，是笔误。实测 `normalizeText` 的 `trim()` 已吸收它，**行为无变化**，但留着会让下一个改配置的人困惑。Task 4 本来就要改这个文件（加 `signalWords`），顺手清掉。

---

## 七、给 ZCode 的执行提示

1. **先读完本工作单再动手**，特别是第三节的 5 条红线。
2. **严格按 Task 顺序**。Task 1 的红灯是后面所有验收的基准；跳过它就等于放弃证明能力。
3. 每个 Task 的 Step 1 都是**先写失败测试**。若发现某步的测试直接就是绿的，说明测试写错了（没测到点子上），停下来检查，不要往下走。
4. 遇到与本工作单描述不符的代码现状（行号漂移、签名不同），**以实际代码为准**，但必须在交付报告第 7 项里写明偏差。
5. 遇到需要设计决策的分叉（本工作单没覆盖的），**停下来问**，不要自行发挥。
6. 全程不 `git push`。
