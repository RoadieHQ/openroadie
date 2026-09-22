import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient, renderHookWithQuery } from '../../test-utils';
import { PATHS } from '../../config/paths';
import { queryKeys } from '../../api/queries';
import { useSidebarCounts } from './use-sidebar-counts';

const listWorkflows = vi.fn();
const listIntegrations = vi.fn();
const listContextGroupRules = vi.fn();
const listRelationshipRules = vi.fn();
const getObjectCountsByDatasource = vi.fn();
const listContextGroups = vi.fn();
const listCapabilities = vi.fn();
const listActions = vi.fn();
const getFacets = vi.fn();

vi.mock('../../api', () => ({
  useWorkflows: () => ({
    workflows: { list: listWorkflows },
    integrations: { list: listIntegrations },
  }),
  useDatastore: () => ({
    listContextGroupRules,
    listRelationshipRules,
    getObjectCountsByDatasource,
    listContextGroups,
  }),
  useCapabilities: () => ({ list: listCapabilities }),
  useActions: () => ({ list: listActions }),
  useMcpAudit: () => ({ getFacets }),
}));

// The capabilities/actions/context-group reads paginate and recount, taking
// `total` from the rows they actually received — so a stub must return rows.
function page(total: number, idPrefix: string) {
  return {
    items: Array.from({ length: total }, (_, i) => ({
      id: `${idPrefix}-${i}`,
    })),
    total,
  };
}

const GROUPS_BY_RULE: Record<string, number> = {
  'cg-0': 40,
  'cg-1': 60,
  'cg-2': 100,
};

describe('useSidebarCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listWorkflows.mockResolvedValue({
      data: [{ id: 'ds-1' }, { id: 'ds-2' }],
      total: 2,
    });
    listIntegrations.mockResolvedValue({ data: [{ id: 'i-1' }], total: 7 });
    listContextGroupRules.mockResolvedValue(page(3, 'cg'));
    // 40 + 60 + 100 groups across the three rules.
    listContextGroups.mockImplementation(({ ruleId }: { ruleId: string }) =>
      Promise.resolve({ items: [], total: GROUPS_BY_RULE[`${ruleId}`] ?? 0 }),
    );
    listRelationshipRules.mockResolvedValue(page(11, 'rr'));
    getObjectCountsByDatasource.mockResolvedValue([
      { datasourceId: 'ds-1', count: 120 },
      { datasourceId: 'ds-2', count: 30 },
    ]);
    listCapabilities.mockResolvedValue(page(5, 'c'));
    listActions.mockResolvedValue(page(4, 'a'));
    getFacets.mockResolvedValue({
      services: [],
      tools: [],
      users: [],
      escalationCount: 1,
      totalSessionCount: 42,
    });
  });

  it('reports a count for every primary sidebar route', async () => {
    const { result } = renderHookWithQuery(() => useSidebarCounts());

    await waitFor(() =>
      expect(result.current).toEqual({
        [PATHS.DATASTORE]: 350,
        [PATHS.INTEGRATIONS]: 7,
        [PATHS.DATA_SOURCES]: 2,
        [PATHS.RELATIONSHIPS]: 11,
        [PATHS.CONTEXT_GROUPS]: 3,
        [PATHS.CAPABILITIES]: 5,
        [PATHS.ACTIONS]: 4,
        [PATHS.ADMIN_MCP_AUDIT_LOG]: 42,
      }),
    );
  });

  it('counts only the rules in force under Relationships', async () => {
    renderHookWithQuery(() => useSidebarCounts());

    await waitFor(() => expect(listRelationshipRules).toHaveBeenCalled());
    expect(listRelationshipRules).toHaveBeenCalledWith({
      state: 'active',
      limit: 1,
    });
  });

  it('leaves an unresolved count absent rather than showing zero', async () => {
    listCapabilities.mockReturnValue(new Promise(() => {}));

    const { result } = renderHookWithQuery(() => useSidebarCounts());

    await waitFor(() => expect(result.current[PATHS.ACTIONS]).toBe(4));
    expect(result.current[PATHS.CAPABILITIES]).toBeUndefined();
    expect(PATHS.CAPABILITIES in result.current).toBe(true);
  });

  it('counts objects and context groups together under Data Store', async () => {
    const { result } = renderHookWithQuery(() => useSidebarCounts());

    // The datastore table lists both, so its total is the sum: 150 objects
    // (120 + 30) plus 200 groups (40 + 60 + 100).
    await waitFor(() => expect(result.current[PATHS.DATASTORE]).toBe(350));
    expect(listContextGroups).toHaveBeenCalledWith({
      ruleId: 'cg-0',
      limit: 1,
    });
  });

  it('counts objects of data sources the workflow list no longer knows', async () => {
    // Deleting a data source leaves its objects behind, so /objects/counts
    // carries rows for datasources that are not data-ingestion workflows — and
    // the datastore table's total includes them. Narrowing the sum to the
    // workflow ids would under-report against the page.
    getObjectCountsByDatasource.mockResolvedValue([
      { datasourceId: 'ds-1', count: 120 },
      { datasourceId: 'ds-2', count: 30 },
      { datasourceId: 'ds-deleted', count: 128 },
    ]);

    const { result } = renderHookWithQuery(() => useSidebarCounts());

    await waitFor(() => expect(result.current[PATHS.DATASTORE]).toBe(478));
  });

  it('leaves a failed count absent without disturbing the others', async () => {
    listIntegrations.mockRejectedValue(new Error('backend down'));
    getObjectCountsByDatasource.mockRejectedValue(new Error('backend down'));

    const { result } = renderHookWithQuery(() => useSidebarCounts());

    await waitFor(() => expect(result.current[PATHS.ACTIONS]).toBe(4));
    expect(result.current[PATHS.INTEGRATIONS]).toBeUndefined();
    // No half-sum from the groups that did resolve, and no NaN.
    expect(result.current[PATHS.DATASTORE]).toBeUndefined();
    expect(result.current[PATHS.CONTEXT_GROUPS]).toBe(3);
  });

  it('publishes no Data Store total until every rule has reported', async () => {
    listContextGroups.mockImplementation(({ ruleId }: { ruleId: string }) =>
      ruleId === 'cg-2'
        ? new Promise<never>(() => {})
        : Promise.resolve({ items: [], total: GROUPS_BY_RULE[`${ruleId}`] }),
    );

    const { result } = renderHookWithQuery(() => useSidebarCounts());

    // The objects and two of three rules resolve; publishing their partial sum
    // (250) would read as a fact rather than as still-loading.
    await waitFor(() => expect(result.current[PATHS.CONTEXT_GROUPS]).toBe(3));
    expect(result.current[PATHS.DATASTORE]).toBeUndefined();
  });

  it('reports zero when there are no data sources and no rules', async () => {
    listWorkflows.mockResolvedValue({ data: [], total: 0 });
    listContextGroupRules.mockResolvedValue(page(0, 'cg'));

    const { result } = renderHookWithQuery(() => useSidebarCounts());

    await waitFor(() => expect(result.current[PATHS.DATASTORE]).toBe(0));
    expect(getObjectCountsByDatasource).not.toHaveBeenCalled();
    expect(listContextGroups).not.toHaveBeenCalled();
  });

  it('counts groups alone when there are no data sources', async () => {
    listWorkflows.mockResolvedValue({ data: [], total: 0 });

    const { result } = renderHookWithQuery(() => useSidebarCounts());

    await waitFor(() => expect(result.current[PATHS.DATASTORE]).toBe(200));
  });

  it('grows the Data Store total when a rule is added', async () => {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSidebarCounts(), { wrapper });
    await waitFor(() => expect(result.current[PATHS.DATASTORE]).toBe(350));

    // A fourth rule with 25 groups appears. The total has to follow the rule
    // *set*, not just each known rule's number.
    GROUPS_BY_RULE['cg-3'] = 25;
    listContextGroupRules.mockResolvedValue(page(4, 'cg'));
    await client.invalidateQueries({ queryKey: queryKeys.contextGroupRules });

    await waitFor(() => expect(result.current[PATHS.DATASTORE]).toBe(375));
    expect(result.current[PATHS.CONTEXT_GROUPS]).toBe(4);
    delete GROUPS_BY_RULE['cg-3'];
  });

  it('reads object counts under the key the data-sources page uses', async () => {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSidebarCounts(), { wrapper });
    await waitFor(() => expect(result.current[PATHS.DATASTORE]).toBe(350));

    // The page keys this entry on its workflow id set; the sidebar has to key
    // it the same way or the two fetch the same payload twice.
    expect(
      client.getQueryData(queryKeys.objectCounts(['ds-1', 'ds-2'])),
    ).toBeDefined();
    expect(getObjectCountsByDatasource).toHaveBeenCalledTimes(1);
  });

  it('tracks the Data Store total across a refetch, not just the first read', async () => {
    const { result } = renderHookWithQuery(() => useSidebarCounts());
    await waitFor(() => expect(result.current[PATHS.DATASTORE]).toBe(350));

    getObjectCountsByDatasource.mockResolvedValue([
      { datasourceId: 'ds-1', count: 500 },
      { datasourceId: 'ds-2', count: 30 },
    ]);
    listWorkflows.mockResolvedValue({
      data: [{ id: 'ds-1' }, { id: 'ds-2' }, { id: 'ds-3' }],
      total: 3,
    });
    GROUPS_BY_RULE['cg-0'] = 41;

    const { result: second } = renderHookWithQuery(() => useSidebarCounts());
    await waitFor(() => expect(second.current[PATHS.DATASTORE]).toBe(731));
    expect(second.current[PATHS.DATA_SOURCES]).toBe(3);
    GROUPS_BY_RULE['cg-0'] = 40;
  });
});
