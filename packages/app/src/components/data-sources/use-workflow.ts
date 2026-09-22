import { useQuery } from '@tanstack/react-query';
import { useWorkflows } from '../../api';
import {
  invalidationKeys,
  queryKeys,
  workflowDetailQuery,
} from '../../api/queries';
import { useInvalidatingMutation } from '../../api/query-hooks';
import type {
  UpdateWorkflowInput,
  WorkflowDefinition,
} from '../../api/workflow/workflow-client';

export function useWorkflow(workflowId: string | undefined) {
  const api = useWorkflows();

  const {
    data: workflow,
    isLoading,
    error,
  } = useQuery({
    ...workflowDetailQuery(api, workflowId ?? ''),
    enabled: !!workflowId,
  });

  const saveMutation = useInvalidatingMutation({
    mutationFn: (input: UpdateWorkflowInput): Promise<WorkflowDefinition> => {
      if (!workflowId) {
        return api.workflows.create({
          name: input.name ?? 'New Pipeline',
          description: input.description ?? '',
          workflowType: 'data-ingestion',
          nodes: input.nodes ?? [],
          edges: input.edges ?? [],
          viewport: input.viewport,
          enabled: input.enabled ?? false,
        });
      }
      return api.workflows.update(workflowId, input);
    },
    invalidates: invalidationKeys.workflowSaved(workflowId),
  });

  const deleteMutation = useInvalidatingMutation({
    mutationFn: async () => {
      if (!workflowId) {
        throw new Error('No workflow ID');
      }
      await api.workflows.delete(workflowId);
    },
    invalidates: [queryKeys.dataIngestionWorkflows],
  });

  const executeMutation = useInvalidatingMutation({
    mutationFn: () => {
      if (!workflowId) {
        throw new Error('No workflow ID');
      }
      return api.executions.execute(workflowId);
    },
    invalidates: invalidationKeys.dataSourceRun(workflowId),
  });
  const execute = executeMutation.mutateAsync;

  return {
    workflow,
    loading: isLoading,
    error: error ?? undefined,
    save: saveMutation.mutateAsync,
    saving: saveMutation.isPending,
    saveError: saveMutation.error ?? undefined,
    deleteWorkflow: deleteMutation.mutateAsync,
    deleting: deleteMutation.isPending,
    deleteError: deleteMutation.error ?? undefined,
    execute,
    executing: executeMutation.isPending,
    executeError: executeMutation.error ?? undefined,
    executionId: executeMutation.data?.executionId,
  };
}
