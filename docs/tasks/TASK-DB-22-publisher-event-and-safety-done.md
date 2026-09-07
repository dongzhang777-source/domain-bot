# TASK-DB-22 施工自测报告：事件判据治本（B-1）+ 发布安全护栏（C-1/A-3/C-3/B-5/B-2/B-3）

> 工单号：DB-22　｜　施工：claude 通道（本单唯一作答会话）
> 依据：`TASK-DB-21-ops-overwrite-and-selection-audit-done.md` §七行动清单
> 基线：`domain-bot @ 22f7395` ＋ `tuna @ dcf2cff`（与工单一致，未 commit/push）
> ⚠️ 报告落盘时 tuna HEAD 已被**另一会话**推进到 `08b0ea0`（4 个提交：L3 键盘避让 / icon-only 按钮 + 台账回写，只动 `apps/tuna/src/screens/DeepChatScreen.tsx` 与 `docs/COMMITMENT-LEDGER.md`，**未触碰本单任何落点文件**；本单全部验证已在 `08b0ea0` 上复跑通过）。domain-bot HEAD 全程未动。
> 报告时间：2026-09-07 18:3x EDT
> 施工顺序：**先 domain-bot（§3，全绿）→ 后 tuna（§1/2/4/5/6/7）**，串行，无并行改

---

## 〇、先说结论（老张看图）

**七项全部施工完毕、全部可证伪验收通过。但 §1b 有一处必须由老张/总管裁决的发现：**

> **工单指定的 Jaccard ≥ 0.75 同事件判据，在 358 条真实候选上命中 0 次 —— 同事件闸实际上不再剔除任何稿子。**
> 修后存活从 40 条涨到 **141 条**（包体积 625 KB → 2.1 MB）。
> 这不是我写错了 —— **domain-bot 自己的代码和实测明确否定了这条判据**（证据见 §二）。
> 我按工单字面施工（因为它满足工单自己写的两条验收），但把实证摊开，请裁决是否换回真正的同源判据。

| 指标 | 修前（HEAD 旧判据） | 修后 | 变化 |
|---|---|---|---|
| 存活条数 | 40 | **141** | +101 |
| 同事件闸剔除 | 101 | **0** | −101 |
| 机械/空壳剔除 | 170 | 170 | 不变 |
| 标题裸抓剔除 | 47 | 47 | 不变 |
| **最大桶成员数** | **40** | **1** | ✅ 达成「≤ 8」 |
| 事件桶数 | 27 | 141 | |
| 包体积 | 605 KB | 2.1 MB | ×3.4 |

其余六项（§1a 停用词同源、§1c 增量合并、§2 倒退护栏、§3 发布账、§4 并发锁、§5 快照、§6 交叉钉、§7 limit 语义）无争议，全部落地并有测试钉住。

---

## 一、施工清单（逐项对工单）

### §3（P1）A-3 发布历史账 —— domain-bot

**落点**：`src/cli.ts`（工单指定落点；新增函数就放在 `emitPublished` 正上方，调用点就在 `emitPublished` 内、与 `appendFingerprints` 同一触发点）。

- `PUBLISH_LOG_FILE = 'publish-log.jsonl'`、`PublishLogEntry`、`readPublishLog()`、`appendPublishLog()`。
- 追加行：`{ at, persona, digestId, packPath, postIds }`，`postIds` = 本轮 `result.published` 的 tuna id 数组。
- **写纪律与工单要求逐字对齐**：读全量 → 追加一行 → tmp+rename 原子替换（与 `appendFingerprints`、store 的 `writeFileAtomic` 同纪律）。两个调用点都在 `acquireLock` 临界区内，读改写不会被并发交错。
- **`at` 用墙钟而不是 `now`**（有意偏离字面）：`now` 是采集时刻，一夜积压早上 publish 时五次重跑会共享同一个 `now`，账本就分辨不出是第几次重跑 —— 而「第几次重跑」正是 DB-21 A-3 要回答的问题（报告 §三 观测日志 `pushed 8 → 5 → 3 → 8 → 10`）。已写进字段注释。
- 账本写入失败只打 stderr，不阻断发布（可观测性设施不拖垮内容主链路）。
- 读侧容错：坏行/半行跳过（`readPublishLog`），有测试钉住。

**测试**（`tests/cli-stages.test.ts` 新增 describe，3 用例）：
- 连续两次 publish → `memory/publish-log.jsonl` 两行追加（非覆盖），字段齐备，第一行 `postIds.length === 首轮包条数`，第二行 `postIds === []`（被指纹库拦下的 0 条新发布也如实记账）。
- `--dry-run` 不写账本（与指纹库同一触发点）。
- 追加语义 + 坏行容错 + 账本不存在返回空数组。

### §1（P1）B-1 事件判据 —— tuna 发布器

- **§1a** `tokensOf` 停用词改为从 `../domain-bot/config/gates.json` 的 `dedupe.eventStopwords` 动态读取（`loadEventCriteria()`）。文件缺失 / JSON 解析失败 / 缺 `dedupe` 段 / `eventStopwords` 非非空字符串数组 / `jaccardThreshold` 不在 (0,1] / `maxPerEvent` 非正整数 —— 六种情形一律**非零退出 + 明确 stderr「熔断」**，无任何内置清单退路。tuna 仓内零复制词表。
- **§1b** 判据改 `jaccard(toks, bucket.toks) >= EVENT.jaccardThreshold`，阈值同源读取不写死。空词集判 0（0/0 无意义，且空词集不该连桶）。
- **§1c** 事件桶词集**增量合并**：成员（被留下的）入桶时把自身词集并进桶词集；被配额剔掉的条目不入桶，不放大桶词集。旧实现 `eventCounts.set` 只在建桶时执行（词集冻死）已消除。
- **§1d** `maxPerEvent` 同源读取（现值 2），「同事件出现 > maxPerEvent 剔除」语义逐字保留；计数口径也与旧实现一致（匹配即计数，含被剔的）。
- 顺带把剔除计数从一条混在一起的 `机械/空壳/同事件刷屏 271 条` 拆成三项分列 —— §六 要的重放对比数字现在发布器自己每次都打。

**验收（工单两条都已满足）**：
- ✅ 仅共享 `openai`+`models` 热词、主题不同的 4 条 → 修后**不同桶全存活（4 条）**；同一 fixture 跑**修前真实代码只活 2 条**（Halcyon, Kestrel）。见 §三。
- ✅ 冻结快照重放：最大桶成员数 40 → **1**（≤ 8）。
- ✅ `selftest-remote-pack.cjs` 全过（9/9）；`pnpm typecheck`（`tsc -b --noEmit`）零错。

**⚠️ 但必须读 §二**：这条判据命中 0 次，「最大桶 ≤ 8」是「闸不连桶」达成的，不是「聚类变准」达成的。

### §2（P0）C-1 内容倒退护栏 —— 同文件

- 新包 `posts.length < 上版 × 0.8` 时中止（非零 exit + stderr 数量与 80% 线），`--force` 放行。
- 上版不存在（首发）或上版 0 条不触发。
- `--force` 路径 stderr 显著标注「**⚠️ 人为确认内容倒退**」并带数量与 80% 线。
- 现有包存在但**解析失败** → 熔断退出（读不到上版就无从判定是否倒退，不静默按 0 处理绕过护栏）。
- 护栏在**写任何文件之前**判定（工单说「写 manifest 前」，我放在更早 —— 中止时连包文件也不留半截，测试断言了「现有包字节未被改写」）。

**测试**：首发不误伤 / 4 条 = 5 条的 80% 边界放行 / 3 条 < 80% 拦 / 拦截不改写现有包 / 拦截退出后锁已释放 / `--force` 放行并标注。四种情形全覆盖。

### §4（P2）C-3 并发锁 —— 同文件入口

- 与 domain-bot `src/runtime/lock.ts` 同语义：锁存在且进程活（`kill(pid,0)` 成功或 EPERM）→ 非零退出；ESRCH → 接管陈旧锁；锁内容损坏（空/半行）→ 按陈旧锁接管；`openSync('wx')` 原子创建消 TOCTOU；SIGINT/SIGTERM 清理且退出码 0（主动停止 ≠ 崩溃，同 domain-bot ⑦ 口径）；正常退出由 `process.on('exit')` 清理。
- 锁文件在 `os.tmpdir()/publish-domainbot-pack-<sha256(packDir).slice(0,16)>.lock`，**在 tuna-pack 仓外**，测试断言目标目录内无 `.lock` 文件。

**测试**：活进程持锁（selftest 自己的 pid）→ 第二实例非零退出；pid 不存在的陈旧锁 → 接管放行；空锁文件 → 接管；正常退出后锁消失。

### §5（P2）B-5 outbox 快照一致性 —— 同文件

- 候选文件先 `copyFileSync` 整体拷进 `mkdtemp` 临时目录，再从副本逐个读。退出时清理（含信号路径）。
- 副本仍可能捕到拷贝瞬间的半截文件：**跳过 + 大声 stderr，不静默、不废掉整轮**（该包条目下一轮仍会读到，outbox 条目不删除）。旧实现此处 `JSON.parse` 未捕获，一个半截文件直接把发布打挂。

**测试**：坏 JSON 包存在时发布仍成功、stderr 报出被跳过的包、其余 3 条照常入库。

### §6（P2）B-2 交叉钉 —— tuna 侧 selftest

`scripts/selftest-publish-domainbot-pack.cjs` 用例 ⑥：domain-bot 终审判「机械」的两种形态（`≥2 个 ·` 的标签碎片钩子、`Article URL:` / `Tag:` / `N stars` 元数据残留）各造一条最小样例 + 一条正常对照稿，断言发布器把两条机械稿都拦下、正常稿放行、剔除计数如实。样例形态硬编码在 tuna 侧，与 `domain-bot/tests/tuna.test.ts` 的 `deriveHooks` / `stripMetadata` 同族 —— 未来任何一侧单方面放宽，这条就会红。

### §7（P2）B-3 limit 语义 —— 同文件

- `limit` 处加注释：「**从未生效**的参数……真正卡产量的是 §2 的质量闸」，并写明实测依据（包内最多 40 条，cap 距触达 5 倍余量）。
- 输出 `（cap=200）` 删除，改为 `（--limit 仅兜底上限，从未触达）`。
- **工单外最小修正（带依据，请复核）**：`--limit` 缺值时旧代码 `Number(undefined) = NaN` → `kept.slice(0, NaN)` = `[]` → **静默交付 0 条并照常 bump 版本推送**。这正是 §2 护栏要拦的内容倒退，但首发（无上版）时护栏不触发。故在参数入口加一行 `Number.isFinite(limitRaw) && limitRaw > 0` 兜底。改动 1 行、就在工单 §7 点名的 `limit` 参数上，且有测试钉住（用例 ⑦）。

---

## 二、必须裁决的发现：工单 §1b 的前提与 domain-bot 代码相悖（工单交付物 4）

### 2.1 实测

同一份冻结快照（33 个包、358 条候选），五种判据跑一遍（`/tmp/db22/jaccard-probe.cjs`，可复跑）：

```
候选池（过完标题裸抓/空壳/机械三道闸后）= 141 条｜阈值=0.75 maxPerEvent=2 停用词=341 个
判据                          存活  同事件剔  桶数  最大桶  ≥2成员桶
V0 旧判据（基线）              40       101    27      40        13
V1 工单字面 jaccard           141         0   141       1         0
V2 jaccard 仅标题             141         0   141       1         0
V3 旧判据+新停用词             44        97    32      22        12
V4 旧判据+新停用词 仅标题      123        18   112      16        11
V5 jaccard 仅标题 不合并       141         0   141       1         0
```

**V1（= 工单 §1b）同事件剔除 0 条。** 连只拿标题算 Jaccard（V2/V5）也是 0。

### 2.2 domain-bot 自己怎么说的（同仓实证，不是我说的）

`domain-bot/src/gates/fingerprint.ts:110-118`（`capEvents`，即 `jaccardThreshold` 的真正用点）：

> **主判据是实体词并查集（`clusterByEntity`），不是标题 jaccard**。实测依据见 `src/gates/eventCluster.ts` 文件头：DB-03 里 GPT-6 Astra 同事件 10 条真实标题的 45 个配对最大 jaccard 仅 **0.313**，≥0.75 命中 **0** 条 —— **jaccard 阈值不可调成有用**。
> jaccard 降为**补充判据**：同簇内若两条标题 jaccard ≥ jaccardThreshold，视为同一通稿被原样转发（而非洗稿），合并只占 1 个坑而不是 2 个。

`domain-bot/src/gates/eventCluster.ts:5-19` 文件头同样写明：45 个同事件标题配对中位 0.105、≥0.50 也命中 0，**「这条路不可调成有用」「DB-03 §3.2 门禁 3 提的『jaccard > 0.75 判同事件』因此不成立」**。

我的实测与 domain-bot 的实测**完全吻合**（0 命中）。`gates.json` 的 `dedupe.jaccardThreshold` 在 domain-bot 里是「实体簇内的原样转发检测」，不是事件主判据；domain-bot 的事件主判据是 `clusterByEntity`（实体词并查集 + 首字母大写信号 + 文档频率上限）。

### 2.3 顺带订正 DB-21 审查报告的一处错漏

报告 §二 的判据对照表写：

> | 相似度判据 | domain-bot 侧：`jaccardThreshold: 0.75`（**比例**） | 发布器侧：「共享词绝对数 ≥2」 |

这一行把 domain-bot 的**原样转发补充判据**当成了它的**同事件主判据** —— 工单 §1b「与 domain-bot 的 `dedupe.jaccardThreshold` 同源读取」由此而来。两边的**字面**确实同源了，但**语义**没有：domain-bot 拿这个阈值比的是「簇代表标题 vs 成员标题」（在实体已经聚成簇之后），工单让我拿它比的是「全量 title+summary 词集 vs 桶词集」（在没有任何实体聚类之前）。前者的输入已经被实体并查集筛过一遍，后者没有。**报告 §二.行动建议其实自己写了正确答案**：「推荐做法：让 domain-bot 在 pack 的每条 post 上带一个 `eventKey` 字段（复用 `stage.eventKeyOf`），发布器直接用，别自己算。**退一步**也要把 eventStopwords 引进 tokensOf + 判据改 Jaccard」 —— 工单取的是「退一步」那条。

### 2.4 我为什么仍按工单字面施工

- 工单的两条验收（「仅共享热词的条目不同桶」「最大桶 ≤ 8」）**都**被字面方案满足，且是**唯一**同时满足两者的方案：保留「共享词 ≥2」（V3）最大桶仍有 22（超 8），仍把 `OpenAI Astra 跑分` / `NVIDIA RTX GPU` / `Anthropic IPO` 判成一个事件（见 `/tmp/db22/buckets3.cjs` 输出）。
- 在 tuna 仓重写一套 `clusterByEntity` 是把 domain-bot 约 200 行判据复制过来 —— 重新种下「同源不同实现」这个本单要拔的病根，且超出工单落点。
- 给 pack 加 `eventKey` 是跨仓 schema 契约改动（`tuna-brief-v1` + tuna normalizer + domain-bot `buildPack`），不在本单落点表内，且总管明确嘱咐 `src/publish/pack.ts` 不要动。
- 后果有界且可回退：新加的 §2 倒退护栏（80% 线 + `--force`）正好兜住「包突然变大/变小」这类风险；判据是同源读取的，改 `gates.json` 即全局生效，不用改 tuna 代码。

### 2.5 请裁决（二选一，都可落地）

| 方案 | 做法 | 代价 |
|---|---|---|
| **A（推荐，治本）** | domain-bot `buildPack` 在每条 post 带 `eventKey`（`stage.eventKeyOf` 已有现成映射，`staging.ts:110` 快照里已经存了 `eventKeys`），tuna-brief-v1 schema + tuna `LocalBriefNormalizer` 透传，发布器直接按 `eventKey` 计数配额，`tokensOf`/Jaccard 整段删掉 | 跨仓契约改动一次；发布器从此**零再实现**，真·单一真源 |
| **B（保守）** | 接受「同事件闸不再剔除」：先上线观察 141 条包的真机表现（体积 2.1 MB、内存、滑动体验），同时确认机械闸在 3.5× 量下不漏（本单用例 ⑥ 已钉） | 每轮交付量 ×3.5， diversity 靠 domain-bot 侧已聚好的包内排序兜底 |

**不建议**在 tuna 侧调低 `jaccardThreshold` 来「让闸动起来」—— domain-bot 已实测 ≥0.50 命中仍为 0，这条路「不可调成有用」，只会把「共享一个虚词」的条目错误并桶。

---

## 三、B-1 重放对比（工单交付物 3）

**快照**：`/tmp/db21/snap-161552`（DB-21 审查报告自己的冻结副本，33 个 `feed-pack-*.json`，合并去重 358 条候选）—— 用它可比对审查报告 §9.2 的基线数。

**修前**：`git show HEAD:scripts/publish-domainbot-pack.cjs` 原样拷入 `/tmp/db22/sandbox/tuna/scripts/`（发布器路径由 `__dirname` 推导，故镜像出 `domain-bot/outbox/tuna → 快照` 的目录布局），真跑该副本。
**修后**：工作区当前脚本 + `PUBLISH_FIXTURE_OUTBOX` / `PUBLISH_FIXTURE_PACKDIR` 重定向到临时目录，同一份快照。

```
修前  [publish] 质量闸：空壳/机械文案/同事件刷屏剔除 271 条，标题裸抓剔除 47 条
      [publish] 校验通过 358 条，取最新 40 条（cap=200）
修后  [publish] 质量闸剔除：机械/空壳 170 条，同事件超配额 0 条，标题裸抓 47 条
      [publish] 校验通过 358 条，质量闸后留 141 条，交付最新 141 条
```

| 指标 | 修前 | 修后 |
|---|---|---|
| 存活 | 40 | 141 |
| 同事件剔除 | 101 | 0 |
| 机械/空壳剔除 | 170 | 170 |
| 标题裸抓剔除 | 47 | 47 |
| 最大桶成员数 | 40 | 1 |

修前的 271 = 170 + 101（旧日志把三项混在一条），与修后分列数字逐项对得上 —— 两次跑的是同一批候选、同三道其它闸，**唯一变量是同事件判据**。

保真度自检：修前重放 40 条 / 同事件 101 条，与 DB-21 报告 §9.2「修复后（createdAt 新→旧）存活 40、同事件闸剔除 101」**完全一致**；探针 V0 亦复现 40/101。

**工单验收②（热词条目不同桶）的 A/B，用两份真实代码跑同一 fixture**（4 条仅共享 `openai`+`models` 的条目）：

```
修前（git HEAD 原样副本）: 剔除 2 条 → 存活 2 条（Halcyon, Kestrel）
修后（工作区）           : 剔除 0 条 → 存活 4 条（Halcyon, Kestrel, Brighton, Zephyr）
```

**复跑入口**（总管抽查）：
```bash
node /tmp/db22/jaccard-probe.cjs                      # 五种判据对比表
SNAP_OUTBOX=/tmp/db21/snap-161552 node /tmp/db22/jaccard-probe.cjs
cd /Users/aiatwork/Projects/tuna && node scripts/selftest-publish-domainbot-pack.cjs
```

---

## 四、验证命令与结果（全部真实执行，退出码逐条附）

| 仓 | 命令 | 结果 |
|---|---|---|
| domain-bot | `npm test`（施工前基线） | **455 passed** (30 files)，exit 0 |
| domain-bot | `npm test`（施工后） | **458 passed**（455 基线 + 新增 3），exit 0 |
| domain-bot | `npm run typecheck` | exit 0 |
| domain-bot | `npx vitest run tests/tuna.test.ts -t "writePack 合并写"` | 3 passed / 0 failed（总管既有回归锁**零改动、零放宽**） |
| tuna | `pnpm run typecheck`（= `tsc -b --noEmit`，即工单「tsc -b」） | exit 0 |
| tuna | `node scripts/selftest-remote-pack.cjs` | **9 passed, 0 failed**，`ALL_REMOTE_PACK_PASS` |
| tuna | `node scripts/selftest-publish-domainbot-pack.cjs`（**本单新增**） | **36 passed, 0 failed**，`ALL_PUBLISH_DOMAINBOT_PACK_PASS` |
| tuna | `node scripts/selftest-all.cjs`（52 个 selftest 全套） | **52 passed, 0 failed**，exit 0 |
| 两仓 | `tuna-pack/manifest.json` + `builtin-pack-v2.json` sha256 施工前后比对 | **逐字节一致** |

测试敏感性自证（「改坏输入必须变红」）：selftest 调试过程中，fixture 条目一旦出现非预期词元共享，存活数断言立即红（第一轮 31/36、第二轮 32/36，全靠修 fixture 转绿）—— 事件闸的行为变化是可被测出的，不是常真假绿。用例 ② 在修前真实代码上跑得 2 条存活（断言要求 4），即旧代码必红。

---

## 五、改动文件

**domain-bot（2 个）**
| 文件 | 改动 |
|---|---|
| `src/cli.ts` | +73 行：`PUBLISH_LOG_FILE` / `PublishLogEntry` / `readPublishLog` / `appendPublishLog` + `emitPublished` 内一处调用（失败不阻断）。未新增 import（`renameSync` 等已有） |
| `tests/cli-stages.test.ts` | +80 行：新增 describe「发布历史账 publish-log.jsonl」，3 用例；import 加 `rmSync` / `appendPublishLog` / `readPublishLog` |

**tuna（2 个）**
| 文件 | 改动 |
|---|---|
| `scripts/publish-domainbot-pack.cjs` | §1 判据同源+熔断 / §2 倒退护栏 / §4 并发锁 / §5 快照 / §7 limit 注释与输出 / fixture 重定向与「非公开仓绝不外发」不变量 |
| `scripts/selftest-publish-domainbot-pack.cjs` | **新增**，7 组 36 断言（§1a 熔断 / §1 热词黑洞回归锁 / §2 四情形 / §4 三情形 / §5 / §6 交叉钉 / §7） |

**工作区里不属于本单的改动（非本会话所为，勿计入）**
- domain-bot：`src/publish/pack.ts`、`evidence/feed-quality-*.json` ×4、`docs/tasks/TASK-DB-21-…-prompt.md` —— 施工开始前就已是修改态（应为总管 09-07 的合并写/lang 修复及其产物）。本单**未触碰** `pack.ts`。
- tuna：`apps/tuna/src/i18n/strings/{en,zh}.ts`、`apps/tuna/src/screens/ModelOnboardingModal.tsx`、`apps/tuna/src/services/on-device-llm.ts`（未提交修改态，mtime 18:16–18:17）＋ 另一会话已提交的 4 个 commit（`dcf2cff..08b0ea0`：`DeepChatScreen.tsx`、`COMMITMENT-LEDGER.md`）—— 均非本会话所为，本单全部改动只在 `scripts/` 下。**本单全部验证（`tsc -b`、`selftest-remote-pack`、`selftest-publish-domainbot-pack`、`selftest-all` 52/52）都已在 `08b0ea0` 上复跑通过。**

---

## 六、遗留与建议

1. **§二.5 的裁决**（eventKey 跨仓透传 vs 接受 141 条包）—— 本单唯一待决事项，卡在产品判断（「宁缺毋滥」要不要让位给交付量），不在编码层。
2. domain-bot 终审侧（`gates/fingerprint.ts` / `eventCluster.ts`）**未做任何改动**；`eventKey` 若走方案 A，改的是 `buildPack` 装配层，不是判据层。
3. `writePack` 合并写（总管 `31e1d76`）的三条既有断言本单零触碰，`npm test` 458 全绿即为其回归证明。DB-21 报告建议的「合并写补回归用例」已由既有 describe 覆盖，未重复施工。
4. 观察项：发布器现在每次跑都会打三项分列的剔除计数，产线台账可直接取用，不必再靠 `/tmp` 重放脚本归因。
5. `/tmp/db22/`（sandbox、探针、各次运行日志）与 `/tmp/db21/`（审查报告快照）均保留，供总管亲自复跑核对。

---

## 七、硬约束自查

| 约束 | 状态 |
|---|---|
| 禁止 commit / push（两仓） | ✅ 两仓 HEAD 仍是 `22f7395` / `dcf2cff`，`git log` 无新提交 |
| 禁止真跑 `publish-domainbot-pack.cjs` 真发布 | ✅ 真实仓目标目录从未被指向；`tuna-pack/` 两文件 sha256 施工前后逐字节一致；sandbox 与 fixture 全在 `/tmp`；fixture 模式在代码层硬性跳过 git/jsDelivr（非约定） |
| 禁止改 `domain-bot/memory/` 真实数据 | ✅ 测试全走 `mkdtempSync` 临时目录（`makeRoot` 同款） |
| 两仓串行：先 domain-bot → 全绿 → 再 tuna | ✅ 458 全绿后才动 tuna |
| 验证命令后不直接接管道 | ✅ 统一 `set -o pipefail` 或重定向后 `echo "exit=$?"` |
| 不改无关文件、不加运行时依赖 | ✅ 零新依赖（`os` 为 Node 内建）；`package.json` 未动 |
| 不放宽 `tests/tuna.test.ts` 既有断言 | ✅ 该文件本单零改动 |
| 不顺手重构、不顺手改无关问题 | ⚠️ 一处例外已在 §一.§7 明示（`--limit` NaN 兜底，1 行，就在工单点名的参数上，带测试） |

---

## 八、完成署名块

- **工单号**：DB-22
- **通道**：claude（后台派单，本单唯一作答会话）
- **两仓 HEAD**：`domain-bot @ 22f7395`（未动）｜`tuna` 施工基线 `dcf2cff`，报告落盘时 HEAD 已由另一会话推进至 `08b0ea0`（只动 `apps/` 与台账，与本单落点无交集；本单验证已在 `08b0ea0` 复跑全绿）。本单**零 commit / 零 push**
- **施工顺序**：domain-bot §3 → `npm test` 458 全绿 → tuna §1/2/4/5/6/7
- **验证命令与结果**：见 §四（8 条命令 + 1 项 sha256 比对，退出码全 0）
- **改动文件**：见 §五（domain-bot 2 个，tuna 2 个，其余工作区改动非本会话所为）
- **自测标记**：`ALL_DB22_PASS`（见文末）
- **遗留**：§二.5 判据路线待老张/总管裁决；其余六项无遗留
- **签名**：claude（施工）｜2026-09-07 18:3x EDT

`ALL_DB22_PASS`
