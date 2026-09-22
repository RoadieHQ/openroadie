import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useWorkspacesApi,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type Workspace,
} from '../../api';
import { queryKeys } from '../../api/queries';

export function useWorkspaceMutations() {
  const api = useWorkspacesApi();
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.workspacesList });

  const createMutation = useMutation({
    mutationFn: (input: CreateWorkspaceInput) => api.create(input),
    onSuccess: workspace => {
      queryClient.setQueryData<Workspace[]>(
        queryKeys.workspacesList,
        current => {
          if (!current) {
            return [workspace];
          }
          return current.some(candidate => candidate.id === workspace.id)
            ? current
            : [...current, workspace];
        },
      );
      return invalidate();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateWorkspaceInput }) =>
      api.update(id, input),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(id),
    onSuccess: invalidate,
  });

  return {
    createWorkspace: createMutation.mutateAsync,
    updateWorkspace: updateMutation.mutateAsync,
    deleteWorkspace: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
  };
}
