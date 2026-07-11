#!/usr/bin/env bash
# CentaurAI 清场启动脚本：先清理上一次的残留进程/端口，再干净启动。
# 解决「BackendStartupError: centaurai-core exited before health check passed /
#       Another instance is already running」——根因是旧实例的 core/ACP
# 子进程没退干净，占着后端端口 51441 与 CDP 端口 9230。

set -u

echo "[centaurai] 清理残留进程…"
# 先杀 electron 主进程（杀它才会停掉它派生的 core，避免重生）
pkill -9 -f 'electron/dist/electron' 2>/dev/null
sleep 1
# 再清理 canonical core、显式回退的旧 core 与 ACP 子进程。
pkill -9 -x 'centaurai-core'                    2>/dev/null
pkill -9 -x 'aioncore'                          2>/dev/null
pkill -9 -f 'claude-agent-sdk-linux-x64/claude' 2>/dev/null
pkill -9 -f 'codex-acp'                         2>/dev/null

# 等端口 51441 / 9230 真正释放（最多 ~5s）
for i in $(seq 1 10); do
  if ! ss -ltn 2>/dev/null | grep -qE '127.0.0.1:(9230|51441)\b'; then
    break
  fi
  sleep 0.5
done

if ss -ltn 2>/dev/null | grep -qE '127.0.0.1:(9230|51441)\b'; then
  echo "[centaurai] 警告：端口仍被占用，仍尝试启动——若再报启动错误，请手动检查 9230/51441。"
else
  echo "[centaurai] 端口已释放，启动中…"
fi

cd /home/user/桌面/centaurai-aionui || exit 1
export PATH="$HOME/.bun/bin:$PATH"
if ss -ltn 2>/dev/null | grep -qE '127\.0\.0\.1:7897\b'; then
  export HTTP_PROXY=http://127.0.0.1:7897 HTTPS_PROXY=http://127.0.0.1:7897 ALL_PROXY=socks://127.0.0.1:7897 NO_PROXY=localhost,127.0.0.1,::1
  export http_proxy=http://127.0.0.1:7897 https_proxy=http://127.0.0.1:7897 all_proxy=socks://127.0.0.1:7897 no_proxy=localhost,127.0.0.1,::1
else
  unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
  export NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1
  echo "[centaurai] 本地代理 127.0.0.1:7897 未运行，已禁用代理环境。"
fi
# App Store standalone-app installers (per-OS), served to LAN users via /api/appstore/downloads/*
export AIONUI_APPSTORE_INSTALLER_DIR="$HOME/.config/CentaurAI-Dev/appstore-installers"

LOG="/home/user/桌面/centaurai-aionui/nohup.out"

# 前台模式（--fg 或 FOREGROUND=1）：在本终端跑，能直接看日志，但关终端会停。
if [ "${1:-}" = "--fg" ] || [ "${FOREGROUND:-0}" = "1" ]; then
  echo "[centaurai] 前台启动（关闭本终端会停止）…"
  exec bun start
fi

# 默认：用 setsid 脱离控制终端启动，这样关掉终端/SSH 会话也不会 SIGHUP 掉
# Vite dev server（那会让 Electron 壳指向已死的 5173 → 白屏）。日志写入 nohup.out。
setsid nohup bun start > "$LOG" 2>&1 < /dev/null &
DEV_PID=$!
echo "[centaurai] 已脱离终端后台启动 (pid=$DEV_PID)。"
echo "[centaurai] 看日志: tail -f $LOG   |   关闭本终端不会再杀掉它。"
echo "[centaurai] 要停止/重启：再跑一次本脚本（顶部会先清场）。"
