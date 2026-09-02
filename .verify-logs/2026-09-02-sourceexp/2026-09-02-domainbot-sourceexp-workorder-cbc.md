# 工单：domain-bot 信息源扩展独立验机（cbc-R1）

- **派单身份**：小智（项目总管）
- **执行身份**：cbc（--model hy3, --permission-mode bypassPermissions）
- **日期**：2026-09-02
- **验机对象**：domain-bot 仓库 commit `437365c`（feat(collector): 信息源扩展前两档）
- **验机工作区**：`/Users/aiatwork/.review-worktrees/domainbot-cbc-437365c`
  你**只在这个 worktree 里干活**；禁止改动主仓 `/Users/aiatwork/Projects/domain-bot`，禁止 git commit/push，禁止修改任何源码/测试/配置来让检查变绿。允许的写入仅限：本 worktree 的 `node_modules`、`dist`、报告文件、`/tmp` 下运行时状态。

## 背景

本次改动（diff 基线 `dd95df4`）：sources.json 7→18 源、domain.json 补中文关键词、新增 ytsearch 适配器（yt-dlp）、jina 失败重试链接 exa.web_fetch_exa 兜底、两处闸门放宽（MAX_BODY_BYTES 256KiB→2MiB、fxp maxTotalExpansions 1000→20000）。执行者自报：101/101 测试绿；真实烟测 18 源 17 通（hn-frontpage 单轮瞬时失败）、1432 采集→727 相关→6 推送。**你的任务是独立复测这些声称值，不许照抄**。

## 验机步骤（全部在 worktree 内执行）

1. `npm install`（worktree 无 node_modules）。
2. `npm run typecheck` —— 记录退出码与输出。
3. `npx vitest run` —— 记录精确的文件数/测试数/耗时，与自报 101 对照。
4. `npm run build` —— 确认零错误。
5. **防作弊审查**：读 `tests/agentreach.test.ts` 新增的 ytsearch/jina 兜底测试，确认 mock 只打在 SpawnFn/FetchFn 边界、断言真实覆盖：兜底成功、网络异常走兜底、双失败报聚合错误、SSRF 拒绝不绕过兜底。确认没有任何测试通过改被测函数/全局补丁来造假通过。
6. **真实采集烟测**（网络允许）：在 worktree 写一个临时脚本（放 /tmp），调 `dist/index.js` 导出的 `runOnce`，参数：`domain=sources 读 worktree config/`，`memoryDir=/tmp/cbc-smoke-memory`（先删旧目录），`outDir=/tmp/cbc-smoke-outbox`，跑一轮。记录：stats JSON 原文、启用了哪些源、skippedSources 是哪些、推送条目的 source 分布。
7. 配置静态核验：`config/sources.json` 合法 JSON、源数量、各 type 与适配器 switch 分支一一对应（`src/index.ts` collectSource）；`yt-llm` 应为 enabled:true。

## 产出要求

- 报告写到（**工作区路径，勿用 /tmp 存报告**）：
  `/Users/aiatwork/Projects/domain-bot/.verify-logs/2026-09-02-sourceexp/2026-09-02-domainbot-sourceexp-verify-cbc.md`
- 每项检查给出：命令原文 + 关键输出原文（不要只写 PASS）+ 与自报值的数值级对照（一致/偏差多少）。
- 结尾给验机结论：通过 / 有条件通过（列条件）/ 打回（列证据）。
- 报告命名必须严格用上文名；无产物即视为失败重派。
- 注意：烟测要走外网（mcporter→exa、yt-dlp、arxiv 等），单个源失败不阻塞；若全部源失败，先查网络与 mcporter，再下结论。
