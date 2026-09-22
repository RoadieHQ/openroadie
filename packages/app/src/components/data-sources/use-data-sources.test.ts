import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '../../api/queries';
import { useDataSources } from './use-data-sources';
import { RUNNING_POLL_INTERVAL_MS } from './execution-polling';

const mockApi = {
  workflows: { list: vi.fn() },
  nodeTypes: { list: vi.fn() },
  integrations: { list: vi.fn(), listLogos: vi.fn() },
  executions: { getLatestSummaries: vi.fn() },
};

const mockDatastore = {
  getObjectCountsByDatasource: vi.fn(),
};

vi.mock('../../api', () => ({
  useWorkflows: () => mockApi,
  useDatastore: () => mockDatastore,
}));

function makeWorkflow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ds-1',
    name: 'GitHub Repos',
    description: '',
    version: 1,
    workflowType: 'data-ingestion',
    nodes: [],
    edges: [],
    enabled: true,
    createdBy: 'user-1',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-20T10:30:00Z',
    ...overrides,
  };
}

function setupDefaults(
  overrides: {
    workflows?: unknown[];
    nodeTypes?: unknown[];
    integrations?: unknown[];
    logos?: unknown[];
    summaries?: unknown[];
    objectCounts?: Array<{ datasourceId: string; count: number }>;
  } = {},
) {
  mockApi.workflows.list.mockResolvedValue({
    data: overrides.workflows ?? [],
    total: (overrides.workflows ?? []).length,
  });
  mockApi.nodeTypes.list.mockResolvedValue(overrides.nodeTypes ?? []);
  mockApi.integrations.list.mockResolvedValue({
    data: overrides.integrations ?? [],
    total: (overrides.integrations ?? []).length,
  });
  mockApi.integrations.listLogos.mockResolvedValue(overrides.logos ?? []);
  mockApi.executions.getLatestSummaries.mockResolvedValue(
    overrides.summaries ?? [],
  );
  mockDatastore.getObjectCountsByDatasource.mockResolvedValue(
    overrides.objectCounts ?? [],
  );
}

// Fresh QueryClient per test so cached query results never leak between tests.
let wrapper: (props: { children: ReactNode }) => ReactNode;
let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaults();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  wrapper = ({ children }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
});

describe('useDataSources', () => {
  describe('initial loading', () => {
    it('returns loading=true and empty dataSources while fetching', () => {
      // Don't resolve the promises immediately
      mockApi.workflows.list.mockReturnValue(new Promise(() => {}));
      mockApi.nodeTypes.list.mockReturnValue(new Promise(() => {}));
      mockApi.integrations.list.mockReturnValue(new Promise(() => {}));
      mockApi.integrations.listLogos.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useDataSources(), { wrapper });
      expect(result.current.loading).toBe(true);
      expect(result.current.dataSources).toEqual([]);
    });
  });

  describe('data mapping', () => {
    it('maps workflows to DataSourceItem with integration from resolved integration', async () => {
      setupDefaults({
        workflows: [
          makeWorkflow({
            id: 'ds-1',
            nodes: [
              {
                id: 'n1',
                type: 'github-source',
                data: { config: { integrationId: 'int-gh' } },
              },
            ],
          }),
        ],
        nodeTypes: [
          {
            type: 'github-source',
            label: 'GitHub',
            category: 'source',
            icon: 'Github',
            color: '#333',
          },
        ],
        integrations: [
          {
            id: 'int-gh',
            name: 'GitHub Org',
            type: 'github',
            logoUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E',
          },
        ],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.dataSources).toHaveLength(1);
      const ds = result.current.dataSources[0];
      expect(ds.integrationId).toBe('int-gh');
      expect(ds.sourceConfig).toEqual({ integrationId: 'int-gh' });
      expect(ds.integration).toEqual(
        expect.objectContaining({
          id: 'int-gh',
          // Category type from the resolved integration, not its id.
          type: 'github',
          label: 'GitHub Org',
          icon: 'Github',
          color: '#333',
          logoUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E',
        }),
      );
    });

    it('falls back to nodeType when integration is not found', async () => {
      setupDefaults({
        workflows: [
          makeWorkflow({
            nodes: [
              {
                id: 'n1',
                type: 'http-source',
                data: { config: {} },
              },
            ],
          }),
        ],
        nodeTypes: [
          {
            type: 'http-source',
            label: 'HTTP',
            category: 'source',
            icon: 'Http',
            color: '#3b82f6',
          },
        ],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.dataSources[0].integration).toEqual(
        expect.objectContaining({
          type: 'http-source',
          label: 'HTTP',
          icon: 'Http',
          color: '#3b82f6',
          logoUrl: '',
        }),
      );
    });

    it('falls back to sourceType string when neither integration nor nodeType exists', async () => {
      setupDefaults({
        workflows: [
          makeWorkflow({
            nodes: [
              {
                id: 'n1',
                type: 'custom-source',
                data: { config: {} },
              },
            ],
          }),
        ],
        nodeTypes: [
          { type: 'custom-source', label: 'Custom', category: 'source' },
        ],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      // Falls back to nodeType since it exists (even without icon/color)
      expect(result.current.dataSources[0].integration?.label).toBe('Custom');
    });

    it('returns undefined integration for workflow with no source node', async () => {
      setupDefaults({
        workflows: [makeWorkflow({ nodes: [] })],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.dataSources[0].integration).toBeUndefined();
    });

    it('collects primary and chained-source integrations into `integrations`', async () => {
      setupDefaults({
        workflows: [
          makeWorkflow({
            id: 'ds-chained',
            nodes: [
              {
                id: 'n1',
                type: 'github-source',
                data: { config: { integrationId: 'int-gh' } },
              },
              {
                id: 'n2',
                type: 'source-chained',
                data: { config: { integrationId: 'int-pd' } },
              },
            ],
          }),
        ],
        nodeTypes: [
          {
            type: 'github-source',
            label: 'GitHub',
            category: 'source',
            icon: 'Github',
          },
        ],
        integrations: [
          { id: 'int-gh', name: 'GitHub Org', type: 'github', logoUrl: '' },
          { id: 'int-pd', name: 'PagerDuty', type: 'pagerduty', logoUrl: '' },
        ],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      const ds = result.current.dataSources[0];
      // Primary integration is unchanged and stays first.
      expect(ds.integration?.id).toBe('int-gh');
      expect(ds.integrations?.map(i => i.id)).toEqual(['int-gh', 'int-pd']);
    });

    it('dedupes a chained source that reuses the primary integration', async () => {
      setupDefaults({
        workflows: [
          makeWorkflow({
            id: 'ds-dupe',
            nodes: [
              {
                id: 'n1',
                type: 'github-source',
                data: { config: { integrationId: 'int-gh' } },
              },
              {
                id: 'n2',
                type: 'source-chained',
                data: { config: { integrationId: 'int-gh' } },
              },
            ],
          }),
        ],
        nodeTypes: [
          { type: 'github-source', label: 'GitHub', category: 'source' },
        ],
        integrations: [
          { id: 'int-gh', name: 'GitHub Org', type: 'github', logoUrl: '' },
        ],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(
        result.current.dataSources[0].integrations?.map(i => i.id),
      ).toEqual(['int-gh']);
    });

    it('resolves logoUrl to data URI via logoSlug from logos catalog', async () => {
      setupDefaults({
        workflows: [
          makeWorkflow({
            nodes: [
              {
                id: 'n1',
                type: 'github-source',
                data: { config: { integrationId: 'int-gh' } },
              },
            ],
          }),
        ],
        nodeTypes: [
          {
            type: 'github-source',
            label: 'GitHub',
            category: 'source',
            icon: 'Github',
          },
        ],
        integrations: [
          {
            id: 'int-gh',
            name: 'GH',
            type: 'github',
            logoUrl: 'https://backend/api/integrations/int-gh/logo',
            logoSlug: 'github',
          },
        ],
        logos: [{ slug: 'github', label: 'GitHub', svg: '<svg/>' }],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.dataSources[0].logoUrl).toBe(
        'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E',
      );
    });

    it('keeps inline data URI logoUrl as-is', async () => {
      const dataUri = 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E';
      setupDefaults({
        workflows: [
          makeWorkflow({
            nodes: [
              {
                id: 'n1',
                type: 'github-source',
                data: { config: { integrationId: 'int-gh' } },
              },
            ],
          }),
        ],
        nodeTypes: [
          {
            type: 'github-source',
            label: 'GitHub',
            category: 'source',
            icon: 'Github',
          },
        ],
        integrations: [
          {
            id: 'int-gh',
            name: 'GH',
            type: 'github',
            logoUrl: dataUri,
          },
        ],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.dataSources[0].logoUrl).toBe(dataUri);
    });

    it('falls back to empty string when no logoSlug and logoUrl is not a data URI', async () => {
      setupDefaults({
        workflows: [
          makeWorkflow({
            nodes: [
              {
                id: 'n1',
                type: 'github-source',
                data: { config: { integrationId: 'int-gh' } },
              },
            ],
          }),
        ],
        nodeTypes: [
          {
            type: 'github-source',
            label: 'GitHub',
            category: 'source',
            icon: 'Github',
          },
        ],
        integrations: [
          {
            id: 'int-gh',
            name: 'GH',
            type: 'github',
            logoUrl: 'https://backend/api/integrations/int-gh/logo',
          },
        ],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.dataSources[0].logoUrl).toBe('');
    });
  });

  describe('execution data', () => {
    it('fetches execution summaries and attaches to data sources', async () => {
      setupDefaults({
        workflows: [makeWorkflow({ id: 'ds-1' })],
        summaries: [
          {
            workflowId: 'ds-1',
            executionId: 'exec-1',
            completedAt: '2026-03-20T10:00:00Z',
            startedAt: '2026-03-20T09:55:00Z',
            objectCount: 42,
            status: 'completed',
          },
        ],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => {
        expect(result.current.dataSources[0]?.execution).toEqual({
          executionId: 'exec-1',
          lastRunAt: '2026-03-20T10:00:00Z',
          objectCount: 42,
          status: 'completed',
          isDryRun: false,
        });
      });
    });

    it('skips execution fetching when skipExecutions is true', async () => {
      setupDefaults({
        workflows: [makeWorkflow({ id: 'ds-1' })],
      });

      const { result } = renderHook(
        () => useDataSources({ skipExecutions: true }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(mockApi.executions.getLatestSummaries).not.toHaveBeenCalled();
    });

    it('noteRunStarted preserves the previous real execution while scheduling its replacement', async () => {
      setupDefaults({
        workflows: [makeWorkflow({ id: 'ds-1' })],
        summaries: [
          {
            workflowId: 'ds-1',
            executionId: 'exec-1',
            completedAt: '2026-03-20T10:00:00Z',
            startedAt: '2026-03-20T09:55:00Z',
            objectCount: 42,
            status: 'completed',
            error: 'Previous run failed',
            largePayloadWarning: {
              code: 'large-data-source-payload',
              affectedObjectCount: 1,
              oversizedValueCount: 1,
              thresholdBytes: 100_000,
              largestValueBytes: 120_000,
              largestValuePath: 'metadata.description',
              kubernetesObjectsCleaned: 0,
              bytesRemoved: 0,
            },
          },
        ],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() =>
        expect(result.current.dataSources[0]?.execution?.objectCount).toBe(42),
      );

      const before = Date.now();
      act(() => {
        result.current.noteRunStarted('ds-1');
      });

      const execution = result.current.dataSources[0]?.execution;
      expect(execution?.status).toBe('running');
      expect(execution?.executionId).toBe('exec-1');
      expect(execution?.objectCount).toBe(42);
      expect(execution?.error).toBeUndefined();
      expect(execution?.largePayloadWarning).toBeUndefined();
      expect(execution?.lastRunAt).toBeDefined();
      const stamped = new Date(execution!.lastRunAt!).getTime();
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(Date.now());
    });

    it('monotonic lastRunAt: a stale refetch does not clobber the optimistic timestamp', async () => {
      // Each call returns fresh objects so React Query publishes a new
      // reference and the execution-summary effect re-runs.
      mockApi.workflows.list.mockImplementation(async () => ({
        data: [makeWorkflow({ id: 'ds-1' })],
        total: 1,
      }));
      mockApi.nodeTypes.list.mockImplementation(async () => []);
      mockApi.integrations.list.mockImplementation(async () => ({
        data: [],
        total: 0,
      }));
      const staleCompletedAt = '2026-03-20T10:00:00Z';
      mockApi.executions.getLatestSummaries.mockResolvedValue([
        {
          workflowId: 'ds-1',
          completedAt: staleCompletedAt,
          startedAt: '2026-03-20T09:55:00Z',
          objectCount: 42,
          status: 'completed',
        },
      ]);

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() =>
        expect(result.current.dataSources[0]?.execution?.objectCount).toBe(42),
      );

      // Simulate clicking Run once: optimistic stamp is newer than the stale
      // completed-at the server keeps returning.
      act(() => {
        result.current.noteRunStarted('ds-1');
      });
      const optimisticStamp =
        result.current.dataSources[0]!.execution!.lastRunAt!;

      // The subsequent refetch resolves to the prior completed summary (the
      // endpoint hasn't observed the just-triggered run yet). The merge must
      // keep the optimistic stamp rather than reverting to the old one.
      act(() => {
        result.current.refetch();
      });

      await waitFor(() =>
        expect(
          mockApi.executions.getLatestSummaries.mock.calls.length,
        ).toBeGreaterThan(1),
      );

      const afterRefetch = result.current.dataSources[0]?.execution;
      expect(afterRefetch?.lastRunAt).toBe(optimisticStamp);
      expect(afterRefetch?.objectCount).toBe(42);
    });

    it('handles execution fetch failure silently', async () => {
      mockApi.executions.getLatestSummaries.mockRejectedValue(
        new Error('Network error'),
      );
      setupDefaults({
        workflows: [makeWorkflow({ id: 'ds-1' })],
      });
      // Re-apply the rejection after setupDefaults
      mockApi.executions.getLatestSummaries.mockRejectedValue(
        new Error('Network error'),
      );

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      // Should not throw, execution data just remains undefined
      expect(result.current.dataSources[0].execution).toBeUndefined();
      expect(result.current.error).toBeUndefined();
    });
  });

  describe('datastore object counts', () => {
    it('preserves counts for existing datasources while a changed list reloads them', async () => {
      setupDefaults({
        workflows: [makeWorkflow({ id: 'ds-1' })],
        objectCounts: [{ datasourceId: 'ds-1', count: 17 }],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() =>
        expect(result.current.dataSources[0]?.objectCount).toBe(17),
      );

      mockApi.workflows.list.mockResolvedValue({
        data: [makeWorkflow({ id: 'ds-1' }), makeWorkflow({ id: 'ds-2' })],
        total: 2,
      });
      mockDatastore.getObjectCountsByDatasource.mockReturnValue(
        new Promise(() => {}),
      );

      await act(async () => {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.dataIngestionWorkflows,
        });
      });
      await waitFor(() => expect(result.current.dataSources).toHaveLength(2));

      expect(result.current.dataSources[0]?.objectCount).toBe(17);
      expect(result.current.dataSources[1]?.objectCount).toBeUndefined();
    });

    it('attaches the datastore count, not the last-run execution count', async () => {
      setupDefaults({
        workflows: [makeWorkflow({ id: 'ds-1' })],
        summaries: [
          {
            workflowId: 'ds-1',
            completedAt: '2026-03-20T10:00:00Z',
            startedAt: '2026-03-20T09:55:00Z',
            objectCount: 42,
            status: 'completed',
          },
        ],
        // The last run fetched 42 objects, but only 17 remain in the store
        // (e.g. after webhook-driven deletions).
        objectCounts: [{ datasourceId: 'ds-1', count: 17 }],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.dataSources).toHaveLength(1));
      await waitFor(() => expect(result.current.executionsLoading).toBe(false));

      expect(result.current.dataSources[0]?.objectCount).toBe(17);
      expect(result.current.dataSources[0]?.execution?.objectCount).toBe(42);
    });

    it('reports 0 for datasources absent from the grouped counts', async () => {
      setupDefaults({
        workflows: [makeWorkflow({ id: 'ds-1' }), makeWorkflow({ id: 'ds-2' })],
        objectCounts: [{ datasourceId: 'ds-1', count: 3 }],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.dataSources).toHaveLength(2));
      await waitFor(() => expect(result.current.executionsLoading).toBe(false));

      expect(result.current.dataSources[0]?.objectCount).toBe(3);
      expect(result.current.dataSources[1]?.objectCount).toBe(0);
    });

    it('leaves objectCount undefined when the counts fetch fails', async () => {
      setupDefaults({
        workflows: [makeWorkflow({ id: 'ds-1' })],
      });
      mockDatastore.getObjectCountsByDatasource.mockRejectedValue(
        new Error('Network error'),
      );

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.dataSources).toHaveLength(1));
      await waitFor(() => expect(result.current.executionsLoading).toBe(false));

      expect(result.current.dataSources[0]?.objectCount).toBeUndefined();
      expect(result.current.error).toBeUndefined();
    });

    it('does not fetch counts when skipExecutions is true', async () => {
      setupDefaults({
        workflows: [makeWorkflow({ id: 'ds-1' })],
      });

      const { result } = renderHook(
        () => useDataSources({ skipExecutions: true }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(mockDatastore.getObjectCountsByDatasource).not.toHaveBeenCalled();
    });
  });

  describe('isSourceConfigured', () => {
    const awsNodeTypes = [
      {
        type: 'aws',
        label: 'AWS',
        category: 'source',
        icon: 'Cloud',
        color: '#f90',
      },
    ];

    function makeAwsWorkflow(config: Record<string, unknown>) {
      return makeWorkflow({
        id: 'ds-aws',
        nodes: [{ id: 'n1', type: 'aws', data: { config } }],
      });
    }

    it('treats an AWS service-api source as configured without a resourceType (sc-33960)', async () => {
      setupDefaults({
        workflows: [
          makeAwsWorkflow({
            integrationId: 'int-aws',
            backendType: 'aws',
            mode: 'service-api',
            accountIds: ['123456789012'],
            service: 's3',
            operation: 'ListBuckets',
            path: '/',
            arrayExpression: 'Buckets',
          }),
        ],
        nodeTypes: awsNodeTypes,
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.dataSources[0]?.isSourceConfigured).toBe(true);
    });

    it('treats a source-datastore node as configured once a datasource is chosen (sc-33950)', async () => {
      const datastoreNodeTypes = [
        {
          type: 'source-datastore',
          label: 'Data Source',
          category: 'source',
          icon: 'stacked',
          color: '#3b82f6',
        },
      ];
      setupDefaults({
        workflows: [
          makeWorkflow({
            id: 'ds-configured',
            nodes: [
              {
                id: 'n1',
                type: 'source-datastore',
                data: { config: { datasourceId: 'ds-upstream' } },
              },
            ],
          }),
          makeWorkflow({
            id: 'ds-unconfigured',
            nodes: [
              {
                id: 'n1',
                type: 'source-datastore',
                data: { config: {} },
              },
            ],
          }),
        ],
        nodeTypes: datastoreNodeTypes,
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      const byId = new Map(result.current.dataSources.map(ds => [ds.id, ds]));
      expect(byId.get('ds-configured')?.isSourceConfigured).toBe(true);
      expect(byId.get('ds-unconfigured')?.isSourceConfigured).toBe(false);
    });

    it('flags an AWS cloud-control source without a resourceType as not configured', async () => {
      setupDefaults({
        workflows: [
          makeAwsWorkflow({
            integrationId: 'int-aws',
            backendType: 'aws',
            accountIds: ['123456789012'],
          }),
        ],
        nodeTypes: awsNodeTypes,
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.dataSources[0]?.isSourceConfigured).toBe(false);
    });

    it('detects AWS via the resolved integration when the persisted config has no backendType (AWS Organizations Account)', async () => {
      // Real-world shape: a `source-integration` node whose config lacks
      // `backendType` (it is only persisted when the integration is picked
      // through the source-config UI). AWS-ness must come from the resolved
      // integration, mirroring the editor — otherwise the source is validated
      // with the http rule and wrongly flagged "Needs setup" (sc-33960 gap).
      setupDefaults({
        workflows: [
          makeWorkflow({
            id: 'ds-aws-org',
            nodes: [
              {
                id: 'n1',
                type: 'source-integration',
                data: {
                  config: {
                    integrationId: 'int-aws',
                    mode: 'cloud-control',
                    accountIds: ['131774410247'],
                    resourceType: 'AWS::Organizations::Account',
                    objectIdExpression: 'id',
                  },
                },
              },
            ],
          }),
        ],
        nodeTypes: [
          {
            type: 'source-integration',
            label: 'Integration',
            category: 'source',
            icon: 'Cloud',
          },
        ],
        integrations: [
          {
            id: 'int-aws',
            name: 'AWS',
            type: 'infrastructure',
            backendType: 'aws',
            logoUrl: '',
          },
        ],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.dataSources[0]?.isSourceConfigured).toBe(true);
    });
  });

  describe('execution polling', () => {
    const RUNNING_SUMMARY = {
      workflowId: 'ds-1',
      executionId: 'ex-1',
      status: 'running',
      startedAt: '2026-08-21T12:00:00Z',
    };
    const SETTLED_SUMMARY = {
      workflowId: 'ds-1',
      executionId: 'ex-1',
      status: 'completed',
      startedAt: '2026-08-21T11:59:00Z',
      completedAt: '2026-08-21T12:00:00Z',
    };

    // Settle the dependent query chain (workflows -> summaries) without tripping
    // the poll interval, which is far larger than these advances.
    async function settle() {
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50);
        });
      }
    }

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-21T12:00:05Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('keeps polling the execution summaries while a run is in flight', async () => {
      setupDefaults({
        workflows: [makeWorkflow({ id: 'ds-1' })],
        summaries: [RUNNING_SUMMARY],
      });

      renderHook(() => useDataSources(), { wrapper });
      await settle();
      const callsAfterSettle =
        mockApi.executions.getLatestSummaries.mock.calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RUNNING_POLL_INTERVAL_MS + 200);
      });

      expect(
        mockApi.executions.getLatestSummaries.mock.calls.length,
      ).toBeGreaterThan(callsAfterSettle);
    });

    it('starts polling from the optimistic running state even when the cache still shows a settled run', async () => {
      // Reproduces the reader-replica race: a manual run flips the row to
      // running via noteRunStarted, but the immediate post-run refetch can lag
      // and still return the prior settled summary. Polling must key off the
      // optimistic/merged state, not only the cache, or "Running…" gets stuck.
      setupDefaults({
        workflows: [makeWorkflow({ id: 'ds-1' })],
        summaries: [SETTLED_SUMMARY],
      });

      const { result } = renderHook(() => useDataSources(), { wrapper });
      await settle();
      const callsAfterSettle =
        mockApi.executions.getLatestSummaries.mock.calls.length;

      act(() => {
        result.current.noteRunStarted('ds-1');
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RUNNING_POLL_INTERVAL_MS + 200);
      });

      expect(
        mockApi.executions.getLatestSummaries.mock.calls.length,
      ).toBeGreaterThan(callsAfterSettle);
    });

    it('does not poll once every run has settled', async () => {
      setupDefaults({
        workflows: [makeWorkflow({ id: 'ds-1' })],
        summaries: [SETTLED_SUMMARY],
      });

      renderHook(() => useDataSources(), { wrapper });
      await settle();
      const callsAfterSettle =
        mockApi.executions.getLatestSummaries.mock.calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RUNNING_POLL_INTERVAL_MS * 3);
      });

      expect(mockApi.executions.getLatestSummaries.mock.calls.length).toBe(
        callsAfterSettle,
      );
    });
  });
});
