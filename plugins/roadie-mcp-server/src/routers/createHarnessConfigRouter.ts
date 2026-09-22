import PromiseRouter from 'express-promise-router';
import type { Router } from 'express';
import { getSupportedHarnesses } from '../normalizers';

interface HarnessConfigOptions {
  baseUrl: string;
  mcpScopes: string[];
}

interface InstallStep {
  label: string;
  type: 'command' | 'deeplink' | 'config';
  value: string;
}

interface HarnessConfig {
  harness: string;
  label: string;
  telemetrySupport: 'full' | 'mcp-only';
  /** Primary install — one step that gives you everything the harness supports. */
  step: InstallStep;
  /** Optional raw MCP-only alternative when the primary bundles more (plugin). */
  mcpOnlyStep?: InstallStep;
  description: string;
}

function buildClaudeCodeConfig(
  mcpUrl: string,
  telemetryUrl: string,
): HarnessConfig {
  return {
    harness: 'claude-code',
    label: 'Claude Code',
    telemetrySupport: 'full',
    step: {
      label: 'Install the openroadie plugin',
      type: 'command',
      value: `curl -sf ${telemetryUrl}/claude-code/setup.sh | bash`,
    },
    mcpOnlyStep: {
      label: 'MCP server only (no telemetry)',
      type: 'command',
      value: `claude mcp add openroadie --transport http ${mcpUrl}/`,
    },
    description:
      'Installs the MCP server and session telemetry. Prompts, model, subagent spans, and tool calls appear in the audit log.',
  };
}

function buildCodexConfig(mcpUrl: string, telemetryUrl: string): HarnessConfig {
  return {
    harness: 'codex',
    label: 'Codex',
    telemetrySupport: 'full',
    step: {
      label: 'Install the openroadie plugin',
      type: 'command',
      value: `curl -sf ${telemetryUrl}/codex/setup.sh | bash`,
    },
    mcpOnlyStep: {
      label: 'MCP server only (no telemetry)',
      type: 'command',
      value: `codex mcp add openroadie --transport http ${mcpUrl}/`,
    },
    description:
      'Installs the MCP server and session telemetry. Prompts, model, subagent spans, and tool calls appear in the audit log.',
  };
}

function buildCursorConfig(
  mcpUrl: string,
  telemetryUrl: string,
): HarnessConfig {
  const serverConfig = { url: `${mcpUrl}/` };
  const encoded = Buffer.from(JSON.stringify(serverConfig)).toString('base64');
  const deeplink = `cursor://anysphere.cursor-deeplink/mcp/install?name=openroadie&config=${encoded}`;

  return {
    harness: 'cursor',
    label: 'Cursor',
    telemetrySupport: 'full',
    step: {
      label: 'Install the openroadie plugin',
      type: 'command',
      value: `curl -sf ${telemetryUrl}/cursor/setup.sh | bash`,
    },
    mcpOnlyStep: {
      label: 'MCP server only (no telemetry)',
      type: 'deeplink',
      value: deeplink,
    },
    description:
      'Installs the MCP server and session telemetry. Prompts, model, and tool calls appear in the audit log.',
  };
}

function buildOpencodeConfig(
  mcpUrl: string,
  telemetryUrl: string,
): HarnessConfig {
  return {
    harness: 'opencode',
    label: 'OpenCode',
    telemetrySupport: 'full',
    step: {
      label: 'Install the openroadie plugin',
      type: 'command',
      value: `curl -sf ${telemetryUrl}/opencode/setup.sh | bash`,
    },
    mcpOnlyStep: {
      label: 'MCP server only (no telemetry)',
      type: 'config',
      value: JSON.stringify(
        {
          mcp: {
            openroadie: {
              type: 'remote',
              url: `${mcpUrl}/`,
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
    },
    description:
      'Installs the MCP server and session telemetry plugin. Prompts, model, and tool calls appear in the audit log.',
  };
}

const CONFIG_BUILDERS: Record<
  string,
  (mcpUrl: string, telemetryUrl: string) => HarnessConfig
> = {
  'claude-code': buildClaudeCodeConfig,
  codex: buildCodexConfig,
  cursor: buildCursorConfig,
  opencode: buildOpencodeConfig,
};

export function createHarnessConfigRouter({
  baseUrl,
  mcpScopes,
}: HarnessConfigOptions): Router {
  const router = PromiseRouter();

  const mcpUrl = `${baseUrl}/api/mcp/v1`;
  const telemetryUrl = `${baseUrl}/api/mcp/harness-plugin`;

  router.get('/', (_req, res) => {
    const harnesses = Object.entries(CONFIG_BUILDERS).map(([_key, builder]) =>
      builder(mcpUrl, telemetryUrl),
    );

    res.json({
      harnesses,
      mcpScopes,
      supportedTelemetryHarnesses: getSupportedHarnesses(),
    });
  });

  router.get('/:harness', (req, res) => {
    const { harness } = req.params;
    const builder = CONFIG_BUILDERS[`${harness}`];
    if (!builder) {
      res.status(404).json({
        error: `Unknown harness: ${harness}. Supported: ${Object.keys(CONFIG_BUILDERS).join(', ')}`,
      });
      return;
    }

    res.json(builder(mcpUrl, telemetryUrl));
  });

  return router;
}
