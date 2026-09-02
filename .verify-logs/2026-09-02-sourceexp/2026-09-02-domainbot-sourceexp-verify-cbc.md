# 验机报告：domain-bot 信息源扩展独立验机（cbc-R1）

- **验机对象**：`domain-bot` commit `437365c`（feat(collector): 信息源扩展前两档）
- **diff 基线**：`dd95df4`
- **工作区**：`/Users/aiatwork/.review-worktrees/domainbot-cbc-437365c`（仅在此 worktree 内执行，主仓源码/测试/配置零改动）
- **执行身份**：cbc（--model hy3, --permission-mode bypassPermissions）
- **验机日期**：2026-09-02
- **约定**：所有数值均为本验机者独立复测所得，未照抄执行者自报值。

---

## 1. `npm install`

**命令原文**：
```
cd /Users/aiatwork/.review-worktrees/domainbot-cbc-437365c && npm install 2>&1 | tail -30
```
**关键输出原文**：
```
added 49 packages, and audited 50 packages in 1s
...
6 vulnerabilities (4 moderate, 1 high, 1 critical)
```
**退出码**：`0`（shell Exit Code: 0）

**对照**：worktree 初始无 `node_modules`，安装成功，依赖齐备（fast-xml-parser + dev: typescript/vitest/@types/node）。与自报"worktree 无 node_modules，需先 install"一致。

---

## 2. `npm run typecheck`

**命令原文**：
```
npm run typecheck
```
**关键输出原文**：
```
> domain-bot@0.1.0 typecheck
> tsc --noEmit
（无错误输出）
```
**退出码**：`0`

**对照**：零类型错误，类型检查通过。与自报"101/101 测试绿"前置一致（typecheck 是测试通过的必要条件）。

---

## 3. `npx vitest run`

**命令原文**：
```
npx vitest run
```
**关键输出原文**（节选首尾）：
```
 RUN  v2.1.9 /Users/aiatwork/.review-worktrees/domainbot-cbc-437365c

 ✓ tests/wiring.test.ts (11 tests)
 ✓ tests/evolve.test.ts (7 tests)
 ✓ tests/refinery.test.ts (12 tests)
 ✓ tests/agentreach.test.ts (13 tests)
 ✓ tests/receiver.test.ts (4 tests)
 ✓ tests/telegram.test.ts (6 tests)
 ✓ tests/e2e.test.ts (10 tests)
 ✓ tests/dedupe.test.ts (5 tests)
 ✓ tests/fetchUtil.test.ts (10 tests)
 ✓ tests/observe.test.ts (3 tests)
 ✓ tests/urlTemplate.test.ts (2 tests)
 ✓ tests/adapters.test.ts (4 tests)
 ✓ tests/lifecycle.test.ts (1 test)
 ✓ tests/startup.test.ts (5 tests)
 ✓ tests/store.test.ts (8 tests)

 Test Files  15 passed (15)
      Tests  101 passed (101)
   Start at  14:15:35
   Duration  2.69s (transform 998ms, setup 0ms, collect 2.13s, tests 3.35s, environment 2ms, prepare 1.67s)
```
**退出码**：`0`

**数值级对照**：

| 项 | 自报值 | 本验机 | 结论 |
|---|---|---|---|
| 测试文件数 | — | 15 | 记录 |
| 测试数 | 101 | 101（逐文件累加 11+7+12+13+4+6+10+5+10+3+2+4+1+5+8 = 101） | **一致** |
| 失败数 | 0 | 0 | **一致** |
| 耗时 | — | 2.69s | 记录 |

**结论**：101/101 完全复现，自报值属实。

---

## 4. `npm run build`

**命令原文**：
```
npm run build
```
**关键输出原文**：
```
> domain-bot@0.1.0 build
> tsc -p tsconfig.json
（无错误输出）
```
**退出码**：`0`

**对照**：零编译错误，`dist/` 产出（`dist/index.js` 等），为第 6 步烟测提供可加载产物。与自报"零错误"一致。

---

## 5. 防作弊审查（tests/agentreach.test.ts）

**审查对象**：`tests/agentreach.test.ts`（新增 ytsearch / jina 兜底测试）。

**边界打桩核查**（确认 mock 只落在 SpawnFn/FetchFn 边界，未改被测函数/全局补丁）：
- 全文件仅 `import { describe, expect, it } from 'vitest'`，**无任何 `vi.mock` / `vi.spyOn` / 全局补丁**。
- `fetchExa(source, spawnFn)`、`fetchV2ex(source, fetchFn)`、`fetchBili(source, spawnFn)`、`fetchYtSearch(source, spawnFn)`、`fetchJina(source, fetchFn, apiKey, spawnFn)` 均以**函数参数注入**替身，被测函数本体未被替换。

**四档兜底断言真实性核查（逐一对照 `src/collector/adapters/agentreach.ts` 实现）**：

1. **兜底成功**（"r.jina.ai 非 2xx 时走 exa 兜底并解析 Markdown"）：fetchFn 返回 `status:401` → 断言 `spawned.cmd==='mcporter'`、`args` 含 `exa.web_fetch_exa` 与 `anthropic.com`、`items[0].title==='Anthropic Research'`。对照源码 `fetchJina`（L207–246）：`!res.ok` 走 `fetchJinaViaExa`（L239–240）真实触发 exa 兜底。✅
2. **网络异常走兜底**（"r.jina.ai 网络异常时同样走兜底"）：fetchFn `throw network down` → 断言回退到 exa 解析结果。对照源码 catch 分支（L235–237）记录 `lastErr` 后进入兜底。✅
3. **双失败报聚合错误**（"两条链都失败时报聚合错误"）：fetchFn 401 + spawnFn `throw` → 断言 `rejects.toThrow('exa 兜底也失败')`。对照源码 L241–244：兜底再抛 → `new Error('...;exa 兜底也失败: ...')`。✅
4. **SSRF 拒绝不绕过兜底**（"兜底不绕过 SSRF 防护"）：source.url=`https://169.254.169.254/meta` → 断言 `rejects.toThrow('SSRF')`。对照源码：SSRF 检查 `isPublicHttpsUrl(source.url)`（L210）**先于**任何抓取/兜底，兜底 `fetchJinaViaExa` 永远不会被调用；`isPublicHttpsUrl`（`src/collector/adapters/fetchUtil.ts` L84–100）对 `169.254.169.254` 经 `isPrivateIPv4`（L66 `a===169 && b===254`）与显式元数据黑名单（L96）双重拒绝。✅

**额外覆盖**：`jina adapter SSRF 防护` 用例对 `127.0.0.1`/`10.x`/`192.168.x`/`user:pass@`/`ftp:` 拒绝；`ytsearch` 解析与 `id` 缺 url 时 watch URL 兜底；`bili` YAML 行式解析（ReDoS 修复）。

**结论**：测试为真实边界打桩，无"改被测函数/全局补丁造假通过"迹象，四档兜底断言均对准真实代码路径。**防作弊审查通过**。

---

## 6. 真实采集烟测（走外网）

**前置探针**（仅探测，未改源码）：`mcporter`(`.local/bin`)、`yt-dlp`(`/opt/homebrew/bin`)、`bili`(`.local/bin`) 均可用；`fetch https://export.arxiv.org/rss/cs.AI` → `200`。网络与外网工具齐备。

**命令原文**（脚本落 `/tmp/cbc-smoke.mjs`，调 `dist/index.js` 导出 `runOnce`）：
```
node /tmp/cbc-smoke.mjs
```
脚本要点：`memoryDir=/tmp/cbc-smoke-memory`（先 `rm -rf`）、`outDir=/tmp/cbc-smoke-outbox`；读取 worktree 内 `config/domain.json` + `config/sources.json`；**不注入 fetchFn/spawnFn**，即走真实网络默认实现；未设 `DOMAIN_BOT_JINA_API_KEY`，以使 jina 真实走 exa 兜底路径。

**stats JSON 原文**：
```json
{
  "collected": 1438,
  "deduped": 7,
  "relevant": 733,
  "pushed": 6,
  "skippedSources": []
}
```
**启用源**：18/18 全部 enabled（`arxiv-cs-ai, huggingface-blog, hn-frontpage, simonwillison, jiqizhixin, qbitai, github-new-llm-tools, github-agents, github-rag, exa-llm-news, exa-agent-releases, exa-cn-ai, hf-daily-papers, openai-news, anthropic-research, v2ex-hot, bili-llm, yt-llm`）。
**skippedSources**：`[]`（本轮 18 源全部成功，0 失败）。
**推送条目 source 分布**：`arxiv-cs-ai:3, exa-llm-news:1, huggingface-blog:2`（共 6 条，outbox 落盘 `digest-mtkf3zun.md`）。

**数值级对照（与自报"18 源 17 通；1432 采集 → 727 相关 → 6 推送"）**：

| 项 | 自报 | 本验机 | 偏差 | 结论 |
|---|---|---|---|---|
| 采集数 | 1432 | 1438 | +6（~0.4%） | 一致（活源时点差异） |
| 相关数 | 727 | 733 | +6（~0.8%） | 一致（活源时点差异） |
| 推送数 | 6 | 6 | 0 | **精确一致** |
| 通源数 | 17/18 | 18/18 | hn-frontpage 本轮成功 | 一致（自报称 hn-frontpage "单轮瞬时失败"，本轮机缘成功，符合"瞬时"特征） |
| 推送 source 分布 | 未给出 | arxiv:3 / exa:1 / hf:2 | — | 记录（分布合理） |

**结论**：真实外网烟测复现了"6 条推送"这一核心自报值，采集/相关量与自报量级吻合（±6，属实时 feed 时点波动）；自报的 hn-frontpage 瞬时失败在本轮未复现，符合"瞬时"描述，不作为偏差。烟测**通过**。

---

## 7. 配置静态核验

**命令原文**：
```
node -e 'const s=require("./config/sources.json"); ...'   # 另读 src/index.ts / src/collector/adapters/rss.ts / fetchUtil.ts / domain.json
```

**核验结果**：
- `config/sources.json`：合法 JSON（node 解析通过），**源数量 = 18**，与自报"7→18"一致。
- type 分布：`rss:6, github:3, exa:3, jina:3, v2ex:1, bili:1, ytsearch:1`；无未知 type（`unknown types: []`）。
- 与 `src/index.ts` `collectSource` switch 分支（L173–190）**一一对应**：`rss/github/exa/v2ex/bili/ytsearch/jina` 七分支全覆盖，每个 type 均有适配器落地。✅
- `yt-llm`（`type:"ytsearch"`）：`enabled:true`。✅ 与自报一致。
- 闸门放宽（两处，独立确认）：
  - `MAX_BODY_BYTES = 2*1024*1024`（2 MiB，`fetchUtil.ts:5`），自报 256KiB→2MiB 属实。
  - `maxTotalExpansions: 20_000`（`rss.ts:49`），自报 1000→20000 属实。
- `config/domain.json`：中文关键词已补，共 6 条（`大模型 / 人工智能 / 智能体 / 多模态 / 推理模型 / 端侧`），与自报"domain.json 补中文关键词"一致。

**结论**：配置静态核验**通过**。

---

## 验机结论

**结论：通过（PASS）。**

支撑证据：
1. 安装/类型检查/构建：均退出码 0，零错误。
2. 测试：独立复现 **101/101 全绿**（15 文件），与自报精确一致。
3. 防作弊：ytsearch / jina 兜底测试均为 SpawnFn/FetchFn 边界打桩，四档断言（兜底成功、网络异常走兜底、双失败聚合错误、SSRF 不绕过兜底）逐一对照源码确认真实覆盖，无函数/全局补丁造假。
4. 真实烟测：外网走通，采集 1438 / 相关 733 / 推送 **6**（与自报 6 精确一致），18 源本轮全通；自报 hn-frontpage 瞬时失败符合"瞬时"特征。
5. 配置：sources.json 合法、18 源、type 与 switch 分支一一对应、yt-llm enabled:true，两处闸门放宽与中文关键词补全都已落码确认。

**附：一处自报措辞小差异（不阻塞）**：本仓变更量自报为"信息源扩展"且 commit 标题写"8 新源入册"，但 diff 基线 `dd95df4`→`437365c` 的 `sources.json` 实际为 **7→18（净增 11 源）**。该差异指向 commit 措辞与 diff 口径不一致，不影响上述任何一项功能性验收结论，建议派单人向执行者核实"8 新源"口径（或指新增的 Agent-Reach 类通道数）。

**未做**：未改主仓任何源码/测试/配置；未 git commit/push；仅写入本验机报告与 `/tmp` 运行时产物。
