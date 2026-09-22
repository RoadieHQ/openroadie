import React, { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import {
  AlertTriangle,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserRoundPlus,
  UsersRound,
} from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { IntegrationIconFrame } from '@roadiehq/ui/item-list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@roadiehq/ui/dropdown-menu';
import {
  useAlert,
  useFeatureFlag,
  useWorkspacesApi,
  type Team,
} from '../../../api';
import { queryKeys } from '../../../api/queries';
import {
  OverviewListingPageHeader,
  OverviewListingStandaloneBody,
  OverviewListingToolbar,
} from '../../common';
import {
  OverviewEmptyState,
  OverviewTable,
  useOverviewLoadErrorToast,
  useOverviewState,
  type ColumnConfig,
  type OverviewConfig,
} from '../../overview';
import { TeamCreateDialog, TeamEditDialog } from '../team-form-dialog';
import { TeamMembersDialog } from '../team-members-dialog';
import { useTeamMutations } from '../use-team-mutations';
import { TEAMS_COLUMN_WIDTH } from './teams-table-layout';
import { NewWorkspaceButton } from '../../workspaces/overview/new-workspace-button';

const TEAM_OVERVIEW_CONFIG: OverviewConfig<Team> = {
  getId: team => team.id,
  searchFields: team => [team.name, team.slug],
};

function formatCreated(value: string): string {
  return DateTime.fromJSDate(new Date(value)).toRelative() ?? '—';
}

export function TeamsPage() {
  const api = useWorkspacesApi();
  const alertApi = useAlert();
  const { value: creationEnabled } = useFeatureFlag(
    'workspace-creation',
    false,
  );
  const teamsQuery = useQuery({
    queryKey: queryKeys.teamsList,
    queryFn: () => api.listTeams(),
  });
  const teams = teamsQuery.data ?? [];
  useOverviewLoadErrorToast(teamsQuery.error);
  const { deleteTeam, isDeleting } = useTeamMutations();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [managingMembers, setManagingMembers] = useState<Team | null>(null);
  const [deleting, setDeleting] = useState<Team | null>(null);
  const {
    search,
    rows: filteredTeams,
    setSearch,
  } = useOverviewState(teams, TEAM_OVERVIEW_CONFIG);

  const columns = useMemo<ColumnConfig<Team>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        enableHiding: false,
        sortable: true,
        accessor: team => team.name,
        width: TEAMS_COLUMN_WIDTH.name,
        headClassName: 'pl-3 sm:pl-4',
        cellClassName: 'overflow-hidden pl-3 sm:pl-4',
        cell: team => (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setManagingMembers(team)}
            className="h-auto max-w-full min-w-0 justify-start gap-3 p-0 font-medium text-foreground hover:bg-transparent hover:underline"
          >
            <IntegrationIconFrame size="group">
              <UsersRound className="size-4 text-primary" />
            </IntegrationIconFrame>
            <span className="truncate">{team.name}</span>
          </Button>
        ),
      },
      {
        id: 'slug',
        header: 'Slug',
        enableHiding: true,
        sortable: true,
        accessor: team => team.slug,
        width: TEAMS_COLUMN_WIDTH.slug,
        cell: team => (
          <span className="block truncate font-mono text-sm text-muted-foreground">
            {team.slug}
          </span>
        ),
      },
      {
        id: 'members',
        header: 'Members',
        enableHiding: true,
        sortable: true,
        accessor: team => team.memberCount,
        width: TEAMS_COLUMN_WIDTH.members,
        cell: team => (
          <span className="text-sm text-muted-foreground">
            {team.memberCount}
          </span>
        ),
      },
      {
        id: 'createdAt',
        header: 'Created',
        enableHiding: true,
        sortable: true,
        accessor: team => team.createdAt,
        width: TEAMS_COLUMN_WIDTH.createdAt,
        cell: team => (
          <span className="text-sm whitespace-nowrap text-muted-foreground">
            {formatCreated(team.createdAt)}
          </span>
        ),
      },
    ],
    [],
  );

  const renderRowActions = useCallback(
    (team: Team) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Actions for ${team.name}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setManagingMembers(team)}>
            <UserRoundPlus />
            <span>Manage members</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditing(team)}>
            <Pencil />
            <span>Edit</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
            onSelect={() => setDeleting(team)}
          >
            <Trash2 />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    [],
  );

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <OverviewListingStandaloneBody className="flex min-h-0 flex-1 flex-col space-y-4 sm:space-y-6">
        <OverviewListingPageHeader
          title="Teams"
          description="Manage each team workspace and the people who can access it."
          toolbar={
            teams.length > 0 ? (
              <OverviewListingToolbar
                searchValue={search}
                onSearchChange={setSearch}
                searchPlaceholder="Search teams..."
                searchAriaLabel="Search teams"
                variant="pageHeader"
              />
            ) : null
          }
          primaryAction={
            <NewWorkspaceButton
              enabled={creationEnabled}
              label="New team"
              onClick={() => setCreateOpen(true)}
            />
          }
        />

        <div className="flex min-h-0 flex-1 flex-col">
          {!teamsQuery.isPending && teamsQuery.isError ? (
            <OverviewEmptyState
              icon={AlertTriangle}
              title="Failed to load teams"
              description={teamsQuery.error.message}
            />
          ) : !teamsQuery.isPending && teams.length === 0 ? (
            <OverviewEmptyState
              icon={UsersRound}
              title="No teams yet"
              description="Create a team, then add the people who should work together."
              action={
                <NewWorkspaceButton
                  enabled={creationEnabled}
                  label="Create team"
                  onClick={() => setCreateOpen(true)}
                />
              }
            />
          ) : (
            <OverviewTable<Team>
              data={filteredTeams}
              columns={columns}
              columnDisplay={{ tableId: 'teams' }}
              getRowId={team => team.id}
              loading={teamsQuery.isPending}
              paginate={false}
              skeletonRowCount={3}
              rowActions={renderRowActions}
              emptyState="No teams match your search"
            />
          )}
        </div>
      </OverviewListingStandaloneBody>

      <TeamCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      {editing && (
        <TeamEditDialog
          key={editing.id}
          open
          team={editing}
          onOpenChange={next => !next && setEditing(null)}
        />
      )}
      {managingMembers && (
        <TeamMembersDialog
          key={managingMembers.id}
          team={managingMembers}
          onOpenChange={next => !next && setManagingMembers(null)}
        />
      )}
      {deleting && (
        <ConfirmationDialog
          open
          isDelete
          title={`Delete ${deleting.name}?`}
          contentText="This removes the team workspace and its membership. Anything that belonged to it stops being reachable."
          confirmButtonText="Delete team"
          confirmingText="Deleting..."
          confirmDisabled={isDeleting}
          onConfirm={async () => {
            try {
              await deleteTeam(deleting.id);
              setDeleting(null);
            } catch (error: unknown) {
              alertApi.post({
                message:
                  error instanceof Error
                    ? error.message
                    : 'Failed to delete team',
                severity: 'error',
              });
            }
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
