import type { AlertApi, AppConfig, AuthSession } from './infrastructure';
import { AlertApiImpl } from './infrastructure';
import type { ApiClients } from './context';
import { WorkflowClient } from './workflow';
import { CatalogDatastoreClient } from './datastore';
import { SecretsSettingsClient } from './secrets';
import { ServiceTokensClient } from './service-tokens';
import { AgentClient } from './agent';
import { CapabilitiesClient } from './capabilities';
import { ActionsClient } from './actions';
import { WebhooksClient } from './webhooks';
import { FeatureFlagClient } from './feature-flags';
import { McpSettingsClient } from './mcp-settings';
import { McpAuditClient } from './mcp-audit';
import { WorkspacesClient } from './workspaces';
import {
  getWorkspaceScope,
  WORKSPACE_ID_HEADER,
  type WorkspaceScope,
} from './workspace-scope';

interface CreateApisOptions {
  workspaceScope?: WorkspaceScope;
  alert?: AlertApi;
}

export function createApis(
  config: AppConfig,
  auth?: AuthSession,
  options?: CreateApisOptions,
): ApiClients {
  const backendUrl = config.backend.baseUrl;
  const extraHeaders = config.backend.headers ?? {};

  const baseFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(extraHeaders);
    const requestHeaders = new Headers(init?.headers);
    requestHeaders.forEach((value, key) => headers.set(key, value));

    const { workspaceId } = options?.workspaceScope ?? getWorkspaceScope();
    headers.delete(WORKSPACE_ID_HEADER);
    if (workspaceId) {
      headers.set(WORKSPACE_ID_HEADER, workspaceId);
    }

    if (auth) {
      headers.set('Authorization', `Bearer ${await auth.getAccessToken()}`);
      return fetch(input, { ...init, headers });
    }

    return fetch(input, {
      credentials: 'include',
      ...init,
      headers,
    });
  };

  const alert = options?.alert ?? new AlertApiImpl();

  return {
    config,
    auth,
    fetch: baseFetch,
    alert,
    workflows: new WorkflowClient({
      baseUrl: `${backendUrl}/api/catalog-workflow`,
      integrationsBaseUrl: `${backendUrl}/api/integrations`,
      fetch: baseFetch,
    }),
    datastore: new CatalogDatastoreClient(
      `${backendUrl}/api/catalog-datastore`,
      baseFetch,
    ),
    secrets: new SecretsSettingsClient(
      `${backendUrl}/api/secrets-settings`,
      baseFetch,
    ),
    serviceTokens: new ServiceTokensClient(
      `${backendUrl}/api/service-tokens`,
      baseFetch,
    ),
    agent: new AgentClient(`${backendUrl}/api/ai`, baseFetch, alert),
    capabilities: new CapabilitiesClient(
      `${backendUrl}/api/capabilities`,
      baseFetch,
    ),
    actions: new ActionsClient(`${backendUrl}/api/actions`, baseFetch),
    webhooks: new WebhooksClient(
      `${backendUrl}/api/catalog-datastore/webhooks`,
      baseFetch,
    ),
    featureFlags: new FeatureFlagClient(
      `${backendUrl}/api/feature-flags`,
      baseFetch,
    ),
    mcpSettings: new McpSettingsClient(
      `${backendUrl}/api/mcp-settings`,
      baseFetch,
    ),
    mcpAudit: new McpAuditClient(`${backendUrl}/api/mcp`, baseFetch),
    workspaces: new WorkspacesClient(`${backendUrl}/api/workspaces`, baseFetch),
    forWorkspace: workspaceScope =>
      createApis(config, auth, { workspaceScope, alert }),
  };
}
