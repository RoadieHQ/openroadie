import { useQuery } from '@tanstack/react-query';
import type { WorkflowClient } from '../../../api/workflow';
import { queryKeys } from '../../../api/queries';

/**
 * Fetch one integration by id, gated on the id being present. Wraps the
 * `enabled: !!id` gate + `undefined`→`null` coalesce that every
 * data-source-editor consumer repeats. Returns the raw query result — callers
 * coalesce `.data` to `null`/`undefined` and read `isLoading` as they need.
 *
 * `refreshNonce` is appended to the query key when supplied, so bumping it
 * forces a refetch (used to pick up a just-saved secret's scope readiness
 * without a full reload).
 */
export function useIntegrationDetail(
  api: WorkflowClient,
  id: string | undefined,
  options?: { refreshNonce?: unknown },
) {
  const withNonce = options && 'refreshNonce' in options;
  return useQuery({
    queryKey: [
      ...queryKeys.integrationDetail(id ?? ''),
      ...(withNonce ? [options.refreshNonce] : []),
    ],
    queryFn: async () => (await api.integrations.get(id ?? '')) ?? null,
    enabled: !!id,
  });
}
