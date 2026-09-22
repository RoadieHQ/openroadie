import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useWorkspacesApi,
  type CreateTeamInput,
  type UpdateTeamInput,
} from '../../api';
import { queryKeys } from '../../api/queries';

export function useTeamMutations() {
  const api = useWorkspacesApi();
  const queryClient = useQueryClient();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.teamsList }),
      queryClient.invalidateQueries({ queryKey: queryKeys.workspacesList }),
    ]);

  const createMutation = useMutation({
    mutationFn: (input: CreateTeamInput) => api.createTeam(input),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTeamInput }) =>
      api.updateTeam(id, input),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteTeam(id),
    onSuccess: invalidate,
  });

  return {
    createTeam: createMutation.mutateAsync,
    updateTeam: updateMutation.mutateAsync,
    deleteTeam: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
  };
}
