import { createContext, useContext } from 'react';
import type { AlertApi, AppConfig, AuthSession } from './infrastructure';
import type { WorkflowClient } from './workflow';
import type { CatalogDatastoreClient } from './datastore';
import type { SecretsSettingsClient } from './secrets';
import type { AgentClient } from './agent';
import type { CapabilitiesClient } from './capabilities';
import type { ActionsClient } from './actions';
import type { WebhooksClient } from './webhooks';
import type { FeatureFlagClient } from './feature-flags';
import type { ServiceTokensClient } from './service-tokens';
import type { McpSettingsClient } from './mcp-settings';
import type { McpAuditClient } from './mcp-audit';
import type { WorkspacesClient } from './workspaces';
import type { WorkspaceScope } from './workspace-scope';

export interface ApiClients {
  config: AppConfig;
  auth?: AuthSession;
  // The authed base `fetch` (adds auth headers / credentials). Exposed so
  // deployment overlays can build their own clients via the admin-section seam.
  fetch: typeof fetch;
  workflows: WorkflowClient;
  datastore: CatalogDatastoreClient;
  secrets: SecretsSettingsClient;
  serviceTokens: ServiceTokensClient;
  agent: AgentClient;
  alert: AlertApi;
  capabilities: CapabilitiesClient;
  actions: ActionsClient;
  webhooks: WebhooksClient;
  featureFlags: FeatureFlagClient;
  mcpSettings: McpSettingsClient;
  mcpAudit: McpAuditClient;
  workspaces: WorkspacesClient;
  forWorkspace?: (scope: WorkspaceScope) => ApiClients;
}

export const ApiContext = createContext<ApiClients>(null!);

export const useApis = () => useContext(ApiContext);
export const useAppConfig = () => useApis().config;
export const useAuth = () => useApis().auth;
export const useWorkflows = () => useApis().workflows;
export const useDatastore = () => useApis().datastore;
export const useSecrets = () => useApis().secrets;
export const useServiceTokens = () => useApis().serviceTokens;
export const useAgent = () => useApis().agent;
export const useAlert = () => useApis().alert;
export const useCapabilities = () => useApis().capabilities;
export const useActions = () => useApis().actions;
export const useWebhooksApi = () => useApis().webhooks;
export const useFeatureFlags = () => useApis().featureFlags;
export const useMcpSettings = () => useApis().mcpSettings;
export const useMcpAudit = () => useApis().mcpAudit;
export const useWorkspacesApi = () => useApis().workspaces;
