# TASK-DB-15：五项微缺陷清扫（jobId 时区 / 临时目录 / 注释漂移 / model 空值 / 正则状态）

> 工单号：DB-15　｜　创建：2026-09-05　｜　创建人：总管小巴（源自同日 24h 代码审查）
> 基线 HEAD：`domain-bot @ 3cb4d7c8c885e0babaea75b0865afca938d4ffe1`（npm test 412/412 绿，2026-09-05 20:33 EDT 实测）
> 工作目录：`/Users/aiatwork/Projects/domain-bot`
> 推荐通道：agy（`gemini-3.8-flash --effort high`，免费档）
> 优先级：**P2**
> 预计工时：1–2 小时
> 上游依据：`docs/review-2026-09-05-24h-code-changes.md`（2026-09-05 24h 代码审查报告 §三 P2 级）
> 所属台账：`domain-bot/docs/tasks/`
> ⛔ **依赖 DB-14**：本单第 2、4 项与 DB-14 同改 `src/editorial/index.ts`，**必须在 DB-14 落盘入库后开工，禁止并行**。

---

## 〇、必读（不看会做错）

1. **只改 domain-bot 仓**，禁 commit/push（入库归总管）。禁止触碰 `/Users/aiatwork/Projects/tuna`。
2. **生产区禁写**：`memory/`、`staging/`、`outbox/`、`evidence/`、`ops/`、`dist/`。禁止 `npm run build`（dist 归总管管理）。
3. **测试必须在沙箱外跑**：沙箱内 `npm test` 会因 vite `loadEnv` 读 `.env` 触发文件代理拒绝（`CODEBUDDY_BROKER_DENY`），表现为 **Startup Error 而非测试失败**。这是环境问题，不是你的改动导致。
4. **验证退出码必须自查**：`npm test > /tmp/t.log 2>&1; echo "exit=$?"`，禁止 `npm test | tail`。
5. 编号纪律：本工单属 domain-bot `DB-nn` 族，报告引用编号一律写全 `DB-15`。

## 一、任务与验收标准（逐项可证伪）

五项相互独立，**逐项给出"改 / 不改"结论 + 论证**。允许对任一项给出"不改"结论，但必须量化论证，不得默认全改。

### 1. `makeJobId` 用 UTC 日期，与本地日期差一天

`src/editorial/job.ts:226-229`：

```ts
export function makeJobId(role: 'writer' | 'reviewer', personaId: string, dayStamp: number): string {
  const day = new Date(dayStamp).toISOString().slice(0, 10).replace(/-/g, '')
  return `${role}-${personaId}-${day}`
}
```

**实测**（本机时区 America/New_York，EDT = UTC−4）：本地 `2026-09-05 20:31` → `makeJobId` 产出 `writer-<persona>-20260906`。

**影响**：波士顿用户晚 20:00 后启动过夜批产，staging 文件名日期与本地日期差一天，排查时易误判；跨 UTC 午夜的中断续跑会新起作业（writer 实测单轮 ≈53 分钟，重跑代价高）。

**必须回答的双向论证**：
- 现在不改的代价？（上面已给量化）
- 改了会推翻什么？**改后 jobId 变化 → `staging/jobs/` 里既有进度文件不再匹配 → 一次性续跑失效**。staging 是 `.gitignore` 的可重跑中间态（非审计留档），代价较低，但**若当前有长作业在跑则会打断它**——开工前先确认无活跃作业。

**验收**：新增 ≥1 测试——给定构造的 `dayStamp`，断言 jobId 中的日期段等于该时刻的**本地**日期。若结论为"不改"，改为在 `job.ts` 加注释说明为何用 UTC。

### 2. 校准作业临时目录从不清理

`src/editorial/index.ts:330`：

```ts
stagingDir: mkdtempSync(join(tmpdir(), 'dbot-calibrate-')),
```

每轮整链跑都会在系统临时目录留下一个 `dbot-calibrate-XXXXXX/` 且从不删除。该目录是**刻意**用临时目录的（注释 325-329 行说明：避免 `runJob` 的续跑判据复用上一次校准结果——2026-09-05 实测过"改完配置重跑仍返回旧结果"的坑），**不得改回固定目录**。

**要求**：在保留"每次唯一目录"这一不变量的前提下，用后清理（如 `try/finally` + `rmSync(recursive)`）。

**验收**：新增 ≥1 测试或给出实测证据——跑完一次带校准的 `runEditorial` 后，`tmpdir()` 下无新增 `dbot-calibrate-*` 残留。**且**必须验证"每次唯一目录"仍然成立（连续两次跑不使用同一目录）。

### 3. 注释与实现不符：称"十条硬断言"，实为 12 条

`src/gatekeeper/assertions.ts:13` 注释称"十条硬断言"，而 `runAssertions`（同文件 61-76 行）实际返回 **12 条**断言，另有跨条目断言 `checkEventOversubscribed`（290 行）共 13 条。DB-11 新增 `checkHtmlLeak`、DB-12 新增相关判据后未同步注释。

**要求**：把注释改为与实际一致，并**写明条数会随判据增长**——避免下次新增判据时再漂移（建议注释里不再写死具体数字，或写明"当前 N 条 + 1 条跨条目"并指向 `runAssertions` 本体）。

**验收**：注释条数与实际 `runAssertions` 返回长度一致（报告中给出核对方式与数字）。

### 4. `lastUsage` 的 `model` 字段硬编码为空串

`src/editorial/index.ts:288-300`，`lastUsage()` 返回对象里 `model: ''` 恒为空。看板若展示该字段，读者会以为"未指定模型"，而实际是代码没记录——属于"有字段但不说真话"。

**要求**（二选一，须论证）：让 `model` 说真话（记录该端点实际使用的模型；注意当前 `EndpointUsageStat`（`job.ts:25-34`）**没有 model 字段**，需评估加字段的代价）；**或**明确标注为占位并说明为何无法取得。禁止保留一个恒空却看似有效的字段。

**验收**：该字段要么反映实际模型（附测试），要么显式标注不可用（注释 + 类型层面表达，如改为可选字段）。

### 5. ⚠️ `VIEWER_CHROME` 正则带 `g` 标志——**注意：直接去掉 g 是错的**

`src/gatekeeper/assertions.ts:58`：

```ts
const VIEWER_CHROME = /频道\s*·\s*[\d,.]+\s*万?\s*次观看|.../gi
```

**当前是安全的**：它只在 `checkHollowSummary` 的 `substanceOf` 里用于 `String.replace`（`assertions.ts:271`），而带 `g` 的正则在 `Symbol.replace` 中会重置 `lastIndex`，无状态污染。

**但不要直接删掉 `g`**：`String.replace` 不带 `g` 时**只替换第一处匹配**，会把"剥除平台 chrome"变成"只剥第一处"，直接改变 `checkHollowSummary` 的判定结果（可能让空卡混入或真实内容被误杀）。

**要求**：在**保持全局替换语义不变**的前提下消除隐患。可选方案（择一论证）：
- (A) 改为保存正则源字符串，在 `substanceOf` 内按需 `new RegExp(source, 'gi')` 局部创建（无跨调用共享状态）；
- (B) 保留模块级正则，加醒目注释禁令"本正则带 g，禁止用 `.test()` / `.exec()`"；
- (C) 其他你能论证的方案。

**验收**：新增 ≥1 测试——含**多处**平台 chrome 的文本（如同时含"1.2万次观看"与"123K views"）被 `checkHollowSummary` 判为空壳，证明全局替换语义未被破坏。

## 二、硬约束（违反即退回）

- [ ] 禁止 commit / push / `npm run build`；禁止触碰 tuna 仓、`memory/`、`staging/`、`outbox/`、`evidence/`、`ops/`、`dist/`
- [ ] 禁止新增运行时依赖（本仓唯一依赖 `fast-xml-parser`，此约束是项目红线）
- [ ] 验证退出码必须重定向自查
- [ ] 不得修改与本工单无关的文件
- [ ] **不得改回固定校准目录**（`index.ts:325-329` 注释记载的"复用旧结果"坑是真的，务必先读该注释）
- [ ] 第 5 项**禁止直接删除 `g` 标志**（见上，会破坏 replace 全局语义）

## 三、自测要求

运行：`npm test > /tmp/db15.log 2>&1; echo "exit=$?"`（须 exit=0，且用例数 ≥412，只增不减）

每项任务给出：结论（改 / 不改）+ 论证 + 测试证据。至少第 1、2、5 项须有可执行断言。

**自测标记**：报告末尾输出 `ALL_DB15_PASS`。

**验收方式**：总管会**打开你的测试文件读断言本身**，并做变异抽验（改坏输入看它是否真的会红）。只输出 `ALL_PASS` 而无真实断言的，视为未通过。

## 四、交付物

1. 代码改动（未 commit）
2. 自测报告，落盘 `/Users/aiatwork/Projects/domain-bot/.verify-logs/2026-09-05-domainbot-db15-micro-sweep-agy.md`，含：
   - 五项各自的结论 + 双向论证 + 测试输出
   - 全量测试输出与退出码
   - 遗留与风险
3. 若发现本工单描述与代码不符：**明确指出并说明依据**（路径 + 行号），不要将错就错

## 五、禁止事项

- 禁止自制沙箱短路（不得写永真断言 / 不得 mock 掉被测目标本身）
- 禁止顺手重构无关代码
- 禁止在报告中声称"已验证"你实际未运行验证的项
