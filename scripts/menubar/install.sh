#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWIFTBAR_DIR="${SWIFTBAR_DIR:-$HOME/swiftbar}"

mkdir -p "$SWIFTBAR_DIR"

for plugin in cursor-bridge.10s.sh mbp-tunnel.30s.sh; do
  src="$SCRIPT_DIR/$plugin"
  dest="$SWIFTBAR_DIR/$plugin"
  if [ ! -f "$src" ]; then
    echo "missing plugin: $src" >&2
    exit 1
  fi
  ln -sf "$src" "$dest"
  echo "linked $dest -> $src"
done

echo "SwiftBar plugins folder: $SWIFTBAR_DIR"
