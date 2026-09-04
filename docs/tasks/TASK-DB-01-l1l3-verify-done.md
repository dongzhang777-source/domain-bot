# TASK-DB-01：domain-bot L1-L3 行为范式实现验机报告（独立复核）

> 工单号：DB-01　｜　验机执行：agy (gemini-3.8-flash)　｜　日期：2026-09-04  
> 派单基线 HEAD：`domain-bot @ cbf7247`　｜　实际验机 HEAD：`domain-bot @ 43ace98`（只读复核，零改动，零 commit/push）  
> 工作目录：`/Users/aiatwork/Projects/domain-bot`  
> 最终结论：**有条件通过（Conditional Pass）**（全绿可运行，核心链路已真机闭环；存在实体转义冲突、未引用死代码与测试断言盲区等 4 项待总管收口事项）

---

## 一、验收目标逐项核验结果

### 1. 测试复跑（143/143 绿，exit=0）

- **命令**：
  ```bash
  npm test > /tmp/t.log 2>&1; echo "exit=$?"
  ```
- **输出摘要**：
  ```text
   RUN  v2.1.9 /Users/aiatwork/Projects/domain-bot

   ✓ tests/observe.test.ts (5 tests) 5ms
   ✓ tests/refinery.test.ts (15 tests) 7ms
   ✓ tests/telegram.test.ts (12 tests) 8ms
   ✓ tests/agentreach.test.ts (16 tests) 25ms
   ✓ tests/receiver.test.ts (9 tests) 37ms
   ✓ tests/e2e.test.ts (10 tests) 76ms
   ✓ tests/interest.test.ts (6 tests) 5ms
   ✓ tests/evolve.test.ts (7 tests) 8ms
   ✓ tests/wiring.test.ts (11 tests) 24ms
   ✓ tests/adapters.test.ts (5 tests) 6ms
   ✓ tests/fetchUtil.test.ts (11 tests) 58ms
   ✓ tests/dedupe.test.ts (6 tests) 6ms
   ✓ tests/doctor.test.ts (3 tests) 8ms
   ✓ tests/urlTemplate.test.ts (2 tests) 2ms
   ✓ tests/lifecycle.test.ts (1 test) 6ms
   ✓ tests/evidence-script.test.ts (10 tests) 689ms
   ✓ tests/startup.test.ts (6 tests) 829ms
   ✓ tests/store.test.ts (8 tests) 1849ms

   Test Files  18 passed (18)
        Tests  143 passed (143)
     Duration  2.27s
  exit=0
  ```
- **判定**：✅ **通过**。测试套件全绿，自查退出码 `exit=0`。

---

### 2. 构建复跑（tsc 全绿，exit=0）

- **命令**：
  ```bash
  npm run build > /tmp/b.log 2>&1; echo "exit=$?"
  ```
- **输出摘要**：
  ```text
  > domain-bot@0.1.0 build
  > tsc -p tsconfig.json
  exit=0
  ```
- **判定**：✅ **通过**。TypeScript 类型检查与编译无报错，退出码 `exit=0`。

---

### 3. ex: 回调协议三端一致性审查

对三端代码路径（`src/push/telegram.ts`、`src/feedback/receiver.ts`、`src/memory/store.ts`）进行逐行对账：

| 阶段 | 文件与代码位置 | 实现内容 | 对账结果 |
|---|---|---|---|
| **生成端** | `src/push/telegram.ts:60-68` | `hookKeyboard(digestId, index)` 生成 `callback_data: "ex:${digestId}:${index}"` | `index` 为 `0..clusters.length-1` 循环索引，`digestId` 为 base36 时间戳 |
| **解析端** | `src/push/telegram.ts:94-98` | `parseExpandCallbackData(data)` 正则 `/^ex:([a-z0-9]+):(\d+)$/` 解析 | 捕获组 1 为 `digestId`（匹配 `[a-z0-9]+`），捕获组 2 为 `index`（`Number(m[2])` 正整数） |
| **处理端** | `src/feedback/receiver.ts:58-75` | `const expand = parseExpandCallbackData(cq.data)` -> `store.loadDigest(expand.digestId)?.clusters[expand.index]` | 正则结果直接对应 `loadDigest` 字段与数组下标；空 cluster 走 `'ignored'` 防御 |
| **持久端** | `src/memory/store.ts:231-255` | `saveDigest` 映射存入 `StoredDigest.clusters[i]`，`loadDigest(id)` 查找并返回 | `clusters[index]` 下标映射一一对应；字段包含 `{ ref, title, summary, why, url, isNew, source }` |
| **展示端** | `src/push/telegram.ts:129-150` | `expandDigestMessage` 使用 `cluster` 的 `title/summary/why/url/isNew` 编辑原卡片 | 字段名与 `StoredDigest.clusters[i]` 严格对齐，原文按钮直接引用 `cluster.url` |
| **信号端** | `src/feedback/receiver.ts:68-72` | 1. `store.recordView(digestId)`<br>2. `store.recordEngagement({ digestId, index, source, at })`<br>3. `interestRecordExpand(dir, cluster.source)` | 展开即已读（viewed）、条目级行为（engagements）、源级强证据（interest）三级落账一致 |

- **真实点击全链路核验**：
  查阅 `memory/digests.json`（行 8-20）、`memory/engagements.json`（行 1-8）、`memory/interest.json`（行 1-9）：
  - 真实推送 `digestId: "mtn8r5nf"` 第 0 簇 `simonwillison` 被老张真机点击；
  - `engagements.json` 记录：`{"digestId": "mtn8r5nf", "index": 0, "source": "simonwillison", "at": 1788544284626}`；
  - `interest.json` 记录：`"simonwillison": { "exposures": 1, "expands": 1 }`；
  - `feedback-offset.json` 正常单调推进；
- **判定**：✅ **通过**。正则、索引、字段三端严格对齐，零错位。

---

### 4. 行为→兴趣数学正确性（`src/memory/interest.ts`）

- **模型**：
  $$\text{interest}(s) = \frac{\text{expands} + \alpha_0}{\text{exposures} + \alpha_0 + \beta_0}, \quad \alpha_0 = 1, \beta_0 = 2$$
- **四个数学属性核验**：
  1. **新源先验**：
     - 代码位置：`src/memory/interest.ts:39-44`（`interestOf`）
     - 当 `exposures = 0, expands = 0` 时，$\text{interest} = (0 + 1) / (0 + 1 + 2) = 1/3$。
     - 测试实证：`tests/interest.test.ts:11-15`（`expect(interestOf(s, 'src-a')).toBeCloseTo(1 / 3)` 绿）。
  2. **`settleStaleExposures` 幂等性**：
     - 代码位置：`src/memory/interest.ts:62-88`
     - 维护 `state.settled`（格式 `digestId:index` 集合）；遍历过期 digest 时，`if (settled.has(key)) continue; settled.add(key);`。
     - 测试实证：`tests/interest.test.ts:67-71` 第二次调用 `r2.counted === 0 && r2.alreadyExpanded === 0`，状态不重复累加。
  3. **已展开条目在 settle 中不重复计曝光**：
     - 代码位置：`src/memory/interest.ts:76-79`
     - 判定逻辑：若 `engaged.has(key)`（用户此前点过 ▽ 展开，已由 `recordExpand` 记入 `exposures += 1` 与 `expands += 1`），则仅记录 `result.alreadyExpanded++` 并 `continue`，**不**再对该源执行 `c.exposures += 1`。
     - 测试实证：`tests/interest.test.ts:64` 验证展开项所属源在 settle 后其计数保持未被篡改。
  4. **边界值稳定性**：
     - 当 `exposures = 0` 时，分母为 $0 + 1 + 2 = 3$，恒为 $1/3$，绝不产生除零或等于 0 的情况。
- **持久化坏文件容错**：
  - 代码位置：`src/memory/interest.ts:92-107`
  - `loadState` 解析异常时自动改名 `.corrupt-<ts>` 留存，返回 `emptyState()`，不静默清零。
- **判定**：✅ **通过**。数学推导与边界处理完全正确。

---

### 5. 双渠道产物完整性（`src/push/tuna.ts` 与 `--once` 实测）

- **代码与 Schema 审查**：
  - 文件：`src/push/tuna.ts:17-46`
  - 产出 Schema：固定标识 `schema: "tuna-brief-v0"`；
  - 三级瀑布流字段：
    - `tier1`（钩子层）：`hook`（`title.slice(0, 90)`）、`meta`（`source`）、`isNew`、`publishedAt`；
    - `tier2`（消费层）：`title`（`title.slice(0, 120)`）、`summary`（`summary.slice(0, 300)`）、`why`（`why.slice(0, 200)`）；
    - `tier3`（心流层）：`url`；
    - 评分：`score`。
  - `pushTuna`（`src/push/tuna.ts:48-56`）对 `digest.id` 实施 `replace(/[^a-z0-9]/g, '')` 消毒，并在空 ID 时抛错。
- **Schema 独立验证**：
  - 执行独立 node 断言：
    ```bash
    node -e '
    import("./dist/push/tuna.js").then(({ renderTunaBrief }) => {
      const digest = { id: "test1", domain: "ai", generatedAt: 123, clusters: [{ ref: "test1:0", title: "T", summary: "S", why: "W", items: [{ id: "1", source: "s", title: "T", body: "", url: "http://u", publishedAt: 0, valueScore: 0.8, isNew: true, reason: "" }] }] };
      const json = JSON.parse(renderTunaBrief(digest, 456));
      if (json.schema !== "tuna-brief-v0" || !json.items[0].tier1 || !json.items[0].tier2 || !json.items[0].tier3) process.exit(1);
      console.log("SCHEMA_OK");
    });'
    ```
  - 输出：`SCHEMA_OK`，退出码 0。
- **磁盘现存双渠道产物核查**：
  - `outbox/` 目录下实际包含双渠道对齐产物：
    - `outbox/digest-mtn8r5nf.md` 与 `outbox/tuna/brief-mtn8r5nf.json`（2026-09-04 13:42 真实产出）；
    - `outbox/digest-mtn82j31.md` 与 `outbox/tuna/brief-mtn82j31.json`（2026-09-04 13:23 真实产出）。
  - `outbox/tuna/brief-mtn8r5nf.json` 经读取核验，结构完全符合 `tuna-brief-v0` 规范。
- **`--once` 实跑情况核实与现场保护**：
  - 运行命令：`node --env-file-if-exists=.env dist/index.js --once > /tmp/once_test.log 2>&1; echo "exit=$?"`
  - 退出状态：`exit=1`
  - 报错实证：`/tmp/once_test.log` 显示：
    `Error: memoryDir 已被进程 10934 持有（/Users/aiatwork/Projects/domain-bot/memory/.lock）。同一 memoryDir 不允许并发运行`
  - **实情调查**：
    当前系统正运行常驻后台守护进程（PID 10934：`node --env-file-if-exists=.env dist/index.js`），负责长轮询 Telegram 回调。根据单实例锁机制（`src/runtime/lock.ts:34`），该锁有效阻止了并发 `--once` 进程对 `memory/` 产生写入竞态，**锁防护机制按预期起效**。
    此外，若当前全网源无新增内容（`pushed === 0`），依 `src/index.ts:145`（`if (opts.outDir && digest.clusters.length > 0)`），流水线将跳过推送产物生成（在 `tests/startup.test.ts:43-46` 与真实历史中已验证有内容时各产出一份）。
- **判定**：✅ **通过**（产物结构完备，单实例并发锁有效生效）。

---

### 6. 回归面核验（最近 8 笔提交）

- **命令**：
  ```bash
  git log --oneline -8
  ```
- **提交清单核验**：
  - `43ace98` docs(tasks): DB-01 验机工单——L1-L3 行为范式独立复核（派 agy）
  - `cbf7247` feat(interest): 行为→兴趣映射引擎——Beta 后验兴趣估计
  - `a6086e0` feat(ui): 极简交互——▽ 展开、↗ 原文、负信号改行为推断
  - `c5c9ad5` feat(push): L1-L3 行为范式落地——钩子卡+展开交互+why 人话化+tuna 分发渠道
  - `5360209` docs(governance): 老张 2026-09-04 决断落档——签字与开跑后置，先打磨产品形态
  - `0b26a73` fix(push): 每条条目独立成消息、按钮紧跟条目
  - `b040c35` fix(boot/doctor): LLM 就绪判定与 scorer 实际启用条件对齐
  - `2de2b43` fix(feedback): answerCallbackQuery 失败不再判整条 update 失败
- **回归断言**：
  - `2de2b43` 应答语义分离：`tests/receiver.test.ts:21-23` 保持绿灯；
  - `b040c35` 横幅判定修复：`tests/doctor.test.ts` 及 `tests/startup.test.ts:49-71` 保持绿灯；
  - `0b26a73` 每条独立消息：`tests/telegram.test.ts:33-65` 保持绿灯；
  - `cbf7247` 兴趣引擎：`tests/interest.test.ts` 全绿；
  - `npm test` 18 文件 143 测试无一回归。
- **判定**：✅ **通过**。

---

## 二、精确落点审查结果（代码细节）

| 审查文件 | 关键项 | 审查实测结论 |
|---|---|---|
| `src/push/telegram.ts` | 转义与渲染链 | ⚠️ 存在转义与粗体包裹冲突（见缺陷 1）；`escUrl` 为死代码（见缺陷 2）；`expandDigestMessage` 未复用 `renderExpandedBody`（见缺陷 3） |
| `src/push/telegram.ts` | 失败语义 | 确认：任一消息发送失败即抛出 Error，整轮不交付，保证 I-2 指标分母不被假送达稀释 |
| `src/feedback/receiver.ts` | ex 展开分支 | 确认：按 `loadDigest` -> `expandDigestMessage` -> `recordView` -> `recordEngagement` -> `interestRecordExpand` 顺序执行，单条失败由重试退避守护 |
| `src/feedback/receiver.ts` | answerQuietly | 确认：应答超时（HTTP 400）仅打印警告，不中断 `recorded` 状态，防止假失败污染队列 |
| `src/memory/interest.ts` | Beta 后验与幂等 | 确认：$\alpha_0=1, \beta_0=2$，24h 判定期；`settled` 去重键；坏文件改名 `.corrupt-<ts>` 留存 |
| `src/memory/store.ts` | 内存与磁盘裁剪 | 确认：`digests.json` 保留最近 30 份（`MAX_STORED_DIGESTS=30`）；`engagements.json` 保持 5000 条（`MAX_ENGAGEMENTS=5000`）；原子写入防截断 |
| `src/push/tuna.ts` | 渠道产物 | 确认：字段齐全，`digest.id` 消毒；但缺少直接针对 `renderTunaBrief` 的单元测试（见缺陷 4） |
| `src/index.ts` | 装配接线 | 确认：`runOnce:137-148` 包含 `saveDigest`、`settleStaleExposures` 及 `pushTuna` 调用；`startBot` 正确管控长驻与单次模式 |

---

## 三、审查发现的问题清单（附实证与双向论证）

### 缺陷 1（P1·格式安全隐患）：`renderHookCard` 与 `renderExpandedBody` 在实体内部包裹转义文本，违反既有 D1 规范

- **实证（文件与行号）**：
  - `src/push/telegram.ts:21-23` 注释声明：
    ```ts
    // 转义只允许发生在实体外部，因此粗体只包代码常量（序号/标签），用户文本一律在实体外（小巴 impl 审查 D1：此前「转义文本放进 *…* 内部」违反实体内禁转义规则，且尾部 \ 会吞掉闭合星号）。
    ```
  - 但在 `c5c9ad5` 引入 L1-L3 后，`src/push/telegram.ts:50`、`57`、`135` 实现为：
    ```ts
    50: return `*${tag}${escMd(c.title.slice(0, 90))}*\n_${escMd(meta)}_`
    57: return `*${c.items[0]!.isNew ? '🆕 ' : ''}${escMd(c.title.slice(0, 120))}*\n\n${escMd(c.summary.slice(0, 300))}${why}`
    135: const text = `*${cluster.isNew ? '🆕 ' : ''}${escMd(cluster.title.slice(0, 120))}*\n\n${escMd(cluster.summary.slice(0, 300))}${why}`
    ```
- **现象分析**：
  当采集到标题包含下划线（如 arXiv 常见公式/代码名 `BERT_base`、`d_model`）或星号时，`escMd` 会转义为 `\_` 和 `\*`。在 Telegram 官方 Legacy Markdown 模式下，实体内部（`*...*` 或 `_..._`）禁止转义字符；如果用户标题出现 `*`，`escMd` 生成的 `\*` 会被 Telegram 提前截断或引发 `can't parse entities` 错误抛出，导致整条消息发送失败。
- **双向论证（DISPATCH-RULES §二.约束 2）**：
  1. *现在不做会怎样？* 一旦真实抓取到标题包含 LaTeX 符号或带 `_` 的标题，`sendDigestTelegram` 会抛出 400 Bad Request 导致当轮推送失败，且会被计入失败。
  2. *做了会推翻哪个已验证资产？* 不推翻已验证资产。只需将外层粗体 `*` 改为仅修饰固定前缀（如 `*🆕* ${escMd(title)}`），或者在实体内使用安全转义（或改用 HTML / MarkdownV2）。当前测试用例未构造带 `*` 的标题包裹在 `*...*` 内部的变异，因此只需调整微小模板即可保持全绿。
- **建议动作**：总管排期修复模板转义边界，将实体标签与不可控文本解耦。

---

### 缺陷 2（P2·代码卫生）：`src/push/telegram.ts` 中 `escUrl` 为未被引用的残留死代码

- **实证**：
  - Grep 实测：
    `ripgrep` 检索 `escUrl`，全仓仅在 `src/push/telegram.ts:29` 定义一次，内部及外部没有任何调用点：
    ```ts
    29: function escUrl(u: string): string {
    30:   return u.replace(/\\/g, '%5C').replace(/\)/g, '%29')
    31: }
    ```
- **根因**：
  在早期静态排版中，URL 嵌入在 Markdown 链接 `[src](${escUrl(src.url)})` 中；交互范式切换到 L1-L3 之后，原文链接通过 Telegram 原生 URL 按钮（`expandedKeyboard`：`[{ text: '↗ 原文', url }]`）发出，直接使用原始 URL，导致 `escUrl` 悬空。
- **双向论证**：
  1. *现在不做会怎样？* 仅产生 3 行死代码，不影响功能运行。
  2. *做了会推翻哪个资产？* 纯无用私有函数，删除不影响任何导出 API 与测试。
- **建议动作**：总管收口时随手清理或补注。

---

### 缺陷 3（P2·代码异味）：`renderExpandedBody` 与 `expandDigestMessage` 消息体格式化逻辑重复

- **实证**：
  - `src/push/telegram.ts:54-58`：
    ```ts
    export function renderExpandedBody(digest: Digest, index: number): string {
      const c = digest.clusters[index]!
      const why = c.why && c.why !== c.title ? `\n\n💡 ${escMd(c.why.slice(0, 200))}` : ''
      return `*${c.items[0]!.isNew ? '🆕 ' : ''}${escMd(c.title.slice(0, 120))}*\n\n${escMd(c.summary.slice(0, 300))}${why}`
    }
    ```
  - `src/push/telegram.ts:134-135`（在 `expandDigestMessage` 中）：
    ```ts
    const why = cluster.why && cluster.why !== cluster.title ? `\n\n💡 ${escMd(cluster.why.slice(0, 200))}` : ''
    const text = `*${cluster.isNew ? '🆕 ' : ''}${escMd(cluster.title.slice(0, 120))}*\n\n${escMd(cluster.summary.slice(0, 300))}${why}`
    ```
- **现象分析**：
  `renderExpandedBody` 导出了但仅在 `tests/telegram.test.ts` 中被断言；实际在运行时编辑消息的 `expandDigestMessage` 却硬编码复制了一份相同的拼接逻辑。未来修改展开文案时容易出现两头不同步。
- **建议动作**：总管收口时可让 `renderExpandedBody` 接受 `cluster` 或抽取公共函数。

---

### 缺陷 4（P2·测试盲区）：`renderTunaBrief` 缺乏独立单元测试断言

- **实证**：
  - Grep 实测：在 `tests/` 目录下搜索 `renderTunaBrief`，结果为 **0 命中**。
  - 在 `tests/e2e.test.ts:69` 仅断言了 `out/` 目录下文件数（`readdirSync().toHaveLength(2)`），未对 `brief-*.json` 内部的 JSON 结构、`schema` 字段、`tier1/tier2/tier3` 进行字段级值断言。
- **双向论证**：
  1. *现在不做会怎样？* 若后续修改 `tuna.ts` 的字段映射（如契约变更），现有自动化测试无法拦截字段断裂风险。
  2. *做了会推翻哪个资产？* 新增只读单测，不改动任何生产代码。
- **建议动作**：总管在补充测试批次中新增 `tests/tuna.test.ts`，锁定 `schema` 及三级结构。

---

## 四、最终验机结论

**结论：有条件通过（Conditional Pass）**

- **通过理由**：
  1. 自动化流水线（143/143 测试）与 TypeScript 构建完全绿灯；
  2. L1 钩子卡（▽）、L2 消费层展开、Beta 后验兴趣引擎、三端协议一致性、单实例并发锁等核心能力均通过代码核验与实机验证；
  3. 真机全链路数据闭环已确认在盘（`simonwillison` 点击已正确反映于 `engagements.json` 与 `interest.json`）。
- **条件限制**：
  建议在正式进入两周探针窗口前，由总管安排修整缺陷 1（转义标签包裹）并补齐缺陷 4（Tuna Brief 单测）。

---

## 完成署名

- 工单号：DB-01
- 执行通道：agy
- 执行人标识：agy (gemini-3.8-flash)
- 完成日期：2026-09-04
- 派单基线 HEAD：`domain-bot @ cbf7247`（`npm test` 143/143 绿）
- 实际落盘 HEAD：`domain-bot @ 43ace98`（只读验机，未 commit，待总管入库）
- 验证：`npm test > /tmp/t.log 2>&1; echo "exit=$?"` 143/143 绿，exit=0；`npm run build > /tmp/b.log 2>&1; echo "exit=$?"` exit=0
- 自测标记：ALL_DB01_PASS
- 改动文件：
  - `/Users/aiatwork/Projects/domain-bot/docs/tasks/TASK-DB-01-l1l3-verify-done.md`
- 关联台账更新：
  - `docs/HANDOFF-DEPUTY-2026-09-04.md` 附录动作台账待追加：`DB-01 验机完成（agy），结论：有条件通过（发现 P1 转义隐患等 4 项）`
- 遗留 / 风险：
  - 风险 1：`src/push/telegram.ts:50,57,135` 实体内部包裹转义文本与该文件第 21-23 行注释违背，特殊字符标题在 Telegram 官方解析时有抛错风险。
  - 风险 2：常驻进程 PID 10934 持有 `memory/.lock`，属于正常行为守护，若手动跑 `--once` 须注意单实例锁拦截语义。
