import { act, renderHook, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { TestQueryProvider } from '../../test-utils';
import { queryKeys } from '../../api/queries';
import {
  useContextGroups,
  useContextGroupRule,
  useContextGroupRuleStats,
} from './use-context-groups';

const mockDatastore = {
  getContextGroupRuleGroups: vi.fn(),
  getContextGroupRule: vi.fn(),
  listContextGroupRules: vi.fn(),
  deleteContextGroupRule: vi.fn(),
  updateContextGroupRule: vi.fn(),
  materializeContextGroupRule: vi.fn(),
};

vi.mock('../../api', () => ({
  useDatastore: () => mockDatastore,
}));

function previewGroup(id: string) {
  return {
    id,
    name: `Group ${id}`,
    members: [
      { datasourceId: 'ds-a', objectId: `a-${id}`, object: {} },
      { datasourceId: 'ds-b', objectId: `b-${id}`, object: {} },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDatastore.listContextGroupRules.mockResolvedValue({
    items: [
      { id: 'rule-1', name: 'Owners' },
      { id: 'rule-2', name: 'Teams' },
    ],
    total: 2,
  });
});

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useContextGroups', () => {
  it('removes a rule immediately while deletion is pending', async () => {
    const deletion = deferred<void>();
    mockDatastore.deleteContextGroupRule.mockReturnValue(deletion.promise);
    mockDatastore.listContextGroupRules
      .mockResolvedValueOnce({
        items: [
          { id: 'rule-1', name: 'Owners' },
          { id: 'rule-2', name: 'Teams' },
        ],
        total: 2,
      })
      .mockResolvedValue({
        items: [{ id: 'rule-2', name: 'Teams' }],
        total: 1,
      });
    const { result } = renderHook(() => useContextGroups(), {
      wrapper: TestQueryProvider,
    });
    await waitFor(() => expect(result.current.rules).toHaveLength(2));

    let deletePromise: Promise<void> | undefined;
    act(() => {
      deletePromise = result.current.deleteRule('rule-1');
    });

    await waitFor(() => {
      expect(result.current.rules.map(rule => rule.id)).toEqual(['rule-2']);
      expect(result.current.total).toBe(1);
    });
    deletion.resolve();
    await act(async () => deletePromise);
  });

  it('restores a rule when deletion fails', async () => {
    mockDatastore.deleteContextGroupRule.mockRejectedValue(
      new Error('Delete failed'),
    );
    const { result } = renderHook(() => useContextGroups(), {
      wrapper: TestQueryProvider,
    });
    await waitFor(() => expect(result.current.rules).toHaveLength(2));

    let deleteError: unknown;
    await act(async () => {
      try {
        await result.current.deleteRule('rule-1');
      } catch (error: unknown) {
        deleteError = error;
      }
    });
    expect(deleteError).toEqual(new Error('Delete failed'));

    await waitFor(() => {
      expect(result.current.rules.map(rule => rule.id)).toEqual([
        'rule-1',
        'rule-2',
      ]);
      expect(result.current.total).toBe(2);
    });
  });
});

// Saving or materializing a rule re-materializes its groups under fresh ids,
// so any mounted page of the old groups must refetch — stale rows point at
// deleted groups and their bundles 404 ("Context group not found").
describe('rule groups invalidation', () => {
  function useRuleGroupsPage(ruleId: string) {
    return useQuery({
      queryKey: [
        ...queryKeys.contextGroupRuleGroups(ruleId),
        { offset: 0, limit: 20 },
      ],
      queryFn: () =>
        mockDatastore.getContextGroupRuleGroups(ruleId, {
          limit: 20,
          offset: 0,
        }),
    });
  }

  beforeEach(() => {
    mockDatastore.getContextGroupRuleGroups.mockResolvedValue({
      groups: [previewGroup('g-1')],
      totalGroups: 1,
    });
    mockDatastore.getContextGroupRule.mockResolvedValue({
      id: 'rule-1',
      name: 'Owners',
    });
  });

  it('refetches the groups pages after saving a rule', async () => {
    mockDatastore.updateContextGroupRule.mockResolvedValue({
      id: 'rule-1',
      name: 'Owners',
      slug: 'owners',
    });

    const { result } = renderHook(
      () => ({
        page: useRuleGroupsPage('rule-1'),
        rule: useContextGroupRule('rule-1'),
      }),
      { wrapper: TestQueryProvider },
    );
    await waitFor(() => expect(result.current.page.isSuccess).toBe(true));
    expect(mockDatastore.getContextGroupRuleGroups).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.rule.updateRule({ name: 'Owners' });
    });

    await waitFor(() =>
      expect(mockDatastore.getContextGroupRuleGroups).toHaveBeenCalledTimes(2),
    );
  });

  it('refetches the groups pages after materializing a rule', async () => {
    mockDatastore.materializeContextGroupRule.mockResolvedValue(undefined);

    const { result } = renderHook(
      () => ({
        page: useRuleGroupsPage('rule-1'),
        list: useContextGroups(),
      }),
      { wrapper: TestQueryProvider },
    );
    await waitFor(() => expect(result.current.page.isSuccess).toBe(true));
    expect(mockDatastore.getContextGroupRuleGroups).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.list.materializeRule('rule-1');
    });

    await waitFor(() =>
      expect(mockDatastore.getContextGroupRuleGroups).toHaveBeenCalledTimes(2),
    );
  });
});

describe('useContextGroupRuleStats', () => {
  it('does not fetch without a selected rule', async () => {
    const { result } = renderHook(() => useContextGroupRuleStats(undefined), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalGroups).toBe(0);
    expect(result.current.totalMembers).toBe(0);
    expect(mockDatastore.getContextGroupRuleGroups).not.toHaveBeenCalled();
  });

  it('sums member counts across every rule group, fetched page by page', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      previewGroup(`${index}`),
    );
    mockDatastore.getContextGroupRuleGroups
      .mockResolvedValueOnce({ groups: firstPage, totalGroups: 101 })
      .mockResolvedValueOnce({
        groups: [previewGroup('100')],
        totalGroups: 101,
      });

    const { result } = renderHook(() => useContextGroupRuleStats('rule-1'), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalGroups).toBe(101);
    expect(result.current.totalMembers).toBe(202);
    expect(mockDatastore.getContextGroupRuleGroups).toHaveBeenCalledTimes(2);
  });

  it('exposes batch failures for the future drawer error state', async () => {
    mockDatastore.getContextGroupRuleGroups.mockRejectedValue(
      new Error('Stored groups unavailable'),
    );

    const { result } = renderHook(() => useContextGroupRuleStats('rule-1'), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() =>
      expect(result.current.error?.message).toBe('Stored groups unavailable'),
    );
  });
});
