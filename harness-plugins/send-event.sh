#!/usr/bin/env bash
# Posts hook events to the openroadie session telemetry endpoint.
#
# Reads the URL and token from:
#   1. Plugin options (CLAUDE_PLUGIN_OPTION_URL / CLAUDE_PLUGIN_OPTION_TOKEN) — Claude Code plugins
#   2. Raw env vars (OPENROADIE_URL / OPENROADIE_TOKEN) — Codex, Cursor, Cline, or manual setup

set -euo pipefail

HARNESS="${1:?Usage: send-event.sh <harness>}"
URL="${CLAUDE_PLUGIN_OPTION_URL:-${OPENROADIE_URL:-}}"

if [[ -z "$URL" ]]; then
  exit 0
fi

TOKEN="${CLAUDE_PLUGIN_OPTION_TOKEN:-${OPENROADIE_TOKEN:-}}"
AUTH_HEADER=()
if [[ -n "$TOKEN" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${TOKEN}")
fi

curl -sf -X POST \
  "${URL}/api/mcp/session-telemetry/${HARNESS}" \
  -H "Content-Type: application/json" \
  "${AUTH_HEADER[@]}" \
  -d @- > /dev/null 2>&1 || true
