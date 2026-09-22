import ora from 'ora';
import { loadConfig } from '../config';
import { OpenRoadieHttpClient } from '../http-client';
import { printResult, printFailure } from '../print';
import { ENDPOINTS } from '../status';

interface WorkflowRow {
  id: string;
  name?: string;
  workflowType?: string;
  enabled?: boolean;
}

interface WorkflowsListResponse {
  data?: WorkflowRow[];
  total?: number;
}

/** `POST /workflows/:id/execute` returns `{ executionId }` (unwrapped). */
interface ExecuteResponse {
  executionId?: string;
}

type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** `GET /executions/:id` returns `{ data: { status, ... } }`. */
interface ExecutionResponse {
  data?: { id?: string; status?: ExecutionStatus };
}

/** `GET /catalog-datastore/objects` returns `{ items, total }`. */
interface ObjectsResponse {
  items?: unknown[];
  total?: number;
}

const TERMINAL: ReadonlySet<ExecutionStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

/** Default poll budget: 60 reads × 1s ≈ 60s per execution before timing out. */
export const DEFAULT_POLL_INTERVAL_MS = 1000;
export const DEFAULT_MAX_POLLS = 60;

export interface IndexResult {
  command: 'index';
  status: 'indexed' | 'partial' | 'failed' | 'noop';
  executions: Array<{
    workflowId: string;
    name: string;
    executionId?: string;
    status: ExecutionStatus | 'unknown' | 'timeout' | 'not-started';
  }>;
  objects: number;
  reason?: string;
}

export interface IndexOptions {
  /** Injected so tests resolve immediately instead of waiting on real time. */
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

/**
 * Number of consecutive failed reads tolerated before a poll gives up. A single
 * transient blip (a dropped connection, a momentary 5xx) shouldn't abandon a
 * still-running execution; only a sustained run of failures means the execution
 * is truly unreadable.
 */
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

/**
 * Poll one execution until it reaches a terminal status or the budget runs out.
 * Returns the last-seen status; `timeout` if it never settled. Transient read
 * failures are retried within the budget — only `MAX_CONSECUTIVE_POLL_FAILURES`
 * failed reads in a row yields `unknown`.
 */
async function pollExecution(
  client: OpenRoadieHttpClient,
  executionId: string,
  options: Required<
    Pick<IndexOptions, 'sleep' | 'pollIntervalMs' | 'maxPolls'>
  >,
): Promise<ExecutionStatus | 'unknown' | 'timeout'> {
  let consecutiveFailures = 0;
  for (let attempt = 0; attempt < options.maxPolls; attempt += 1) {
    const res = await client.get<ExecutionResponse>(
      `${ENDPOINTS.executions}/${encodeURIComponent(executionId)}`,
    );
    if (!res.ok) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        return 'unknown';
      }
      await options.sleep(options.pollIntervalMs);
      continue;
    }
    consecutiveFailures = 0;
    const status = res.body?.data?.status;
    if (status && TERMINAL.has(status)) {
      return status;
    }
    await options.sleep(options.pollIntervalMs);
  }
  return 'timeout';
}

/**
 * Index the catalog: enumerate the `data-ingestion` workflows, execute each with
 * `triggerType: 'manual'`, poll every execution to a terminal status, then read
 * the real object count from the datastore. The count is the datastore `total`
 * after all runs settle — never a sum of guesses.
 */
export async function indexCatalog(
  client: OpenRoadieHttpClient,
  options: IndexOptions = {},
): Promise<IndexResult> {
  const resolved = {
    sleep: options.sleep ?? realSleep,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    maxPolls: options.maxPolls ?? DEFAULT_MAX_POLLS,
  };

  // Only execute ENABLED data-ingestion workflows: a disabled seed shouldn't be
  // run. Both query params are honored by the backend workflows list route
  // (workflows.ts parses `workflowType` and `enabled` and ANDs them).
  const listRes = await client.get<WorkflowsListResponse>(
    `${ENDPOINTS.workflows}?workflowType=data-ingestion&enabled=true`,
  );
  if (!listRes.ok) {
    return {
      command: 'index',
      status: 'failed',
      executions: [],
      objects: 0,
      reason: listRes.unreachable
        ? 'backend unreachable'
        : `could not list workflows (status ${listRes.status})`,
    };
  }

  const workflows = listRes.body?.data ?? [];
  if (workflows.length === 0) {
    return {
      command: 'index',
      status: 'noop',
      executions: [],
      objects: 0,
      reason:
        'No data-ingestion workflows to run. Enable data sources first: openroadie sources enable --all',
    };
  }

  const executions: IndexResult['executions'] = [];
  for (const workflow of workflows) {
    const name = workflow.name ?? workflow.id;
    const execRes = await client.post<ExecuteResponse>(
      `${ENDPOINTS.workflows}/${encodeURIComponent(workflow.id)}/execute`,
      { triggerType: 'manual' },
    );
    if (!execRes.ok || !execRes.body?.executionId) {
      executions.push({
        workflowId: workflow.id,
        name,
        status: 'not-started',
      });
      continue;
    }
    const executionId = execRes.body.executionId;
    const status = await pollExecution(client, executionId, resolved);
    executions.push({ workflowId: workflow.id, name, executionId, status });
  }

  const objectsRes = await client.get<ObjectsResponse>(ENDPOINTS.objects);
  const objects = objectsRes.ok
    ? (objectsRes.body?.total ?? objectsRes.body?.items?.length ?? 0)
    : 0;

  const anyFailed = executions.some(
    exec =>
      exec.status === 'failed' ||
      exec.status === 'not-started' ||
      exec.status === 'unknown' ||
      exec.status === 'timeout' ||
      exec.status === 'cancelled',
  );

  // A few sub-sources failing (e.g. a token lacks scope for one source) while
  // others indexed real objects is a PARTIAL success, not a failure — the
  // catalog is usable. Only call it 'failed' when nothing landed.
  const status = !anyFailed ? 'indexed' : objects > 0 ? 'partial' : 'failed';

  return {
    command: 'index',
    status,
    executions,
    objects,
  };
}

export async function runIndex(): Promise<void> {
  const config = loadConfig();
  const client = new OpenRoadieHttpClient(config);
  const spinner = ora('Indexing connected sources…').start();
  const result = await indexCatalog(client);

  if (result.status === 'noop') {
    spinner.warn('Nothing to index');
    printResult([result.reason ?? 'Nothing to index.'], result);
    return;
  }

  const lines = result.executions.map(exec => `  ${exec.name}: ${exec.status}`);

  if (result.status === 'failed') {
    spinner.fail('Indexing did not fully complete');
    // When the failure is upstream of any execution (e.g. the workflow list
    // couldn't be read), surface that reason; otherwise list per-workflow states.
    if (result.executions.length === 0) {
      printFailure(
        [`Could not index: ${result.reason ?? 'unknown error'}`],
        result,
      );
      return;
    }
    printFailure(
      [
        `Indexed ${result.objects} catalog object(s); some workflows did not complete:`,
        ...lines,
      ],
      result,
    );
    return;
  }

  if (result.status === 'partial') {
    const failedCount = result.executions.filter(
      exec => exec.status !== 'completed',
    ).length;
    spinner.warn(
      `Indexed ${result.objects} object(s); ${failedCount} source(s) failed (likely token scope)`,
    );
    printResult(
      [
        `Indexed ${result.objects} catalog object(s); ${failedCount} of ${result.executions.length} sources did not complete (often a token-scope limit — safe to continue):`,
        ...lines,
      ],
      result,
    );
    return;
  }

  spinner.succeed(
    `Indexed ${result.objects} catalog object(s) across ${result.executions.length} workflow(s)`,
  );
  printResult(
    [
      `Indexed ${result.objects} catalog object(s) across ${result.executions.length} data-ingestion workflow(s):`,
      ...lines,
    ],
    result,
  );
}
