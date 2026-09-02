# domain-bot P0 修复交付报告

> 执行：ZCode/小智 · 2026-09-02 · 工作单：`.hermes/plans/2026-09-01_domain-bot-p0-workorder-zcode.md`
> 状态：**14 个 Task 全部完成，未 push，等待老张批准。**

## 1. Task 1 接线守卫的红灯原始输出（基线证据）

```
 ❯ tests/wiring.test.ts (8 tests | 8 failed) 

 Test Files  1 failed (1)
      Tests  8 failed (8)
   Start at  19:50:59
```

8 条全红：recordFeedback / resolveRef / feedbackBySource / saveWeights / updateWeights / refreshWeights / parseCallbackData / answerCallbackQuery 均无生产调用者——证实工作单背景 §1"反馈回路在生产路径完全断开"。

## 2. Task 14 Step 2 全量绿灯原始输出

```
 Test Files  11 passed (11)
      Tests  67 passed (67)
```

总测试数 67（原 35 → 新增 32；工作单预估 ≥50 ✓）。中途各 Task 的全量跑：Task 8 后首次 54/54 全绿（接线守卫 8/8 转绿）、Task 9 后 56/56、Task 10 后 58/58、Task 11 后 62/62、Task 12 后 65/65。

## 3. Task 13 Step 4 红绿验证输出

改坏（`refreshWeights(store, opts.sources)` → config 常量权重）：

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
      Tests  2 failed | 16 passed (18)     ← 两条反测试 FAIL
```

改回后：

```
      Tests  67 passed (67)                ← 全绿
```

偏差说明：工作单预期"两条反测试 + wiring 的 refreshWeights 守卫"三条全 FAIL，实际 wiring 守卫仍绿——因为 `receiver.ts` 里 `refreshWeights(deps.store, ...)` 也是合法生产调用者，改坏 index.ts 不影响该守卫。守卫设计如此，反测试两条 FAIL 已足以证明测试有效性。

## 4. 真实两轮的 observations.jsonl 全文

```jsonl
{"at":1788307589178,"candidates":647,"pushed":6,"candidateP50":0.602,"candidateP90":0.747,"candidateTop1":0.862,"pushedMean":0.759,"saturationRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"github-new-llm-tools":0.5,"exa-llm-news":0.6,"hf-daily-papers":0.6,"v2ex-hot":0.2,"bili-llm":0.2},"bySource":{"arxiv-cs-ai":3,"exa-llm-news":1,"huggingface-blog":2}}
{"at":1788307612781,"candidates":1,"pushed":1,"candidateP50":0.628,"candidateP90":0.628,"candidateTop1":0.628,"pushedMean":0.628,"saturationRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"github-new-llm-tools":0.5,"exa-llm-news":0.6,"hf-daily-papers":0.6,"v2ex-hot":0.2,"bili-llm":0.2},"bySource":{"github-new-llm-tools":1}}
```

逐项对照工作单 Task 14 验收点：

| 验收点 | 实测 | 判定 |
|---|---|---|
| saturationRate < 0.5 | **0**（sqrt 压缩后真实数据零饱和） | ✓ |
| candidates > pushed | 647 > 6 | ✓ |
| candidateP50 ≠ P90（有区分度） | 0.602 / 0.747 / top1 0.862 | ✓ |
| weights = config 先验 | 7 源全在，值=先验 | ✓ |
| archive pushed 数 < 总数 | 6 < 647 | ✓ |
| 第二轮推送骤降 | 6 → 1（去重删 646，唯一入选是 GitHub 真新增），top1 0.628 来自**新内容**而非池枯竭（candidates=1 且第一轮 647 条已被整批归档屏蔽） | ✓ |

## 5. 提交清单（派单前 → 完成）

```
0c687e9 test(e2e): 端到端反测试——只走真实回调/手工入口，附红绿验证证明测试有效
8978375 fix(scorer): LLM 打分分批（默认 20）+ 失败/漏答均降级启发式
df17047 feat(observe): 每轮落盘 observations.jsonl + 修 skippedSources 恒为空
6bec904 feat(evolve): isNew 参与排序（旧闻 ×0.75）+ Telegram 补 🆕/♻️ 标记
d85b727 fix(memory): 归档全量候选池而非仅推送条目——解传送带
f8e3ca6 feat(index): runOnce 读持久化权重 + main 起常驻回调接收 + 节奏改每天 1 轮
821cbc2 feat(feedback): Telegram 回调接收端（接线守卫 8/8 转绿）
576fc6f feat(memory): 权重持久化 weights.json + refreshWeights 闸门
d9af199 fix(index): 过滤用原始分、排序用加权分
e04c650 feat(config): 信号词从硬编码搬入 domain.json
2c03e6b fix(scorer): sqrt 压缩破解打分饱和
7184715 chore: 探针证据快照脚本
afdd33c test: 接线守卫（当前全红）
```

## 6. `git diff --stat c2d9a3a..HEAD`（派单前基线 c2d9a3a）

```
 27 files changed, 2717 insertions(+), 32 deletions(-)
 （含 src/memory/weights.ts、src/feedback/receiver.ts、src/memory/observe.ts、
   scripts/snapshot-evidence.mjs、tests/wiring|receiver|observe.test.ts 全新文件）
```

## 7. deviations（与工作单不一致处，逐条）

1. **【重要·工作单外的既有 bug】`.gitignore` 的 `memory/` 未锚定根目录，导致 `src/memory/` 自建仓起从未入库**（Task 6 提交时被 git 拒绝才发现）。已锚定为 `/memory/`、`/outbox/` 并补入全部 src/memory 文件。此问题意味着此前所有 commit 里核心记忆层代码都不在版本控制内。
2. **接线守卫正则放宽（红线 3 边缘，但属"让守卫可满足"而非"放宽断言"）**：原正则 `[^\\w.$]` 排除点号前缀，而工作单自带的实现代码里 recordFeedback/resolveRef/feedbackBySource/saveWeights 全部以 `store.fn(` 方法调用形式出现——守卫按原正则永远无法转绿，与 Task 6/7 的转绿预期自相矛盾。改为 `[^\w$]`（允许方法调用），保留"有生产调用者"本意。
3. **`stats.pushed` 语义从簇数改为推送条数**：工作单 Task 9 的 e2e 同时断言 `pushed===4` 与 `clusters===2`，原实现 `pushed: digest.clusters.length` 恒为 2，两者矛盾。按工作单口径取条数。
4. **红线 3 两处授权例外均按裁决执行**：R11（裁剪测试改 `{ maxEntries: 2000 }` 构造，断言一字未改）；R12（refinery 测试仅改标题措辞，两条断言实跑确认原样通过）。**除上述外未动任何现有测试断言**；`applySourceWeight(0.8,1)===1.2` 断言原样在 tests/evolve.test.ts 中且通过。
5. **Task 11 Step 5 的红灯步骤未严格先行**：skippedSources 的 catch push 修复与守卫测试同一批写入（该测试写出即绿）。功能与验收等价，但缺一次独立红灯记录，特此说明。
6. **Task 9 的 `⚠️ candidates 顺序陷阱**（先存候选再截断）按工作单执行，且曾实际踩到（`scored = diversified` 残留行导致 candidates 拿到截断数组），在跑测试前已发现删除，未进入提交。
7. **性能门**：2 万归档 × 200 次 isNovel = **2ms**（门限 3000ms），未触发"停下来问"条件。
8. **DoD 其余各项**：signalWords 10 个（无 `open-source`）✓；`" multimodal "` 空格已清 ✓；无新增 npm 依赖（package.json 仅增 `snapshot` script）✓；已 commit、**未 push** ✓。
