import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  Sparkles,
  Plus,
  AlertTriangle,
  Zap,
  Users,
  Share2,
  Trash2,
} from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { EmptyState } from '@roadiehq/ui/empty-state';
import { toolbarPrimaryCtaButtonClassName } from '@roadiehq/ui/toolbar';
import { useAlert } from '../../../api';
import { PATHS, capabilityDetail } from '../../../config/paths';
import { useCapabilities } from '../use-capabilities';
import { useReferenceUsage } from '../use-reference-usage';
import { ReferenceUsageWarning } from '../reference-usage-warning';
import { useCapabilityReferences } from '../editor/use-capability-references';
import {
  extractReferences,
  referenceKey,
  type ParsedReference,
} from '../editor/references';
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
  OverviewBulkActions,
  OverviewTable,
  useOverviewLoadErrorToast,
  useOverviewState,
  type ColumnConfig,
  type GhostRow,
} from '../../overview';
import type { Capability } from '../../../api';
import { useCapabilitiesOverviewConfig } from './capabilities-overview-config';
import {
  useCapabilityColumns,
  CapabilityRowActionsMenu,
} from './capabilities-columns';
import { CapabilityDetailDrawer } from './capability-detail-drawer';

const NEW_CAPABILITY_PATH = `${PATHS.CAPABILITIES}/new`;

const GHOST_HEADERS = ['Name', 'Version', 'Updated'];
const GHOST_COLUMNS = '2.5rem minmax(0,1fr) 5rem 5.5rem';
const GHOST_ROWS: GhostRow[] = [
  [
    { kind: 'icon', icon: Sparkles },
    { kind: 'title', text: 'Triage an incident' },
    { kind: 'badge', text: 'v1' },
    { kind: 'text', text: '4h ago' },
  ],
  [
    { kind: 'icon', icon: Sparkles },
    { kind: 'title', text: 'Draft release notes' },
    { kind: 'badge', text: 'v2' },
    { kind: 'text', text: 'Yesterday' },
  ],
  [
    { kind: 'icon', icon: Sparkles },
    { kind: 'title', text: 'Summarize open pull requests' },
    { kind: 'badge', text: 'v1' },
    { kind: 'text', text: '1w ago' },
  ],
];

export function CapabilitiesPage() {
  const navigate = useNavigate();
  const alertApi = useAlert();
  const { capabilities, loading, error, deleteCapability, isDeleting } =
    useCapabilities();
  const [deleteTargets, setDeleteTargets] = useState<
    Array<{
      id: string;
      name: string;
      slug: string;
    }>
  >([]);
  const [selectedCapabilities, setSelectedCapabilities] = useState<
    Capability[]
  >([]);

  const config = useCapabilitiesOverviewConfig();
  const { search, rows, setSearch } = useOverviewState(capabilities, config);

  // Row click opens a detail drawer (URL-driven via ?detail=<id>); look the row
  // up in the full list so it survives search filtering.
  const {
    openId: detailId,
    open: openDetail,
    close: closeDetail,
  } = useDetailDrawer();
  const detailCapability = detailId
    ? capabilities.find(c => c.id === detailId)
    : undefined;

  // Cross-check each capability's `@type:slug` references against the resources
  // that actually exist, so the list can flag dangling references. Skip while
  // references are still loading — otherwise everything looks broken.
  const { byKey, loading: referencesLoading } = useCapabilityReferences();
  const brokenByCapability = useMemo(() => {
    const map = new Map<string, ParsedReference[]>();
    if (referencesLoading) return map;
    for (const capability of capabilities) {
      const broken = extractReferences(capability.instructions).filter(
        ref => !byKey.has(referenceKey(ref.type, ref.slug)),
      );
      if (broken.length > 0) map.set(capability.id, broken);
    }
    return map;
  }, [capabilities, byKey, referencesLoading]);

  const getBrokenReferences = useCallback(
    (capability: Capability): ParsedReference[] =>
      brokenByCapability.get(capability.id) ?? [],
    [brokenByCapability],
  );

  // Surface load errors via toast (matches Data Sources) rather than an inline
  // error panel, so the page still renders its table/empty state.
  useOverviewLoadErrorToast(error);

  const handleCreate = useCallback(() => {
    navigate(NEW_CAPABILITY_PATH);
  }, [navigate]);

  const handleEdit = useCallback(
    (id: string) => {
      navigate(capabilityDetail(id));
    },
    [navigate],
  );

  const handleDelete = useCallback((capability: Capability) => {
    const { id, name, slug } = capability;
    setDeleteTargets([{ id, name, slug }]);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (deleteTargets.length === 0 || isDeleting) return;

    const failedTargets: typeof deleteTargets = [];
    let firstError: unknown;
    for (const target of deleteTargets) {
      try {
        await deleteCapability(target.id);
      } catch (e: unknown) {
        firstError ??= e;
        failedTargets.push(target);
      }
    }

    if (failedTargets.length === 0) {
      alertApi.post({
        message:
          deleteTargets.length === 1
            ? 'Capability deleted'
            : `${deleteTargets.length} capabilities deleted`,
        severity: 'success',
        display: 'transient',
      });
      setDeleteTargets([]);
    } else {
      alertApi.post({
        message:
          deleteTargets.length === 1 && firstError instanceof Error
            ? firstError.message
            : `Failed to delete ${failedTargets.length} of ${deleteTargets.length} capabilities`,
        severity: 'error',
      });
      setDeleteTargets(failedTargets);
    }
  }, [deleteTargets, isDeleting, deleteCapability, alertApi]);

  const handleDeleteCancel = useCallback(() => {
    if (isDeleting) return;
    setDeleteTargets([]);
  }, [isDeleting]);

  const handleBulkDelete = useCallback(() => {
    setDeleteTargets(
      selectedCapabilities.map(capability => ({
        id: capability.id,
        name: capability.name,
        slug: capability.slug,
      })),
    );
  }, [selectedCapabilities]);

  // A capability may be `@capability:`-referenced by others. References from
  // capabilities that are themselves being deleted are excluded — a mutually
  // referencing pair deleted together breaks nothing that survives.
  const { getReferencedTargets, loading: usageLoading } = useReferenceUsage({
    skip: deleteTargets.length === 0,
  });
  const referencedDeleteTargets = useMemo(
    () =>
      getReferencedTargets(
        deleteTargets.map(target => ({
          type: 'capability' as const,
          name: target.name,
          slug: target.slug,
        })),
        new Set(deleteTargets.map(target => target.id)),
      ),
    [deleteTargets, getReferencedTargets],
  );

  const columns: ColumnConfig<Capability>[] =
    useCapabilityColumns(getBrokenReferences);

  const getRowId = useCallback((c: Capability) => c.id, []);
  const renderRowActions = useCallback(
    (c: Capability) => (
      <CapabilityRowActionsMenu
        capability={c}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
    ),
    [handleEdit, handleDelete],
  );

  const listEmpty = !loading && !error && capabilities.length === 0;

  const headerToolbar =
    !error && capabilities.length > 0 ? (
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 md:gap-3">
        <OverviewBulkActions
          selectedCount={selectedCapabilities.length}
          destructiveActions={[
            {
              label: 'Delete',
              icon: Trash2,
              onSelect: handleBulkDelete,
            },
          ]}
        />
        {selectedCapabilities.length > 0 ? (
          <div
            className="hidden h-6 w-px shrink-0 bg-border sm:block"
            aria-hidden
          />
        ) : null}
        <OverviewListingSearchField
          value={search}
          onValueChange={setSearch}
          placeholder="Search by name..."
          ariaLabel="Search capabilities by name"
          layout="pageHeader"
        />
      </div>
    ) : undefined;

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col bg-background">
      <OverviewListingStandaloneBody className="flex min-h-0 flex-1 flex-col space-y-4 sm:space-y-6">
        <OverviewListingPageHeader
          title="Capabilities"
          description="Define reusable AI capability prompts and tools for your workspace."
          toolbar={headerToolbar}
          primaryAction={
            <Button
              size="sm"
              className={toolbarPrimaryCtaButtonClassName}
              onClick={handleCreate}
            >
              <Plus />
              New
            </Button>
          }
        />

        {!loading && error ? (
          <OverviewEmptyState
            icon={AlertTriangle}
            title="Failed to load capabilities"
            description={error.message}
          />
        ) : listEmpty ? (
          <OverviewEmptyPreview
            actionDelay={ghostSettleAt(GHOST_ROWS.length, 4)}
            title="No capabilities yet"
            description={
              <>
                A{' '}
                <strong className="font-medium text-foreground">
                  capability
                </strong>{' '}
                is a playbook for agents: reusable instructions, written once
                and versioned, that an agent retrieves over MCP when asked to do
                the kind of work it covers. Instead of improvising, the agent
                follows your proven steps — and a capability can point it at
                exactly what it needs:
              </>
            }
            bullets={[
              {
                icon: Zap,
                term: 'Actions',
                text: 'invoke a deterministic step to run it exactly, not approximately.',
              },
              {
                icon: Users,
                term: 'Context groups',
                text: 'cross-cutting business concepts layered over the object graph that no single object names.',
              },
              {
                icon: Share2,
                term: 'Data sources',
                text: 'ground its work in live objects from your catalog rather than guesswork.',
              },
            ]}
            preview={
              <GhostTablePreview
                headers={GHOST_HEADERS}
                columns={GHOST_COLUMNS}
                rows={GHOST_ROWS}
              />
            }
            action={
              <Button variant="outline" onClick={handleCreate}>
                <Plus className="size-4" />
                New Capability
              </Button>
            }
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 sm:gap-6">
            <OverviewTable<Capability>
              data={rows}
              columns={columns}
              getRowId={getRowId}
              loading={loading}
              defaultSort={[{ id: 'updated', desc: true }]}
              selection={{
                marquee: true,
                onChange: setSelectedCapabilities,
              }}
              rowActions={renderRowActions}
              onRowClick={c => openDetail(c.id)}
              paginationTestId="capabilities-table-pagination"
              emptyState={
                <EmptyState
                  title="No matching capabilities"
                  description="Try clearing your search or filters."
                />
              }
            />
          </div>
        )}
      </OverviewListingStandaloneBody>

      <CapabilityDetailDrawer
        capabilityId={detailId}
        capability={detailCapability}
        open={detailId != null}
        listLoading={detailId != null && !detailCapability && loading}
        onOpenChange={open => {
          if (!open) closeDetail();
        }}
      />

      <ConfirmationDialog
        open={deleteTargets.length > 0}
        title={
          deleteTargets.length > 1 ? 'Delete capabilities' : 'Delete capability'
        }
        contentText={
          <>
            {deleteTargets.length > 1
              ? `Are you sure you want to delete ${deleteTargets.length} capabilities? This action cannot be undone.`
              : `Are you sure you want to delete "${deleteTargets[0]?.name}"? This action cannot be undone.`}
            <ReferenceUsageWarning
              referenced={referencedDeleteTargets}
              loading={usageLoading}
              multiple={deleteTargets.length > 1}
            />
          </>
        }
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        isDelete
        confirmButtonText="Delete"
        confirmingText="Deleting…"
        confirmDisabled={isDeleting}
        cancelDisabled={isDeleting}
      />
    </div>
  );
}
