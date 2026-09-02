# 工单：domain-bot 信息源扩展代码审查（agy-R1）

- **派单身份**：小智（项目总管）
- **执行身份**：agy（gemini-3.7-flash, effort high）
- **日期**：2026-09-02
- **审查对象**：domain-bot 仓库 commit `437365c`（feat(collector): 信息源扩展前两档），diff 基线为父提交 `dd95df4`
- **审查工作区（只读）**：`/Users/aiatwork/.review-worktrees/domainbot-agy-437365c`
  你在该目录**只读**：除下述报告文件外禁止任何写入，禁止 git commit/push，禁止改源码/测试/配置。

## 背景

domain-bot 是一个自进化领域专家 bot（采集→提炼→反馈闭环），本次改动把信息源从 7 个扩到 18 个并新增两条能力：
1. 档位一（纯配置）：`config/sources.json` 新增 8 源（HN/Simon Willison/机器之心/量子位/GitHub agents+rag/Exa 两路/Jina 盯 OpenAI+Anthropic）；`config/domain.json` 补中文关键词。
2. 档位二（代码）：`src/collector/adapters/agentreach.ts` 新增 `ytsearch` 适配器（yt-dlp）与 jina 失败重试链（第二跳走 exa.web_fetch_exa）；`src/index.ts` 路由 + `src/types.ts` 类型；`tests/agentreach.test.ts` 新增 20 条测试。
3. 两处安全闸门放宽：`fetchUtil.ts` MAX_BODY_BYTES 256KiB→2MiB；`rss.ts` fast-xml-parser processEntities 改对象配置（maxTotalExpansions 1000→20000，其余防护保持布尔默认档）。

改动动机与执行记录见 `docs/source-expansion-agentreach-2026-09-02.md`（执行记录在文末）。

## 审查维度（按优先级）

1. **P0 级**：新增代码的安全与正确性——jina 重试链的 SSRF 防护是否真的前置于兜底、有无绕过路径；错误聚合语义是否会把成功当失败（或反之）；ytsearch 对恶意/畸形 yt-dlp 输出的健壮性（JSON 行解析、字段兜底）。
2. **闸门放宽评估**：2MiB 与 maxTotalExpansions=20000 是否引入实质 DoS/实体爆炸风险？其余实体防护（maxExpansionDepth=10、maxEntitySize、maxEntityCount）保持默认档是否够？给出量化理由。
3. **测试质量（防作弊审查）**：新增 20 条测试是否真测到被测函数（mock 只允许在 SpawnFn/FetchFn 边界）；有无绕过被测逻辑的断言；关键分支（兜底成功/兜底失败/双失败/SSRF 拒绝）覆盖是否有洞。
4. **配置正确性**：sources.json 18 源的 type/url/weight 是否与适配器约定一致（exa/bili/ytsearch 的 url=搜索词、jina=目标 URL）；weight 是否符合"低 weight 灰度"纪律；中文关键词会不会误伤打分。
5. **P2**：与既有管线（每源配额、ε-greedy、观测 skippedSources）的交互有无回归隐患。

## 产出要求

- 报告写到（**工作区路径，勿用 /tmp**）：
  `/Users/aiatwork/Projects/domain-bot/.verify-logs/2026-09-02-sourceexp/2026-09-02-domainbot-sourceexp-review-agy.md`
- 格式：开头给总体结论（通过/有条件通过/打回）+ 评分；问题按 P0/P1/P2 编号，每条给 文件:行号、证据、建议；引用数据一律你自己核实，禁止引用本工单里的数字当作你验证过的。
- 明确写出你实际读过的文件清单和运行过的命令。
- 无产物即视为失败重派；长时间无输出属正常（-p 模式收尾才输出），持续工作即可。
