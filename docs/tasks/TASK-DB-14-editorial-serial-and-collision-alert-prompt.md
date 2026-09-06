# TASK-DB-14：编辑部同端点串行失效修复 + 运行时撞车探测

> 工单号：DB-14　｜　创建：2026-09-05　｜　创建人：总管小巴（源自同日 24h 代码审查）
> 基线 HEAD：`domain-bot @ 3cb4d7c8c885e0babaea75b0865afca938d4ffe1`（npm test 412/412 绿，2026-09-05 20:33 EDT 实测）
> 工作目录：`/Users/aiatwork/Projects/domain-bot`
> 推荐通道：claude
> 优先级：**P1**
> 预计工时：1–2 小时
> 上游依据：`docs/review-2026-09-05-24h-code-changes.md`（2026-09-05 24h 代码审查报告 P1-1）
> 所属台账：`domain-bot/docs/tasks/`

---

## 〇、必读（不看会做错）

1. **只改 domain-bot 仓**，禁 commit/push（入库归总管）。禁止触碰 `/Users/aiatwork/Projects/tuna`。
2. **生产区禁写**：`memory/`、`staging/`、`outbox/`、`evidence/`、`ops/`、`dist/`。禁止 `npm run build`（dist 归总管管理）。
3. **测试必须在沙箱外跑**：本环境沙箱内执行 `npm test` 时，vite 启动阶段 `loadEnv` 读 `.env` 会触发文件代理拒绝（`CODEBUDDY_BROKER_DENY`），表现为 **Startup Error 而非测试失败**。这是环境问题，不是你的改动导致，不要用改配置的方式绕过。
4. **验证退出码必须自查**：`npm test > /tmp/t.log 2>&1; echo "exit=$?"`，禁止 `npm test | tail`（会吞掉失败退出码）。
5. 相关既有代码：`src/editorial/index.ts`（`runEditorial`，本工单主战场）、`src/editorial/job.ts`（`runJob`）、`src/editorial/provider.ts`（`EditorialProvider`）、`src/gatekeeper/board.ts`（`auditBoard` / `EditorialBoard`）。
6. 编号纪律：本工单属 domain-bot `DB-nn` 族，报告引用编号一律写全 `DB-14`。

## 一、背景（为什么做）

### 缺陷 1：串行分支完全失效

`src/editorial/index.ts:216-257` 的当前实现：

```ts
const writerJobPromise = writerUsable ? runJob({...}) : Promise.resolve(null)    // ← 已启动
const reviewerJobPromise = reviewerUsable ? runJob({...}) : Promise.resolve(null) // ← 已启动

if (sameEndpoint) {
  log('[editorial] writer 与 reviewer 同端点，改串执行（避免单槽位互相拖慢）')
  writerJob = await writerJobPromise      // ← 只是等待，不阻止并发
  reviewerJob = await reviewerJobPromise
} else {
  ;[writerJob, reviewerJob] = await Promise.all([writerJobPromise, reviewerJobPromise])
}
```

`runJob` 是 async 函数，**调用即开始执行**（同步执行至第一个 await）。两个 Promise 在 if 判断之前就已启动，`await` 只等待、不阻止并发。因此该分支承诺的"串行"**从未生效**，两个作业始终并发 2 路。

**不做的代价（已实际发生，非推测）**：2026-09-05 17:56 轮真跑的看板记录（evidence `feed-quality-deepthought-deepthoughtmtowr5h2.json` 的 `editorial.endpoints`）显示：

```
[{role:"writer",   endpointId:"nous-proxy",  calls:2, reasoningTokens:6568},
 {role:"writer",   endpointId:"llama-local", calls:1, reasoningTokens:0},
 {role:"reviewer", endpointId:"nous-proxy",  calls:1, reasoningTokens:1064}]
```

reviewer 已从主端点 8002 降级到 **nous-proxy (8052)**，与 writer 撞在同一端点并并发请求——正是这段代码想避免的场景。而 `config/editor.json` 的 `_enabledNote` 还写着"降级链撞车时必须人工干预"，说明该风险已知，但兜底代码是空的。

**会推翻哪个已验证资产**：本修复不改变并行分支（异端点）的行为，`Promise.all` 路径与现有 412 例测试的预期一致；仅让 `sameEndpoint=true` 分支按注释执行。风险面限于"两角色首端点相同时"这一当前配置（8052 vs 8002）**未触发**的路径。

### 缺陷 2：运行时撞车无告警

`sameEndpoint` 只比对配置里的**首端点**（`editorial/index.ts:213-214`），无法拦截"降级后实际撞车"。而 `auditBoard`（`src/gatekeeper/board.ts:179`）已有 `warnings: string[]` 通道，`EditorialBoard.endpoints` 已记录**实际**走到的端点与用量——两者结合即可把"人工干预"升级为自动告警。

## 二、任务与验收标准（逐项可证伪）

### 1. 修复串行分支

把 `runJob` 的调用推迟到分支内，使 `sameEndpoint=true` 时**真正串行**（writer 全部批次完成后 reviewer 才开始，或反之）。

参考形态（你可自行组织，语义须一致）：

```ts
const startWriter   = () => runJob<ReturnType<typeof toWriterInput>, WrittenCopy>({...})
const startReviewer = () => runJob<ReturnType<typeof toWriterInput>, ReviewVerdict>({...})

let writerJob: JobResult<WrittenCopy> | null = null
let reviewerJob: JobResult<ReviewVerdict> | null = null
if (sameEndpoint) {
  log('[editorial] writer 与 reviewer 同端点，改串执行（避免单槽位互相拖慢）')
  if (writerUsable)   writerJob   = await startWriter()
  if (reviewerUsable) reviewerJob = await startReviewer()
} else {
  ;[writerJob, reviewerJob] = await Promise.all([
    writerUsable   ? startWriter()   : Promise.resolve(null),
    reviewerUsable ? startReviewer() : Promise.resolve(null),
  ])
}
```

**验收**：新增 ≥1 测试——注入 `fetchFn` 记录每个请求的**起止时间区间**，构造 `sameEndpoint=true` 场景（两角色首端点配成同一 baseUrl），断言**任意两个请求区间不重叠**（即不存在并发）。同一测试在 `sameEndpoint=false` 场景下应能观察到重叠，以此证明该断言真的有区分力（变异验证，须写进报告）。

> 实现提示：`fetchFn` 内 `await` 一小段延时（如 5ms）后再返回，否则区间退化为 0 无法判定重叠。你不必区分请求属于 writer 还是 reviewer——"是否存在并发重叠"本身就是串行与并行的本质差别。

### 2. 加运行时撞车告警

在 `auditBoard`（`src/gatekeeper/board.ts:179`）中新增检查：取 `board.editorial.endpoints` 里 `role === 'writer'` 与 `role === 'reviewer'` 的 `endpointId` 集合，**有交集则 push 一条 warning**。

文案须包含：撞车的端点 id、以及"降级链撞车，并发请求可能互相拖慢"的后果说明。

**验收**：新增 ≥1 测试——构造 `endpoints` 含 writer 与 reviewer 共用同一 `endpointId` 的 `QualityBoard`，断言 `auditBoard(...).warnings` 含撞车提示；并构造无交集场景断言**不产生**该 warning（防误报）。

### 3. 不得改变异端点路径的现有行为

**验收**：现有 412 例测试保持全绿（只增不减），`Promise.all` 路径的语义不变。

## 三、精确落点

| 位置 | 现状 | 要求 |
|---|---|---|
| `src/editorial/index.ts:213-215` | `sameEndpoint` 比对 `writerProvider.endpoints[0]?.baseUrl === reviewerProvider.endpoints[0]?.baseUrl` | 保留判据（本工单不改它，见 §四.1） |
| `src/editorial/index.ts:216-246` | `writerJobPromise` / `reviewerJobPromise` 在分支前即调用 `runJob(...)` | 改为工厂函数，推迟到分支内调用 |
| `src/editorial/index.ts:249-257` | `if (sameEndpoint) { await ... }` 实为并行 | 改为真串行 |
| `src/gatekeeper/board.ts:213-232` | `auditBoard` 内已有 5 条 editorial 相关 warnings（降级/截断/自检未过/llmCopy 不足/自进化未生效），**无撞车检查** | 新增撞车 warning；`EditorialBoard` 接口（`board.ts` 内）**无需改动**——`endpoints` 字段已含 `role` 与 `endpointId` |

## 四、已知坑点（已核实，不是"可能"）

1. **`sameEndpoint` 只比首端点**这一局限是**已知且记录在案**的（`config/editor.json` 的 `_enabledNote`）。本工单**不要求**你改这个判据——§二.2 的运行时探测才是解决"降级撞车"的正确落点。若你在实现中发现更好的判据方式，可提出但**不得未论证就改**。
2. **`runJob` 的续跑语义**：`job.ts:175-183` 用 `jobId` + `totalItems/batchSize` 判续跑，`makeJobId` 按 `role-persona-日期` 生成。串行化不改变 jobId，故续跑行为不受影响——但请确认你的改动没让两个 job 写同一进度文件（它们的 jobId 不同，`jobPath` 也不同）。
3. **`EditorialBoard.endpoints[].role` 的类型是 `string`**（非字面量联合），`filter` 时用 `=== 'writer'` 字符串比较即可。
4. 本仓 `npm test` 基线 **412 例、约 99 秒**。

## 五、硬约束（违反即退回）

- [ ] 禁止 commit / push / `npm run build`；禁止触碰 tuna 仓、`memory/`、`staging/`、`outbox/`、`evidence/`、`ops/`、`dist/`
- [ ] 禁止新增运行时依赖（本仓唯一依赖 `fast-xml-parser`，此约束是项目红线）
- [ ] 验证退出码必须重定向自查
- [ ] 不得修改与本工单无关的文件
- [ ] **不得改动 `EditorialProvider` 的降级链语义**与 `config/editor.json` 的任何端点配置
- [ ] 不得为让测试通过而修改既有断言（必要时逐条论证）

## 六、自测要求

运行：`npm test > /tmp/db14.log 2>&1; echo "exit=$?"`（须 exit=0，且用例数 ≥412）

新增测试落 `tests/` 下（新建文件或扩展 `tests/editorial.test.ts` 均可），须包含以下断言：

1. `sameEndpoint=true` 时请求区间两两不重叠（真串行）；
2. 同一断言在 `sameEndpoint=false` 时能观察到重叠（**变异验证**，证明断言有区分力，须在报告中给出两种场景的实测输出）；
3. writer/reviewer 共用 endpointId 时 `auditBoard().warnings` 含撞车提示；
4. 无共用时**不产生**该 warning（防误报）。

**自测标记**：报告末尾输出 `ALL_DB14_PASS`。

**验收方式**：总管会**打开你的测试文件读断言本身**，并做变异抽验（改坏输入看它是否真的会红）。只输出 `ALL_PASS` 而无真实断言的，视为未通过。

## 七、交付物

1. 代码改动（未 commit）
2. 自测报告，落盘 `/Users/aiatwork/Projects/domain-bot/.verify-logs/2026-09-05-domainbot-db14-editorial-serial-claude.md`，含：
   - 两项任务的改前/改后代码对照
   - 变异验证的实测输出（串行场景无重叠 / 并行场景有重叠）
   - 全量测试输出与退出码
   - 遗留与风险
3. 若发现本工单描述与代码不符：**明确指出并说明依据**（路径 + 行号），不要将错就错

## 八、禁止事项

- 禁止自制沙箱短路（不得写永真断言 / 不得 mock 掉被测目标本身）
- 禁止顺手重构无关代码
- 禁止在报告中声称"已验证"你实际未运行验证的项
- 禁止改动端点配置或降级链语义
