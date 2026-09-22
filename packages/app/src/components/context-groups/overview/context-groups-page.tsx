import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@roadiehq/ui/dialog';
import { EmptyState } from '@roadiehq/ui/empty-state';
import { toolbarPrimaryCtaButtonClassName } from '@roadiehq/ui/toolbar';
import {
  OverviewListingPageHeader,
  OverviewListingSearchField,
  OverviewListingStandaloneBody,
  useDetailDrawer,
} from '../../common';
import {
  OverviewEmptyState,
  OverviewBulkActions,
  OverviewTable,
  useOverviewLoadErrorToast,
  useOverviewState,
} from '../../overview';
import { useAlert } from '../../../api';
import { useContextGroups } from '../use-context-groups';
import { useReferenceUsage } from '../../capabilities/use-reference-usage';
import { ReferenceUsageWarning } from '../../capabilities/reference-usage-warning';
import type { ContextGroupRule } from '../types';
import { PATHS, contextGroupEdit } from '../../../config/paths';
import { useContextGroupsOverviewConfig } from './context-groups-overview-config';
import {
  useContextGroupColumns,
  ContextGroupRowActionsMenu,
} from './context-groups-columns';
import { ContextGroupDetailDrawer } from './context-group-detail-drawer';
import { ContextGroupSeedPicker } from './context-group-seed-picker';

export function ContextGroupsPage() {
  const navigate = useNavigate();
  const alertApi = useAlert();
  const {
    rules,
    loading,
    error,
    retry,
    deleteRule,
    isDeleting,
    materializeRule,
  } = useContextGroups();

  const [seedPickerOpen, setSeedPickerOpen] = useState(false);
  // Remount key: a fresh picker per open resets its selection.
  const [seedPickerSession, setSeedPickerSession] = useState(0);
  const [seedApplying, setSeedApplying] = useState(false);

  const config = useContextGroupsOverviewConfig();
  const { search, rows, setSearch } = useOverviewState(rules, config);

  // Row click opens a detail drawer (URL-driven via ?detail=<id>); look the rule
  // up in the full list so it survives search filtering.
  const {
    openId: detailId,
    open: openDetail,
    close: closeDetail,
  } = useDetailDrawer();
  const detailRule = detailId
    ? rules.find(rule => rule.id === detailId)
    : undefined;

  const [deleteTargets, setDeleteTargets] = useState<ContextGroupRule[]>([]);
  const [selectedRules, setSelectedRules] = useState<ContextGroupRule[]>([]);
  // Per-row set: multiple rules can materialize concurrently, which a single
  // mutation's `isPending` can't express.
  const [materializingIds, setMaterializingIds] = useState<Set<string>>(
    () => new Set(),
  );

  // Surface load errors via toast (matches Data Sources) rather than an inline
  // error panel, so the page still renders its table/empty state.
  useOverviewLoadErrorToast(error);

  const handleCreate = useCallback(() => {
    navigate(PATHS.CONTEXT_GROUPS_NEW);
  }, [navigate]);

  const openSeedPicker = useCallback(() => {
    setSeedPickerSession(session => session + 1);
    setSeedPickerOpen(true);
  }, []);

  const handleSeedPickerComplete = useCallback(() => {
    setSeedPickerOpen(false);
    retry();
  }, [retry]);

  const handleCreateCustom = useCallback(() => {
    setSeedPickerOpen(false);
    handleCreate();
  }, [handleCreate]);

  const handleEdit = useCallback(
    (id: string) => {
      navigate(contextGroupEdit(id));
    },
    [navigate],
  );

  const handleDelete = useCallback((rule: ContextGroupRule) => {
    setDeleteTargets([rule]);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (deleteTargets.length === 0 || isDeleting) return;

    const failedTargets: ContextGroupRule[] = [];
    let firstError: unknown;
    for (const target of deleteTargets) {
      try {
        await deleteRule(target.id);
      } catch (e: unknown) {
        firstError ??= e;
        failedTargets.push(target);
      }
    }

    if (failedTargets.length === 0) {
      alertApi.post({
        message:
          deleteTargets.length === 1
            ? 'Context group rule deleted'
            : `${deleteTargets.length} context group rules deleted`,
        severity: 'success',
      });
      setDeleteTargets([]);
    } else {
      alertApi.post({
        message:
          deleteTargets.length === 1 && firstError instanceof Error
            ? firstError.message
            : `Failed to delete ${failedTargets.length} of ${deleteTargets.length} context group rules`,
        severity: 'error',
      });
      setDeleteTargets(failedTargets);
    }
  }, [deleteTargets, isDeleting, deleteRule, alertApi]);

  const handleDeleteCancel = useCallback(() => {
    if (isDeleting) return;
    setDeleteTargets([]);
  }, [isDeleting]);

  const handleBulkDelete = useCallback(() => {
    setDeleteTargets(selectedRules);
  }, [selectedRules]);

  const { getReferencedTargets, loading: usageLoading } = useReferenceUsage({
    skip: deleteTargets.length === 0,
  });
  const referencedDeleteTargets = useMemo(
    () =>
      getReferencedTargets(
        deleteTargets.map(target => ({
          type: 'context-group' as const,
          name: target.name,
          slug: target.slug,
        })),
      ),
    [deleteTargets, getReferencedTargets],
  );

  const handleMaterialize = useCallback(
    async (rule: ContextGroupRule) => {
      const ruleId = rule.id;
      setMaterializingIds(prev => new Set(prev).add(ruleId));
      try {
        await materializeRule(ruleId);
        alertApi.post({
          message: `Groups updated for "${rule.name}"`,
          severity: 'success',
        });
      } catch (e: unknown) {
        alertApi.post({
          message: e instanceof Error ? e.message : 'Failed to update groups',
          severity: 'error',
        });
      } finally {
        setMaterializingIds(prev => {
          const next = new Set(prev);
          next.delete(ruleId);
          return next;
        });
      }
    },
    [materializeRule, alertApi],
  );

  const handleBulkMaterialize = useCallback(async () => {
    const rulesToMaterialize = selectedRules.filter(
      rule => !materializingIds.has(rule.id),
    );
    if (rulesToMaterialize.length === 0) return;

    const ids = rulesToMaterialize.map(rule => rule.id);
    setMaterializingIds(prev => new Set([...prev, ...ids]));
    const results = await Promise.allSettled(
      ids.map(id => materializeRule(id)),
    );
    const failedCount = results.filter(
      result => result.status === 'rejected',
    ).length;
    const contextGroupLabel =
      rulesToMaterialize.length === 1 ? 'context group' : 'context groups';
    setMaterializingIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });

    alertApi.post(
      failedCount === 0
        ? {
            message: `${rulesToMaterialize.length} ${contextGroupLabel} updated`,
            severity: 'success',
          }
        : {
            message: `Failed to update ${failedCount} of ${rulesToMaterialize.length} ${contextGroupLabel}`,
            severity: 'error',
          },
    );
  }, [selectedRules, materializingIds, materializeRule, alertApi]);

  const columns = useContextGroupColumns();

  const getRowId = useCallback((rule: ContextGroupRule) => rule.id, []);
  const renderRowActions = useCallback(
    (rule: ContextGroupRule) => (
      <ContextGroupRowActionsMenu
        rule={rule}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onMaterialize={handleMaterialize}
        materializingIds={materializingIds}
      />
    ),
    [handleEdit, handleDelete, handleMaterialize, materializingIds],
  );

  const listEmpty = !loading && !error && rules.length === 0;

  const headerToolbar =
    !error && rules.length > 0 ? (
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 md:gap-3">
        <OverviewBulkActions
          selectedCount={selectedRules.length}
          actions={[
            {
              label: 'Update groups',
              icon: RefreshCw,
              onSelect: () => void handleBulkMaterialize(),
              disabled: selectedRules.some(rule =>
                materializingIds.has(rule.id),
              ),
            },
          ]}
          destructiveActions={[
            {
              label: 'Delete',
              icon: Trash2,
              onSelect: handleBulkDelete,
            },
          ]}
        />
        {selectedRules.length > 0 ? (
          <div
            className="hidden h-6 w-px shrink-0 bg-border sm:block"
            aria-hidden
          />
        ) : null}
        <OverviewListingSearchField
          value={search}
          onValueChange={setSearch}
          placeholder="Search by name..."
          ariaLabel="Search context groups by name"
          layout="pageHeader"
        />
      </div>
    ) : null;

  const primaryAction = (
    <Button
      size="sm"
      className={toolbarPrimaryCtaButtonClassName}
      onClick={openSeedPicker}
    >
      <Plus />
      New
    </Button>
  );

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col bg-background">
      <OverviewListingStandaloneBody className="flex min-h-0 flex-1 flex-col space-y-4 sm:space-y-6">
        <OverviewListingPageHeader
          title="Context Groups"
          description="Define rules that create groups of related objects."
          toolbar={headerToolbar}
          primaryAction={primaryAction}
        />

        {!loading && error ? (
          <OverviewEmptyState
            icon={AlertTriangle}
            title="Failed to load context groups"
            description={error.message}
          />
        ) : listEmpty ? (
          <ContextGroupSeedPicker
            onComplete={retry}
            onCreateCustom={handleCreate}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 sm:gap-6">
            <OverviewTable<ContextGroupRule>
              data={rows}
              columns={columns}
              getRowId={getRowId}
              loading={loading}
              defaultSort={[
                { id: 'completeness', desc: false },
                { id: 'name', desc: false },
              ]}
              selection={{
                marquee: true,
                onChange: setSelectedRules,
              }}
              rowActions={renderRowActions}
              onRowClick={rule => openDetail(rule.id)}
              paginationTestId="context-groups-table-pagination"
              emptyState={
                <EmptyState
                  title="No matching context groups"
                  description="Try clearing your search or filters."
                />
              }
            />
          </div>
        )}
      </OverviewListingStandaloneBody>

      <ContextGroupDetailDrawer
        ruleId={detailId}
        rule={detailRule}
        open={detailId != null}
        listLoading={detailId != null && !detailRule && loading}
        onOpenChange={open => {
          if (!open) closeDetail();
        }}
      />

      <ConfirmationDialog
        open={deleteTargets.length > 0}
        title={
          deleteTargets.length > 1
            ? 'Delete Context Group Rules'
            : 'Delete Context Group Rule'
        }
        contentText={
          <>
            {deleteTargets.length > 1
              ? `Are you sure you want to delete ${deleteTargets.length} context group rules? This will also delete all groups created from these rules. This action cannot be undone.`
              : `Are you sure you want to delete "${deleteTargets[0]?.name}"? This will also delete all groups created from this rule. This action cannot be undone.`}
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

      <Dialog
        open={seedPickerOpen}
        onOpenChange={open => {
          if (!open && seedApplying) return;
          setSeedPickerOpen(open);
        }}
      >
        <DialogContent
          hideCloseButton
          className="flex h-[min(80vh,560px)] max-w-xl flex-col gap-0 overflow-hidden p-0"
        >
          <DialogTitle className="sr-only">New context group</DialogTitle>
          <ContextGroupSeedPicker
            key={seedPickerSession}
            variant="compact"
            onComplete={handleSeedPickerComplete}
            onCreateCustom={handleCreateCustom}
            onClose={() => setSeedPickerOpen(false)}
            onApplyingChange={setSeedApplying}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
