import PromiseRouter from 'express-promise-router';
import type { Request, Response, Router } from 'express';
import { curlAuthFlag, forwardedAuthHeader, mcpAuthFlag } from './utils';

interface HarnessPluginOptions {
  baseUrl: string;
}

function claudeCodePlugin(baseUrl: string, token?: string) {
  const mcpUrl = `${baseUrl}/api/mcp/v1`;
  const telemetryEndpoint = `${baseUrl}/api/mcp/session-telemetry/claude-code`;
  return {
    'plugin.json': {
      name: 'openroadie',
      description:
        'Connects to your openroadie developer portal — MCP tools and session telemetry.',
      version: '0.1.0',
      author: { name: 'Roadie' },
    },
    'mcp.json': {
      mcpServers: {
        openroadie: { url: `${mcpUrl}/` },
      },
    },
    'hooks.json': {
      description:
        'Session telemetry — sends agent context so the audit log shows which model, prompt, and agent drove each tool call.',
      hooks: buildCommandHooks(telemetryEndpoint, token),
    },
  };
}

function codexPlugin(baseUrl: string, token?: string) {
  const mcpUrl = `${baseUrl}/api/mcp/v1`;
  const telemetryEndpoint = `${baseUrl}/api/mcp/session-telemetry/codex`;
  return {
    'plugin.json': {
      name: 'openroadie',
      description:
        'Connects to your openroadie developer portal — MCP tools and session telemetry.',
      version: '0.1.0',
      author: { name: 'Roadie' },
    },
    'mcp.json': {
      mcpServers: {
        openroadie: { url: `${mcpUrl}/` },
      },
    },
    'hooks.json': {
      description:
        'Session telemetry — sends agent context so the audit log shows which model, prompt, and agent drove each tool call.',
      hooks: buildCodexHooks(telemetryEndpoint, token),
    },
  };
}

function opencodePlugin(baseUrl: string, token?: string) {
  const telemetryEndpoint = `${baseUrl}/api/mcp/session-telemetry/opencode`;
  return buildOpencodePluginSource(telemetryEndpoint, token);
}

function cursorPlugin(baseUrl: string, token?: string) {
  const mcpUrl = `${baseUrl}/api/mcp/v1`;
  const telemetryEndpoint = `${baseUrl}/api/mcp/session-telemetry/cursor`;
  return {
    'plugin.json': {
      name: 'openroadie',
      description:
        'Connects to your openroadie developer portal — MCP tools and session telemetry.',
      version: '0.1.0',
      author: { name: 'Roadie' },
    },
    'mcp.json': {
      mcpServers: {
        openroadie: { url: `${mcpUrl}/` },
      },
    },
    // Hooks are installed to ~/.cursor/hooks.json by the setup script,
    // NOT inside the plugin dir — plugin-scoped hooks don't fire as IDE hooks.
    hooks: buildCursorHooks(telemetryEndpoint, token),
  };
}

function cursorSetupScript(baseUrl: string, token?: string) {
  const pluginUrl = `${baseUrl}/api/mcp/harness-plugin/cursor`;
  return [
    '#!/usr/bin/env bash',
    '# Installs the openroadie MCP server and telemetry hooks for Cursor.',
    '# Hooks go to ~/.cursor/hooks.json so they fire for ALL models.',
    'set -euo pipefail',
    '',
    'command -v jq >/dev/null 2>&1 || { echo "Error: jq is required (brew install jq / apt-get install jq)."; exit 1; }',
    '',
    `BUNDLE=$(curl -sf${curlAuthFlag(token)} "${pluginUrl}")`,
    '',
    '# 1. MCP server via Cursor plugin',
    'PLUGIN_DIR="${HOME}/.cursor/plugins/local/openroadie"',
    'mkdir -p "${PLUGIN_DIR}/.cursor-plugin"',
    'echo "${BUNDLE}" | jq -r \'."plugin.json"\' > "${PLUGIN_DIR}/.cursor-plugin/plugin.json"',
    'echo "${BUNDLE}" | jq -r \'."mcp.json"\' > "${PLUGIN_DIR}/mcp.json"',
    'rm -f "${PLUGIN_DIR}/hooks.json"',
    '',
    '# 2. Telemetry hooks → ~/.cursor/hooks.json (fires for ALL models)',
    'HOOKS_FILE="${HOME}/.cursor/hooks.json"',
    '[ -f "${HOOKS_FILE}" ] || echo \'{"version":1,"hooks":{}}\' > "${HOOKS_FILE}"',
    '',
    'HOOKS=$(echo "${BUNDLE}" | jq -c \'.hooks\')',
    '',
    '# Merge hooks: remove any previous openroadie entries, then add new ones',
    'jq --argjson hooks "${HOOKS}" \'',
    '  .version = 1 |',
    '  .hooks = (.hooks // {}) |',
    '  reduce ($hooks | to_entries[]) as $e (.;',
    '    .hooks[$e.key] = ([(.hooks[$e.key] // [])[] | select((.command // "") | test("session-telemetry") | not)] + $e.value)',
    '  )',
    '\' "${HOOKS_FILE}" > "${HOOKS_FILE}.tmp" && mv "${HOOKS_FILE}.tmp" "${HOOKS_FILE}"',
    '',
    'echo "Done — MCP server and telemetry hooks installed for Cursor."',
    'echo "Hooks are in ~/.cursor/hooks.json and fire for all models."',
    'echo "Restart Cursor to activate."',
    '',
  ].join('\n');
}

function buildCursorHooks(endpoint: string, token?: string) {
  // Cursor-native hooks format for ~/.cursor/hooks.json.
  // Cursor sends JSON on stdin (includes hook_event_name, conversation_id,
  // model, etc.) and fires hooks for ALL models, not just Claude.
  function makeHook(matcher?: string) {
    const hook: Record<string, unknown> = {
      command: `curl -sf -X POST "${endpoint}" -H "Content-Type: application/json"${curlAuthFlag(token)} -d @- > /dev/null 2>&1 || true`,
      timeout: 5,
    };
    if (matcher) hook.matcher = matcher;
    return hook;
  }

  return {
    sessionStart: [makeHook()],
    sessionEnd: [makeHook()],
    beforeSubmitPrompt: [makeHook()],
    postToolUse: [makeHook()],
    afterMCPExecution: [makeHook('mcp__openroadie__.*')],
    subagentStart: [makeHook()],
    subagentStop: [makeHook()],
    stop: [makeHook()],
  };
}

function buildCommandHooks(endpoint: string, token?: string) {
  const hook = {
    hooks: [
      {
        type: 'command',
        command: `curl -sf -X POST "${endpoint}" -H "Content-Type: application/json"${curlAuthFlag(token)} -d @- > /dev/null 2>&1 || true`,
        async: true,
        timeout: 5,
      },
    ],
  };

  const mcpToolHook = {
    matcher: 'mcp__openroadie__.*',
    hooks: hook.hooks,
  };

  return {
    SessionStart: [hook],
    SessionEnd: [hook],
    UserPromptSubmit: [hook],
    PostToolUse: [mcpToolHook],
    SubagentStart: [hook],
    SubagentStop: [hook],
    Stop: [hook],
  };
}

function buildCodexHooks(endpoint: string, token?: string) {
  const hook = {
    hooks: [
      {
        type: 'command',
        command: `curl -sf -X POST "${endpoint}" -H "Content-Type: application/json"${curlAuthFlag(token)} -d @- > /dev/null 2>&1 || true`,
        timeout: 5,
      },
    ],
  };

  const mcpToolHook = {
    matcher: 'mcp__openroadie__.*',
    hooks: hook.hooks,
  };

  return {
    SessionStart: [hook],
    SessionEnd: [hook],
    UserPromptSubmit: [hook],
    PostToolUse: [mcpToolHook],
    SubagentStart: [hook],
    SubagentStop: [hook],
    Stop: [hook],
  };
}

function buildOpencodePluginSource(endpoint: string, token?: string) {
  return [
    '// OpenCode telemetry plugin for openroadie.',
    '// Posts session events to the telemetry endpoint so the audit log',
    '// shows prompts, model, and tool context.',
    '',
    `const TELEMETRY_ENDPOINT = "${endpoint}";`,
    `const AUTH_HEADER = ${token ? `"${token}"` : 'undefined'};`,
    '',
    'function extractText(content) {',
    '  if (typeof content === "string") return content;',
    '  if (Array.isArray(content)) {',
    '    return content',
    '      .filter(p => typeof p === "string" || p.type === "text")',
    '      .map(p => (typeof p === "string" ? p : p.text))',
    '      .join("\\n");',
    '  }',
    '  return undefined;',
    '}',
    '',
    'function sid(event) {',
    '  return event.session_id || event.sessionID',
    '    || event.properties?.session_id || event.properties?.sessionID;',
    '}',
    '',
    'function extractModel(m) {',
    '  if (typeof m === "string") return m;',
    '  if (m && typeof m === "object") return m.modelID || m.model || m.id;',
    '  return undefined;',
    '}',
    '',
    'async function sendEvent(type, data) {',
    '  try {',
    '    await fetch(TELEMETRY_ENDPOINT, {',
    '      method: "POST",',
    '      headers: AUTH_HEADER',
    '        ? { "Content-Type": "application/json", Authorization: AUTH_HEADER }',
    '        : { "Content-Type": "application/json" },',
    '      body: JSON.stringify({ event: type, ...data }),',
    '      signal: AbortSignal.timeout(5000),',
    '    });',
    '  } catch {',
    '    // Silent failure — telemetry must never break the session.',
    '  }',
    '}',
    '',
    '// Session/message events go through a single "event" handler (opencode >= 1.15).',
    '// Tool hooks remain as direct top-level keys.',
    'export const OpenroadieTelemetry = async (_ctx) => {',
    '  let sessionModel;',
    '  const userMsgMeta = new Map();',
    '',
    '  return {',
    '    event: async ({ event }) => {',
    '      const type = event.type;',
    '      const sessionId = sid(event);',
    '      const props = event.properties || {};',
    '',
    '      const rawModel = props.model || event.model',
    '        || props.info?.model || props.session?.model;',
    '      const model = extractModel(rawModel);',
    '      if (model) sessionModel = model;',
    '',
    '      if (type === "session.created" && sessionId) {',
    '        await sendEvent("session.created", { sessionId, model: model || sessionModel });',
    '      } else if (type === "session.updated" && sessionId) {',
    '        await sendEvent("session.created", { sessionId, model: model || sessionModel });',
    '      } else if (type === "session.deleted" && sessionId) {',
    '        await sendEvent("session.deleted", { sessionId });',
    '      } else if (type === "session.idle" && sessionId) {',
    '        await sendEvent("session.idle", { sessionId });',
    '      } else if (type === "message.updated") {',
    '        const info = props.info || {};',
    '        if (info.role === "user") {',
    '          const msgSid = info.sessionID || info.session_id || sessionId;',
    '          const m = extractModel(info.model) || model || sessionModel;',
    '          const text = extractText(info.content);',
    '          if (text && msgSid) {',
    '            await sendEvent("message.updated", {',
    '              sessionId: msgSid, messageId: info.id, model: m, user_prompt: text,',
    '            });',
    '          } else if (msgSid && info.id) {',
    '            userMsgMeta.set(info.id, { sessionId: msgSid, model: m });',
    '          }',
    '        }',
    '      } else if (type === "message.part.updated") {',
    '        const part = props.part || {};',
    '        const meta = userMsgMeta.get(part.messageID);',
    '        if (meta) {',
    '          const text = extractText(part.text ?? part.content);',
    '          if (text) {',
    '            userMsgMeta.delete(part.messageID);',
    '            await sendEvent("message.updated", {',
    '              sessionId: meta.sessionId, messageId: part.messageID,',
    '              model: meta.model, user_prompt: text,',
    '            });',
    '          }',
    '        }',
    '      }',
    '    },',
    '',
    '    "tool.execute.before": async (input) => {',
    '      const sessionId = input.sessionID || input.session_id;',
    '      if (sessionId) {',
    '        await sendEvent("tool.execute.before", { sessionId, toolName: input.tool });',
    '      }',
    '    },',
    '',
    '    "tool.execute.after": async (input) => {',
    '      const sessionId = input.sessionID || input.session_id;',
    '      if (sessionId) {',
    '        await sendEvent("tool.execute.after", { sessionId, toolName: input.tool });',
    '      }',
    '    },',
    '  };',
    '};',
    '',
  ].join('\n');
}

function opencodeSetupScript(baseUrl: string, token?: string) {
  const mcpUrl = `${baseUrl}/api/mcp/v1`;
  const pluginUrl = `${baseUrl}/api/mcp/harness-plugin/opencode/plugin.js`;
  const mcpConfig = JSON.stringify({
    type: 'remote',
    url: `${mcpUrl}/`,
    enabled: true,
  });

  return [
    '#!/usr/bin/env bash',
    '# Installs the openroadie MCP server and telemetry plugin for OpenCode.',
    'set -euo pipefail',
    '',
    'command -v jq >/dev/null 2>&1 || { echo "Error: jq is required (brew install jq / apt-get install jq)."; exit 1; }',
    '',
    '# 1. MCP server → ~/.config/opencode/opencode.json',
    'CONFIG_DIR="${HOME}/.config/opencode"',
    'CONFIG="${CONFIG_DIR}/opencode.json"',
    'mkdir -p "${CONFIG_DIR}"',
    '[ -f "${CONFIG}" ] || echo \'{}\' > "${CONFIG}"',
    '',
    `MCP_CONFIG='${mcpConfig}'`,
    '',
    'jq --argjson mcp "${MCP_CONFIG}" \'',
    '  .mcp = (.mcp // {}) |',
    '  .mcp.openroadie = $mcp',
    '\' "${CONFIG}" > "${CONFIG}.tmp" && mv "${CONFIG}.tmp" "${CONFIG}"',
    '',
    '# 2. Telemetry plugin → ~/.config/opencode/plugins/',
    'PLUGIN_DIR="${CONFIG_DIR}/plugins"',
    'mkdir -p "${PLUGIN_DIR}"',
    `curl -sf${curlAuthFlag(token)} "${pluginUrl}" > "\${PLUGIN_DIR}/openroadie-telemetry.js"`,
    '',
    'echo "Done — MCP server and telemetry plugin installed for OpenCode."',
    'echo "Restart OpenCode to activate."',
    '',
  ].join('\n');
}

function claudeCodeSetupScript(baseUrl: string, token?: string) {
  const mcpUrl = `${baseUrl}/api/mcp/v1`;
  const telemetryEndpoint = `${baseUrl}/api/mcp/session-telemetry/claude-code`;
  const hooksJson = JSON.stringify(buildCommandHooks(telemetryEndpoint, token));

  return [
    '#!/usr/bin/env bash',
    '# Installs the openroadie MCP server and telemetry hooks for Claude Code.',
    'set -euo pipefail',
    '',
    'command -v jq >/dev/null 2>&1 || { echo "Error: jq is required (brew install jq / apt-get install jq)."; exit 1; }',
    '',
    '# 1. MCP server',
    `claude mcp add openroadie --transport http "${mcpUrl}/"${mcpAuthFlag(token)}`,
    '',
    '# 2. Telemetry hooks → ~/.claude/settings.json',
    'SETTINGS="${HOME}/.claude/settings.json"',
    'mkdir -p "$(dirname "${SETTINGS}")"',
    '[ -f "${SETTINGS}" ] || echo \'{}\' > "${SETTINGS}"',
    '',
    `HOOKS='${hooksJson}'`,
    '',
    'jq --argjson hooks "${HOOKS}" \'',
    '  .hooks = (.hooks // {}) |',
    '  reduce ($hooks | to_entries[]) as $e (.;',
    '    .hooks[$e.key] = ((.hooks[$e.key]) // []) + $e.value',
    '  )',
    '\' "${SETTINGS}" > "${SETTINGS}.tmp" && mv "${SETTINGS}.tmp" "${SETTINGS}"',
    '',
    'echo "Done — MCP server and telemetry hooks installed for Claude Code."',
    '',
  ].join('\n');
}

function codexSetupScript(baseUrl: string, token?: string) {
  const mcpUrl = `${baseUrl}/api/mcp/v1`;
  const telemetryEndpoint = `${baseUrl}/api/mcp/session-telemetry/codex`;
  const hooksJson = JSON.stringify(buildCodexHooks(telemetryEndpoint, token));

  return [
    '#!/usr/bin/env bash',
    '# Installs the openroadie MCP server and telemetry hooks for Codex.',
    'set -euo pipefail',
    '',
    'command -v jq >/dev/null 2>&1 || { echo "Error: jq is required (brew install jq / apt-get install jq)."; exit 1; }',
    '',
    '# 1. MCP server',
    `codex mcp add openroadie --url "${mcpUrl}/"`,
    '',
    '# 2. Telemetry hooks → ~/.codex/hooks.json',
    'HOOKS_FILE="${HOME}/.codex/hooks.json"',
    'mkdir -p "$(dirname "${HOOKS_FILE}")"',
    '[ -f "${HOOKS_FILE}" ] || echo \'{}\' > "${HOOKS_FILE}"',
    '',
    `HOOKS='${hooksJson}'`,
    '',
    'jq --argjson hooks "${HOOKS}" \'',
    '  .hooks = (.hooks // {}) |',
    '  reduce ($hooks | to_entries[]) as $e (.;',
    '    .hooks[$e.key] = ((.hooks[$e.key]) // []) + $e.value',
    '  )',
    '\' "${HOOKS_FILE}" > "${HOOKS_FILE}.tmp" && mv "${HOOKS_FILE}.tmp" "${HOOKS_FILE}"',
    '',
    'echo "Done — MCP server and telemetry hooks installed for Codex."',
    '',
  ].join('\n');
}

export function createHarnessPluginRouter({
  baseUrl,
}: HarnessPluginOptions): Router {
  const router = PromiseRouter();

  const sendScript = (res: Response) =>
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  router.get('/claude-code', (req: Request, res) => {
    res.json(claudeCodePlugin(baseUrl, forwardedAuthHeader(req)));
  });

  router.get('/claude-code/setup.sh', (req: Request, res) => {
    sendScript(res);
    res.send(claudeCodeSetupScript(baseUrl, forwardedAuthHeader(req)));
  });

  router.get('/codex', (req: Request, res) => {
    res.json(codexPlugin(baseUrl, forwardedAuthHeader(req)));
  });

  router.get('/codex/setup.sh', (req: Request, res) => {
    sendScript(res);
    res.send(codexSetupScript(baseUrl, forwardedAuthHeader(req)));
  });

  router.get('/cursor', (req: Request, res) => {
    res.json(cursorPlugin(baseUrl, forwardedAuthHeader(req)));
  });

  router.get('/cursor/setup.sh', (req: Request, res) => {
    sendScript(res);
    res.send(cursorSetupScript(baseUrl, forwardedAuthHeader(req)));
  });

  router.get('/opencode/plugin.js', (req: Request, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.send(opencodePlugin(baseUrl, forwardedAuthHeader(req)));
  });

  router.get('/opencode/setup.sh', (req: Request, res) => {
    sendScript(res);
    res.send(opencodeSetupScript(baseUrl, forwardedAuthHeader(req)));
  });

  router.get('/opencode', (req: Request, res) => {
    res.json({
      pluginSource: opencodePlugin(baseUrl, forwardedAuthHeader(req)),
      mcpConfig: {
        openroadie: {
          type: 'remote',
          url: `${baseUrl}/api/mcp/v1/`,
          enabled: true,
        },
      },
    });
  });

  return router;
}
