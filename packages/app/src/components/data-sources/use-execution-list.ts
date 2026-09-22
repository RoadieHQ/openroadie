import { useQuery } from '@tanstack/react-query';
import { useWorkflows } from '../../api';
import {
  workflowExecutionsQuery,
  type WorkflowExecutionsFilters,
} from '../../api/queries';

const LIVE_RUN_POLL_MS = 3000;

export function useExecutionList(
  workflowId: string | undefined,
  options?: WorkflowExecutionsFilters,
) {
  const api = useWorkflows();

  const { data, isLoading, error, refetch } = useQuery({
    ...workflowExecutionsQuery(api, workflowId ?? '', options ?? {}),
    enabled: !!workflowId,
    refetchInterval: query =>
      query.state.data?.data.some(
        e => e.status === 'pending' || e.status === 'running',
      )
        ? LIVE_RUN_POLL_MS
        : false,
  });

  return {
    executions: data?.data ?? [],
    total: data?.total ?? 0,
    loading: isLoading,
    error: error ?? undefined,
    retry: refetch,
  };
}
