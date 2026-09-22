import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { useState, useCallback, useMemo } from 'react';
import { AlertTriangle, Blocks, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import {
  OverviewListingToolbar,
  OverviewListingPageHeader,
  OverviewListingStandaloneBody,
  OverviewListingEmbeddedBody,
  parseCategoryFilter,
  useDetailDrawer,
  type CategoryFilter,
} from '../../common';
import { useWorkflows, useAlert } from '../../../api';
import { invalidationKeys, queryKeys } from '../../../api/queries';
import { useOptimisticMutation } from '../../../api/query-hooks';
import { Button } from '@roadiehq/ui/button';
import { EmptyState } from '@roadiehq/ui/empty-state';
import {
  OverviewEmptyState,
  OverviewTable,
  integrationLegacyTabTarget,
  useLegacyTabRedirect,
  useOverviewLoadErrorToast,
  useOverviewState,
  usePublishOverviewData,
  OVERVIEW_ALL_GROUP,
} from '../../overview';
import type { EnumTableFilterOption } from '../../overview';
import { useIntegrations } from '../use-integrations';
import {
  useIntegrationSecretStatus,
  useInvalidateIntegrationSecretStatus,
} from '../use-integration-secret-status';
import { IntegrationFormDialog, GitHubIntegrationDialog } from '../form';
import type { IntegrationItem } from '../types';
import {
  CATEGORY_ICON,
  INTEGRATION_TYPE_META,
  isGitHubAppIntegration,
} from '../types';
import { pageContentClassName } from '../../../config/page-layout';
import { PATHS, integrationDetail } from '../../../config/paths';
import { useGithubAppInstallReturn } from '../use-github-app-install-return';
import { toolbarPrimaryCtaButtonClassName } from '@roadiehq/ui/toolbar';
import { useIntegrationOverviewConfig } from './integration-overview-config';
import {
  useIntegrationColumns,
  IntegrationRowActionsMenu,
} from './integrations-columns';
import { IntegrationDetailDrawer } from './integration-detail-drawer';
import { RecommendedIntegrationsStrip } from './recommended-integrations-strip';
import { getIntegrationUsageReason } from '../delete-disabled-reason';
import { ResponseError } from '../../../api/infrastructure/errors';

export function IntegrationOverview({
  embeddedInAdmin = false,
}: {
  embeddedInAdmin?: boolean;
}) {
  const navigate = useNavigate();
  const api = useWorkflows();
  const alertApi = useAlert();

  // Relationship rules are included so the delete guard can name them; that
  // query paginates the whole rule catalog, which is why it's opt-in.
  const { integrations, logoDataUriBySlug, loading, error, refetch } =
    useIntegrations({ includeRelationshipRules: true });

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IntegrationItem | undefined>();
  const [formTemplate, setFormTemplate] = useState<
    IntegrationItem | undefined
  >();
  const [githubDialogOpen, setGithubDialogOpen] = useState(false);
  const [githubTargetId, setGithubTargetId] = useState<string | undefined>();
  const githubTarget = useMemo(
    () =>
      githubTargetId
        ? integrations.find(i => i.id === githubTargetId)
        : undefined,
    [integrations, githubTargetId],
  );
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const { summariesByIntegrationId, loading: secretStatusLoading } =
    useIntegrationSecretStatus(integrations);
  const invalidateSecretStatus = useInvalidateIntegrationSecretStatus();

  useLegacyTabRedirect(integrationLegacyTabTarget);
  const config = useIntegrationOverviewConfig({
    summariesByIntegrationId,
    secretStatusLoading,
    logoDataUriBySlug,
  });
  const { group, search, rows, groups, setGroup, setSearch } = useOverviewState(
    integrations,
    config,
  );

  const getSecretSummary = useCallback(
    (item: IntegrationItem) => summariesByIntegrationId.get(item.id),
    [summariesByIntegrationId],
  );

  // Standalone only: a row click opens a detail drawer (URL-driven via
  // ?detail=<id>). Look the row up in the full list so it survives filtering.
  // The admin embed keeps its dialog edit flow and never renders the drawer.
  const {
    openId: detailId,
    open: openDetail,
    close: closeDetail,
  } = useDetailDrawer();
  const detailIntegration = detailId
    ? integrations.find(i => i.id === detailId)
    : undefined;

  useGithubAppInstallReturn(refetch);
  useOverviewLoadErrorToast(error);

  const handleCreate = useCallback(() => {
    // Standalone: creating is a routed full-page editor (deep-linkable). The
    // admin embed has no `/integrations/*` routes, so it keeps the dialog.
    if (!embeddedInAdmin) {
      navigate(PATHS.INTEGRATIONS_NEW);
      return;
    }
    setEditTarget(undefined);
    setFormTemplate(undefined);
    setFormOpen(true);
  }, [embeddedInAdmin, navigate]);

  const handleEdit = useCallback(
    (id: string) => {
      // Standalone: editing navigates to the routed editor so the URL is
      // shareable, matching every other overview. The admin embed keeps the
      // dialog because `/integrations/:id` isn't routed under `/admin`.
      if (!embeddedInAdmin) {
        navigate(integrationDetail(id));
        return;
      }
      const item = integrations.find(i => i.id === id);
      if (item) {
        if (isGitHubAppIntegration(item)) {
          setGithubTargetId(item.id);
          setGithubDialogOpen(true);
        } else {
          setFormTemplate(undefined);
          setEditTarget(item);
          setFormOpen(true);
        }
      }
    },
    [embeddedInAdmin, navigate, integrations],
  );

  const handleFormClose = useCallback(() => {
    setFormOpen(false);
    setEditTarget(undefined);
    setFormTemplate(undefined);
  }, []);

  const handleDuplicate = useCallback(() => {
    if (!editTarget) {
      return;
    }

    setFormTemplate(editTarget);
    setEditTarget(undefined);
    setFormOpen(true);
  }, [editTarget]);

  const handleGithubDialogClose = useCallback(() => {
    setGithubDialogOpen(false);
    setGithubTargetId(undefined);
  }, []);

  const handleGithubDuplicate = useCallback(() => {
    if (!githubTarget) {
      return;
    }
    setFormTemplate(githubTarget);
    setEditTarget(undefined);
    setFormOpen(true);
    setGithubDialogOpen(false);
    setGithubTargetId(undefined);
  }, [githubTarget]);

  const handleFormSaved = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleSecretsChanged = useCallback(() => {
    refetch();
    void invalidateSecretStatus();
  }, [refetch, invalidateSecretStatus]);

  const handleInstallationsChanged = useCallback(() => {
    refetch();
    void invalidateSecretStatus();
  }, [refetch, invalidateSecretStatus]);

  const handleDelete = useCallback((id: string, name: string) => {
    setDeleteTarget({ id, name });
  }, []);

  const deleteMutation = useOptimisticMutation<
    void,
    string,
    Awaited<ReturnType<typeof api.integrations.list>>
  >({
    mutationFn: (id: string) => api.integrations.delete(id),
    cacheKey: queryKeys.integrationsList,
    update: (current, id) => {
      const data = current.data.filter(item => item.id !== id);
      return {
        ...current,
        data,
        total: current.total - (current.data.length - data.length),
      };
    },
    invalidates: invalidationKeys.integrationDeleted(),
  });

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      alertApi.post({
        message: 'Integration deleted',
        severity: 'success',
        display: 'transient',
      });
      setFormOpen(false);
      setEditTarget(undefined);
      setFormTemplate(undefined);
      if (githubTargetId === deleteTarget.id) {
        setGithubDialogOpen(false);
        setGithubTargetId(undefined);
      }
    } catch (error) {
      // 409 (in use) and 503 (couldn't verify) come from the server-side
      // guard, which sees reference sites the client scan may have missed —
      // so refetch to pick up whatever it knows.
      if (
        error instanceof ResponseError &&
        (error.statusCode === 409 || error.statusCode === 503)
      ) {
        alertApi.post({ message: error.message, severity: 'warning' });
        refetch();
      } else {
        alertApi.post({
          message: `Failed to delete: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          severity: 'error',
        });
      }
    }
    setDeleteTarget(null);
  }, [deleteMutation, deleteTarget, githubTargetId, alertApi, refetch]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const getDeleteDisabledReason = useCallback(
    (item: IntegrationItem): string | null => {
      return getIntegrationUsageReason(item);
    },
    [],
  );

  const secretStatusLoadingForItem = useCallback(
    (item: IntegrationItem) => {
      const summary = summariesByIntegrationId.get(item.id);
      if (!summary) {
        return secretStatusLoading;
      }
      if (summary?.checkingReadiness) {
        return true;
      }
      if (!summary.requiredSecretRefs.length) {
        return false;
      }
      return secretStatusLoading;
    },
    [summariesByIntegrationId, secretStatusLoading],
  );

  const categoryFilterOptions = useMemo<EnumTableFilterOption[]>(() => {
    const categories = new Set(
      integrations.map(item =>
        Object.hasOwn(INTEGRATION_TYPE_META, item.type) ? item.type : 'other',
      ),
    );
    return Object.entries(INTEGRATION_TYPE_META)
      .filter(([value]) => categories.has(value))
      .map(([value, meta]) => {
        const Icon = CATEGORY_ICON[`${value}`] ?? CATEGORY_ICON.other;
        return {
          value,
          label: meta.label,
          icon: <Icon className="size-4 text-muted-foreground" aria-hidden />,
        };
      });
  }, [integrations]);

  const columns = useIntegrationColumns({
    onEdit: handleEdit,
    getSecretSummary,
    secretStatusLoadingForItem,
    getDeleteDisabledReason,
    activeGroup: group,
    statuses: config.statuses ?? [],
    categoryFilterOptions,
    nameAsButton: embeddedInAdmin,
  });

  const getRowId = useCallback((item: IntegrationItem) => item.id, []);
  const renderRowActions = useCallback(
    (item: IntegrationItem) => (
      <IntegrationRowActionsMenu
        item={item}
        onEdit={handleEdit}
        onDelete={handleDelete}
        getDeleteDisabledReason={getDeleteDisabledReason}
      />
    ),
    [handleEdit, handleDelete, getDeleteDisabledReason],
  );

  const integrationFormDeleteReason = useMemo(() => {
    if (!editTarget) {
      return null;
    }
    return getDeleteDisabledReason(editTarget);
  }, [editTarget, getDeleteDisabledReason]);

  const integrationFormOnRequestDelete = useMemo(
    () =>
      editTarget
        ? () => handleDelete(editTarget.id, editTarget.name)
        : undefined,
    [editTarget, handleDelete],
  );

  // Publish the sidebar category sub-items only for the standalone page; the
  // admin embed has no app sidebar, so publishing there would leak groups into
  // the standalone Integrations nav item. Hooks can't be conditional, so always
  // call the hook with `null` when embedded.
  //
  // Also skip publishing the empty loading snapshot (`groups` collapses to
  // All-only before data lands) — keep the sidebar showing the cached counts
  // (or, on first visit, no sub-items until counts land) so the full category
  // set reveals in one step when data lands, instead of flickering All → +counts.
  usePublishOverviewData(
    useMemo(
      () =>
        embeddedInAdmin || loading
          ? null
          : {
              routeKey: PATHS.INTEGRATIONS,
              activeGroup: group,
              groups: groups.map(g => ({
                ...g,
                href:
                  g.key === OVERVIEW_ALL_GROUP
                    ? PATHS.INTEGRATIONS
                    : `${PATHS.INTEGRATIONS}?group=${g.key}`,
              })),
            },
      [embeddedInAdmin, loading, groups, group],
    ),
  );

  // In the admin embed there is no app sidebar to host the category sub-items,
  // so a category select in the toolbar keeps category filtering available.
  const handleCategoryChange = useCallback(
    (value: CategoryFilter) =>
      setGroup(value === 'all' ? OVERVIEW_ALL_GROUP : value),
    [setGroup],
  );

  const listEmpty = !loading && !error && integrations.length === 0;

  // A newcomer has nothing configured yet; surface a curated "connect your
  // first" strip until they do. Restricted to the unfiltered standalone list so
  // it never competes with an active search / category view.
  const anyConfigured = useMemo(
    () =>
      Array.from(summariesByIntegrationId.values()).some(
        summary => summary.configured,
      ),
    [summariesByIntegrationId],
  );
  const showRecommended =
    !embeddedInAdmin &&
    !secretStatusLoading &&
    !anyConfigured &&
    group === OVERVIEW_ALL_GROUP &&
    !search.trim();

  const headerToolbar =
    !error && integrations.length > 0 ? (
      <OverviewListingToolbar
        category={embeddedInAdmin ? parseCategoryFilter(group) : undefined}
        onCategoryChange={embeddedInAdmin ? handleCategoryChange : undefined}
        searchValue={search}
        onSearchChange={setSearch}
        searchAriaLabel="Filter by name, host, or category"
        searchPlaceholder="Search by name, host, or category..."
        variant="pageHeader"
      />
    ) : null;

  const primaryAction = (
    <Button
      size="sm"
      className={toolbarPrimaryCtaButtonClassName}
      onClick={handleCreate}
    >
      <Plus />
      New
    </Button>
  );

  const OverviewListingMain = embeddedInAdmin
    ? OverviewListingEmbeddedBody
    : OverviewListingStandaloneBody;

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col bg-background">
      <OverviewListingMain
        className={
          embeddedInAdmin
            ? pageContentClassName
            : 'flex min-h-0 flex-1 flex-col space-y-4 sm:space-y-6'
        }
      >
        {embeddedInAdmin ? (
          !listEmpty && (
            <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 md:gap-3">
              {headerToolbar}
              {primaryAction}
            </div>
          )
        ) : (
          <OverviewListingPageHeader
            title="Integrations"
            description="Connect external systems and APIs to your catalog."
            toolbar={headerToolbar}
            primaryAction={primaryAction}
          />
        )}

        {!loading && error ? (
          <OverviewEmptyState
            icon={AlertTriangle}
            title="Failed to load integrations"
            description={error.message}
          />
        ) : listEmpty ? (
          <OverviewEmptyState
            icon={Blocks}
            title="No integrations yet"
            description="Integrations connect your external systems. Create your first one to get started."
            action={
              <Button onClick={handleCreate}>
                <Plus />
                Create Integration
              </Button>
            }
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 sm:gap-6">
            {showRecommended && (
              <RecommendedIntegrationsStrip
                integrations={integrations}
                onConnect={handleEdit}
              />
            )}
            <OverviewTable<IntegrationItem>
              data={rows}
              columns={columns}
              columnDisplay={{ tableId: 'integrations' }}
              getRowId={getRowId}
              loading={loading}
              defaultSort={[{ id: 'setup', desc: false }]}
              rowActions={renderRowActions}
              onRowClick={
                embeddedInAdmin ? undefined : item => openDetail(item.id)
              }
              paginationTestId="integrations-table-pagination"
              emptyState={
                <EmptyState
                  title="No matching integrations"
                  description="Try clearing your search or filters."
                />
              }
            />
          </div>
        )}
      </OverviewListingMain>

      {/* Standalone only: a read-first detail drawer opened by row click. The
          admin embed opens its edit dialog instead and never mounts this. */}
      {!embeddedInAdmin && (
        <IntegrationDetailDrawer
          integrationId={detailId}
          integration={detailIntegration}
          listLoading={detailId != null && !detailIntegration && loading}
          open={detailId != null}
          onOpenChange={open => {
            if (!open) closeDetail();
          }}
        />
      )}

      {/* Editing/creating on the standalone page is a routed full-page editor;
          only the admin embed (no `/integrations/*` routes) opens these dialogs. */}
      {embeddedInAdmin && (
        <>
          <IntegrationFormDialog
            open={formOpen}
            onClose={handleFormClose}
            onSaved={handleFormSaved}
            onSecretsChanged={handleSecretsChanged}
            integration={editTarget}
            template={formTemplate}
            onRequestDelete={integrationFormOnRequestDelete}
            onRequestDuplicate={editTarget ? handleDuplicate : undefined}
            deleteDisabledReason={integrationFormDeleteReason}
          />

          {githubTarget && (
            <GitHubIntegrationDialog
              open={githubDialogOpen}
              onClose={handleGithubDialogClose}
              integration={githubTarget}
              onInstallationsChanged={handleInstallationsChanged}
              onSecretsChanged={handleSecretsChanged}
              onRequestDelete={() =>
                handleDelete(githubTarget.id, githubTarget.name)
              }
              deleteDisabledReason={getDeleteDisabledReason(githubTarget)}
              onRequestDuplicate={
                githubTarget.slug === 'github-enterprise-app'
                  ? handleGithubDuplicate
                  : undefined
              }
            />
          )}
        </>
      )}

      <ConfirmationDialog
        open={!!deleteTarget}
        title="Delete integration"
        contentText={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        isDelete
        confirmButtonText="Delete"
      />
    </div>
  );
}
