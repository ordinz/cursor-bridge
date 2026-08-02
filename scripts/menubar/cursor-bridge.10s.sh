#!/usr/bin/env bash

# <swiftbar.title>cursor-bridge</swiftbar.title>
# <swiftbar.version>v1.0</swiftbar.version>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.refreshOnOpen>true</swiftbar.refreshOnOpen>

set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]}"
while [ -L "$SCRIPT_PATH" ]; do
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
  SCRIPT_PATH="$(readlink "$SCRIPT_PATH")"
  [[ $SCRIPT_PATH != /* ]] && SCRIPT_PATH="$SCRIPT_DIR/$SCRIPT_PATH"
done
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

HEALTH_URL="http://127.0.0.1:4242/api/health"
UI_URL="http://127.0.0.1:5173/"
HEALTH_CACHE="/tmp/cursor-bridge-health.json"
LOG="/tmp/cursor-bridge.log"
WATCHDOG_LOG="/tmp/cursor-bridge-watchdog.log"
WATCHDOG_PID_FILE="/tmp/cursor-bridge-watchdog.pid"

api_up=false
ui_up=false
if curl -sf --max-time 2 "$HEALTH_URL" >"$HEALTH_CACHE" 2>/dev/null; then
  api_up=true
fi
if curl -sf --max-time 2 "$UI_URL" >/dev/null 2>&1; then
  ui_up=true
fi

watchdog_up=false
if [ -f "$WATCHDOG_PID_FILE" ]; then
  wd_pid="$(tr -d '[:space:]' <"$WATCHDOG_PID_FILE" || true)"
  if [ -n "${wd_pid:-}" ] && kill -0 "$wd_pid" 2>/dev/null; then
    watchdog_up=true
  fi
fi

if $api_up && $ui_up; then
  ACTIVE_RUNS="$(python3 - "$HEALTH_CACHE" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
print(data.get("agents", {}).get("activeRuns", 0))
PY
)"
  if [ "${ACTIVE_RUNS:-0}" -gt 0 ]; then
    echo "🟡"
  else
    echo "🟢"
  fi
elif $api_up; then
  # API-only orphan — SwiftBar used to show green here; that lied.
  echo "🟠"
else
  rm -f "$HEALTH_CACHE"
  echo "⚫"
fi

echo "---"

if [ -f "$HEALTH_CACHE" ]; then
  python3 - "$HEALTH_CACHE" "$ui_up" "$watchdog_up" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
ui_up = sys.argv[2] == "true"
watchdog_up = sys.argv[3] == "true"
version = data.get("version", "?")
ready = data.get("cursor", {}).get("ready", False)
active = data.get("agents", {}).get("activeRuns", 0)
sessions = data.get("agents", {}).get("sessionCount", 0)
cursor_status = "cursor ready" if ready else "cursor not ready"
if not ui_up:
    stack_status = "UI down"
elif active:
    stack_status = f"{active} agent running"
elif sessions:
    stack_status = f"{sessions} session(s) idle"
else:
    stack_status = "idle"
wd = "watchdog on" if watchdog_up else "watchdog off"
print(f"v{version} — {cursor_status} — {stack_status} — {wd}")
PY
else
  if $watchdog_up; then
    echo "stopped (watchdog on — will restart)"
  else
    echo "stopped"
  fi
fi

echo "---"
echo "Start | bash=$ROOT/scripts/start-bg.sh terminal=false"
echo "Stop | bash=$ROOT/scripts/stop.sh terminal=false"
echo "Open UI | href=http://127.0.0.1:5173"
echo "View log | href=file://$LOG"
echo "Watchdog log | href=file://$WATCHDOG_LOG"
echo "---"
echo "GitHub | href=https://github.com/ordinz/cursor-bridge"
echo "Cloudflare tunnel | href=https://dash.cloudflare.com/5a4fdf7e9a52050c3677ebe502a344d0/tunnels/e98e39df-8b06-4379-b390-a372472284e9/routes"
echo "Refresh | refresh=true"
