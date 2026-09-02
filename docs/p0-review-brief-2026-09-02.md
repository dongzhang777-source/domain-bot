# 外部审查工单 —— domain-bot P0 修复验收（贴给外部评审）

> 用法：本文档 + 附录 A/B/C 整体贴给评审者，无需访问代码仓库。
> 本次审查对象是一份**已完成的修复**及其交付报告，核心问题是：**修对了吗？测试可信吗？数据能信吗？**

---

## 一、背景（30 秒版）

domain-bot 是一个"自进化领域情报 bot"，商业上它是一个假设的测试探针：我们的千 bot 平台路线最大悬念是"用户到底要不要一万个 bot"，本 bot 让作者本人当第一个用户跑两周来验证。

原型 v0.1.0 曾有 **35 个测试全绿，但三方评审 + 实测证实：反馈→进化回路在生产路径完全断开**（8 个关键函数只有定义、无调用者；打分器饱和恒 1.000，观测不到任何质量变化；候选池被逐轮永久消耗）。随后执行了一份 14 个 Task 的 P0 修复工作单（TDD、红灯先行、每 Task 一 commit）。

修复已声称完成，现在请外部评审做**独立验收**。

## 二、修复声称完成的事（请逐条核对附录代码与下表）

| # | 声称 | 实现方式 |
|---|---|---|
| 1 | 接线守卫 | 新增 `tests/wiring.test.ts`：扫描 src/ 源码文本，断言 8 个反馈回路函数有跨文件生产调用者。首跑 8 红，最终 8 绿 |
| 2 | 反馈接收 | 新增 `src/feedback/receiver.ts`：Telegram `getUpdates` 长轮询 → `parseCallbackData` → `resolveRef` → `recordFeedback` → 刷新权重 → answerCallbackQuery |
| 3 | 权重持久化 | `memory/weights.json` + `refreshWeights` 闸门（processedFeedback 计数：无新反馈不重算，防每轮向 0.5 先验漂移冲淡已学信号） |
| 4 | 打分饱和 | 旧公式 `0.3+0.15*kw+0.12*sig`（实测恒 1.000）→ sqrt 压缩 `0.25+0.5*√(kw/8)+0.25*√(sig/6)`，饱和点从 kw≥5 上移到 kw≥8 且 sig≥6 |
| 5 | 过滤/排序解耦 | `scoreThreshold` 过滤**原始分**（原实现乘 0.5 后对启发式路径数学上永远无效），排序用加权分 + 新颖性因子（旧闻 ×0.75）。用原始分过滤是防止"低权源被挡在候选池外→永远拿不到反馈→权重锁死"的反馈死锁 |
| 6 | 传送带 | 归档从"仅推送的 ≤6 条"改为"全量候选"（带 pushed 标记），上限 2000→20000 可注入 |
| 7 | 观测 | 每轮追加 `memory/observations.jsonl`：candidates/P50/P90/top1/pushedMean/saturationRate/权重快照/bySource |
| 8 | LLM 兜底 | 分批（默认 20）+ 批级失败降级启发式 + **漏答降级启发式**（原常数 0.5 会在观测序列造假平台） |
| 9 | 节奏 | 1 小时/轮 → 1 天/轮 |
| 10 | 反测试 | 两条 e2e 只走真实入口（真实 Telegram 回调、手工编辑 feedback.json），并做红绿验证（改坏 refreshWeights 接线 → 2 条 FAIL → 恢复 → 全绿） |

**修复后真实两轮数据**（无 LLM key、启发式打分）：

```jsonl
{"at":1788307589178,"candidates":647,"pushed":6,"candidateP50":0.602,"candidateP90":0.747,"candidateTop1":0.862,"pushedMean":0.759,"saturationRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"github-new-llm-tools":0.5,"exa-llm-news":0.6,"hf-daily-papers":0.6,"v2ex-hot":0.2,"bili-llm":0.2},"bySource":{"arxiv-cs-ai":3,"exa-llm-news":1,"huggingface-blog":2}}
{"at":1788307612781,"candidates":1,"pushed":1,"candidateP50":0.628,"candidateP90":0.628,"candidateTop1":0.628,"pushedMean":0.628,"saturationRate":0,"weights":{...同上},"bySource":{"github-new-llm-tools":1}}
```

执行者的自评：测试 35→67 全绿；红绿验证通过；2 万归档 ×200 次 isNovel 实测 2ms；已 commit 未 push。

## 三、请评审回答的问题

### 定向问题（结论 → 理由 → 可证伪的反对意见，三段式）

1. **修复是否"真修通"而非"修绿"**：本次事故的教训是"测试全绿但回路断开"。请审视附录 A/B 的守卫与反测试设计——它们能否防止下一次同类事故？还有什么"绿灯但断开"的路径残留？
2. **刷新闸门的正确性**：`refreshWeights` 用 `processedFeedback >= feedbackCount()` 做闸门。请攻击这个设计：并发写、手工编辑 feedback.json 直接覆盖（会重置条数）、Telegram 回调与主循环同时触发刷新等场景下会发生什么？严重吗？
3. **观测设计的盲区**：saturationRate/P50/top1 这组指标，能否真正区分"进化生效"与"内容池枯竭/源挂掉"？还有哪个混淆变量没有仪器覆盖？
4. **8 条偏差的裁决**（附录 C 摘录两条最实质的）：a) 接线守卫正则放宽为允许点号方法调用（工作单原正则与其自带实现自相矛盾）；b) `stats.pushed` 从簇数改为条数（工作单两条断言互相矛盾）。执行者是"按工作单本意修工作单"还是"为了让测试变绿而放宽"？请独立判断，并指出还有哪条偏差不该被允许。
5. **sqrt 打分公式**：0.25 基础分 + 五五开的关键词/信号词权重，是否只是把任意性从参数搬到了函数形状？在 LLM 打分接入前，这个启发式对两周探针的结论会造成什么方向的系统性偏倚？
6. **两周探针现在能开跑吗**：以当前状态（启发式打分、无 Telegram key、jina 源 401 降级中），立刻开跑两周会得出什么结论、得不出什么结论？哪些必须先补？

### 无限定问题

以上不构成限制。任何你认为我们没问到但更要紧的话，请直接写。

## 四、偏见声明

1. 执行者兼作者，双重利益相关：修复被验收通过 → 探针开跑 → 千 bot 路线获得证据。请优先攻击证据链。
2. **工作单本身出自另一 AI 会话，执行者是第三个 AI 会话**——本次交付是"AI 修 AI 写的工单"。评审者（很可能也是 LLM）请注意这个链条的共同盲区：对"工程完备度"的共识可能系统性高于对"真实用户价值"的关注，而这两周的判定标准恰恰是后者。
3. 67 个测试全绿、红绿验证、快照存档——这些是过程证据，不是结果证据。请不要因为流程漂亮而放行结论。

## 五、输出格式

- 每个定向问题三段式；无限定区自由发挥。
- 总判断三选一：**验收通过 / 带条件通过（列出条件）/ 打回重修（列出理由）**。
- 如认为某条 P1（工作单 §六：词边界方案 A/B/C、双基线、假门通过线重定、退出条件等）应提前进 P0，请明确说。

---

## 附录 A：接线守卫与反测试（验收核心代码）

```typescript
// tests/wiring.test.ts —— 扫描 src/ 源码文本，断言反馈回路函数有跨文件生产调用者
/** 生产调用 = 出现在定义文件之外、处于调用位置（`fn(` 或 `obj.fn(`）、且不在注释里。
 *  【偏差记录】工作单原正则排除点号前缀（`[^\\w.$]`），但按工作单自带的实现代码，
 *  recordFeedback/resolveRef/feedbackBySource/saveWeights 全部以 `store.fn(` 形式调用，
 *  守卫将永远无法转绿。此处放宽为 `[^\\w$]`（允许方法调用），保留"有生产调用者"的本意。 */
function productionCallers(fn: string, definedIn: string): string[] {
  const hits: string[] = []
  const callRe = new RegExp(`(^|[^\\w$])${fn}\\s*\\(`)
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
// GUARDED 共 8 项：recordFeedback / resolveRef / feedbackBySource / saveWeights /
//   updateWeights / refreshWeights / parseCallbackData / answerCallbackQuery
// 每项断言 callers.not.toHaveLength(0)。首跑 8 failed，最终 8 passed。
```

```typescript
// tests/e2e.test.ts —— 反测试（只走真实入口，不手工调 recordFeedback/updateWeights/saveWeights）
it('反测试：真实 Telegram 回调路径改变持久化权重，且下一轮 runOnce 自己读到', async () => {
  const r1 = await runOnce({ domain, sources, memoryDir, fetchFn: mockFetch(), now: 1000 })
  const ref = r1.digest!.clusters[0]!.ref
  const before = r1.observation.weights
  const target = new MemoryStore(memoryDir).resolveRef(ref)!.source

  const res = await processTelegramUpdate(
    { update_id: 1, callback_query: { id: 'cq', data: `fb:u:${ref}` } },
    { token: 't', store: new MemoryStore(memoryDir), sources,
      fetchFn: async () => ({ ok: true, status: 200, text: async () => '{}' }), now: () => 1500 },
  )
  expect(res).toBe('recorded')

  // 下一轮 runOnce 必须自己从盘上读到新权重（不是测试注入 → 不构成循环论证）
  const r2 = await runOnce({ domain, sources, memoryDir, fetchFn: mockFetch(), now: 2000 })
  const after = r2.observation.weights[target]!
  expect(after).toBeGreaterThan(before[target]!)
  const onDisk = JSON.parse(readFileSync(join(memoryDir, 'weights.json'), 'utf8')).weights[target]
  expect(after).toBeCloseTo(onDisk, 10)
  expect(existsSync(join(memoryDir, 'feedback.json'))).toBe(true)
})

// 红绿验证：把 index.ts 的 refreshWeights(store, sources) 临时替换为 config 常量权重
//   → 上述两条反测试 FAIL（2 failed | 16 passed）；恢复 → 67 passed 全绿。
```

## 附录 B：权重刷新与观测核心代码

```typescript
// src/memory/weights.ts —— 全文
export function refreshWeights(store: MemoryStore, sources: SourceConfig[]): Record<string, number> {
  const state = store.weightsState()
  const current: Record<string, number> = {}
  for (const s of sources) current[s.id] = state.weights[s.id] ?? s.weight
  if (state.processedFeedback >= store.feedbackCount()) return current   // 闸门

  const base = sources.map((s) => ({ ...s, weight: current[s.id]! }))
  const next = updateWeights(base, store.feedbackBySource())
  store.saveWeights(next, store.feedbackCount())
  return next
}
// updateWeights（src/memory/evolve.ts，未改动）：w = (1-α)*w + α*Beta后验均值，α=0.2
// Beta(1,1) 后验均值 = (up+1)/(up+down+2)，信号量小时平滑
```

```typescript
// src/index.ts —— 过滤/排序/归档/观测段（节选）
// 过滤用原始分：源权重只应影响排序，不该把低权源整体挡在候选池外（反馈死锁）
const passed = []
for (let i = 0; i < relevant.length; i++) {
  if (scores[i].valueScore >= opts.domain.scoreThreshold) passed.push({ item: relevant[i], raw: scores[i].valueScore, reason: scores[i].reason })
}
// 排序用加权分 + 新颖性因子（applyNovelty 只作用于排序分，不作用于过滤，防旧闻被整体挡掉）
let scored = passed.map(({ item, raw, reason }) => {
  const novel = store.isNovel(item)
  const weighted = applySourceWeight(raw, weightOf.get(item.source) ?? 0.5)
  return { ...item, valueScore: applyNovelty(weighted, novel), isNew: novel, reason }
})
scored.sort((a, b) => b.valueScore - a.valueScore)
// 每源配额：防 arXiv 类关键词密集源霸榜
const perSourceCap = Math.max(2, Math.ceil(opts.domain.maxPerDigest / 2))
// ... diversified 构建后：
const candidates = scored            // 截断前快照（曾实际踩到顺序错误，已修）
store.recordItems(candidates, now)   // 全量候选入归档（解传送带）
store.markPushed(diversified.map((s) => s.id))
const observation = observeRound(candidates, diversified, weights, now)
appendObservation(opts.memoryDir, observation)
```

## 附录 C：交付报告的 deviations 摘录（全文见 docs/p0-fix-report.md §7）

1. 【工作单外既有 bug】`.gitignore` 的 `memory/` 未锚定根目录 → **src/memory/（核心记忆层）自建仓起从未入库**，已锚定 `/memory/`、`/outbox/` 并补入。
2. 守卫正则放宽允许点号方法调用（理由见附录 A 注释）。
3. `stats.pushed` 语义从簇数改为推送条数（工作单断言 pushed=4 与 clusters=2 矛盾，取条数口径）。
4. R11/R12 两处授权例外按裁决执行（构造方式/标题措辞，断言未动）。
5. Task 11 的 skippedSources 修复与守卫测试同批写入，缺一次独立红灯记录。
6. `applySourceWeight(0.8,1)===1.2` 断言原样未动；无新增 npm 依赖；未 push。
