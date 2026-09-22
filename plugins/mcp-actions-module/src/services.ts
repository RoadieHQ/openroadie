import { DiscoveryService, LoggerService } from '@roadiehq/extensions-api';
import { ToolRegistration } from '@roadiehq/roadie-mcp-server';
import {
  constructListActionsTool,
  constructExecuteReadActionTool,
  constructExecuteWriteActionTool,
} from './tools';

/**
 * Builds one tool registration. Heterogeneous input/output schemas across tools
 * force the erased `ToolRegistration<any>` here, matching `McpService`'s own
 * `AnyToolRegistration`.
 */
export type ToolConstructor = (
  discovery: DiscoveryService,
  logger: LoggerService,
) => Promise<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- type erasure for heterogeneous tool constructors
  ToolRegistration<any>
>;

/**
 * The single source of truth for which tools this module registers under each
 * MCP service. `plugin.ts` registers from it, and the catalog-drift guard in
 * `packages/backend` reads tool names from it — so the admin catalog
 * (`MCP_SERVER_DEFINITIONS`) cannot silently diverge from what is registered.
 */
export const MCP_SERVICE_TOOLS: Record<string, ToolConstructor[]> = {
  // Actions: discover and run configured, parameterized HTTP operations
  actions: [
    constructListActionsTool,
    constructExecuteReadActionTool,
    constructExecuteWriteActionTool,
  ],
};
/**
 * Per-service `instructions` sent to the client at connection time
 * (MCP `ServerOptions.instructions`). Keyed by the same ids as
 * `MCP_SERVICE_TOOLS`.
 */
export const MCP_SERVICE_INSTRUCTIONS: Record<string, string> = {
  actions: [
    'Named, parameterized operations your organization has defined as reusable actions.',
    "Call actions_list first — it returns each action's input schema and whether it is a read or a write. Then run actions_execute_read (which refuses write actions) or actions_execute_write (which refuses read actions); treat write actions as potentially destructive.",
    'These are the curated, safe door to external systems. integrations_request_http is the raw equivalent — prefer an action whenever one fits.',
  ].join('\n\n'),
};
