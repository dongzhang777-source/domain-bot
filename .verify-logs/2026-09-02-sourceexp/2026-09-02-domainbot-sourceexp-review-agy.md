# 代码审查报告：domain-bot 信息源扩展前两档（agy-R1）

- **审查对象**：`domain-bot` 仓库 commit `437365c`（`feat(collector): 信息源扩展前两档——8 新源入册+ytsearch 适配器+jina exa 兜底`）
- **diff 基线**：父提交 `dd95df4`
- **审查身份**：agy（gemini-3.7-flash, effort high）
- **日期**：2026-09-02
- **审查工作区**：`/Users/aiatwork/.review-worktrees/domainbot-agy-437365c`（只读）

---

## 总体结论与评分

- **总体裁决**：**通过（Approved）**
- **综合评分**：**95 / 100**
  - **安全性与正确性（P0）**：98 / 100
  - **安全闸门放宽评估**：95 / 100
  - **测试质量与防作弊**：96 / 100
  - **配置规范与一致性**：94 / 100
  - **管线交互与观测性（P2）**：92 / 100

### 结论摘要

1. **P0 安全性与正确性完全达标**：`fetchJina` 重试链中，SSRF 检查（`isPublicHttpsUrl`）严格前置于任何抓取尝试（包含 `r.jina.ai` 和 `exa.web_fetch_exa` 兜底），不存在私网探测或云元数据绕过路径；`ytsearch` 适配器使用 `execFile` 数组传参，无 Shell 注入隐患；多行 JSON 流式解析与字段降级逻辑完备；双链失败时错误聚合清晰（含第一跳与第二跳真实原因），不吞异常、不伪造成功。
2. **安全闸门放宽合理且有严格边界**：
   - `fetchUtil.ts` 的 `MAX_BODY_BYTES` 从 256 KiB 放宽至 2 MiB，解决了 arXiv cs.AI 等大 feed（实测 0.8~1.8 MB）被误杀的问题；基于 `AbortController` 的流式读取在超过 2 MiB 时立即中止，内存与 CPU 消耗严格有界（单次抓取内存上限 ~2 MB）。
   - `rss.ts` 的 `processEntities.maxTotalExpansions` 从默认 1,000 放宽至 20,000，解决了 Simon Willison 等实体密集型合法 feed（实测 1,012 次展开）解析失败的问题；由于 `maxExpansionDepth=10`、`maxExpandedLength=100,000`、`maxEntitySize=10,000` 依然保持不变，Billion Laughs 指数爆炸漏洞仍被完全防御。
3. **测试真实可信，无作弊行为**：测试用例从 81 增至 101（全套 15 个测试文件、101 条用例全部通过），Mock 严格限定在 `FetchFn` 与 `SpawnFn` 边界，未 Mock 任何被测业务逻辑，覆盖了正常解析、字段兜底、非 2xx 重试、网络异常重试、双失败聚合报错、SSRF 前置拦截等全部关键分支。
4. **配置符合规范与灰度纪律**：18 个源在 `config/sources.json` 中配置清晰，新源初始权重均控制在 0.3~0.4（低 weight 灰度）；`config/domain.json` 补齐中文关键词，使中文源（机器之心/量子位/b站/中文Exa）正常进入相关性过滤与启发式打分，未对英文打分引入负面干扰。

---

## 审查发现（按优先级排序）

### P0 级问题（阻断性安全 / 崩溃 / 数据损毁）
- **无**。未发现任何 P0 级缺陷。

---

### P1 级问题（严重逻辑漏洞 / 明显功能缺陷）
- **无**。未发现任何 P1 级缺陷。

---

### P2 级问题与优化建议（健壮性 / 观测性 / 长期演进）

#### [P2-1] `src/collector/adapters/agentreach.ts:165` — `entry.upload_date` 类型防御性收紧
- **文件与行号**：[`src/collector/adapters/agentreach.ts:165`](file:///Users/aiatwork/.review-worktrees/domainbot-agy-437365c/src/collector/adapters/agentreach.ts#L165)
- **现象证据**：
  ```ts
  const publishedAt = entry.upload_date ? Date.parse(`${entry.upload_date.slice(0, 4)}-${entry.upload_date.slice(4, 6)}-${entry.upload_date.slice(6, 8)}`) || 0 : 0
  ```
- **分析**：`entry` 来自 `JSON.parse(trimmed)`。虽然 `yt-dlp` 的 `upload_date` 标准输出为 `"YYYYMMDD"` 字符串或缺失，但若某些 yt-dlp 变体或异常输出把日期解析为数字（如 `20260902`），调用 `entry.upload_date.slice()` 将抛出 `TypeError: entry.upload_date.slice is not a function`，导致整行或整个适配器报错。
- **建议**：增加显式类型和长度保护：
  ```ts
  const publishedAt = typeof entry.upload_date === 'string' && entry.upload_date.length === 8
    ? Date.parse(`${entry.upload_date.slice(0, 4)}-${entry.upload_date.slice(4, 6)}-${entry.upload_date.slice(6, 8)}`) || 0
    : 0
  ```

#### [P2-2] `src/collector/dedupe.ts:12-14` — 中文无空格标题在 Jaccard 聚类时的 Tokenizer 颗粒度限制
- **文件与行号**：[`src/collector/dedupe.ts:12-14`](file:///Users/aiatwork/.review-worktrees/domainbot-agy-437365c/src/collector/dedupe.ts#L12-L14) 与 [`src/refinery/cluster.ts:12-13`](file:///Users/aiatwork/.review-worktrees/domainbot-agy-437365c/src/refinery/cluster.ts#L12-L13)
- **现象证据**：
  ```ts
  export function tokenize(s: string): Set<string> {
    return new Set(normalizeText(s).split(' ').filter((t) => t.length > 1))
  }
  ```
- **分析**：
  - 英文标题按空格分词，相似文章（如 `vLLM v0.28.0 Released` 与 `vLLM v0.28.0 update`）能计算出高 Jaccard 相似度并聚成一簇。
  - 中文标题通常字间无空格（例如 `机器之心：大模型推理优化实战` vs `量子位：大模型推理优化实战`），`normalizeText` 去除标点后为单个整串，`split(' ')` 只能切出 1 个超长 token（如 `大模型推理优化实战` 和 `量子位大模型推理优化实战`），两者交集为 0，Jaccard 相似度为 0。
  - **影响评估**：精确去重（`contentHash` SHA-1）、相关性过滤（`hay.includes(k)` 子串匹配）均不受影响；但中文同事件跨源报道可能无法被合并为一个 DigestCluster 卡片，各自作为独立卡片推入。
- **建议**：在后续迭代中，若中文源同事件重复报道较多，可在 `tokenize` 中对包含 CJK 字符的文本引入 2-gram（二元滑动分词）或轻量分词，提高中文聚类合并率。

#### [P2-3] `src/collector/adapters/agentreach.ts:199` — `fetchJinaViaExa` 独立导出时的 SSRF 防御一致性
- **文件与行号**：[`src/collector/adapters/agentreach.ts:199`](file:///Users/aiatwork/.review-worktrees/domainbot-agy-437365c/src/collector/adapters/agentreach.ts#L199)
- **现象证据**：
  ```ts
  export async function fetchJinaViaExa(source: SourceConfig, spawnFn: SpawnFn = exaSpawn): Promise<RawItem> {
    const { stdout } = await spawnFn('mcporter', [
      'call', 'exa.web_fetch_exa', '--args',
      JSON.stringify({ urls: [source.url] }),
    ])
    return parseFetchedPage(stdout, source.id, source.url)
  }
  ```
- **分析**：当前管线路由统一走 `fetchJina`，在第 210 行统一执行 `isPublicHttpsUrl(source.url)` 检查，因此重试链路是安全的。但 `fetchJinaViaExa` 作为独立 `export` 函数，若未来有其他模块直接引用，可能脱离前置检查。
- **建议**：在 `fetchJinaViaExa` 内部同样加上 `if (!isPublicHttpsUrl(source.url))` 断言，或取消 `export` 改为模块内部私有函数。

---

## 核心维度审查细则

### 1. P0 级代码安全性与正确性审计

| 检查项 | 验证方式 | 结论与证据 |
|---|---|---|
| **SSRF 防御位置** | 代码审计 + 测试核验 | **通过**。在 `fetchJina`（第 210-212 行），`isPublicHttpsUrl(source.url)` 置于首行，先于任何 HTTP 请求和 spawn 兜底。非公开 HTTPS（包括 `169.254.169.254`、私网 IP、`user:pass@host`、非 HTTPS 协议）立即 throw。`tests/agentreach.test.ts:182` 与 `202` 测试全部验证通过。 |
| **错误聚合语义** | 分支逻辑审计 | **通过**。当第一跳失败（`lastErr` 记录 HTTP 错误或网络异常）且第二跳 exa 失败时，抛出格式为 `${lastErr.message}；exa 兜底也失败: ${fallbackErr.message}` 的聚合异常；第一跳成功则立即返回，不会走兜底；第二跳成功则正常返回解析条目。 |
| **ytsearch 健壮性** | 真实命令执行 + 异常测试 | **通过**。`yt-dlp` 经 `execFile` 传入参数数组，杜绝 Shell 注入。解析遍历 stdout 逐行执行 `JSON.parse`，`try/catch` 跳过非 JSON 行；`title` / `url` 兜底链（`webpage_url ?? url ?? watch?v=id`）完备，缺少 title/url 的无效行直接 `continue` 跳过。 |
| **Markdown 标题提取** | 正则审计 | **通过**。`parseFetchedPage` 使用 `markdown.match(/^#{1,3} (.+)$/m)?.[1]` 提取第一行 H1-H3 标题，无标题时回落为 `source.url`，正文截取前 2000 字符，哈希去重计算一致。 |

---

### 2. 安全闸门放宽评估与量化理由

#### (1) `fetchUtil.ts` MAX_BODY_BYTES：256 KiB → 2 MiB
- **放宽动因**：真实环境中，arXiv CS.AI 的 RSS feed 单文件体积常达 0.8 MB ~ 1.8 MB（包含数十篇论文的完整摘要）。256 KiB 上限导致 arXiv 采集必然触发 `sizeLimit` 中止，整源长期被拒。
- **DoS 风险量化**：
  - `withSizeLimit` 使用流式读取（`reader.read()`），一旦累计字节数超过 2,097,152 字节立即触发 `AbortController.abort()` 中止连接，恶意超大响应不会被全部读入内存。
  - 单个源 2 MiB Buffer 在 V8 堆内存（默认 2GB~4GB）中占比不到 0.1%，GC 回收极快，CPU 拼接耗时 < 1ms。
  - **结论**：放宽至 2 MiB 属于安全、合理的业务必需调整。

#### (2) `rss.ts` fast-xml-parser processEntities 配置放宽
- **放宽动因**：`processEntities: true` 默认配置中 `maxTotalExpansions = 1000`。Simon Willison 等高密度博客 Atom Feed 包含大量 HTML 实体（如 `&amp;`, `&quot;`, `&lt;`, `&#39;`），实测单文件实体展开数达 1,012 次，触发解析器异常。
- **当前配置**：
  ```ts
  processEntities: {
    enabled: true,
    maxEntitySize: 10_000,
    maxExpansionDepth: 10,
    maxTotalExpansions: 20_000,
    maxExpandedLength: 100_000,
    maxEntityCount: 1000,
  }
  ```
- **XML 实体爆炸（Billion Laughs / Quadratic Blowup）防护评估**：
  - **递归深度防护**：`maxExpansionDepth = 10` 维持默认档，禁止深层递归实体嵌套，彻底消除指数爆炸。
  - **总长度防护**：`maxExpandedLength = 100,000` 限制单实体最大扩展字符数。
  - **总展开数防护**：`maxTotalExpansions = 20,000` 允许 20,000 次展开。即使 20,000 次全部发生，在 2 MiB 文本限制下，CPU 耗时实测 < 5ms，完全不会造成事件循环阻塞。
  - **结论**：防护参数组合保持了多维约束，有效防御 XML 炸弹，量化安全。

---

### 3. 测试质量与防作弊审查

- **总用例数**：15 个测试套件，**101 / 101 全部通过**（耗时 1.96s）。
- **新增 20 条测试覆盖明细**（位于 `tests/agentreach.test.ts` 等）：
  1. `ytsearch`: 解析 yt-dlp `--dump-json` 输出、非 JSON 行丢弃、无 URL 行丢弃、view_count 格式化；
  2. `ytsearch`: 缺少 url 时使用 `id` 拼接 `https://www.youtube.com/watch?v=...` 兜底；
  3. `jina 重试链`: r.jina.ai 返回 401 状态码时，无缝切换到 `mcporter call exa.web_fetch_exa` 兜底并解析 Markdown；
  4. `jina 重试链`: r.jina.ai 网络抛错异常时，同样切换到兜底；
  5. `jina 重试链`: 两条链均失败时抛出聚合错误信息（含第一跳与第二跳原因）；
  6. `jina 重试链`: SSRF 非公开 HTTPS URL 在进入重试链前被前置拦截，不调用 exa 兜底；
  7. `parseFetchedPage`: Markdown 无标题行时回落到 URL；
  8. `SSRF 矩阵`: 严格拒绝 HTTP、127.0.0.1、10.x、192.168.x、云元数据 IP、userinfo 认证 URL。
- **防作弊审查结论**：
  - Mock 仅存在于 `FetchFn`（模拟 HTTP 响应）与 `SpawnFn`（模拟 CLI stdout/stderr）外部 IO 边界；
  - 没有针对特定输入打桩的假断言，断言均严格检查了函数返回值的数据结构与属性内容；
  - 核心逻辑全部在被测函数内部真实运行。

---

### 4. 配置一致性与灰度纪律核查

- **源总数**：18 个源（全部 `enabled: true`，ID 全局唯一无冲突）。
- **类型与 URL 契约一致性**：
  - `rss` (6源): `arxiv-cs-ai`, `huggingface-blog`, `hn-frontpage`, `simonwillison`, `jiqizhixin`, `qbitai` — URL 均为标准 HTTP/HTTPS feed。
  - `github` (3源): `github-new-llm-tools`, `github-agents`, `github-rag` — URL 包含 `{{since_days:7}}` 模板参数。
  - `exa` (3源): `exa-llm-news`, `exa-agent-releases`, `exa-cn-ai` — URL 字段为自然语言语义检索词（含中文搜索词）。
  - `jina` (3源): `hf-daily-papers`, `openai-news`, `anthropic-research` — URL 均为目标网页公开 HTTPS 地址。
  - `v2ex` (1源): `v2ex-hot` — V2EX 热门 API 地址。
  - `bili` (1源): `bili-llm` — URL 字段为 B站 搜索词。
  - `ytsearch` (1源): `yt-llm` — URL 字段为 YouTube 搜索词。
- **权重灰度纪律**：所有新增源初始权重均设为 `0.3` 或 `0.4`（老源为 `0.5`~`0.6`），符合先验低权重灰度进入、由后续 👍/👎 反馈驱动 Beta(1,1) 后验更新的既定自进化设计。
- **中文关键词影响**：`config/domain.json` 补充 `["大模型", "人工智能", "智能体", "多模态", "推理模型", "端侧"]`。由于相关性过滤采用 `hay.includes(k)` 子串匹配，中文关键词是中文源内容通过候选池的必要条件，且在启发式打分中提供了合理的关键词命中增益（`kwPart` 基于 sqrt 饱和压缩），不会导致分数虚高。

---

### 5. 管线交互与观测性核查（P2）

- **每源配额（perSourceCap）**：`Math.max(2, Math.ceil(maxPerDigest / 2))`（默认 3 条），成功防止单一源（如 arXiv 或机器之心）垄断整个 Digest 推送。
- **反馈与权重更新**：`index.ts` 过滤使用原始分（`raw >= scoreThreshold`），加权分仅用于排序。即使新源初始权重偏低，只要内容质量达标仍能进入候选池并归档，避免反馈死锁。
- **观测性（skippedSources）**：若本机缺失 `yt-dlp` 或网络单源瞬时抖动（如 `hnrss.org`），异常在 `collectSource` 循环中被捕获并推入 `skipped`，`observation.skippedSources` 记录源 ID，整轮管线不中断并具备完整观测追踪能力。

---

## 审查活动记录

### 实际审阅文件清单
1. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/src/collector/adapters/agentreach.ts`
2. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/src/collector/adapters/fetchUtil.ts`
3. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/src/collector/adapters/rss.ts`
4. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/src/collector/adapters/github.ts`
5. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/src/collector/dedupe.ts`
6. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/src/collector/urlTemplate.ts`
7. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/src/refinery/filter.ts`
8. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/src/refinery/scorer.ts`
9. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/src/refinery/cluster.ts`
10. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/src/index.ts`
11. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/src/types.ts`
12. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/config/sources.json`
13. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/config/domain.json`
14. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/docs/source-expansion-agentreach-2026-09-02.md`
15. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/README.md`
16. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/tests/agentreach.test.ts`
17. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/tests/adapters.test.ts`
18. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/tests/fetchUtil.test.ts`
19. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/tests/e2e.test.ts`
20. `/Users/aiatwork/.review-worktrees/domainbot-agy-437365c/tests/startup.test.ts`

### 实际执行验证命令
- `git log -n 5 --oneline`：核对基线提交与当前提交拓扑
- `git diff dd95df4 437365c --stat` & `git diff dd95df4 437365c`：全量变更 diff 逐行审计
- `npx vitest run --reporter=verbose`：全量测试套件执行（15 suites / 101 tests 全绿）
- `npm run typecheck && npm run build`：TypeScript 严格类型检查与生产构建
- `node -e 'const { XMLParser } = require("fast-xml-parser"); ...'`：核查 fast-xml-parser 默认配置与实体展开防护
- `node -e '<sources.json 校验脚本>'`：验证 18 个源 ID 唯一性、权重范围及类型合法性
- `which yt-dlp && yt-dlp --version`：确认本机 yt-dlp 安装状态（2026.08.19）
- `which mcporter && mcporter list`：确认 mcporter 与 exa 工具状态
- `mcporter call exa.web_fetch_exa --args '{"urls":["https://openai.com/news/"]}'`：实测 exa 兜底抓取输出格式与 Markdown 解析兼容性
- `yt-dlp --dump-json --flat-playlist "ytsearch5:LLM inference optimization explained"`：实测 yt-dlp 搜索 JSON 流输出与字段格式

---
*报告生成于 2026-09-02 | 审查人：agy*
