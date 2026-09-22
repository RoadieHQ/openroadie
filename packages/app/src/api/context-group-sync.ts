import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queries';
import { workspaceQueryKeyInScope } from './workspace-scope';

/**
 * Refresh every context-group surface after a direct-edge write.
 *
 * Context groups merge members across relationship edges, so a direct-edge
 * write changes group membership — but the rebuild the write triggers
 * server-side is debounced, so invalidating the group queries immediately
 * would refetch pre-rebuild groups (and each rebuild regenerates group ids,
 * so a racing refetch caches rows that are about to be deleted). Instead ask
 * the backend to rebuild now — the endpoint also absorbs the pending
 * debounced rebuild — and refetch only once it resolves.
 *
 * Pass each written edge's SOURCE datasource: a rule can only merge on an
 * edge whose two datasources are both in the rule, so every affected rule is
 * discoverable from the source side alone (the same contract the backend's
 * delete-by-source notification relies on).
 */
export async function syncContextGroupsAfterEdgeWrite(
  queryClient: QueryClient,
  api: {
    materializeContextGroupsForDatasource(datasourceId: string): Promise<void>;
  },
  datasourceIds: Iterable<string>,
  workspaceScopeKey: string,
): Promise<void> {
  const ids = [...new Set(datasourceIds)];
  if (ids.length === 0) {
    return;
  }
  await Promise.all(
    ids.map(datasourceId =>
      api.materializeContextGroupsForDatasource(datasourceId).catch(() => {
        // The edge write itself succeeded; on a failed rebuild the backend
        // restores its debounced rebuild, so refetch regardless — worst case
        // the refetch is stale until that rebuild lands.
      }),
    ),
  );
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.contextGroupsPrefix,
        workspaceScopeKey,
      ),
    }),
    queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.objectContextGroupsPrefix,
        workspaceScopeKey,
      ),
    }),
  ]);
}
