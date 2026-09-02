# domain-bot —— 自进化领域专家 Bot（探针版）

> 定位：fati-server 千 bot 工厂"需求 50"命题的**假门测试探针**，第一个用户是老张本人。
> 一个 bot 跑通 = 无数 bot 可跑通的最小证据。设计文档见 `~/Projects/.hermes/plans/2026-09-01_domain-expert-bot-mvp-v2.md`。

## 它做什么

```
采集(广)               提炼(深)                    进化(闭环)
RSS/Atom/arXiv ┐  去重 → 相关性过滤 → 价值打分 → 每源配额    记忆库(归档+新颖性)
GitHub        ─┤                    (启发式/LLM)   →  推送 ←── 反馈(👍/👎)
Agent-Reach   ─┤                    聚类(同事件合一)      ↓        ↓
  Exa 语义搜索  │                                        洞察   ε-greedy 源权重
  V2EX/B站/YouTube┘                                            + Beta 平滑
  Jina(盯无RSS页)┘
```

- **渠道来自 [Agent-Reach](https://github.com/Panniantong/Agent-Reach) 免登录通道**：Exa 语义搜索（经 mcporter）、V2EX 热门、B站搜索（bili-cli）、YouTube 搜索（yt-dlp，`--flat-playlist` 零登录）、Jina 网页阅读（盯无 RSS 页面；无 key 时自动走 exa.web_fetch_exa 兜底，同样免 key）。需登录态的 Twitter/Reddit/小红书通道**刻意不进**无人值守管线（封号风险），留待人工决策。
- **自进化 = 记忆库 + 反馈回路，不重训模型**。每次推送登记 ref，Telegram 👍/👎 回调写进 `memory/feedback.json`，源权重向 Beta(1,1) 后验均值缓慢移动——每周几十次点击也不会抖动。
- 记忆库是纯 JSON（`memory/archive.json` / `feedback.json`），可导出、可手工修正，防自我固化。

## 快速开始

```bash
npm install
npm test          # 全部测试（离线，不访问网络）
npm start         # 跑一轮真实采集，推送到 outbox/*.md
npm run loop      # 常驻模式，每小时一轮（DOMAIN_BOT_POLL_MS 可调）
```

无需任何 API key 即可运行（启发式打分 + 文件推送）。升级路径见 `.env.example`：

- 填 `DOMAIN_BOT_LLM_*`（OpenAI 兼容，可指向 fati-local-service / DeepSeek / oMLX）→ LLM 价值打分与理由。
- 填 `DOMAIN_BOT_TELEGRAM_*` → Telegram 推送 + 👍/👎 反馈按钮（回调处理需把 `parseCallbackData` 接到 webhook/polling 入口，反馈落 `MemoryStore.recordFeedback`）。

## 配置

| 文件 | 内容 |
|---|---|
| `config/domain.json` | 领域名、关键词、打分阈值、每日限量、聚类阈值 |
| `config/sources.json` | 源注册表（id/type/url/weight/enabled），type：`rss`（含 Atom/arXiv）、`github`、`exa`（url=搜索词）、`v2ex`、`bili`（url=搜索词）、`ytsearch`（url=搜索词，需本机装 yt-dlp）、`jina`（url=目标网页） |
| `config/push.json` | 推送通道与 outbox 目录 |

## 两周探针的判定标准

| 待验证命题 | 证据 | 判定 |
|---|---|---|
| 用户要"AI 帮我盯领域" | 主动查看次数 | ≥ 10 次 |
| 推送真有价值 | 👍 率 | ≥ 30% |
| 自进化可感知 | 源权重收敛、旧闻降权 | 第 3 轮起噪音下降 |

## 已知边界（MVP 刻意不做）

- 不做 X/微博/Reddit/B站 适配器（反爬维护黑洞，跑通后再说）。
- 新颖性判定用标题 jaccard，不是向量检索——量级到了再读 tuna 的 embedding 架构升级。
- 只记录被推送条目到归档；被过滤条目每轮重评（打分器变好后可捞回）。
- Telegram 轮询/webhook 入口未内置，先用文件推送跑通价值判断。
