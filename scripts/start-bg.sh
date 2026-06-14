#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEALTH_URL="http://127.0.0.1:4242/api/health"
LOG="/tmp/cursor-bridge.log"

cd "$ROOT"

if curl -sf --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
  echo "cursor-bridge: already running"
  exit 0
fi

nohup pnpm start >>"$LOG" 2>&1 &
disown

echo "cursor-bridge: started in background (log: $LOG)"
