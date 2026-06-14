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
HEALTH_CACHE="/tmp/cursor-bridge-health.json"
LOG="/tmp/cursor-bridge.log"

if curl -sf --max-time 2 "$HEALTH_URL" >"$HEALTH_CACHE" 2>/dev/null; then
  echo "🟢"
else
  rm -f "$HEALTH_CACHE"
  echo "⚫"
fi

echo "---"

if [ -f "$HEALTH_CACHE" ]; then
  python3 - "$HEALTH_CACHE" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
version = data.get("version", "?")
ready = data.get("cursor", {}).get("ready", False)
status = "cursor ready" if ready else "cursor not ready"
print(f"v{version} — {status}")
PY
else
  echo "stopped"
fi

echo "---"
echo "Start | bash=$ROOT/scripts/start-bg.sh terminal=false"
echo "Stop | bash=$ROOT/scripts/stop.sh terminal=false"
echo "Open UI | href=http://localhost:5173"
echo "View log | href=file://$LOG"
echo "Refresh | refresh=true"
