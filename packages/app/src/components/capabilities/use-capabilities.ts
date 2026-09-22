import { useCapabilities as useCapabilitiesApi } from '../../api';
import { capabilitiesListQuery, queryKeys } from '../../api/queries';
import { useListQuery, useOptimisticMutation } from '../../api/query-hooks';

export function useCapabilities(options?: { skip?: boolean }) {
  const skip = options?.skip ?? false;
  const capabilitiesApi = useCapabilitiesApi();

  const { items, total, loading, error, retry } = useListQuery({
    ...capabilitiesListQuery(capabilitiesApi),
    enabled: !skip,
  });

  const deleteMutation = useOptimisticMutation<
    void,
    string,
    Awaited<ReturnType<typeof capabilitiesApi.list>>
  >({
    mutationFn: (id: string) => capabilitiesApi.delete(id),
    cacheKey: queryKeys.capabilitiesList,
    update: (current, id) => {
      const items = current.items.filter(item => item.id !== id);
      return {
        ...current,
        items,
        total: current.total - (current.items.length - items.length),
      };
    },
    invalidates: [queryKeys.capabilitiesList],
  });

  return {
    capabilities: items,
    total,
    // When skipped, the query is disabled and never resolves — report
    // not-loading, or every consumer sits in a permanent "checking" state.
    loading: !skip && loading,
    error,
    retry,
    deleteCapability: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
  };
}
