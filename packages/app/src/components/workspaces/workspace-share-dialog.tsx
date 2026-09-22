import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2, UserRound } from 'lucide-react';
import { Badge } from '@roadiehq/ui/badge';
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
import { useWorkspacesApi, type Workspace } from '../../api';

interface WorkspaceShareDialogProps {
  workspace: Workspace;
  onOpenChange: (open: boolean) => void;
}

export function WorkspaceShareDialog({
  workspace,
  onOpenChange,
}: WorkspaceShareDialogProps) {
  const api = useWorkspacesApi();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const membersQuery = useQuery({
    queryKey: queryKeys.workspaceMembers(workspace.id),
    queryFn: () => api.listMembers(workspace.id),
  });
  const addMember = useMutation({
    mutationFn: (value: string) => api.addMember(workspace.id, value),
    onSuccess: async () => {
      setEmail('');
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceMembers(workspace.id),
      });
    },
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.removeMember(workspace.id, userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceMembers(workspace.id),
      });
    },
  });
  const data = membersQuery.data;
  const busy = addMember.isPending || removeMember.isPending;
  const error = addMember.error ?? removeMember.error ?? membersQuery.error;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share {workspace.name}</DialogTitle>
          <DialogDescription>
            People with access can see and use everything in this workspace.
          </DialogDescription>
        </DialogHeader>

        {membersQuery.isPending ? (
          <div className="flex min-h-32 items-center justify-center">
            <Loader2 className="motion-icon-spin size-5 text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {data?.canManage && (
              <form
                className="flex items-start gap-2"
                onSubmit={event => {
                  event.preventDefault();
                  const value = email.trim();
                  if (value) {
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
            )}

            <Separator />

            <div className="space-y-1">
              <p className="text-sm font-medium">People with access</p>
              {data?.members.map(member => (
                <div
                  key={member.userId}
                  className="flex min-h-12 items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <UserRound className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {member.email ??
                        (member.role === 'owner'
                          ? 'Workspace owner'
                          : member.userId)}
                    </p>
                    {!member.email && member.role !== 'owner' && (
                      <p className="truncate text-xs text-muted-foreground">
                        {member.userId}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline">
                    {member.role === 'owner' ? 'Owner' : 'Member'}
                  </Badge>
                  {data.canManage && member.role === 'member' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${member.email ?? member.userId}`}
                      disabled={busy}
                      onClick={() => removeMember.mutate(member.userId)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error instanceof Error ? error.message : String(error)}
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
