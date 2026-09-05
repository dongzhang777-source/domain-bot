# domain-bot 调度运维（DB-10/S1-4 补登）

- **安装/首次加载**：`launchctl bootstrap gui/501 ops/com.domain-bot.plist`
- **改 plist 后必须重载**（launchd 不会热加载）：`launchctl bootout gui/501/com.domain-bot && launchctl bootstrap gui/501 ops/com.domain-bot.plist`
- **验证**：`launchctl print gui/501/com.domain-bot`（state / last exit code）；手动触发一轮：`launchctl kickstart gui/501/com.domain-bot`，看 `logs/stdout.log`
- 2026-09-05 实录：DB-08 落盘后 job 一直未加载（三时段零触发），由 DB-09 审查发现、DB-10 修复加载
