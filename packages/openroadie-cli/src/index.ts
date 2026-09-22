import { buildProgram } from './program';

export { buildProgram };
export { loadConfig, configPath } from './config';
export type { OpenRoadieConfig } from './config';
export { openUrl } from './browser';
export type { BrowserOpenResult, SpawnBrowser } from './browser';
export { computeStatus, ENDPOINTS } from './status';
export type { StatusPayload } from './status';
export { OpenRoadieHttpClient } from './http-client';
export type { HttpResult } from './http-client';
export { printResult, printFailure } from './print';
export { promptHidden } from './prompt';

export { setSecret } from './commands/secret';
export type { SecretSetResult } from './commands/secret';
export {
  connectIntegration,
  configureIntegrationHost,
} from './commands/connect';
export type {
  ConnectResult,
  ConfigureIntegrationHostResult,
} from './commands/connect';
export { listIntegrations, enableIntegrations } from './commands/integrations';
export type {
  IntegrationsListResult,
  IntegrationsEnableResult,
} from './commands/integrations';
export { mcpClientConfig } from './mcp-config';
export { listSources, enableSources } from './commands/sources';
export {
  suggestRelationships,
  approveRules,
  rejectRules,
  createRule,
  reviewSuggested,
} from './commands/relationships';
export { runQueryWithSession, buildAgentConfig } from './commands/query';
export { createCapability, listCapabilities } from './commands/capabilities';
export {
  createContextGroupRule,
  listContextGroupRules,
} from './commands/context-groups';
export {
  bringServerUp,
  runUp,
  READINESS_PATH,
  DEFAULT_POLL_INTERVAL_MS as UP_DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS as UP_DEFAULT_TIMEOUT_MS,
} from './commands/up';
export type { UpResult, UpOptions, CommandRun } from './commands/up';
export { MCP_TOOLS, exploreUrl } from './mcp-client';
export type { ExploreSession, ToolCallResult } from './mcp-client';

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv, { from: 'user' });
}
