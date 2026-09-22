import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ENDPOINTS } from './status';
import { version as packageVersion } from '../package.json';

/** The two explore-module tools the CLI drives (mcp-catalog-datastore-module). */
export const MCP_TOOLS = {
  search: 'explore_objects_search',
  related: 'explore_related_objects_get',
} as const;

export interface ToolCallResult {
  text: string;
  structured?: unknown;
  isError: boolean;
}

/**
 * Minimal contract over an MCP session the CLI needs. Real callers get this from
 * `openExplore`; tests pass a fake so `query` is exercised without a backend.
 */
export interface ExploreSession {
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult>;
  close(): Promise<void>;
}

export function exploreUrl(backendUrl: string): string {
  return `${backendUrl.replace(/\/+$/, '')}${ENDPOINTS.mcpExplore}`;
}

interface RawToolResult {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

function normalize(raw: RawToolResult): ToolCallResult {
  const text = (raw.content ?? [])
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text as string)
    .join('\n');
  return {
    text,
    structured: raw.structuredContent,
    isError: raw.isError === true,
  };
}

/**
 * Open an MCP client to the explore endpoint over Streamable HTTP. In
 * single-tenant OSS the catalog is queryable without credentials, so no auth
 * header is attached. Returns a small session the verb uses to call
 * `explore_objects_search` then `explore_related_objects_get`.
 */
export async function openExplore(backendUrl: string): Promise<ExploreSession> {
  const transport = new StreamableHTTPClientTransport(
    new URL(exploreUrl(backendUrl)),
  );

  const client = new Client(
    { name: 'openroadie-cli', version: packageVersion },
    { capabilities: {} },
  );
  await client.connect(transport);

  return {
    async callTool(name, args) {
      const raw = (await client.callTool({
        name,
        arguments: args,
      })) as RawToolResult;
      return normalize(raw);
    },
    async close() {
      await client.close();
    },
  };
}
