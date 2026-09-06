#!/bin/bash
# domain-bot 定时批产安装器（2026-09-06）
# 背景：WorkBuddy 沙箱会话里 launchctl bootstrap / crontab 均被 macOS 拒（operation not permitted / I/O error），
# 必须由老张在自己打开的「终端 Terminal.app」里跑本脚本一次。
# 装的是 launchd（含 2 小时宽限 + 日志落盘），装完每天 03:00 / 12:00 / 19:00 自动批产双产线。
set -e
cp /Users/aiatwork/Projects/domain-bot/ops/com.domain-bot.launchd.plist ~/Library/LaunchAgents/com.domain-bot.plist
chmod 600 ~/Library/LaunchAgents/com.domain-bot.plist
launchctl bootout gui/$(id -u)/com.domain-bot 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.domain-bot.plist
echo "─────────────────────────"
echo "✓ domain-bot 定时批产已装载（每天 03:00 / 12:00 / 19:00）"
echo "验证：launchctl list | grep domain-bot"
launchctl list | grep domain-bot
echo "下次触发可在 logs/stdout.log 观察产出"
