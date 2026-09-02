# 自进化领域专家 Bot —— MVP v2（探针口径，小智，2026-09-01）

> 老张拍板（2026-09-01）：本 bot 定位为 fati-server 千 bot 路线"需求 50"命题的**假门测试探针**，第一个用户是老张本人。一个 bot 跑通 = 无数 bot 可跑通的最小证据。取代 DeepSeek v1 方案的 Task 1-12 口径（v1 评审见 `2026-09-01_domain-expert-bot-review-zcode.md`）。

## 假门逻辑（要验证什么）

| 待验证命题 | 探针证据 | 判定 |
|---|---|---|
| 用户要"AI 帮我盯领域" | 老张是否持续看推送 | 两周内 ≥ 10 次主动查看 |
| 推送的东西真有价值 | 👍/👎 反馈率 | 👍 率 ≥ 30% |
| "自进化"可感知 | 源权重是否稳定收敛、旧闻是否被识别 | 第 3 轮起噪音下降 |
| 千 bot 工厂的需求形态 | 本 bot 与 claim graph 同构的"增量判定" | 结论反哺 fati-server |

## MVP 范围（收紧后）

- **一个领域**（config 可换）：AI/LLM 领域。
- **三个免维护源**：arXiv（Atom RSS）、GitHub（REST API search）、一个高质量博客 RSS。
- **提炼**：关键词相关性过滤 → 价值打分（启发式打分器兜底 + OpenAI 兼容 LLM 打分器可插拔，走 env 配置）→ 近似重复聚类（jaccard）→ 每日限量。
- **推送**：本地文件 outbox/（今天就能跑）+ Telegram（带 👍/👎 inline 按钮，拿到 token 即启用；工作区有 hermes-telegram 网关经验）。
- **进化**：ε-greedy + Beta 平滑的源权重更新（每周量级信号也不抖动）；记忆库（JSON 归档 + 新颖性判定）支持导出/人工修正。
- **明确不做**：X/微博/Reddit/B站适配器、向量数据库、微调、多领域。

## 仓库与验证

- 独立仓库 `~/Projects/domain-bot/`（TypeScript + vitest，TDD）。
- 验证：`npm test`（vitest 全绿）+ `npx tsc --noEmit`；遵守工作区"编辑后验证"铁律。
- 采集/打分/推送全部依赖注入 fetchFn，测试离线可跑。

## 与其他项目的接口

- **fati-server**：增量判定与 claim graph 同构；两周探针结论（反馈率、权重收敛性）写成报告归档 `fati-server/docs/reviews/`（由老张决定是否入库）。
- **tuna**：记忆库即"智能私有化"的画像雏形；embedding 方案先读 tuna-embedding-architecture 技能再决定是否升级。
- **fati-local-service**：LLM 打分器 base_url 可指向本地推理，零改动切换。
