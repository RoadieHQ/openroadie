import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDatastore } from '../../api';
import {
  contextGroupRuleDetailQuery,
  contextGroupRuleStatsQuery,
  contextGroupRulesQuery,
  queryKeys,
  type ContextGroupRuleStats,
} from '../../api/queries';
import {
  useInvalidatingMutation,
  useListQuery,
  useOptimisticMutation,
} from '../../api/query-hooks';
import type { ContextGroupRuleInput } from './types';

export function useContextGroups(options?: { skip?: boolean }) {
  const skip = options?.skip ?? false;
  const datastore = useDatastore();

  const { items, total, loading, error, retry } = useListQuery({
    ...contextGroupRulesQuery(datastore),
    enabled: !skip,
  });

  const deleteMutation = useOptimisticMutation<
    void,
    string,
    Awaited<ReturnType<typeof datastore.listContextGroupRules>>
  >({
    mutationFn: (id: string) => datastore.deleteContextGroupRule(id),
    cacheKey: queryKeys.contextGroupRules,
    update: (current, id) => {
      const items = current.items.filter(item => item.id !== id);
      return {
        ...current,
        items,
        total: current.total - (current.items.length - items.length),
      };
    },
    invalidates: [
      queryKeys.contextGroupRules,
      queryKeys.dataSourceDetailsPrefix,
      // Deleting a seeded rule flips its seed-picker row back to selectable.
      queryKeys.contextGroupSeeds,
    ],
  });

  const materializeMutation = useInvalidatingMutation({
    mutationFn: (id: string) => datastore.materializeContextGroupRule(id),
    invalidates: (_data, id) => [
      queryKeys.contextGroupRules,
      queryKeys.contextGroupRuleStats(id),
      // Materializing regenerates every group id for the rule.
      queryKeys.contextGroupRuleGroups(id),
    ],
  });

  return {
    rules: items,
    total,
    // When skipped, the query is disabled and never resolves — report
    // not-loading so consumers don't sit in a permanent loading state.
    loading: !skip && loading,
    error,
    retry,
    deleteRule: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    materializeRule: materializeMutation.mutateAsync,
  };
}

export function useContextGroupRule(id: string | undefined) {
  const datastore = useDatastore();
  const isNew = !id || id === 'new';
  const detailKey =
    id && !isNew ? queryKeys.contextGroupRuleDetail(id) : undefined;
  // Saving or materializing re-materializes the rule's groups under fresh
  // ids, so the paged groups reads must refetch or their rows point at
  // deleted groups ("Context group not found" on expand).
  const groupsKey =
    id && !isNew ? queryKeys.contextGroupRuleGroups(id) : undefined;

  const {
    data: rule,
    isLoading,
    error,
    refetch,
  } = useQuery({
    ...contextGroupRuleDetailQuery(datastore, id ?? ''),
    enabled: !isNew,
  });

  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const createMutation = useInvalidatingMutation({
    mutationFn: (input: ContextGroupRuleInput) =>
      datastore.createContextGroupRule(input),
    invalidates: [
      queryKeys.contextGroupRules,
      queryKeys.dataSourceDetailsPrefix,
      // A custom rule created onto a seeded slug marks that seed as created.
      queryKeys.contextGroupSeeds,
    ],
  });

  const updateMutation = useInvalidatingMutation({
    mutationFn: (input: Partial<ContextGroupRuleInput>) => {
      if (!id || id === 'new') throw new Error('Cannot update a new rule');
      return datastore.updateContextGroupRule(id, input);
    },
    invalidates: [
      queryKeys.contextGroupRules,
      queryKeys.dataSourceDetailsPrefix,
      detailKey,
      groupsKey,
      // A rename/re-slug (or the seedVersion nulling on edit) changes the
      // created/updateAvailable state of seed-picker rows.
      queryKeys.contextGroupSeeds,
    ],
  });

  const materializeMutation = useInvalidatingMutation({
    mutationFn: () => {
      if (!id || id === 'new') throw new Error('Cannot materialize a new rule');
      return datastore.materializeContextGroupRule(id);
    },
    // The detail key is a prefix of its stats key, so this refreshes both.
    invalidates: [detailKey, groupsKey],
  });

  return {
    rule,
    loading: isLoading,
    error: error ?? undefined,
    retry,
    createRule: createMutation.mutateAsync,
    updateRule: updateMutation.mutateAsync,
    materializeRule: materializeMutation.mutateAsync,
  };
}

const EMPTY_RULE_STATS: ContextGroupRuleStats = {
  totalGroups: 0,
  totalMembers: 0,
};

export function useContextGroupRuleStats(ruleId: string | undefined) {
  const datastore = useDatastore();
  const enabled = !!ruleId && ruleId !== 'new';

  const {
    data: stats,
    isLoading,
    error,
    refetch,
  } = useQuery({
    ...contextGroupRuleStatsQuery(datastore, ruleId ?? ''),
    enabled,
  });
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    ...(stats ?? EMPTY_RULE_STATS),
    loading: isLoading,
    error: error ?? undefined,
    retry,
  };
}
