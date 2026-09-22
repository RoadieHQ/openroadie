import ora from 'ora';
import { loadConfig } from '../config';
import { httpFailureReason, OpenRoadieHttpClient } from '../http-client';
import { printResult, printFailure } from '../print';
import { ENDPOINTS } from '../status';

/** A seed row from `GET /api/catalog-workflow/data-source-seeds`. */
interface SeedRow {
  name: string;
  description?: string;
  integrationSlug?: string;
  integrationConfigured?: boolean;
  created?: boolean;
}

interface SeedsResponse {
  data?: SeedRow[];
}

/** The apply response: `{ data: { inserted, skipped } }`. */
interface ApplyResponse {
  data?: {
    inserted?: number;
    skipped?: Array<{ name: string; reason: string }>;
  };
}

export interface SourcesListResult {
  command: 'sources list';
  status: 'ok' | 'failed';
  sources: Array<{
    name: string;
    integrationConfigured: boolean;
    created: boolean;
  }>;
  reason?: string;
}

export async function listSources(
  client: OpenRoadieHttpClient,
): Promise<SourcesListResult> {
  const res = await client.get<SeedsResponse>(ENDPOINTS.dataSourceSeeds);
  if (!res.ok) {
    return {
      command: 'sources list',
      status: 'failed',
      sources: [],
      reason: res.unreachable
        ? 'backend unreachable'
        : `request failed (status ${res.status})`,
    };
  }
  const sources = (res.body?.data ?? []).map(seed => ({
    name: seed.name,
    integrationConfigured: seed.integrationConfigured === true,
    created: seed.created === true,
  }));
  return { command: 'sources list', status: 'ok', sources };
}

export async function runSourcesList(): Promise<void> {
  const config = loadConfig();
  const client = new OpenRoadieHttpClient(config);
  const spinner = ora('Listing data-source seeds…').start();
  const result = await listSources(client);

  if (result.status === 'failed') {
    spinner.fail('Could not list sources');
    printFailure([`Failed to list sources: ${result.reason}`], result);
    return;
  }

  spinner.stop();
  const lines = result.sources.length
    ? result.sources.map(source => {
        const flags = [
          source.integrationConfigured ? 'configured' : 'not-configured',
          source.created ? 'enabled' : 'available',
        ].join(', ');
        return `${source.name} (${flags})`;
      })
    : ['No data-source seeds.'];
  printResult([`Data sources (${result.sources.length}):`, ...lines], result);
}

export interface SourcesEnableResult {
  command: 'sources enable';
  status: 'enabled' | 'failed' | 'noop';
  requested: string[];
  inserted: number;
  skipped: Array<{ name: string; reason: string }>;
  reason?: string;
}

/**
 * Resolve which seed names to apply, then POST them to the apply route. With
 * `--all`, every seed whose integration is configured is chosen; otherwise the
 * explicitly-named keys are applied. Returns the inserted count + skipped rows
 * the backend reports.
 */
export async function enableSources(
  client: OpenRoadieHttpClient,
  options: { all?: boolean; keys?: string[] },
): Promise<SourcesEnableResult> {
  let requested = options.keys ?? [];

  if (options.all) {
    const list = await listSources(client);
    if (list.status === 'failed') {
      return {
        command: 'sources enable',
        status: 'failed',
        requested: [],
        inserted: 0,
        skipped: [],
        reason: list.reason,
      };
    }
    requested = list.sources
      .filter(source => source.integrationConfigured)
      .map(source => source.name);
  }

  if (requested.length === 0) {
    return {
      command: 'sources enable',
      status: 'noop',
      requested: [],
      inserted: 0,
      skipped: [],
      reason: options.all
        ? 'no configured sources available to enable'
        : 'no source keys given',
    };
  }

  const res = await client.post<ApplyResponse>(ENDPOINTS.dataSourceSeedsApply, {
    seeds: requested,
  });

  if (!res.ok) {
    return {
      command: 'sources enable',
      status: 'failed',
      requested,
      inserted: 0,
      skipped: [],
      reason: httpFailureReason(res),
    };
  }

  return {
    command: 'sources enable',
    status: 'enabled',
    requested,
    inserted: res.body?.data?.inserted ?? 0,
    skipped: res.body?.data?.skipped ?? [],
  };
}

export async function runSourcesEnable(
  keys: string[],
  opts: { all?: boolean },
): Promise<void> {
  const config = loadConfig();
  const client = new OpenRoadieHttpClient(config);
  const spinner = ora('Enabling data sources…').start();
  const result = await enableSources(client, { all: opts.all, keys });

  if (result.status === 'failed') {
    spinner.fail('Could not enable sources');
    printFailure([`Failed to enable sources: ${result.reason}`], result);
    return;
  }
  if (result.status === 'noop') {
    spinner.warn('Nothing to enable');
    printResult([result.reason ?? 'Nothing to enable.'], result);
    return;
  }

  spinner.succeed(`Enabled ${result.inserted} source(s)`);
  const skippedLines = result.skipped.map(
    skip => `  skipped ${skip.name}: ${skip.reason}`,
  );
  printResult(
    [
      `Applied ${result.requested.length} seed(s): ${result.inserted} inserted, ${result.skipped.length} skipped.`,
      ...skippedLines,
    ],
    result,
  );
}
