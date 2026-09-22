import ora from 'ora';
import { loadConfig } from '../config';
import { httpFailureReason, OpenRoadieHttpClient } from '../http-client';
import { printResult, printFailure } from '../print';
import { ENDPOINTS } from '../status';
import { findPreset, presetCreateBody } from './integration-presets';
import {
  cliIdForRow,
  displayId,
  type IntegrationRow,
  type IntegrationsListResponse,
} from './integration-model';

/** The create response: `{ data: IntegrationRow }` from `POST /api/integrations`. */
interface IntegrationCreateResponse {
  data?: IntegrationRow;
}

export interface IntegrationsListResult {
  command: 'integrations list';
  status: 'ok' | 'failed';
  integrations: Array<{
    id: string;
    name: string;
    type: string;
    authType: string;
    enabled: boolean;
    connected: boolean;
  }>;
  reason?: string;
}

/**
 * GET the live integration rows. The backend seeds the integration catalog, so
 * the wizard lists whatever rows the backend returns instead of a CLI-owned
 * preset subset.
 */
export async function listIntegrations(
  client: OpenRoadieHttpClient,
): Promise<IntegrationsListResult> {
  const res = await client.get<IntegrationsListResponse>(
    ENDPOINTS.integrations,
  );
  if (!res.ok) {
    return {
      command: 'integrations list',
      status: 'failed',
      integrations: [],
      reason: res.unreachable
        ? 'backend unreachable'
        : `request failed (status ${res.status})`,
    };
  }

  const rows = res.body?.data ?? [];
  const integrations = rows.map(row => ({
    id: cliIdForRow(row),
    name: row.name ?? displayId(row),
    type: row.type ?? 'other',
    authType: row.authType ?? 'none',
    enabled: true,
    connected: row.readyForCurrentScope === true,
  }));

  return { command: 'integrations list', status: 'ok', integrations };
}

export async function runIntegrationsList(): Promise<void> {
  const config = loadConfig();
  const client = new OpenRoadieHttpClient(config);
  const spinner = ora('Listing integrations…').start();
  const result = await listIntegrations(client);

  if (result.status === 'failed') {
    spinner.fail('Could not list integrations');
    printFailure([`Failed to list integrations: ${result.reason}`], result);
    return;
  }

  spinner.stop();
  const lines = result.integrations.map(integration => {
    const mark = integration.enabled ? '[x]' : '[ ]';
    const state = integration.enabled
      ? integration.connected
        ? 'connected'
        : 'enabled'
      : 'available';
    return `${mark} ${integration.id} — ${integration.name} (${integration.type}, ${integration.authType}, ${state})`;
  });
  printResult(
    [`Integrations (${result.integrations.length}):`, ...lines],
    result,
  );
}

export interface IntegrationsEnableResult {
  command: 'integrations enable';
  status: 'enabled' | 'partial' | 'failed' | 'noop';
  results: Array<{
    id: string;
    outcome: 'created' | 'existing' | 'failed';
    integrationId?: string;
    reason?: string;
  }>;
  reason?: string;
}

/**
 * Enable each requested preset by POSTing its create body to
 * `/api/integrations`. Ids already present in the backend list are reported as
 * `existing` (idempotent — no duplicate row). Unknown ids fail the whole call
 * before any write, so a typo never half-enables a batch.
 */
export async function enableIntegrations(
  client: OpenRoadieHttpClient,
  ids: string[],
): Promise<IntegrationsEnableResult> {
  if (ids.length === 0) {
    return {
      command: 'integrations enable',
      status: 'noop',
      results: [],
      reason: 'no integration ids given',
    };
  }

  const unknown = ids.filter(id => !findPreset(id));
  if (unknown.length > 0) {
    return {
      command: 'integrations enable',
      status: 'failed',
      results: [],
      reason: `unknown integration id(s): ${unknown.join(', ')}`,
    };
  }

  const existing = await listIntegrations(client);
  if (existing.status === 'failed') {
    return {
      command: 'integrations enable',
      status: 'failed',
      results: [],
      reason: existing.reason,
    };
  }
  const enabledSet = new Set(
    existing.integrations.filter(i => i.enabled).map(i => i.id.toLowerCase()),
  );

  const results: IntegrationsEnableResult['results'] = [];
  // Collapse aliases (e.g. github + github-token → one preset) so a single call
  // never POSTs the same integration twice.
  const uniquePresetIds = [...new Set(ids.map(id => findPreset(id)!.id))];
  for (const presetId of uniquePresetIds) {
    const preset = findPreset(presetId)!;
    if (enabledSet.has(preset.id.toLowerCase())) {
      results.push({ id: preset.id, outcome: 'existing' });
      continue;
    }

    const res = await client.post<IntegrationCreateResponse>(
      ENDPOINTS.integrations,
      presetCreateBody(preset),
    );
    if (res.ok && res.body?.data?.id) {
      results.push({
        id: preset.id,
        outcome: 'created',
        integrationId: res.body.data.id,
      });
    } else {
      results.push({
        id: preset.id,
        outcome: 'failed',
        reason: httpFailureReason(res),
      });
    }
  }

  // All failed → failed; some failed alongside some that landed (created or
  // already-existing) → partial; none failed → enabled. Consistent with the
  // index/relationships partial-success handling.
  const failedCount = results.filter(r => r.outcome === 'failed').length;
  let status: IntegrationsEnableResult['status'];
  if (failedCount === 0) {
    status = 'enabled';
  } else if (failedCount === results.length) {
    status = 'failed';
  } else {
    status = 'partial';
  }
  return {
    command: 'integrations enable',
    status,
    results,
  };
}

/** The GitHub-via-PAT hint, shared by the single- and multi-id hint paths. */
const GITHUB_PAT_HINT =
  'Next: set its token (openroadie secret set GITHUB_TOKEN), then enable its sources + index — do NOT run `connect github`.';

/**
 * The GitHub PAT hint fires when ANY created integration is github/github-token,
 * not only when github is the first created id. Everything else connects normally.
 */
function nextHintFor(
  created: IntegrationsEnableResult['results'],
): string | undefined {
  const hasGithub = created.some(
    r => r.id === 'github' || r.id === 'github-token',
  );
  if (hasGithub) {
    return GITHUB_PAT_HINT;
  }
  return created[0] ? `Next: openroadie connect ${created[0].id}` : undefined;
}

export async function runIntegrationsEnable(ids: string[]): Promise<void> {
  const config = loadConfig();
  const client = new OpenRoadieHttpClient(config);
  const spinner = ora(`Enabling ${ids.join(', ')}…`).start();
  const result = await enableIntegrations(client, ids);

  if (result.status === 'noop') {
    spinner.warn('Nothing to enable');
    printResult([result.reason ?? 'Nothing to enable.'], result);
    return;
  }
  if (result.status === 'failed' && result.results.length === 0) {
    spinner.fail('Could not enable integrations');
    printFailure([`Failed to enable: ${result.reason}`], result);
    return;
  }

  const created = result.results.filter(r => r.outcome === 'created');
  const lines = result.results.map(r => {
    if (r.outcome === 'created') {
      return `  created ${r.id} (${r.integrationId})`;
    }
    if (r.outcome === 'existing') {
      return `  already enabled ${r.id}`;
    }
    return `  failed ${r.id}: ${r.reason}`;
  });

  if (result.status === 'failed') {
    spinner.fail('Could not enable integrations');
    printFailure(
      [`Enabled ${created.length} of ${result.results.length}:`, ...lines],
      result,
    );
    return;
  }

  const nextHint = nextHintFor(created);

  // Some landed, some failed → partial. Warn, list every outcome, keep a zero
  // exit so the agent treats the catalog as usable and continues.
  if (result.status === 'partial') {
    const okCount = result.results.length - failedCount(result.results);
    spinner.warn(
      `Enabled ${okCount} of ${result.results.length}; ${failedCount(result.results)} failed`,
    );
    printResult(
      [
        `Enabled ${okCount} of ${result.results.length} integration(s): ${created.length} created.`,
        ...lines,
        ...(nextHint ? [nextHint] : []),
      ],
      result,
    );
    return;
  }

  spinner.succeed(`Enabled ${created.length} integration(s)`);
  printResult(
    [
      `Enabled ${result.results.length} integration(s): ${created.length} created.`,
      ...lines,
      nextHint ?? 'All requested integrations were already enabled.',
    ],
    result,
  );
}

function failedCount(results: IntegrationsEnableResult['results']): number {
  return results.filter(r => r.outcome === 'failed').length;
}
