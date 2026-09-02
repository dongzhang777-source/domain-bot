# agent-reach 安装原委与收尾清单（2026-09-01 根仓归档）

> 归档日期：2026-09-01
> 归档来源：Hermes state.db 会话 `20260820_000417_0d685f`（安装）与 `20260820_221925_a50bd2`（深夜总结）+ `20260820_230437_8cb825`（状态检查被 Unsloth 问题岔开）
> 关联主线：`docs/cross-project-insights-*.md` 与 `.hermes/plans/2026-09-01_150921-domain-expert-bot.md`（自进化领域专家 bot —— agent-reach 是其"15 平台采集底座"）

## 一、装了什么、怎么装的

- **2026-08-20 00:22**，老张丢来 Agent Reach 安装文档链接，小赫在 Hermes 会话 `20260820_000417_0d685f` 执行安装。
- agent-reach 是开源「互联网能力路由器」(github.com/Panniantong/Agent-Reach)，一个给 AI 助手接各平台渠道的选择器/安装器/健康检查器，本身不包装任何工具，直接用上游工具（OpenCLI / bili-cli / twitter-cli / yt-dlp / mcporter / gh 等）。
- 装法：本机无 pipx，用 venv（`~/.agent-reach-venv`）；`yt-dlp` 要 Python 3.10+，系统 3.9.6 不够，改用 Homebrew Python 3.14；跑 `agent-reach install --env=auto --system --channels=all` 全渠道安装。
- **技能文件铺到三处**（物理拷贝，inode 各不同）：`~/.agents/skills/agent-reach`、`~/.openclaw/skills/agent-reach`、`~/.claude/skills/agent-reach`。所以 Hermes、OpenClaw、Claude Code、以及 DSH（读 `.agents/skills/`）都能看到它。✅ **解释了"DSH 怎么会用 Hermes 装的技能"**。
- `~/.agents/.skill-lock.json` 中**没有** agent-reach → 它非经标准技能管理器安装，是那次直接铺进去的（所以锁文件无记录、需手动维护）。

## 二、当前真实状态（2026-09-01 实测 `agent-reach doctor --json`）

**5/15 渠道可用：**
- YouTube（yt-dlp）、B站（bili-cli）、V2EX（公开 API）、RSS/Atom（feedparser）、任意网页（Jina Reader）

**10/15 需配置（全部 warn，未解锁）：**
- GitHub CLI（有认证配置但 Doctor 不实时验证，warn）
- Twitter/X、雪球 → 缺浏览器 Cookie（需 `agent-reach configure twitter-cookies` / `--from-browser chrome --platform xueqiu`）
- Reddit、Facebook、Instagram、小红书 → 缺 OpenCLI Chrome 扩展（需手动装 + 在对应网站登录）
- 小宇宙播客 → 缺免费 Groq Key（`agent-reach configure groq-key`）
- LinkedIn → 缺浏览器登录态
- 全网语义搜索 → mcporter+Exa 已写配置但 Doctor 未做连通验证（warn）

## 三、遗留收尾（老张 2026-09-01 提及"还有收尾工作没做"）

1. **状态检查没真正跑完**：8/20 深夜老张说"现在跑个状态检查"（msg 48883），但接续会话 `20260820_230437_8cb825` 被 Unsloth 本地模型"关推理报错"调试岔开，agent-reach 渠道状态检查没落地。**本条已在 2026-09-01 用 `agent-reach doctor --json` 补上**（见上节）。
2. **8 个登录型渠道未解锁**：
   - 手动装 OpenCLI Chrome 扩展 → chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk，装完登录 Reddit/Facebook/Instagram/小红书。
   - Twitter/X、雪球 → 导出浏览器 Cookie 后 configure。
   - 小宇宙 → 免费 Groq Key。
   - LinkedIn → 浏览器登录态。
3. **锁文件补齐/可回查**：agent-reach 不在 `.agents/.skill-lock.json`，若想与其他技能一致可补一条记录（source 指向 GitHub 仓库）。
4. **与"自进化领域专家 bot"主线衔接**（`.hermes/plans/2026-09-01_150921-domain-expert-bot.md`）：agent-reach 现成的 5+ 渠道可直接当 bot 环1采集源；剩余渠道解锁后补足小红书/Reddit/雪球等强信源。这应是本轮"收尾"的最终落点。

## 四、可复用的踩坑

- agent-reach 依赖 yt-dlp，需 Python 3.10+；系统 3.9.6 不够 → 用 Homebrew Python 3.14 的 venv。
- Doctor 对"已装但需登录/凭据"的渠道只报 warn 不实时验证（避免写 device-id / 直读浏览器 Cookie），实际可用性需靠真实调用确认。
- Cookie 从不被自动读取：只在用户打算授权某平台时手动执行对应 configure。