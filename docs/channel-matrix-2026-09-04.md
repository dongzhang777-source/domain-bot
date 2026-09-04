# agent-reach 15 渠道信息源验证矩阵（2026-09-04 实测）

> 任务来源：老张指令「逐一验证 15 个渠道中的每一个信息渠道都可以成为信息源」
> 验证方式：每渠道跑一次真实只读请求（agent-reach skill 路由命令），输出截取见当日会话
> 结论：**15/15 渠道无结构性不可用**——6 个立即可用（其中 5 个已在 domain-bot 生产运行），9 个需一次性配置（key/登录态）

## 验证矩阵

| # | 渠道 | 后端 | 实测 | 数据形态 | domain-bot 判定 |
|---|---|---|---|---|---|
| 1 | Exa 搜索 | mcporter | ✅ 200 | 标题/URL/发布时间/高亮 | ✅ 生产在用（exa-llm-news 等） |
| 2 | GitHub | gh CLI | ✅ 200 | 仓库名/描述/stars/updatedAt | ✅ 生产在用（github-* 3 源） |
| 3 | V2EX | 公开 API | ✅ 200 | 主题 title/url/created | ✅ 可用（探针期禁用的中文源，可恢复） |
| 4 | B站 | bili-cli | ✅ 200 | BV号/标题/作者/播放量 | ✅ 可用（禁用中可恢复；营销号内容多，靠打分过滤） |
| 5 | YouTube | yt-dlp ytsearch | ✅ | title/url/upload_date | ✅ 生产在用（yt-llm） |
| 6 | RSS | curl 直连源站 | ✅ 完整 XML | 标准 RSS | ✅ 生产在用（11 个 RSS 源）。⚠️ rsshub.app 公共实例已限流仅测试用，勿作生产源 |
| 7 | Jina 网页 | r.jina.ai 匿名 | ❌ 401 | IP 信誉墙（AS7922）要求认证 | ⚠️ 需配免费 JINA_API_KEY（.env 的 DOMAIN_BOT_JINA_API_KEY，一直空置的原因已实锤） |
| 8 | Twitter/X | twitter-cli | ❌ not_authenticated | — | ⚠️ 需导出浏览器 cookie（TWITTER_AUTH_TOKEN+CT0 环境变量） |
| 9 | Reddit | opencli | ❌ BROWSER_CONNECT | — | ⚠️ 需一次性配置（见下） |
| 10 | 小红书 | opencli | ❌ BROWSER_CONNECT | — | ⚠️ 同上 |
| 11 | LinkedIn | opencli | ❌ BROWSER_CONNECT | — | ⚠️ 同上 |
| 12 | Facebook | opencli | ❌ BROWSER_CONNECT | — | ⚠️ 同上 |
| 13 | Instagram | opencli | ❌ BROWSER_CONNECT | — | ⚠️ 同上 |
| 14 | 小宇宙 | transcribe.sh（已装）+ jina | ⚠️ 脚本在，底层走 jina 匿名被 401 | — | ⚠️ 随 Jina key 一并解锁 |
| 15 | 雪球 | opencli xueqiu | ❌ BROWSER_CONNECT | — | ⚠️ 同 opencli 组 |

**opencli 组（9/10/11/12/13/15）统一解锁条件**：Chrome 打开 + 安装 OpenCLI 桥接扩展（github.com/jackwener/opencli/releases）+ 各平台登录态。一次性配置，6 渠道同时解锁。

## 接入建议（打磨期，未动 sources.json）

- **探针期维持 13 源**（案 A 中文源禁用决策不变）；本矩阵是**加注后扩展**的选型依据。
- 新增候选优先级建议：Twitter（AI 领域一手信息密度最高，配 cookie 后）> Reddit（r/LocalLLaMA 等社区）> 小宇宙（中文播客）> 雪球（金融视角）。每接入一个源都是 I-3 分母成员 + probe-changelog 记录项。
- 中文源（V2EX/B站/小红书）恢复与案 A 决策冲突，须老张重新拍板（属判定相关配置）。

---
*验证人：小智（代理总管）2026-09-04｜agent-reach skill v（Panniantong/Agent-Reach）｜工具形态：本机后端 CLI 直连实测*
