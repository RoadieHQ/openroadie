import ora from 'ora';
import { loadConfig } from '../config';
import { httpFailureReason, OpenRoadieHttpClient } from '../http-client';
import { printResult, printFailure } from '../print';
import { ENDPOINTS } from '../status';
import { findPreset } from './integration-presets';
import type { ConnectFlow } from './integration-presets';
import {
  buildAuthConfigForSecretRefs,
  cliIdForRow,
  defaultSecretRefsForUnconfigured,
  displayId,
  getAuthConfigSecretRefs,
  isGithubAppAuth,
  matchesIntegration,
  normalizeHost,
  type IntegrationRow,
  type IntegrationsListResponse,
} from './integration-model';

/** A linked GitHub App from `GET /api/integrations/github-app/apps`. */
interface GithubAppRow {
  id: string;
  appId: string;
  host?: string;
  htmlUrl?: string;
}

interface GithubAppsResponse {
  data?: GithubAppRow[];
}

interface InstallLinkResponse {
  data?: { installUrl?: string };
}

interface InstallationRow {
  id: string;
}

interface InstallationsResponse {
  data?: InstallationRow[];
}

export interface ConnectResult {
  command: 'connect';
  id: string;
  flow?: ConnectFlow;
  status: 'connected' | 'pending' | 'failed';
  connected: boolean;
  /** What the agent should relay/do next when not yet connected. */
  needs?:
    | 'host'
    | 'user-secret'
    | 'github-app-install'
    | 'integration-not-enabled';
  /** GitHub-App install URL to open, when the loop needs the user. */
  installUrl?: string;
  /** The `secret set <id>` command, when a secret is missing. */
  addSecret?: string;
  /** Every secret ref the integration requires. Values must be set one by one. */
  secretNames?: string[];
  reason?: string;
}

/** Find the live row whose slug/id matches the requested integration id. */
async function findIntegrationRow(
  client: OpenRoadieHttpClient,
  id: string,
): Promise<
  | { ok: true; row?: IntegrationRow }
  | { ok: false; reason: string; unreachable: boolean }
> {
  const res = await client.get<IntegrationsListResponse>(
    ENDPOINTS.integrations,
  );
  if (!res.ok) {
    return {
      ok: false,
      unreachable: res.unreachable,
      reason: res.unreachable
        ? 'backend unreachable'
        : `request failed (status ${res.status})`,
    };
  }
  const row = (res.body?.data ?? []).find(r => matchesIntegration(r, id));
  return { ok: true, row };
}

/**
 * Drive the GitHub-App install loop. Without `--confirm` it resolves the linked
 * app, asks the backend for the install URL, and relays it for the user to open.
 * With `--confirm` (after the user finished the GitHub callback) it re-reads the
 * installations and reports connected once at least one install row exists.
 */
async function connectGithubApp(
  client: OpenRoadieHttpClient,
  id: string,
  integrationId: string,
  host: string | undefined,
  confirm: boolean,
): Promise<ConnectResult> {
  const appsRes = await client.get<GithubAppsResponse>(
    `${ENDPOINTS.githubApps}?integrationId=${encodeURIComponent(integrationId)}`,
  );
  if (!appsRes.ok) {
    return {
      command: 'connect',
      id,
      flow: 'github-app',
      status: 'failed',
      connected: false,
      reason: appsRes.unreachable
        ? 'backend unreachable'
        : `could not list GitHub Apps (status ${appsRes.status})`,
    };
  }
  const app = (appsRes.body?.data ?? [])[0];
  if (!app) {
    return {
      command: 'connect',
      id,
      flow: 'github-app',
      status: 'pending',
      connected: false,
      needs: 'github-app-install',
      reason:
        'No GitHub App is linked to this integration yet. Create one in the OpenRoadie app (Settings → Integrations → GitHub), then re-run connect.',
    };
  }

  if (confirm) {
    const installsRes = await client.get<InstallationsResponse>(
      `${ENDPOINTS.githubAppInstallations}?appId=${encodeURIComponent(app.appId)}`,
    );
    if (!installsRes.ok) {
      return {
        command: 'connect',
        id,
        flow: 'github-app',
        status: 'failed',
        connected: false,
        reason: installsRes.unreachable
          ? 'backend unreachable'
          : `could not read installations (status ${installsRes.status})`,
      };
    }
    const installed = (installsRes.body?.data ?? []).length > 0;
    if (installed) {
      return {
        command: 'connect',
        id,
        flow: 'github-app',
        status: 'connected',
        connected: true,
      };
    }
    return {
      command: 'connect',
      id,
      flow: 'github-app',
      status: 'pending',
      connected: false,
      needs: 'github-app-install',
      reason:
        'No GitHub App installation found yet. Finish the install in the browser, then re-run connect --confirm.',
    };
  }

  // `redirectUrl` is the post-install *browser* landing page the backend stores
  // in the state JWT and sends the user back to once the GitHub App install and
  // callback complete — NOT the API callback origin (the backend derives that
  // from the request host itself). The frontend passes its own portal page here;
  // for the single-tenant CLI the app and API share `client.url`, so that origin
  // is the right (and allowlist-safe) place to land after install.
  const redirectUrl = client.url;
  const params = new URLSearchParams({
    appId: app.appId,
    redirectUrl,
  });
  if (host) {
    params.set('host', host);
  }
  const linkRes = await client.get<InstallLinkResponse>(
    `${ENDPOINTS.githubAppInstallLink}?${params.toString()}`,
  );
  const installUrl = linkRes.ok ? linkRes.body?.data?.installUrl : undefined;
  if (!installUrl) {
    const reason = linkRes.ok ? null : httpFailureReason(linkRes);
    return {
      command: 'connect',
      id,
      flow: 'github-app',
      status: 'failed',
      connected: false,
      reason:
        reason === null || reason.startsWith('request failed ')
          ? `could not generate install link (status ${linkRes.status})`
          : reason,
    };
  }
  return {
    command: 'connect',
    id,
    flow: 'github-app',
    status: 'pending',
    connected: false,
    needs: 'github-app-install',
    installUrl,
  };
}

/**
 * Connect an enabled integration via its real auth flow, deriving connected
 * from the readiness check (`readyForCurrentScope`). Three branches:
 *  - github-app: the install loop (install-link → callback → installations).
 *  - secret-ref: the secret was set via `secret set`; readiness resolves it.
 *    If readiness is false the secret is missing — relay the `secret set`
 *    command so the user adds it in their own terminal, never the agent.
 *  - config-only (aws): managed/ambient creds — ready as soon as the row
 *    is configured for execution; readiness reflects that.
 */
function resolveConnectFlow(
  rowAuthType: string | undefined,
  authType: string | undefined,
  preset: ReturnType<typeof findPreset>,
): ConnectFlow {
  if (isGithubAppAuth(authType) || preset?.connectFlow === 'github-app') {
    return 'github-app';
  }
  if (rowAuthType === undefined && preset?.connectFlow) {
    return preset.connectFlow;
  }
  return authType === 'none' ? 'config-only' : 'secret-ref';
}

export async function connectIntegration(
  client: OpenRoadieHttpClient,
  id: string,
  options: { confirm?: boolean } = {},
): Promise<ConnectResult> {
  const preset = findPreset(id);
  const found = await findIntegrationRow(client, id);
  if (!found.ok) {
    return {
      command: 'connect',
      id,
      flow: preset?.connectFlow,
      status: 'failed',
      connected: false,
      reason: found.reason,
    };
  }
  if (!found.row) {
    const reason = preset
      ? `${id} is not enabled yet. Run: openroadie integrations list`
      : `unknown integration id: ${id}`;
    return {
      command: 'connect',
      id,
      flow: preset?.connectFlow,
      status: 'failed',
      connected: false,
      needs: 'integration-not-enabled',
      reason,
    };
  }

  const row = found.row;
  const resultId = cliIdForRow(row);
  const authType = row.authType ?? preset?.authType;
  const flow = resolveConnectFlow(row.authType, authType, preset);

  if ((row.host === null || row.host === '') && authType !== 'none') {
    return {
      command: 'connect',
      id: resultId,
      flow,
      status: 'pending',
      connected: false,
      needs: 'host',
      reason: `${row.name ?? resultId} needs its instance host URL before credentials can be collected.`,
    };
  }

  if (flow === 'github-app') {
    return connectGithubApp(
      client,
      resultId,
      row.id,
      row.host || undefined,
      options.confirm === true,
    );
  }

  if (row.readyForCurrentScope === true) {
    return {
      command: 'connect',
      id: resultId,
      flow,
      status: 'connected',
      connected: true,
    };
  }

  if (flow === 'secret-ref') {
    const secretNames = getAuthConfigSecretRefs(row.authConfig);
    if (secretNames.length === 0) {
      const fallbackSecretRef = preset
        ? getAuthConfigSecretRefs({
            ref: `\${${preset.secretRef ?? preset.id}}`,
          })
        : [];
      secretNames.push(...fallbackSecretRef);
    }
    if (secretNames.length === 0) {
      return {
        command: 'connect',
        id: resultId,
        flow: 'secret-ref',
        status: 'pending',
        connected: false,
        needs: 'host',
        reason: `${row.name ?? resultId} needs host/auth configuration before secrets can be collected.`,
      };
    }
    return {
      command: 'connect',
      id: resultId,
      flow: 'secret-ref',
      status: 'pending',
      connected: false,
      needs: 'user-secret',
      addSecret: secretNames
        .map(name => `openroadie secret set ${name}`)
        .join(' && '),
      secretNames,
      reason: `${row.name ?? resultId} needs ${secretNames.length === 1 ? `its secret (${secretNames[0]})` : `${secretNames.length} secrets (${secretNames.join(', ')})`}. Values go straight through openroadie secret set and are never logged.`,
    };
  }

  return {
    command: 'connect',
    id: resultId,
    flow: 'config-only',
    status: 'pending',
    connected: false,
    reason: `${row.name ?? resultId} is configured for managed/ambient auth but is not ready yet. Confirm its credentials are available to the backend, then re-run connect.`,
  };
}

export interface ConfigureIntegrationHostResult {
  command: 'integrations configure-host';
  id: string;
  status: 'configured' | 'failed';
  secretNames: string[];
  reason?: string;
}

export async function configureIntegrationHost(
  client: OpenRoadieHttpClient,
  id: string,
  host: string,
): Promise<ConfigureIntegrationHostResult> {
  const found = await findIntegrationRow(client, id);
  if (!found.ok) {
    return {
      command: 'integrations configure-host',
      id,
      status: 'failed',
      secretNames: [],
      reason: found.reason,
    };
  }
  if (!found.row) {
    return {
      command: 'integrations configure-host',
      id,
      status: 'failed',
      secretNames: [],
      reason: `${id} is not enabled yet.`,
    };
  }

  const row = found.row;
  const body: Record<string, unknown> = {
    host: normalizeHost(host),
  };
  // Seeded rows ship their integration-specific auth shape in the migration
  // (header schemes like `Api-Token`, oauth audiences) that the generic
  // rebuild below doesn't know — never overwrite an existing auth config.
  const seededAuth =
    row.authConfig &&
    typeof row.authConfig === 'object' &&
    Object.keys(row.authConfig).length > 0;
  let secretNames: string[];
  if (seededAuth) {
    secretNames = getAuthConfigSecretRefs(row.authConfig);
  } else {
    secretNames = defaultSecretRefsForUnconfigured(row);
    const authConfig = buildAuthConfigForSecretRefs(row, secretNames);
    if (!isGithubAppAuth(row.authType) && authConfig !== null) {
      body.authType = row.authType;
      body.authConfig = authConfig;
    }
  }

  const res = await client.patch<{ data?: IntegrationRow }>(
    `${ENDPOINTS.integrations}/${encodeURIComponent(row.id)}`,
    body,
  );
  if (!res.ok) {
    return {
      command: 'integrations configure-host',
      id: displayId(row),
      status: 'failed',
      secretNames: [],
      reason: httpFailureReason(res),
    };
  }

  return {
    command: 'integrations configure-host',
    id: displayId(row),
    status: 'configured',
    secretNames,
  };
}

export async function runConnect(
  id: string,
  options: { confirm?: boolean } = {},
): Promise<void> {
  const config = loadConfig();
  const client = new OpenRoadieHttpClient(config);
  const spinner = ora(`Connecting ${id}…`).start();
  const result = await connectIntegration(client, id, options);

  if (result.status === 'connected') {
    spinner.succeed(`Connected ${result.id}`);
    printResult(
      [`Connected ${result.id} (${result.flow}). Readiness check passed.`],
      result,
    );
    return;
  }

  if (result.status === 'failed') {
    spinner.fail(`Could not connect ${result.id}`);
    printFailure([`Failed to connect ${result.id}: ${result.reason}`], result);
    return;
  }

  // Pending exits non-zero so an installing agent does not treat the step as done.
  spinner.warn(`${result.id} not connected yet`);
  const lines: string[] = [];
  if (result.installUrl) {
    lines.push(
      `Open this URL to install the GitHub App, then re-run with --confirm:`,
      `  ${result.installUrl}`,
    );
  } else if (result.addSecret) {
    lines.push(
      result.reason ?? `${result.id} needs a secret.`,
      result.addSecret,
    );
  } else {
    lines.push(result.reason ?? `${result.id} is not connected yet.`);
  }
  printFailure(lines, result);
}
