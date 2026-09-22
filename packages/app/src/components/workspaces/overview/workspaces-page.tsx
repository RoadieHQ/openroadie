import React, { useCallback, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import {
  ArrowRight,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
} from 'lucide-react';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@roadiehq/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import {
  DEFAULT_WORKSPACE_ID,
  useFeatureFlag,
  type Workspace,
} from '../../../api';
import {
  OverviewListingPageHeader,
  OverviewListingStandaloneBody,
  OverviewListingToolbar,
} from '../../common';
import {
  OverviewTable,
  useOverviewState,
  type ColumnConfig,
  type OverviewConfig,
} from '../../overview';
import { useWorkspaces } from '../workspace-context';
import { useWorkspaceMutations } from '../use-workspace-mutations';
import {
  WorkspaceCreateDialog,
  WorkspaceEditDialog,
} from '../workspace-form-dialog';
import { WorkspaceMark } from '../workspace-mark';
import { WorkspaceShareDialog } from '../workspace-share-dialog';
import { NewWorkspaceButton } from './new-workspace-button';
import { WORKSPACES_COLUMN_WIDTH } from './workspaces-table-layout';

const WORKSPACE_OVERVIEW_CONFIG: OverviewConfig<Workspace> = {
  getId: workspace => workspace.id,
  searchFields: workspace => [
    workspace.name,
    workspace.slug,
    workspace.type,
    workspace.ownerUserId ?? '',
  ],
};

const TYPE_LABEL: Record<Workspace['type'], string> = {
  organization: 'Organization',
  team: 'Team',
  personal: 'Personal',
};

function formatCreated(value: string): string {
  return DateTime.fromJSDate(new Date(value)).toRelative() ?? '—';
}

export function WorkspacesPage() {
  const { workspaces, activeWorkspace, loading, setActiveWorkspace } =
    useWorkspaces();
  const { value: creationEnabled } = useFeatureFlag(
    'workspace-creation',
    false,
  );
  const { deleteWorkspace, isDeleting } = useWorkspaceMutations();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Workspace | null>(null);
  const [sharing, setSharing] = useState<Workspace | null>(null);
  const [deleting, setDeleting] = useState<Workspace | null>(null);

  const {
    search,
    rows: filteredWorkspaces,
    setSearch,
  } = useOverviewState(workspaces, WORKSPACE_OVERVIEW_CONFIG);

  const columns = useMemo<ColumnConfig<Workspace>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        enableHiding: false,
        sortable: true,
        accessor: w => w.name,
        width: WORKSPACES_COLUMN_WIDTH.name,
        headClassName: 'pl-3 sm:pl-4',
        cellClassName: 'overflow-hidden pl-3 sm:pl-4',
        // A workspace has no page of its own, so the name opens the edit
        // dialog — the admin-embed treatment from listing-navigation.md.
        cell: w => {
          const name = (
            <>
              <WorkspaceMark workspace={w} size="group" />
              <span className="truncate">{w.name}</span>
            </>
          );
          return w.canManage === false ? (
            <div
              data-testid={`workspace-name-${w.id}`}
              className="flex min-w-0 items-center gap-3 font-medium text-foreground"
            >
              {name}
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              data-testid={`workspace-name-${w.id}`}
              onClick={() => setEditing(w)}
              className="h-auto max-w-full min-w-0 justify-start gap-3 p-0 font-medium text-foreground hover:bg-transparent hover:underline"
            >
              {name}
            </Button>
          );
        },
      },
      {
        id: 'slug',
        header: 'Slug',
        enableHiding: true,
        sortable: true,
        accessor: w => w.slug,
        width: WORKSPACES_COLUMN_WIDTH.slug,
        cell: w => (
          <span className="block truncate font-mono text-sm text-muted-foreground">
            {w.slug}
          </span>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        enableHiding: true,
        sortable: true,
        accessor: w => w.type,
        filter: {
          kind: 'enum',
          label: 'Type',
          value: w => w.type,
          options: [
            { value: 'organization', label: TYPE_LABEL.organization },
            { value: 'team', label: TYPE_LABEL.team },
            { value: 'personal', label: TYPE_LABEL.personal },
          ],
        },
        width: WORKSPACES_COLUMN_WIDTH.type,
        cell: w => <Badge variant="outline">{TYPE_LABEL[w.type]}</Badge>,
      },
      {
        id: 'owner',
        header: 'Owner',
        enableHiding: true,
        sortable: true,
        accessor: w => w.ownerUserId ?? '',
        width: WORKSPACES_COLUMN_WIDTH.owner,
        // An organization workspace is owned by nobody, so there is no name to
        // fall back to. The id is provider-shaped and can be long, hence the
        // tooltip rather than a bare truncation.
        cell: w =>
          w.ownerUserId ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block truncate font-mono text-sm text-muted-foreground">
                  {w.ownerUserId}
                </span>
              </TooltipTrigger>
              <TooltipContent>{w.ownerUserId}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        id: 'createdAt',
        header: 'Created',
        enableHiding: true,
        sortable: true,
        accessor: w => w.createdAt,
        width: WORKSPACES_COLUMN_WIDTH.createdAt,
        cell: w => (
          <span className="text-sm whitespace-nowrap text-muted-foreground">
            {formatCreated(w.createdAt)}
          </span>
        ),
      },
    ],
    [],
  );

  const renderRowActions = useCallback(
    (workspace: Workspace) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Actions for ${workspace.name}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={workspace.id === activeWorkspace?.id}
            onSelect={() => setActiveWorkspace(workspace)}
          >
            <ArrowRight />
            <span>Open workspace</span>
          </DropdownMenuItem>
          {workspace.canManage !== false && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setEditing(workspace)}>
                <Pencil />
                <span>Edit</span>
              </DropdownMenuItem>
            </>
          )}
          {workspace.type === 'personal' && (
            <DropdownMenuItem onSelect={() => setSharing(workspace)}>
              <Share2 />
              <span>Share</span>
            </DropdownMenuItem>
          )}
          {workspace.canManage !== false && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={workspace.id === DEFAULT_WORKSPACE_ID}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
                onSelect={() => setDeleting(workspace)}
              >
                <Trash2 />
                <span>Delete</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    [activeWorkspace?.id, setActiveWorkspace],
  );

  return (
    <TooltipProvider>
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
        <OverviewListingStandaloneBody className="flex min-h-0 flex-1 flex-col space-y-4 sm:space-y-6">
          <div className="shrink-0">
            <OverviewListingPageHeader
              title="Workspaces"
              description="The tenant a workspace's catalog data belongs to."
              toolbar={
                workspaces.length > 0 ? (
                  <OverviewListingToolbar
                    searchValue={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="Search by name, slug, or type..."
                    searchAriaLabel="Search workspaces"
                    variant="pageHeader"
                  />
                ) : null
              }
              primaryAction={
                <NewWorkspaceButton
                  enabled={creationEnabled}
                  onClick={() => setCreateOpen(true)}
                />
              }
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <OverviewTable<Workspace>
              data={filteredWorkspaces}
              columns={columns}
              columnDisplay={{ tableId: 'workspaces' }}
              getRowId={w => w.id}
              loading={loading}
              paginate={false}
              skeletonRowCount={3}
              rowActions={renderRowActions}
              emptyState={
                workspaces.length === 0
                  ? 'No workspaces'
                  : 'No workspaces match your filters'
              }
            />
          </div>
        </OverviewListingStandaloneBody>
      </div>

      <WorkspaceCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={setActiveWorkspace}
      />

      {editing && (
        <WorkspaceEditDialog
          key={editing.id}
          open
          onOpenChange={next => !next && setEditing(null)}
          workspace={editing}
        />
      )}

      {sharing && (
        <WorkspaceShareDialog
          key={sharing.id}
          workspace={sharing}
          onOpenChange={next => !next && setSharing(null)}
        />
      )}

      {deleting && (
        <ConfirmationDialog
          open
          isDelete
          title={`Delete ${deleting.name}?`}
          contentText="The workspace is removed. Anything that belonged to it stops being reachable."
          confirmButtonText="Delete workspace"
          confirmingText="Deleting..."
          confirmDisabled={isDeleting}
          onConfirm={() => {
            deleteWorkspace(deleting.id);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </TooltipProvider>
  );
}
