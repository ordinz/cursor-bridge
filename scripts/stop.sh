#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# SwiftBar runs with a minimal PATH — include common node install locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  # shellcheck disable=SC1090
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  for candidate in "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$candidate" ]; then
      NODE="$candidate"
      break
    fi
  done
fi

if [ -z "$NODE" ]; then
  echo "cursor-bridge: node not found" >&2
  exit 1
fi

exec "$NODE" "$ROOT/scripts/stop.mjs"
