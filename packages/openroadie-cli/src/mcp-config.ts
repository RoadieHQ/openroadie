import { ENDPOINTS } from './status';

/**
 * Build the MCP client config a coding agent drops into its `.mcp.json`. The
 * URL is the explore endpoint on the configured backend. In single-tenant OSS
 * the catalog is queryable without credentials, so the entry carries no
 * `headers` / Authorization. Shape matches Claude Code's `type: 'http'` server
 * entry.
 */
export function mcpClientConfig(backendUrl: string): Record<string, unknown> {
  const base = backendUrl.replace(/\/+$/, '');
  return {
    mcpServers: {
      openroadie: {
        type: 'http',
        url: `${base}${ENDPOINTS.mcpExplore}`,
      },
    },
  };
}
