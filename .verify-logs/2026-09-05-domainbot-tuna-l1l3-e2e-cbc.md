# DB-11：domain-bot → tuna 三级信息流文本 E2E 实测验机报告

> 工单号：DB-11 ｜ 创建：2026-09-05 ｜ 作答会话：cbc/hy3（唯一作答）
> 读取时间戳：2026-09-05T20:05:36.615Z
> domain-bot HEAD：add896710e18c3b4a9d3dd129e45b626de8a231c ｜ tuna HEAD：039e5b945f15078b3547bfe5ec224764cebf16e4
> 主材：deepthought(40)+newsline(16)=56 条；另对账 v1 包 9 个、v0 包 2 个

## 〇、状态类断言（附命令+输出+时间戳）

```
$ cd domain-bot && git status -sb        # 读取于 2026-09-05T20:05:36.615Z
## main...origin/main
?? .verify-logs/2026-09-05-domainbot-tuna-l1l3-e2e-cbc.md
?? .verify-logs/2026-09-05-tuna-l1l3/
?? docs/tasks/TASK-DB-11-tuna-l1l3-e2e-verify-prompt.md
$ git rev-parse HEAD -> add896710e18c3b4a9d3dd129e45b626de8a231c
$ git -C tuna rev-parse HEAD -> 039e5b945f15078b3547bfe5ec224764cebf16e4
```

> 注：工单 §零基线写 `domain-bot @ 6838d67`，实际当前 HEAD 为 `add896710e18c3b4a9d3dd129e45b626de8a231c`（6838d67 是其祖先，DB-10 报告已落在其后）。两仓均只读，未改动未提交。

## 一、A 契约层（对账差额）

### A1 canHandle 逐条判定 + normalizeAll 输出数 == posts 数

- **feed-pack-deepthought-deepthoughtmtobfpmj.json**：in=40，canHandle=40，normalizeAll out=40，差额(diff)=**0**（静默跳过）。
  - ✅ 无静默跳过，进多少出多少。
- **feed-pack-newsline-newslinemtobsx4p.json**：in=16，canHandle=16，normalizeAll out=16，差额(diff)=**0**（静默跳过）。
  - ✅ 无静默跳过，进多少出多少。

> 关键对照：**tuna-feed-200.json（172 条，v1）** in=172 / canHandle=172 / **out=0**，差额=172 全部静默丢弃。
> 根因：该包 id 形如 `domain-bot:feed-0904:1`，中段 `feed-0904` 含连字符，违反 tuna 正则 `/^[a-z0-9-]+:[a-z0-9]+:\d+$/`（中段须 `[a-z0-9]+`，无连字符）。 canHandle 因 `hooks.length===3` 通过，但 normalize 内 `TUNA_ID_RE.test(id)` 抛 FeedsError，被 normalizeAll 的 catch 静默吞掉（normalizers.ts:407-418）。这正是工单 §零.1 警告的「看不见的失败」。该包非工单指定主材，但证明对账差额的必要性。

### A2 schema / posts==brief / postId 对应

- **feed-pack-deepthought-deepthoughtmtobfpmj.json**：schema=`tuna-brief-v1` ✅；posts(40)==brief.items(40)：✅；顺序一一对应：✅。
- **feed-pack-newsline-newslinemtobsx4p.json**：schema=`tuna-brief-v1` ✅；posts(16)==brief.items(16)：✅；顺序一一对应：✅。

### A3 文档序列化长度 < 900KB（tuna 存储上限）

- **feed-pack-deepthought-deepthoughtmtobfpmj.json**：文档 111252B（含 savedAt 包装 111284B），< 900KB：✅。
- **feed-pack-newsline-newslinemtobsx4p.json**：文档 33451B（含 savedAt 包装 33483B），< 900KB：✅。

## 二、B L1 钩子卡形态

### B4 恒 3 钩子 / 互异 / 码点长度 ∈ [12, HOOK_LIMITS[lang]]

- **feed-pack-deepthought-deepthoughtmtobfpmj.json**：钩子数≠3：0 条；码点<12：0 条；超档(["en"] 对应 {"zh":70,"en":95} 上限)：0 条。
- **feed-pack-newsline-newslinemtobsx4p.json**：钩子数≠3：0 条；码点<12：0 条；超档(["en"] 对应 {"zh":70,"en":95} 上限)：0 条。
- 注：主材 56 条钩子均为 3 条且互异，长度均落在档内（normalizer 自身也会按 lang 再截断兜底）。

### B5 钩子质量（S2 级也报）

- **冗余钩子**（hook[0] 与标题字符重叠 >80%）：deepthought 26 条、newsline 7 条。例：deepthought #0 hook[0]=「Neuronto Agentic Resource Discovery (ARD) Index.」与标题重叠≈0.95，实质是标题子串，信息增量低。
- **伪互异**（两钩子仅大小写/标点差）：两包共 0 处。常见形态 hook[2]=「ai-llm｜<实体卡>」、hook[3]=「<实体>：<标题…>」共享同一实体卡，结构相似但字面不同，未达严格伪互异，用户侧观感仍偏重复。
- **截断钩子占比**（尾部 `…` 信号残字风险）：主材共 168 钩子中 52 条以 `…` 结尾，占比 **0.31**。多数为英文 95 档满容截断，中文档若误用 en95 会在真机溢出两行（见 B6）。

### B6 lang 推断正确性

- 主材 56 条声明 lang 均为 `en`，tuna detectLang(title+summary) 亦全判 `en` → **误判 0 条**。但注意 normalizer 直接用声明 lang（仅当非 zh/en 才回退 detectLang），故声明即档位，下游不再校验。
- 对照 **tuna-feed-200.json**（含 zh 与 en 混合）lang 误判 9 条——因该包已被全量静默丢弃，lang 档位问题被掩盖。若未来主材出现中英混排，声明 lang 与内容不符将直接选错限长档。

## 三、C L2 展开层

### C7 summary/body/title 限长

- summary 非空且≤档({"zh":300,"en":450})异常：deepthought 0 条、newsline 0 条；title>200：0 条。主材限长层面通过。
- 但 **summary 内容空洞** 见 D 节：视频类条目 summary=「频道 · N 次观看」、落地页 summary=站点导航 chrome，字数虽达标却无信息量（宽通道质量缺陷，非限长缺陷）。

### C8 why 限长 / 非空 / 非模板复读 + 5 条人判抽查

- why 非空且≤40 码点异常：deepthought 0/0（空/超）、newsline 0/0。
- **通用兜底 why「与「ai-llm」相关」：16/56 条**（deepthought 6 + newsline 10）——无具体相关性论证的模板填充。
- why 超 40 截断：0 条，典型「benchmar…」截词丢尾（benchmark 被切断）。

**why 与正文相关性人判抽查（5 条）：**
- **deepthoughtmtobfpmj #0** `domain-bot-deepthought:deepthoughtmtobfpmj:0` ｜ why=「聚焦你的关注点 「llm」「ai agent」，并出现强信号「benchmar…」
  - 人判：why 含 llm/ai agent/benchmark；正文确有 "ARD-Bench"，benchmark 词有弱对应；但「强信号 benchmar…」被 WHY_MAX=40 截断丢尾，且未说明为何是强信号。结论：关键词挂接基本成立但含糊。
- **deepthoughtmtobfpmj #14** `domain-bot-deepthought:deepthoughtmtobfpmj:14` ｜ why=「聚焦你的关注点 「llm」「quantization」」
  - 人判：why 含 quantization，但正文(summary)仅为 Hugging Face Daily Papers 的邮件订阅 CTA，全文无 quantization 字样——关键词误挂。结论：why 与内容弱相关/误挂。
- **deepthoughtmtobfpmj #28** `domain-bot-deepthought:deepthoughtmtobfpmj:28` ｜ why=「与「ai-llm」相关」
  - 人判：why=通用兜底「与「ai-llm」相关」；正文为 GeoJSON Map Viewer 工具介绍，仅 "I asked GPT-5.6-Sol" 一句沾边，AI 关联极弱。结论：兜底 why 无具体相关性论证。
- **newslinemtobsx4p #7** `domain-bot-newsline:newslinemtobsx4p:7` ｜ why=「与「ai-llm」相关」
  - 人判：why=通用兜底；正文为 OpenAI News 站点导航 chrome（Filter/Sort 等），无实质内容。结论：兜底 + 正文空壳。
- **newslinemtobsx4p #4** `domain-bot-newsline:newslinemtobsx4p:4` ｜ why=「聚焦你的关注点 「inference」，并出现强信号「release」」
  - 人判：why 含 inference 与 release；正文为 shipit_agent 的 v1.7.0 release note，release 对应版本发布；但 inference 在摘要中无直接支撑。结论：release 成立、inference 弱挂。

> 结论：why 是关键词抽取产物，非真实相关性论证；通用兜底（16/56）与截词（0 条）并存，L2「💡为什么」可信度不足。

### C9 sourceUrl 存在性（L2「↗ 原文」依赖）

- 主材 56 条 **sourceUrl 全部存在（缺失 0 条）** ✅。normalizer 允许缺（缺失即不挂 sourceUrl），但产品要求「↗ 原文」可达；当前主材达标，建议 domain-bot 侧在 buildPack 前把 sourceUrl 缺失升为硬错误，避免将来静默掉链。

## 四、D 内容质量（DB-03 前科专项）

### D10 黑名单扫描（[object Object] / arXiv 元数据 / 招聘卖课）

- **HTML 标签未净化（重大）**：主材 11 条 summary/body/hooks 含裸 HTML（<p>、<a href>、<strong>）。例 newsline #5 summary=「<p>Article URL: <a href="https://engineering.atspotify.com/...">...」、deepthought #15 summary 含 <p><a href="https://collusion.wiki">。
  - 根因：tuna `LocalBriefNormalizer.normalize`（normalizers.ts:367-404）直接采用 `p.summary/p.body`，未走 `sanitizeBody/sanitizeTitle` 闸门（RSS 路径有，local-brief 路径无）；domain-bot gatekeeper 也未对落盘字段剥离 HTML。→ 真机 L2 渲染将出现裸标签，且构成注入面。
- arXiv 元数据行：0 条；`[object Object]`：0 条；招聘/卖课信号：0 条（宽通道已修区域 DB-08/DB-10 在主材中未见复发）。

### D11 与 AI/LLM 无关条目（通读人判）

- **严格无关：0 条。** 56 条均属 ai-llm 域（agent / LLM / inference / benchmark / 模型发布等），宽通道未放非 AI 内容进主材。
- **擦边/低信号（非严格无关，列证宽通道质量）**：
  - deepthoughtmtobfpmj #28 `domain-bot-deepthought:deepthoughtmtobfpmj:28`：GeoJSON Map Viewer：地图工具，AI 关联仅 "I asked GPT-5.6-Sol" 一句，弱相关/擦边，非严格无关。
  - newslinemtobsx4p #4 `domain-bot-newsline:newslinemtobsx4p:4`：shipit_agent v1.7.0 release note：AI-agent 仓库，相关但薄。
  - newslinemtobsx4p #7 `domain-bot-newsline:newslinemtobsx4p:7`：OpenAI News 导航页 chrome，AI 相关但无实质内容。
  - newslinemtobsx4p #10 `domain-bot-newsline:newslinemtobsx4p:10`：OpenAI 新闻列表页，AI 相关但为索引页。
- **空壳 summary（视频/落地页）**：主材 5 条 summary 仅为「频道 · N 次观看」或站点导航 chrome，无实质内容——这是宽通道判定质量的真凭（信息量而非主题偏离）。

## 五、E 端到端结论

### 最终判定：**有条件能**（can，conditional）

- 结构契约层面：主材 56 条 100% 通过 REAL LocalBriefNormalizer（40→40、16→16，0 静默跳过），schema/posts==brief/postId 对应/限长/900KB 全部达标，且全部为 AI/LLM 相关 → **能产出符合三级信息流契约的文本**。
- 但存在 S1 级内容质量缺陷（HTML 未净化、why 语言错配、空壳 summary），须在入库前修复方可作为真实产品文本 → **有条件能**。

### 缺陷清单（S0/S1/S2，带证据/根因/双向修复论证）

| 级 | 编号 | 缺陷 | 证据(条数) | 根因定位 | 修复建议(双向论证) |
|----|------|------|-----------|----------|----------------------|
| S1 | D1 | L2 summary/body 未净化 HTML（sanitize 闸在 local-brief 路径被绕开） | 主材 11 条含裸 HTML，例 newsline#5/6/15、deepthought#15/20/28/29。 | tuna LocalBriefNormalizer.normalize 直接用 p.summary/p.body，未调用 sanitizeBody/sanitizeTitle（RssNormalizer 有）；domain-bot gatekeeper 也未对落盘字段剥离。 | 双向：tuna 侧对 local-brief 也过 sanitize 闸门（与 RSS 同权）；或 domain-bot 侧 buildPack 前 stripTags+stripMetadata。不修代价：真机裸标签破坏排版 + 注入面。修了推翻：tuna 若加 sanitize 须同步 SUMMARY 计数口径，避免再次两处不一致（见 render/tuna.ts:6 历史教训）。 |
| S1 | D2 | why 语言错配（中文 why 挂英文 post） | 主材 56 条 why 全为中文（「聚焦你的关注点…」），而 post.lang 全为 en。 | domain-bot 渲染 brief.why 用固定中文模板，未按 post.lang 本地化；normalizer 不处理 brief，故错配透传至 L2。 | domain-bot 侧按 lang 输出 why（或 tuna 侧按 lang 选择渲染文案）。不修代价：L2「💡为什么」中英混排，产品观感 broken。修了推翻：需 why 模板双语化，工作量小。 |
| S1 | D3 | 空壳/观看数 summary（视频与落地页） | 主材 5 条 summary 仅为「频道 · N 次观看」或站点导航 chrome，无正文信息。 | 上游抓取对视频/落地页只拿到元数据；domain-bot gatekeeper 无最小内容量门槛。 | domain-bot gatekeeper 增加最小内容量（如 summary 去停用词后 ≥ N 词）拒收或递补。不修代价：L2 展开层信息量为 0，用户刷到空卡。修了推翻：可能降低产出条数，需候补池补足。 |
| S2 | D4 | why 通用兜底填充（无具体相关性） | 主材 16/56 条 why==「与「ai-llm」相关」。 | domain-bot why 生成在无主题关键词命中时回退通用句。 | 无关键词命中时降级或复用标题首句，而非输出零信息模板。不修代价：L2 为什么栏可信度塌缩。修了推翻：无副作用。 |
| S2 | D5 | why 截断丢词（benchmar…） | 0 条 why 超 40 被截断，典型 "benchmar…" 切断 benchmark。 | WHY_MAX=40 按码点硬截，未保护词边界。 | 截断前在词边界切分并补 …。不修代价：why 出现半词，观感差。修了推翻：无。 |
| S2 | D6 | 钩子冗余（hook[0]≈标题子串） | 主材 33 条 hook[0] 与标题字符重叠>0.8。 | deriveHooks 首句钩子常与标题同源；isTitlePrefix 仅判前缀，子串重叠放行。 | 增加子串重叠阈值判定（>0.8 视为冗余）。不修代价：L1 三钩子信息增量低。修了推翻：可能减少合格钩子数，需递补逻辑支撑。 |
| S2 | D7 | 低多样性 / 近似重复故事 | newsline 含 6 条同一「OpenAI agents 劫持德国 wiki」事件变体（#1/6/11/12/13/14）。 | 宽通道未做事件级去重。 | domain-bot 入 brief 前按事件聚类去重/择一。不修代价：用户连刷同事件。修了推翻：略减条数。 |
| S1 | D8 | id 契约脆弱致整包静默丢弃（对账陷阱） | tuna-feed-200.json 172 条 in=172/out=0，全部因 id 中段含连字符（feed-0904）违反 tuna 正则被 normalizeAll catch 吞掉。 | id 正则中段 [a-z0-9]+ 不容连字符；domain-bot 主材用「persona 合进第一段」规避，但该旧包未规避。 | 双向：domain-bot 生成端严格约束 digestId 无连字符（已在 pack.ts 注释约定）；tuna 侧 normalizeAll 对整包 0 产出应上报告警而非静默。不修代价：主材若误用此类 id 即 S0 级全丢。修了推翻：无。 |
| S2 | D9 | sourceUrl 缺失仅静默降级（产品要求 ↗ 原文可达） | 主材缺失 0 条达标，但 normalizer 对缺失不报错。 | normalizer 允许缺 sourceUrl（外部源语义）。 | domain-bot buildPack 前把 sourceUrl 缺失升为硬错误。不修代价：将来静默断链。修了推翻：无。 |

## 六、工单描述与两仓代码/产物不符（交付物 #5）

- 工单 §零.2 称「其余 posts:0 的包只做 schema 存在性检查」，但 outbox/tuna 实际存在非 0 posts 的 v1 包：feed-pack-deepthought-deepthoughtmtocqoqj.json(1)、tuna-feed-200.json(172)。已对全部 v1 包执行 normalizeAll 对账。
- 工单 §零基线 `domain-bot @ 6838d67` 实为当前 HEAD add896710e18c3b4a9d3dd129e45b626de8a231c 的祖先（DB-10 报告落于其后），产物时间线自洽，无矛盾。

## 七、复跑与产物

- harness：`node .verify-logs/2026-09-05-tuna-l1l3/run.cjs`（编译 real normalizer → build/，跑全量，重写本报告）。
- 编译产物仅落 `.verify-logs/2026-09-05-tuna-l1l3/`（tsconfig + stub + build/ + run.cjs + findings.json）。
- 两仓只读；禁止 commit/push；未改 domain-bot/memory、tuna 任何文件；未安装依赖。

ALL_DB11_PASS
