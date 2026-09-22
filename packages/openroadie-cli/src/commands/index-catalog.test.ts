import { indexCatalog } from './index-catalog';
import { OpenRoadieHttpClient } from '../http-client';
import { ENDPOINTS } from '../status';
import type { OpenRoadieConfig } from '../config';

const CONFIG: OpenRoadieConfig = { backendUrl: 'http://localhost:7008' };

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

function routingFetch(
  calls: Call[],
  handler: (
    url: string,
    method: string,
    body?: unknown,
  ) => { status: number; body?: unknown },
): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });
    const { status, body: resBody } = handler(url, method, body);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => resBody ?? {},
      text: async () => JSON.stringify(resBody ?? {}),
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
}

// Resolve sleeps immediately so polling does not wait on real time.
const noSleep = async (): Promise<void> => undefined;

describe('indexCatalog', () => {
  it('lists data-ingestion workflows, executes each, polls to completion, and reports the datastore total', async () => {
    const calls: Call[] = [];
    // Each execution is polled: first read "running", then "completed".
    const pollState = new Map<string, number>();
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, (url, method) => {
        if (
          method === 'GET' &&
          url.includes(ENDPOINTS.workflows) &&
          !url.includes('/execute')
        ) {
          return {
            status: 200,
            body: {
              data: [
                {
                  id: 'wf-1',
                  name: 'GitHub repos',
                  workflowType: 'data-ingestion',
                },
                {
                  id: 'wf-2',
                  name: 'Shortcut stories',
                  workflowType: 'data-ingestion',
                },
              ],
            },
          };
        }
        if (method === 'POST' && url.includes('/execute')) {
          const execId = url.includes('wf-1') ? 'exec-1' : 'exec-2';
          return { status: 202, body: { executionId: execId } };
        }
        if (method === 'GET' && url.includes(ENDPOINTS.executions)) {
          const execId = url.endsWith('exec-1') ? 'exec-1' : 'exec-2';
          const seen = pollState.get(execId) ?? 0;
          pollState.set(execId, seen + 1);
          // First poll: still running. Second poll: completed.
          const status = seen === 0 ? 'running' : 'completed';
          return { status: 200, body: { data: { id: execId, status } } };
        }
        if (method === 'GET' && url.endsWith(ENDPOINTS.objects)) {
          return { status: 200, body: { items: [], total: 137 } };
        }
        return { status: 404 };
      }),
    );

    const result = await indexCatalog(client, {
      sleep: noSleep,
      pollIntervalMs: 0,
      maxPolls: 5,
    });

    // The workflow list was filtered to enabled data-ingestion workflows.
    const listCall = calls.find(
      c =>
        c.method === 'GET' &&
        c.url.includes(ENDPOINTS.workflows) &&
        !c.url.includes('/execute'),
    );
    expect(listCall?.url).toContain('workflowType=data-ingestion');
    expect(listCall?.url).toContain('enabled=true');

    const exec1 = calls.find(
      c => c.method === 'POST' && c.url.includes('wf-1/execute'),
    );
    const exec2 = calls.find(
      c => c.method === 'POST' && c.url.includes('wf-2/execute'),
    );
    expect(exec1?.body).toEqual({ triggerType: 'manual' });
    expect(exec2?.body).toEqual({ triggerType: 'manual' });

    expect(result.executions).toEqual([
      {
        workflowId: 'wf-1',
        name: 'GitHub repos',
        executionId: 'exec-1',
        status: 'completed',
      },
      {
        workflowId: 'wf-2',
        name: 'Shortcut stories',
        executionId: 'exec-2',
        status: 'completed',
      },
    ]);

    // The object count is the datastore total, read after the runs settled.
    expect(result.objects).toBe(137);
    expect(result.status).toBe('indexed');
  });

  it('is a noop when there are no data-ingestion workflows', async () => {
    const calls: Call[] = [];
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch(calls, () => ({ status: 200, body: { data: [] } })),
    );

    const result = await indexCatalog(client, { sleep: noSleep });
    expect(result.status).toBe('noop');
    expect(result.objects).toBe(0);
    expect(calls.some(c => c.url.includes('/execute'))).toBe(false);
  });

  it('reports failed when an execution terminates failed', async () => {
    const client = new OpenRoadieHttpClient(
      CONFIG,
      routingFetch([], (url, method) => {
        if (method === 'GET' && url.includes(ENDPOINTS.workflows)) {
          return {
            status: 200,
            body: {
              data: [
                { id: 'wf-1', name: 'Broken', workflowType: 'data-ingestion' },
              ],
            },
          };
        }
        if (method === 'POST' && url.includes('/execute')) {
          return { status: 202, body: { executionId: 'exec-x' } };
        }
        if (method === 'GET' && url.includes(ENDPOINTS.executions)) {
          return { status: 200, body: { data: { status: 'failed' } } };
        }
        if (method === 'GET' && url.endsWith(ENDPOINTS.objects)) {
          return { status: 200, body: { total: 0 } };
        }
        return { status: 404 };
      }),
    );

    const result = await indexCatalog(client, {
      sleep: noSleep,
      pollIntervalMs: 0,
      maxPolls: 3,
    });
    expect(result.status).toBe('failed');
    expect(result.executions[0].status).toBe('failed');
  });
});
