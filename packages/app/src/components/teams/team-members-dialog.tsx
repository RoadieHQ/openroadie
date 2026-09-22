import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2, UserRound } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@roadiehq/ui/dialog';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { Separator } from '@roadiehq/ui/separator';
import { queryKeys } from '../../api/queries';
import { useWorkspacesApi, type Team } from '../../api';

export function TeamMembersDialog({
  team,
  onOpenChange,
}: {
  team: Team;
  onOpenChange: (open: boolean) => void;
}) {
  const api = useWorkspacesApi();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const membersQuery = useQuery({
    queryKey: queryKeys.teamMembers(team.id),
    queryFn: () => api.listTeamMembers(team.id),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.teamMembers(team.id),
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.teamsList }),
      queryClient.invalidateQueries({ queryKey: queryKeys.workspacesList }),
    ]);
  };
  const addMember = useMutation({
    mutationFn: (value: string) => api.addTeamMember(team.id, value),
    onSuccess: async () => {
      setEmail('');
      await refresh();
    },
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.removeTeamMember(team.id, userId),
    onSuccess: refresh,
  });
  const members = membersQuery.data ?? [];
  const busy = addMember.isPending || removeMember.isPending;
  const mutationError = addMember.error ?? removeMember.error;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{team.name}</DialogTitle>
          <DialogDescription>
            Add or remove access to this team workspace.
          </DialogDescription>
        </DialogHeader>

        {membersQuery.isPending ? (
          <div className="flex min-h-32 items-center justify-center">
            <Loader2 className="motion-icon-spin size-5 text-muted-foreground" />
          </div>
        ) : membersQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {membersQuery.error.message}
          </p>
        ) : (
          <div className="space-y-4">
            <form
              className="flex items-start gap-2"
              onSubmit={event => {
                event.preventDefault();
                const value = email.trim();
                if (value) {
                  removeMember.reset();
                  addMember.mutate(value);
                }
              }}
            >
              <OutlinedInput
                label="Email address"
                type="email"
                required
                value={email}
                disabled={busy}
                onChange={event => setEmail(event.target.value)}
                className="flex-1"
              />
              <Button type="submit" disabled={busy || !email.trim()}>
                Add person
              </Button>
            </form>

            <Separator />

            <div className="space-y-1">
              <p className="text-sm font-medium">
                {members.length === 0
                  ? 'No team members yet'
                  : `${members.length} ${members.length === 1 ? 'member' : 'members'}`}
              </p>
              {members.map(member => (
                <div
                  key={member.userId}
                  className="flex min-h-12 items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <UserRound className="size-4 text-muted-foreground" />
                  </div>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">
                    {member.email ?? member.userId}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${member.email ?? member.userId}`}
                    disabled={busy}
                    onClick={() => {
                      addMember.reset();
                      removeMember.mutate(member.userId);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>

            {mutationError && (
              <p role="alert" className="text-sm text-destructive">
                {mutationError instanceof Error
                  ? mutationError.message
                  : String(mutationError)}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
