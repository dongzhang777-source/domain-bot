# domain-bot 调度运维（DB-10/S1-4 补登；2026-09-07 订正安装口径与时刻）

- **安装（唯一口径）**：老张在自己打开的 Terminal.app 里跑一次 `bash ops/install-scheduler.sh`
  （WorkBuddy 沙箱会话里 launchctl 会被 macOS 拒，脚本注释有背景）。脚本把
  `ops/com.domain-bot.launchd.plist` 拷为 `~/Library/LaunchAgents/com.domain-bot.plist` 并装载。
- **当前时刻（2026-09-06 DB-20 老张四令）**：每天 11:00 / 15:00 / 19:00 三轮批产。
- **改 plist 后必须重载**（launchd 不会热加载）：`launchctl bootout gui/501/com.domain-bot && bash ops/install-scheduler.sh`
- **验证**：`launchctl print gui/501/com.domain-bot`（state / last exit code）；手动触发一轮：`launchctl kickstart gui/501/com.domain-bot`，看 `logs/stdout.log`
- **当前状态**：launchd 保持卸载（`899a73e` DB-20：ZCode 定时任务为唯一启动器），本目录 plist/脚本是标准安装途径，重装时用。
- 2026-09-05 实录：DB-08 落盘后 job 一直未加载（三时段零触发），由 DB-09 审查发现、DB-10 修复加载
- ⚠️ 旧指引曾直接 `bootstrap ops/com.domain-bot.plist`——该文件是 DB-08 时代 03:00/12:00/19:00 旧时刻遗留（2026-09-07 已把两份 plist 的时刻与注释统一为 11/15/19，消除装错时刻的隐患），安装仍以 install-scheduler.sh 为准
