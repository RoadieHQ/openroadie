import {
  loadConfig,
  openUrl,
  OpenRoadieHttpClient,
  listIntegrations as listIntegrationsInternal,
  enableIntegrations as enableIntegrationsInternal,
  connectIntegration as connectIntegrationInternal,
  configureIntegrationHost as configureIntegrationHostInternal,
  setSecret as setSecretInternal,
} from '@roadiehq/openroadie-cli';
import type { BrowserOpenResult, SpawnBrowser } from '@roadiehq/openroadie-cli';

/**
 * The wizard's backend bridge. Instead of spawning the `openroadie` binary and
 * parsing its `JSON:` lines (the old `lib/cli.mts` approach in the mock repo),
 * this calls the package's own command internals directly — the same functions
 * `commands/connect.ts`, `commands/secret.ts`, and `commands/integrations.ts`
 * use — against a shared `OpenRoadieHttpClient`. No child process, no second
 * repo. The credential boundary is preserved exactly: `setSecret` POSTs the
 * token straight to the write-only secret route and never stores or logs it.
 */

/**
 * A fresh client per call. The client is a thin wrapper over `fetch` + config,
 * so constructing one per bridge call is cheap and keeps the module free of
 * shared mutable state (a module-level cache would leak config between tests).
 */
function client(): OpenRoadieHttpClient {
  return new OpenRoadieHttpClient(loadConfig());
}

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

export type IntegrationAuthType =
  | 'none'
  | 'header'
  | 'basic'
  | 'bearer-token'
  | 'oauth2-client-credentials'
  | 'oauth2-jwt-bearer'
  | 'github-app';

export type CliIntegration = {
  id: string;
  name: string;
  type: string;
  authType: IntegrationAuthType;
  enabled: boolean;
  connected: boolean;
};

export type ConnectResult = {
  connected: boolean;
  status: string;
  needs: string | null;
  secretName: string | null;
  secretNames: string[];
  reason: string | null;
};

export type { BrowserOpenResult } from '@roadiehq/openroadie-cli';

function asAuthType(value: string): IntegrationAuthType {
  switch (value) {
    case 'none':
    case 'header':
    case 'basic':
    case 'bearer-token':
    case 'oauth2-client-credentials':
    case 'oauth2-jwt-bearer':
    case 'github-app':
      return value;
    default:
      return 'none';
  }
}

function githubAppSetupUrl(backendUrl: string): string {
  return `${backendUrl.replace(/\/+$/, '')}/admin/integrations`;
}

export function openGithubAppSetupPage(
  spawnBrowser?: SpawnBrowser,
  platform: NodeJS.Platform = process.platform,
): BrowserOpenResult {
  return openUrl(
    githubAppSetupUrl(loadConfig().backendUrl),
    spawnBrowser,
    platform,
  );
}

export async function listIntegrations(): Promise<CliIntegration[]> {
  const result = await listIntegrationsInternal(client());
  if (result.status === 'failed') {
    throw new CliError(
      `integrations list failed: ${result.reason ?? 'unknown error'}`,
    );
  }
  return result.integrations.map(item => ({
    id: item.id,
    name: item.name,
    type: item.type,
    authType: asAuthType(item.authType),
    enabled: item.enabled,
    connected: item.connected,
  }));
}

export async function enableIntegration(id: string): Promise<void> {
  const result = await enableIntegrationsInternal(client(), [id]);
  if (result.status === 'failed') {
    const failure = result.results.find(r => r.outcome === 'failed');
    throw new CliError(
      `integrations enable ${id} failed: ${
        failure?.reason ?? result.reason ?? 'unknown error'
      }`,
    );
  }
}

export async function connectIntegration(
  id: string,
  confirm = false,
): Promise<ConnectResult> {
  const result = await connectIntegrationInternal(client(), id, { confirm });
  return {
    connected: result.connected,
    status: result.status,
    needs: result.needs ?? null,
    secretName: result.secretNames?.[0] ?? null,
    secretNames: result.secretNames ?? [],
    reason: result.reason ?? null,
  };
}

export async function configureIntegrationHost(
  id: string,
  host: string,
): Promise<string[]> {
  const result = await configureIntegrationHostInternal(client(), id, host);
  if (result.status === 'failed') {
    throw new CliError(
      `integrations configure-host ${id} failed: ${result.reason ?? 'unknown error'}`,
    );
  }
  return result.secretNames;
}

export async function setSecret(
  secretName: string,
  token: string,
): Promise<void> {
  const result = await setSecretInternal(client(), secretName, token);
  if (result.status === 'failed') {
    throw new CliError(
      `secret set ${secretName} failed: ${result.reason ?? 'unknown error'}`,
    );
  }
}
