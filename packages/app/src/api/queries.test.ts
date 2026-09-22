import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResponseError } from './infrastructure/errors';
import { WorkflowClient } from './workflow';
import {
  actionsListQuery,
  actionVersionCountQuery,
  activeRelationshipRuleCountQuery,
  allDirectRelationshipsQuery,
  capabilitiesListQuery,
  contextGroupInstanceQuery,
  contextGroupRuleGroupCountQuery,
  contextGroupRulesQuery,
  dataSourceSeedsQuery,
  executionDetailQuery,
  integrationsListQuery,
  invalidationKeys,
  logosCatalogQuery,
  mcpAuditFacetsQuery,
  queryKeys,
  workspacesListQuery,
} from './queries';
import { resetWorkspaceScope, setWorkspaceScope } from './workspace-scope';

afterEach(resetWorkspaceScope);

describe('workspace query keys', () => {
  it('keeps entity caches separate across workspace switches', () => {
    const organizationActions = queryKeys.actionsList;

    setWorkspaceScope({ workspaceId: 'workspace-a', kind: 'personal' });
    const workspaceActions = queryKeys.actionsList;
    const workspaceDetail = queryKeys.actionDetail('action-1');

    expect(organizationActions).toEqual([
      'workspace',
      '__organization__',
      'actions',
      'list',
    ]);
    expect(workspaceActions).toEqual([
      'workspace',
      'workspace-a',
      'actions',
      'list',
    ]);
    expect(workspaceDetail).toEqual([
      'workspace',
      'workspace-a',
      'actions',
      'detail',
      'action-1',
    ]);
  });

  it('keeps deployment-wide catalogs outside workspace caches', () => {
    const organizationLogos = queryKeys.logos;
    const organizationNodeTypes = queryKeys.dataIngestionNodeTypes;

    setWorkspaceScope({ workspaceId: 'workspace-a', kind: 'personal' });

    expect(queryKeys.logos).toBe(organizationLogos);
    expect(queryKeys.dataIngestionNodeTypes).toBe(organizationNodeTypes);
  });
});

/**
 * Invoke a `queryOptions` object's `queryFn`.
 *
 * `queryFn` is optional on the type and receives a QueryFunctionContext that
 * none of these queries reads, so calling it directly is a type error. This
 * asserts it exists once, here, instead of casting at every call site.
 */
async function runQueryFn<TResult = unknown>(query: {
  queryFn?: unknown;
}): Promise<TResult> {
  const { queryFn } = query;
  if (typeof queryFn !== 'function') {
    throw new Error('query has no queryFn');
  }
  return (await queryFn({} as never)) as TResult;
}

describe('invalidationKeys.workflowSaved', () => {
  it('refreshes integrations derived from workflow references', () => {
    expect(invalidationKeys.workflowSaved('wf-1')).toEqual([
      queryKeys.integrationsList,
      queryKeys.dataIngestionWorkflows,
      queryKeys.workflowDetail('wf-1'),
    ]);
  });

  it('omits the workflow detail key when no id is provided', () => {
    expect(invalidationKeys.workflowSaved()).toEqual([
      queryKeys.integrationsList,
      queryKeys.dataIngestionWorkflows,
      undefined,
    ]);
  });
});

// The client-side-paginated listings must fetch every page. A bare `list()`
// takes the backend's default page size (50) and silently truncates the table.
describe('fully-paginated listing queries', () => {
  const listing = (count: number) => {
    const all = Array.from({ length: count }, (_, i) => ({ id: `item-${i}` }));
    return vi.fn(async (options?: { limit?: number; offset?: number }) => {
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 50;
      return { items: all.slice(offset, offset + limit), total: all.length };
    });
  };

  const cases = [
    {
      name: 'capabilitiesListQuery',
      method: 'list',
      build: capabilitiesListQuery,
    },
    { name: 'actionsListQuery', method: 'list', build: actionsListQuery },
    {
      name: 'contextGroupRulesQuery',
      method: 'listContextGroupRules',
      build: contextGroupRulesQuery,
    },
  ] as const;

  cases.forEach(({ name, method, build }) => {
    describe(name, () => {
      it('never relies on the backend default page size', async () => {
        const load = listing(157);
        const query = build({ [`${method}`]: load } as any);

        const result = await runQueryFn<any>(query);

        expect(load.mock.calls[0][0]?.limit).toBeGreaterThan(157);
        expect(result.items).toHaveLength(157);
        expect(result.total).toBe(157);
      });

      it('walks every page when the list exceeds one page', async () => {
        const load = listing(1_200);
        const query = build({ [`${method}`]: load } as any);

        const result = await runQueryFn<any>(query);

        expect(result.items).toHaveLength(1_200);
        expect(result.total).toBe(1_200);
        expect(new Set(result.items.map((i: any) => i.id)).size).toBe(1_200);
      });
    });
  });
});

// The graph aggregates these into per-pair "+N direct" counts and a delete
// confirmation that states how many edges it will remove, so a truncated fetch
// makes the UI state numbers that are simply wrong.
describe('allDirectRelationshipsQuery', () => {
  const relationships = (count: number) => {
    const all = Array.from({ length: count }, (_, i) => ({ id: `rel-${i}` }));
    return vi.fn(
      async (options?: {
        limit?: number;
        offset?: number;
        direct?: boolean;
      }) => {
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? 50;
        return { items: all.slice(offset, offset + limit), total: all.length };
      },
    );
  };

  it('walks every page rather than capping at one', async () => {
    const queryRelationships = relationships(1_200);
    const query = allDirectRelationshipsQuery({ queryRelationships } as any);

    const result = await runQueryFn<any>(query);

    expect(result.items).toHaveLength(1_200);
    expect(new Set(result.items.map((r: any) => r.id)).size).toBe(1_200);
  });

  it('only ever asks for direct relationships', async () => {
    const queryRelationships = relationships(10);
    const query = allDirectRelationshipsQuery({ queryRelationships } as any);

    await runQueryFn(query);

    for (const [options] of queryRelationships.mock.calls) {
      expect(options?.direct).toBe(true);
    }
  });
});

describe('invalidationKeys.capabilitySaved', () => {
  it('refreshes the list after creating a capability', () => {
    expect(invalidationKeys.capabilitySaved()).toEqual([
      queryKeys.capabilitiesList,
    ]);
  });

  it('refreshes the list, detail and versions after updating a capability', () => {
    expect(invalidationKeys.capabilitySaved('capability-1')).toEqual([
      queryKeys.capabilitiesList,
      queryKeys.capabilityDetail('capability-1'),
      queryKeys.capabilityVersions('capability-1'),
    ]);
  });
});

describe('invalidationKeys.actionSaved', () => {
  it('refreshes the list after creating or deleting an action', () => {
    expect(invalidationKeys.actionSaved()).toEqual([queryKeys.actionsList]);
  });

  it('refreshes the list, detail and versions after updating an action', () => {
    expect(invalidationKeys.actionSaved('action-1')).toEqual([
      queryKeys.actionsList,
      queryKeys.actionDetail('action-1'),
      queryKeys.actionVersions('action-1'),
    ]);
  });
});

describe('actionVersionCountQuery', () => {
  it('uses the shared version-count key and requests one version', async () => {
    const listVersions = vi.fn().mockResolvedValue({ items: [], total: 4 });
    const query = actionVersionCountQuery({ listVersions } as any, 'action-1');

    expect(query.queryKey).toEqual(queryKeys.actionVersionCount('action-1'));
    await expect(runQueryFn(query)).resolves.toBe(4);
    expect(listVersions).toHaveBeenCalledWith('action-1', { limit: 1 });
  });
});

describe('query freshness', () => {
  it('does not focus-refetch event-backed queries', () => {
    expect(actionsListQuery({} as any).refetchOnWindowFocus).toBe(false);
  });

  it('focus-refetches mutable queries without subscriptions', () => {
    expect(integrationsListQuery({} as any).refetchOnWindowFocus).toBe(true);
    expect(workspacesListQuery({} as any).refetchOnWindowFocus).toBe(true);

    const workflowApi = new WorkflowClient({
      baseUrl: 'http://localhost',
      integrationsBaseUrl: 'http://localhost',
      fetch: globalThis.fetch,
    });
    expect(dataSourceSeedsQuery(workflowApi).refetchOnWindowFocus).toBe(true);
  });

  it('keeps deployment data fresh indefinitely', () => {
    const query = logosCatalogQuery({} as any);

    expect(query.staleTime).toBe(Infinity);
    expect(query.refetchOnWindowFocus).toBe(false);
  });
});

describe('contextGroupInstanceQuery', () => {
  it('returns null on a 404 bundle response', async () => {
    const api = {
      getContextGroupBundle: vi
        .fn()
        .mockRejectedValue(new ResponseError('Context group not found', 404)),
    } as any;

    const query = contextGroupInstanceQuery(api, 'group-1');

    await expect(runQueryFn(query)).resolves.toBeNull();
  });

  it('rethrows non-404 bundle errors', async () => {
    const api = {
      getContextGroupBundle: vi
        .fn()
        .mockRejectedValue(new ResponseError('Server error', 500)),
    } as any;

    const query = contextGroupInstanceQuery(api, 'group-1');

    await expect(runQueryFn(query)).rejects.toMatchObject({
      statusCode: 500,
    });
  });
});

describe('executionDetailQuery', () => {
  it('merges against live cache state that arrives during the request', async () => {
    let resolveRequest: ((value: any) => void) | undefined;
    const request = new Promise<any>(resolve => {
      resolveRequest = resolve;
    });
    const api = {
      executions: {
        get: vi.fn(() => request),
      },
    } as any;
    const queryClient = new QueryClient();
    const query = executionDetailQuery(api, 'exec-1');
    const fetchPromise = queryClient.fetchQuery(query);

    queryClient.setQueryData(queryKeys.executionDetail('exec-1'), {
      id: 'exec-1',
      status: 'completed',
      completedAt: '2026-01-01T00:00:02.000Z',
      nodeExecutions: [],
    });
    resolveRequest?.({
      id: 'exec-1',
      status: 'running',
      nodeExecutions: [],
    });

    await expect(fetchPromise).resolves.toMatchObject({
      status: 'completed',
      completedAt: '2026-01-01T00:00:02.000Z',
    });
  });
});

/**
 * The sidebar's count-only reads have no page to share a cache entry with, so
 * each is keyed *under* a prefix the relevant mutations already invalidate.
 * That inheritance is the whole reason the counts stay fresh, and it is
 * invisible at the call site — these assert it holds rather than that the keys
 * merely exist.
 */
describe('sidebar count queries', () => {
  const isPrefixOf = (prefix: readonly unknown[], key: readonly unknown[]) =>
    prefix.every((segment, index) => segment === key[`${index}`]);

  describe('activeRelationshipRuleCountQuery', () => {
    it('counts only the rules in force, without loading them', async () => {
      const listRelationshipRules = vi
        .fn()
        .mockResolvedValue({ items: [], total: 194 });
      const query = activeRelationshipRuleCountQuery({
        listRelationshipRules,
      } as any);

      await expect(runQueryFn(query)).resolves.toBe(194);
      expect(listRelationshipRules).toHaveBeenCalledWith({
        state: 'active',
        limit: 1,
      });
    });

    it('refetches when a rule mutation invalidates the rule prefix', async () => {
      const client = new QueryClient();
      const listRelationshipRules = vi
        .fn()
        .mockResolvedValue({ items: [], total: 3 });
      const query = activeRelationshipRuleCountQuery({
        listRelationshipRules,
      } as any);

      expect(isPrefixOf(queryKeys.relationshipRules, query.queryKey)).toBe(
        true,
      );

      await client.fetchQuery(query);
      expect(listRelationshipRules).toHaveBeenCalledTimes(1);

      // What every rule mutation invalidates (approve, dismiss, delete, …).
      await client.invalidateQueries({
        queryKey: queryKeys.relationshipRules,
        refetchType: 'all',
      });
      expect(listRelationshipRules).toHaveBeenCalledTimes(2);
    });
  });

  describe('contextGroupRuleGroupCountQuery', () => {
    it("counts one rule's groups, without loading them", async () => {
      const listContextGroups = vi
        .fn()
        .mockResolvedValue({ items: [], total: 8632 });
      const query = contextGroupRuleGroupCountQuery(
        { listContextGroups } as any,
        'rule-1',
      );

      await expect(runQueryFn(query)).resolves.toBe(8632);
      expect(listContextGroups).toHaveBeenCalledWith({
        ruleId: 'rule-1',
        limit: 1,
      });
    });

    it('refetches when materializing the rule regenerates its groups', async () => {
      const client = new QueryClient();
      const listContextGroups = vi
        .fn()
        .mockResolvedValue({ items: [], total: 5 });
      const query = contextGroupRuleGroupCountQuery(
        { listContextGroups } as any,
        'rule-1',
      );

      expect(
        isPrefixOf(queryKeys.contextGroupRuleGroups('rule-1'), query.queryKey),
      ).toBe(true);

      await client.fetchQuery(query);
      expect(listContextGroups).toHaveBeenCalledTimes(1);

      // What a rule save/materialize invalidates — see useContextGroups.
      await client.invalidateQueries({
        queryKey: queryKeys.contextGroupRuleGroups('rule-1'),
        refetchType: 'all',
      });
      expect(listContextGroups).toHaveBeenCalledTimes(2);
    });

    it("keys each rule separately so one rule's refresh spares the others", async () => {
      const a = contextGroupRuleGroupCountQuery({} as any, 'rule-1');
      const b = contextGroupRuleGroupCountQuery({} as any, 'rule-2');

      expect(a.queryKey).not.toEqual(b.queryKey);
      expect(
        isPrefixOf(queryKeys.contextGroupRuleGroups('rule-1'), b.queryKey),
      ).toBe(false);
    });
  });

  describe('mcpAuditFacetsQuery', () => {
    it("shares the audit log page's cache entry", () => {
      // The page reads the same factory; this pins the key it settled on, so a
      // rename can\'t silently split the sidebar and the page into two fetches.
      expect(mcpAuditFacetsQuery({} as any).queryKey).toEqual(
        queryKeys.mcpAuditFacets,
      );
      expect(queryKeys.mcpAuditFacets).toEqual([
        'workspace',
        '__organization__',
        'mcpAuditLog',
        'facets',
      ]);
    });
  });
});
