import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFetcher, useNavigate } from 'react-router';
import { Zap, Plus, AlertTriangle } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { EmptyState } from '@roadiehq/ui/empty-state';
import { InlineCode } from '@roadiehq/ui/inline-code';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@roadiehq/ui/dialog';
import { toolbarPrimaryCtaButtonClassName } from '@roadiehq/ui/toolbar';
import { useActions as useActionsApi } from '../../../api';
import { actionVersionCountQuery } from '../../../api/queries';
import type { ActionWithSchema } from '../types';
import { useActions } from '../use-actions';
import { useReferenceUsage } from '../../capabilities/use-reference-usage';
import { formatUsedByNames } from '../../capabilities/reference-usage';
import type { ActionsRouteActionResult } from '../actions-route-action';
import {
  OverviewListingPageHeader,
  OverviewListingSearchField,
  OverviewListingStandaloneBody,
  useDetailDrawer,
} from '../../common';
import {
  GhostTablePreview,
  ghostSettleAt,
  OverviewEmptyState,
  OverviewEmptyPreview,
  OverviewTable,
  useLegacyTabRedirect,
  useOverviewLoadErrorToast,
  useOverviewState,
  type GhostRow,
} from '../../overview';
import { PATHS, actionDetail } from '../../../config/paths';
import { useActionsOverviewConfig } from './actions-overview-config';
import { useActionColumns, ActionRowActionsMenu } from './actions-columns';
import { ActionDetailDrawer } from './action-detail-drawer';

const GHOST_HEADERS = ['Name', 'Steps', 'Status', 'Updated'];
const GHOST_COLUMNS = '2.5rem minmax(0,1fr) 6rem 6rem 5.5rem';
const GHOST_ROWS: GhostRow[] = [
  [
    { kind: 'icon', icon: Zap },
    {
      kind: 'title',
      text: 'Create a Jira ticket',
      subtext: 'create-jira-ticket',
    },
    { kind: 'badge', text: 'POST' },
    { kind: 'status', text: 'Enabled' },
    { kind: 'text', text: '2h ago' },
  ],
  [
    { kind: 'icon', icon: Zap },
    { kind: 'title', text: 'Trigger a deployment', subtext: 'trigger-deploy' },
    { kind: 'badge', text: 'GET+POST' },
    { kind: 'status', text: 'Enabled' },
    { kind: 'text', text: 'Yesterday' },
  ],
  [
    { kind: 'icon', icon: Zap },
    {
      kind: 'title',
      text: 'Post a message to Slack',
      subtext: 'post-to-slack',
    },
    { kind: 'badge', text: 'POST' },
    { kind: 'status', text: 'Enabled' },
    { kind: 'text', text: '3d ago' },
  ],
];

export function ActionsPage() {
  const navigate = useNavigate();
  const actionsApi = useActionsApi();
  const deleteFetcher = useFetcher<ActionsRouteActionResult>();
  const { actions, loading, error } = useActions();
  const [deleteTarget, setDeleteTarget] = useState<ActionWithSchema | null>(
    null,
  );
  const submittedDeleteId = deleteFetcher.formData?.get('actionId');
  const optimisticDeleteId =
    deleteFetcher.state !== 'idle' && typeof submittedDeleteId === 'string'
      ? submittedDeleteId
      : undefined;
  const visibleActions = useMemo(
    () =>
      optimisticDeleteId
        ? actions.filter(action => action.id !== optimisticDeleteId)
        : actions,
    [actions, optimisticDeleteId],
  );

  useLegacyTabRedirect();
  const config = useActionsOverviewConfig();
  const { search, rows, setSearch } = useOverviewState(visibleActions, config);

  // Row click opens a detail drawer (URL-driven via ?detail=<id>); look the row
  // up in the full list so it survives search/status filtering.
  const {
    openId: detailId,
    open: openDetail,
    close: closeDetail,
  } = useDetailDrawer();
  const detailAction = detailId
    ? actions.find(action => action.id === detailId)
    : undefined;

  // Surface load errors via toast (matches Data Sources) rather than an inline
  // error panel, so the page still renders its table/empty state.
  useOverviewLoadErrorToast(error);

  // How many versions exist, so the delete dialog can warn that history is
  // destroyed too. Best-effort — falls back to generic copy while loading or
  // on failure.
  const versionCountQuery = useQuery({
    ...actionVersionCountQuery(actionsApi, deleteTarget?.id ?? ''),
    enabled: !!deleteTarget,
  });
  const versionCount = versionCountQuery.data ?? null;

  // Capabilities whose instructions carry an `@action:<slug>` token. Replaces
  // the old blanket "agents and integrations reference this" claim, which was
  // asserted without ever looking anything up.
  const { getUsage } = useReferenceUsage({ skip: !deleteTarget });
  const referencingCapabilities = getUsage('action', deleteTarget?.slug);

  const handleEdit = useCallback(
    (action: ActionWithSchema) => {
      navigate(actionDetail(action.id));
    },
    [navigate],
  );

  const handleDuplicate = useCallback(
    (action: ActionWithSchema) => {
      // Open the create form prefilled from this action; the user reviews and
      // saves (no half-baked copies created behind their back).
      navigate(PATHS.ACTIONS_NEW, {
        state: {
          duplicateFrom: {
            name: `${action.name} (copy)`,
            slug: '',
            description: action.description,
            enabled: action.enabled,
            parameters: action.parameters,
            steps: action.steps,
          },
        },
      });
    },
    [navigate],
  );

  const closeDeleteDialog = useCallback(() => {
    if (deleteFetcher.state !== 'idle') {
      return;
    }
    deleteFetcher.reset();
    setDeleteTarget(null);
  }, [deleteFetcher]);

  const handleDelete = useCallback(
    (action: ActionWithSchema) => {
      deleteFetcher.reset();
      setDeleteTarget(action);
    },
    [deleteFetcher],
  );

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    void deleteFetcher.submit(
      { intent: 'delete', actionId: deleteTarget.id },
      { method: 'post', action: PATHS.ACTIONS },
    );
  };

  const columns = useActionColumns(config.statuses ?? []);
  const getRowId = useCallback((action: ActionWithSchema) => action.id, []);
  const renderRowActions = useCallback(
    (action: ActionWithSchema) => (
      <ActionRowActionsMenu
        action={action}
        onEdit={handleEdit}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
      />
    ),
    [handleEdit, handleDuplicate, handleDelete],
  );

  const listEmpty = !loading && !error && actions.length === 0;
  const deleteResult =
    deleteTarget && deleteFetcher.data?.actionId === deleteTarget.id
      ? deleteFetcher.data
      : undefined;
  const isDeleting =
    deleteFetcher.state !== 'idle' &&
    deleteFetcher.formData?.get('actionId') === deleteTarget?.id;
  const deleteSucceeded = deleteResult?.ok === true;

  const headerToolbar =
    !error && (loading || actions.length > 0) ? (
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 md:gap-3">
        <OverviewListingSearchField
          disabled={loading}
          value={search}
          onValueChange={setSearch}
          placeholder="Search by name or slug..."
          ariaLabel="Search actions"
          layout="pageHeader"
        />
      </div>
    ) : undefined;

  const primaryAction = (
    <Button
      size="sm"
      className={toolbarPrimaryCtaButtonClassName}
      onClick={() => navigate(PATHS.ACTIONS_NEW)}
    >
      <Plus />
      New
    </Button>
  );

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col bg-background">
      <OverviewListingStandaloneBody className="flex min-h-0 flex-1 flex-col space-y-4 sm:space-y-6">
        <OverviewListingPageHeader
          title="Actions"
          description="Define reusable, parameterized HTTP operations that run against your integrations."
          toolbar={headerToolbar}
          primaryAction={primaryAction}
        />

        {!loading && error ? (
          <OverviewEmptyState
            icon={AlertTriangle}
            title="Failed to load actions"
            description={error.message}
          />
        ) : listEmpty ? (
          <OverviewEmptyPreview
            actionDelay={ghostSettleAt(GHOST_ROWS.length, 5)}
            title="No actions yet"
            description="An action is a deterministic operation callable via MCP. It captures a multi-step path, a proven, standardized way to get something done, as a single repeatable operation. Actions are exposed as MCP tools, so agents can trigger these golden paths directly rather than stitching together the individual steps themselves. Capabilities refer to actions to invoke this deterministic behavior."
            preview={
              <GhostTablePreview
                headers={GHOST_HEADERS}
                columns={GHOST_COLUMNS}
                rows={GHOST_ROWS}
              />
            }
            action={
              <Button
                variant="outline"
                onClick={() => navigate(PATHS.ACTIONS_NEW)}
              >
                <Plus className="size-4" />
                New Action
              </Button>
            }
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 sm:gap-6">
            <OverviewTable<ActionWithSchema>
              data={rows}
              columns={columns}
              columnDisplay={{ tableId: 'actions' }}
              getRowId={getRowId}
              loading={loading}
              defaultSort={[{ id: 'updated', desc: true }]}
              rowActions={renderRowActions}
              onRowClick={action => openDetail(action.id)}
              paginationTestId="actions-table-pagination"
              emptyState={
                <EmptyState
                  title="No matching actions"
                  description="Try clearing your search or filters."
                />
              }
            />
          </div>
        )}
      </OverviewListingStandaloneBody>

      <ActionDetailDrawer
        actionId={detailId}
        action={detailAction}
        open={detailId != null}
        listLoading={detailId != null && !detailAction && loading}
        onOpenChange={open => {
          if (!open) closeDetail();
        }}
      />

      <Dialog
        open={!!deleteTarget && !deleteSucceeded}
        onOpenChange={open => !open && closeDeleteDialog()}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</DialogTitle>
            <DialogDescription>
              This permanently deletes the action and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            {/* Warning tone only when something verifiably breaks. */}
            {referencingCapabilities.length > 0 && (
              <div className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <p className="text-warning">
                  Referenced by {referencingCapabilities.length} capabilit
                  {referencingCapabilities.length === 1 ? 'y' : 'ies'}:{' '}
                  <span className="font-medium">
                    {formatUsedByNames(
                      referencingCapabilities.map(c => c.name),
                    )}
                  </span>
                  . Deleting will leave{' '}
                  {referencingCapabilities.length === 1 ? 'it' : 'them'} with a
                  broken <InlineCode>@action:{deleteTarget?.slug}</InlineCode>{' '}
                  reference.
                </p>
              </div>
            )}
            {/* Advisory: unlike the block above this asserts no known usage,
                only that these addressing modes name the slug. */}
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p>
                Service tokens scoped to{' '}
                <InlineCode>action:execute:{deleteTarget?.slug}</InlineCode> and
                external MCP callers naming this slug will stop resolving.
              </p>
            </div>
            {deleteTarget?.enabled && (
              <div className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <p>
                  This action is{' '}
                  <span className="font-medium text-foreground">enabled</span>{' '}
                  and currently exposed to MCP / agents.
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <p>
                {versionCount && versionCount > 0
                  ? `All ${versionCount} saved version${
                      versionCount === 1 ? '' : 's'
                    } will be permanently deleted.`
                  : 'All saved version history will be permanently deleted.'}
              </p>
            </div>
            {deleteResult?.ok === false && (
              <p role="alert" className="text-destructive">
                {deleteResult.error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDeleteDialog}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
