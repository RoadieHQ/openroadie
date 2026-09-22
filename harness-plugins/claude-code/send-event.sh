#!/usr/bin/env bash
# Posts hook events to the openroadie session telemetry endpoint.
#
# URL and token come from plugin userConfig — Claude Code exports them
# as CLAUDE_PLUGIN_OPTION_URL and CLAUDE_PLUGIN_OPTION_TOKEN automatically.
# No manual env vars needed.

set -euo pipefail

HARNESS="${1:?Usage: send-event.sh <harness>}"
URL="${CLAUDE_PLUGIN_OPTION_URL:-}"

if [[ -z "$URL" ]]; then
  exit 0
fi

AUTH_HEADER=()
if [[ -n "${CLAUDE_PLUGIN_OPTION_TOKEN:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${CLAUDE_PLUGIN_OPTION_TOKEN}")
fi

curl -sf -X POST \
  "${URL}/api/mcp/session-telemetry/${HARNESS}" \
  -H "Content-Type: application/json" \
  "${AUTH_HEADER[@]}" \
  -d @- > /dev/null 2>&1 || true
