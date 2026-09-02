# 信息源扩展方案：用 Agent-Reach 扩大 domain-bot 信息面（2026-09-02）

> 背景：两周探针进行中，判定标准是 👍 率 ≥30%。当前 7 源（arxiv-cs-ai、huggingface-blog、github-new-llm-tools、exa-llm-news、hf-daily-papers、v2ex-hot、bili-llm）全部来自 agent-reach 免登录通道。
> 本文盘点 agent-reach 尚未接入的能力，按接入成本分三档。核心原则不变：**需登录态的通道（Twitter/Reddit/小红书/雪球/LinkedIn）不进无人值守管线**（封号风险）。

## 档位一：零代码，只改 config/sources.json（建议先做）

现有 `rss` / `exa` / `github` / `jina` 适配器都是通用的，扩源只是加注册表条目，每源独立 weight、走既有每源配额（防止 arXiv 霸榜的教训已内建）。

| 建议新源 | type | 说明 |
|---|---|---|
| HN 头条（hnrss.org） | rss | `https://hnrss.org/frontpage?points=100`，LLM 领域最高信噪比的免费聚合器之一 |
| Simon Willison 博客 | rss | `https://simonwillison.net/atom/everything/`，LLM 工程实践一手信息 |
| 机器之心 / 量子位 | rss | 中文 AI 资讯面 |
| GitHub 追加查询 | github | 同适配器多开源：`topic:agents`、`topic:rag`、按 stars 增长看趋势 |
| Exa 追加搜索词 | exa | 每个搜索词注册为独立源（如 "AI agent framework release"、中文词），Exa 检索面比 RSS 宽 |
| Jina 盯无 RSS 页面 | jina | OpenAI news、Anthropic research、关键厂商 changelog/release 页 |

## 档位二：小改动，新增适配器（1~2 天）

1. **YouTube 搜索（yt-dlp，零登录）**
   - `yt-dlp --dump-json "ytsearch5:<query>"` 拿标题+描述+频道，结构与 bili 适配器同构（SpawnFn + 逐行/JSON 解析），新增 `ytsearch` type 即可。
   - 深度内容可选加字幕管线（`--write-auto-sub`），但转写成本高，建议只在打分 top-N 时按需拉。
2. **web-reader MCP 作为 Jina 的免费兜底**
   - `mcporter call web-reader.webReader url=...`，本机 mcporter 已可用。Jina 免费档有限流（老张 key 还没配），把 web-reader 接为 `jina` 适配器的失败重试链第二跳，可以先把"盯无 RSS 页面"这条路跑起来，不阻塞在 key 上。
3. **雪球/其他登录态源的半自动旁路（可选）**
   - 仍不进自动管线；做一个"人工触发批次"入口：人肉跑一次 agent-reach 命令，产物 Markdown 丢进 refinery 复用既有去重/打分/聚类。适合偶发的行情/舆情类需求，不背封号风险。

## 档位三：观察后再定

- **小宇宙播客转录**（`~/.agent-reach/tools/xiaoyuzhou/transcribe.sh`）：单集转录成本高，不适合轮询采集；只适合对 hit 到的高价值单集做深读，归入按需拉取而非常驻源。
- **YouTube 评论**（yt-dlp `--write-comments`）：网页抓取不稳定，等 push 反馈显示"缺少社区视角"再考虑。

## 纪律与验证

- 新通道接入前跑 `agent-reach doctor --json` 确认 active_backend；上线前各跑一轮真实采集确认非空内容（"发现命令存在 ≠ 内容可用"）。
- 每加一个源必须在 `config/domain.json` 的每源配额里登记，且首轮以低 weight（0.2~0.4）灰度，靠 👍/👎 反馈让 ε-greedy 自己收敛。
- 外派实现时遵循工单落盘纪律（`日期-项目-主题-身份.md`），外派 agent 禁止 commit/push。

## 与两周探针判定挂钩

扩源节奏建议：第 1 周只做档位一（纯配置，风险为零），观察反馈曲线；若 👍 率健康且"信息面不够宽"是主要 👏 理由，第 2 周再上档位二的 YouTube 搜索 + web-reader 兜底。**不要在探针未出结论前大改源结构**，否则自进化收敛性（第 3 轮起噪音下降）就无法归因。

---

## 执行记录（2026-09-02，前两档已落地，老张拍板"先做前两档"）

老张改了节奏：前两档同日落地。与原方案的差异与实测结论：

1. **档位一 8 个新源已进 `config/sources.json`**（HN hnrss/points=100、Simon Willison、机器之心、量子位、GitHub topic:ai-agents 与 topic:rag、Exa 两路新搜索词含一路中文、Jina 盯 OpenAI news 与 Anthropic research），全部低 weight（0.3~0.4）灰度。
2. **中文关键词坑**：相关性过滤是关键词子串匹配，机器之心/量子位等中文源会被英文关键词整源过滤——`config/domain.json` 已补中文关键词（大模型/人工智能/智能体/多模态/推理模型/端侧）。
3. **兜底改走 `exa.web_fetch_exa` 而非 web-reader MCP**：本机 mcporter 实际只配了 exa 通道（web-reader 未配置）；exa 自带 fetch 工具、免 key、同一 SpawnFn 模式，是更优解。jina 三个源无 key 已实测全走通兜底。
4. **ytsearch 适配器**：`yt-dlp --dump-json --flat-playlist ytsearch5:<词>`，只解析搜索结果页（快、少触发 bot 校验）；yt-dlp 已 brew 安装（2026.08.19），通道实测通过，`yt-llm` 源已启用。
5. **两处安全闸门误伤合法大 feed，已放宽**（实测烟测发现的真问题）：
   - `fetchUtil.ts` MAX_BODY_BYTES 256 KiB → 2 MiB（arXiv cs.AI feed 超限被整源拒收）；
   - `rss.ts` fast-xml-parser processEntities 改对象配置，仅 maxTotalExpansions 1000 → 20000，其余防护（maxExpansionDepth=10 等）保持布尔默认档（Simon Willison feed 实测 1012 次展开被拒）。
6. **验收**：101/101 测试绿（新增 ytsearch 解析/字段兜底、jina 兜底链/SSRF 不绕过等 20 条）；真实全源烟测 18 源 17 通（hn-frontpage 单轮瞬时失败，hnrss 偶发抖动，单源跳过为既定设计），1432 采集 → 727 相关 → 6 推送，skippedSources 观测正常。

