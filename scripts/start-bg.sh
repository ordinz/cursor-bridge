#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEALTH_URL="http://127.0.0.1:4242/api/health"
UI_URL="http://127.0.0.1:5173/"
LOG="/tmp/cursor-bridge.log"

cd "$ROOT"

api_up=false
ui_up=false
curl -sf --max-time 2 "$HEALTH_URL" >/dev/null 2>&1 && api_up=true
curl -sf --max-time 2 "$UI_URL" >/dev/null 2>&1 && ui_up=true

if $api_up && $ui_up; then
  echo "cursor-bridge: already running"
  exit 0
fi

# API-only orphan (green health, dead Vite) — restart the full stack.
if $api_up && ! $ui_up; then
  echo "cursor-bridge: API up but UI down — restarting full stack"
  bash "$ROOT/scripts/stop.sh" || true
  sleep 1
fi

nohup pnpm start >>"$LOG" 2>&1 &
disown

echo "cursor-bridge: started in background (log: $LOG)"
