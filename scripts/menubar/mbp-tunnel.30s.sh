#!/usr/bin/env bash

# <swiftbar.title>mbp tunnel</swiftbar.title>
# <swiftbar.version>v1.0</swiftbar.version>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.refreshOnOpen>true</swiftbar.refreshOnOpen>

set -euo pipefail

TUNNEL_HOST="${TUNNEL_HOST:-mbp.thematrixofdestiny.com}"
TUNNEL_URL="https://${TUNNEL_HOST}/"
CLOUDFLARE_TUNNEL_URL="https://dash.cloudflare.com/5a4fdf7e9a52050c3677ebe502a344d0/tunnels/e98e39df-8b06-4379-b390-a372472284e9/routes"

if pgrep -x cloudflared >/dev/null 2>&1; then
  CLOUDFLARED="running"
else
  CLOUDFLARED="stopped"
fi

HTTP_CODE="$(
  curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "$TUNNEL_URL" 2>/dev/null || echo "000"
)"

# 530 = Cloudflare "origin/tunnel unreachable"; anything else means the edge routed the request.
if [ "$HTTP_CODE" != "000" ] && [ "$HTTP_CODE" != "530" ]; then
  TUNNEL="online"
elif [ "$CLOUDFLARED" = "running" ]; then
  TUNNEL="degraded"
else
  TUNNEL="offline"
fi

case "$TUNNEL" in
  online) echo ":globe: | sfcolor=#34C759" ;;
  degraded) echo ":icloud.and.arrow.up: | sfcolor=#FF9500" ;;
  offline) echo ":icloud.slash: | sfcolor=#8E8E93" ;;
esac

echo "---"

case "$TUNNEL" in
  online) echo "${TUNNEL_HOST} — online (HTTP ${HTTP_CODE})" ;;
  degraded)
    echo "${TUNNEL_HOST} — unreachable (HTTP ${HTTP_CODE})"
    echo "cloudflared is running locally"
    ;;
  offline) echo "${TUNNEL_HOST} — offline" ;;
esac

echo "cloudflared: ${CLOUDFLARED}"
echo "---"
echo "Open ${TUNNEL_HOST} | href=${TUNNEL_URL}"
echo "Cloudflare tunnel | href=${CLOUDFLARE_TUNNEL_URL}"
echo "Refresh | refresh=true"
