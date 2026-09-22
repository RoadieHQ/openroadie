import ora from 'ora';
import { OpenRoadieHttpClient, httpFailureReason } from '../http-client';
import { loadConfig } from '../config';
import { ENDPOINTS } from '../status';
import { printFailure, printResult } from '../print';
import type { IntegrationBackedConfig } from './relationships';

export interface PreviewInput {
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceFieldExpression: string;
  targetFieldExpression?: string;
  relationshipType: string;
  reciprocalRelationshipType?: string;
  strategy?: string;
  matchStrategy?: string;
  sourceFilterExpression?: string;
  targetFilterExpression?: string;
  integrationConfig?: IntegrationBackedConfig;
}

export interface PreviewOutcome {
  command: 'relationships preview';
  status: 'ok' | 'failed';
  total: number;
  items: Array<{
    sourceObjectId: string;
    relationshipType: string;
    targetObjectIds: string[];
    sourceLabel?: string;
    targetLabels?: string[];
  }>;
  truncated?: boolean;
  callLimitReached?: boolean;
  skippedSources?: string[];
  responseSample?: {
    sourceObjectId: string;
    sourceValue: string;
    path: string;
    data: unknown;
  };
  reason?: string;
}

/**
 * How many matches the human-readable list shows, and — for a field-matching
 * preview — how many we ask the backend for by default. The two must agree: the
 * backend pages field-matching on `limit` (defaulting to just 5 server-side),
 * so without an explicit `limit` the CLI would print at most 5 of a `total` of
 * hundreds and give no honest way to see more. Requesting up to the display cap
 * makes the printed list representative of the join being judged.
 */
export const PREVIEW_LIST_LIMIT = 25;

/**
 * Preview an UNSAVED rule. Unlike `dry-run` this persists nothing, and it is
 * the only way to test a lookup (integration-backed) rule before creating it:
 * it makes real, bounded integration calls and reports the raw response sample.
 */
export async function previewRule(
  client: OpenRoadieHttpClient,
  input: PreviewInput,
  options: { sampleLimit?: number; sourceObjectId?: string },
): Promise<PreviewOutcome> {
  const query = new URLSearchParams();
  // The two preview modes read different query params. Integration-backed
  // bounds its live calls with `sampleLimit` (capped at 50 server-side);
  // field-matching pages on `limit`. Both can target a single `sourceObjectId`.
  // Sending the wrong sample-cap param is a silent no-op — the backend picks
  // its own default — so route the cap to whichever param the mode actually
  // reads, and never send both.
  const integrationBacked =
    input.strategy === 'integration-backed' ||
    input.integrationConfig !== undefined;
  if (integrationBacked) {
    if (options.sampleLimit !== undefined) {
      query.set('sampleLimit', String(options.sampleLimit));
    }
  } else {
    query.set('limit', String(options.sampleLimit ?? PREVIEW_LIST_LIMIT));
  }
  if (options.sourceObjectId !== undefined) {
    query.set('sourceObjectId', options.sourceObjectId);
  }
  const qs = query.toString();
  const res = await client.post<Omit<PreviewOutcome, 'command' | 'status'>>(
    `${ENDPOINTS.relationshipRules}/preview${qs ? `?${qs}` : ''}`,
    input,
  );
  if (!res.ok) {
    return {
      command: 'relationships preview',
      status: 'failed',
      total: 0,
      items: [],
      reason: httpFailureReason(res),
    };
  }
  return {
    command: 'relationships preview',
    status: 'ok',
    total: res.body?.total ?? 0,
    items: res.body?.items ?? [],
    truncated: res.body?.truncated,
    callLimitReached: res.body?.callLimitReached,
    skippedSources: res.body?.skippedSources,
    responseSample: res.body?.responseSample,
  };
}

export async function runRelationshipsPreview(
  input: PreviewInput,
  options: { sampleLimit?: number; sourceObjectId?: string },
): Promise<void> {
  const client = new OpenRoadieHttpClient(loadConfig());
  const spinner = ora('Previewing rule…').start();
  const result = await previewRule(client, input, options);

  if (result.status === 'failed') {
    spinner.fail('Preview failed');
    printFailure([`Preview failed: ${result.reason}`], result);
    return;
  }
  spinner.stop();

  const SHOWN = PREVIEW_LIST_LIMIT;
  const shownCount = Math.min(result.items.length, SHOWN);
  const lines = [
    `${result.total} match(es)${result.truncated ? ' (truncated)' : ''}:`,
    ...result.items
      .slice(0, SHOWN)
      .map(
        i =>
          `  ${i.sourceLabel ?? i.sourceObjectId} —${i.relationshipType}→ ${
            (i.targetLabels ?? i.targetObjectIds).join(', ') || '(no match)'
          }`,
      ),
  ];
  // The note must key off `total`, not the returned item count. The backend
  // pages field-matching, so a `total` of 100 can arrive as 25 items with no
  // `truncated` flag — the header says "100 match(es)", 25 lines follow, and
  // nothing explains the gap. Fire whenever more matches exist than we printed,
  // and say where the rest are: in the JSON line if they were returned, or
  // out of reach (raise the sample / refine the rule) if they were not.
  if (result.total > shownCount) {
    const notReturned = result.total - result.items.length;
    const hint =
      notReturned > 0
        ? ' — refine the rule or raise --sample-limit to see more'
        : ' — the rest are in the JSON line';
    lines.push(`  … showing ${shownCount} of ${result.total} match(es)${hint}`);
  }
  if (result.callLimitReached) {
    lines.push(
      '  note: the integration call budget was reached — raise --sample-limit or narrow the source filter',
    );
  }
  if (result.skippedSources?.length) {
    lines.push(`  skipped sources: ${result.skippedSources.join(', ')}`);
  }
  if (result.responseSample) {
    lines.push(
      '  response sample:',
      `    ${result.responseSample.path} → ${JSON.stringify(result.responseSample.data).slice(0, 400)}`,
    );
  }
  printResult(lines, result);
}
