import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAlert, useWorkflows } from '../../../api';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import { formatErrorString } from '../../../api/workflow/parse-execution-error';
import { useInvalidatingMutation } from '../../../api/query-hooks';
import { queryKeys } from '../../../api/queries';
import { dataSourceDetail } from '../../../config/paths';
import { deleteDatasourceWithRules } from './delete-datasource-with-rules';
import { pluralS } from './suggested-rules-utils';
import type { PendingRelationshipConnection } from './types';

/** Rules using this data source at either end. */
export function rulesTouchingDatasource(
  rules: readonly RelationshipRule[],
  datasourceId: string,
): RelationshipRule[] {
  return rules.filter(
    rule =>
      rule.sourceDatasourceId === datasourceId ||
      rule.targetDatasourceId === datasourceId,
  );
}

interface OpenRuleUi {
  editingRule: RelationshipRule | null;
  pendingConnection: PendingRelationshipConnection | null;
  selectedRuleId: string | null;
}

/**
 * Whether any open rule UI references this data source.
 *
 * Removing a node out from under an open rule drawer would leave the form able
 * to save against an endpoint that no longer exists, and the `?rule` deep link
 * able to restore it — so the caller has to close that UI first.
 */
export function ruleUiInvolvesDatasource(
  { editingRule, pendingConnection, selectedRuleId }: OpenRuleUi,
  datasourceId: string,
  relatedRuleIds: ReadonlySet<string>,
): boolean {
  return (
    editingRule?.sourceDatasourceId === datasourceId ||
    editingRule?.targetDatasourceId === datasourceId ||
    pendingConnection?.sourceDatasourceId === datasourceId ||
    pendingConnection?.targetDatasourceId === datasourceId ||
    (selectedRuleId !== null && relatedRuleIds.has(selectedRuleId)) ||
    (editingRule !== null && relatedRuleIds.has(editingRule.id))
  );
}

/** Confirmation copy for a permanent data-source deletion. */
export function describeDatasourceDeletion(relatedRuleCount: number): string {
  return relatedRuleCount > 0
    ? `This permanently deletes the data source and its ${relatedRuleCount} relationship${pluralS(
        relatedRuleCount,
      )}. This can't be undone.`
    : "This permanently deletes the data source. This can't be undone.";
}

interface UseDatasourceLifecycleOptions {
  rules: RelationshipRule[];
  deleteRule: (ruleId: string) => Promise<void>;
  onSetDataSourceEnabled?: (id: string, enabled: boolean) => Promise<void>;
  onHideDataSource?: (id: string) => void;
  onDeleteDataSource?: (id: string) => Promise<void>;
  /**
   * A data source has left the canvas — hidden, disabled or deleted. All three
   * need the same follow-up (drop its focus and inspector, prune the layout),
   * so they report through one callback rather than each remembering the list.
   */
  onDetached: (
    datasourceId: string,
    relatedRuleIds: ReadonlySet<string>,
  ) => void;
  /**
   * A data source was permanently deleted. Separate from {@link onDetached}
   * because only this path needs the node pruned from the canvas optimistically
   * — hiding is instant (the parent owns the scope) and disabling keeps the
   * node until its query refetches.
   */
  onDeleted: (datasourceId: string) => void;
}

interface UseDatasourceLifecycleResult {
  hideDatasource: (id: string) => void;
  setDatasourceEnabled: (id: string, enabled: boolean) => Promise<void>;
  /** Ask before permanently deleting; drives the confirmation dialog. */
  requestDeleteDatasource: (id: string) => void;
  deleteDatasourceId: string | null;
  /** Confirmation copy, or undefined when nothing is pending. */
  deleteDatasourceText: string | undefined;
  confirmDeleteDatasource: () => Promise<void>;
  cancelDeleteDatasource: () => void;
  addDatasourceOpen: boolean;
  openAddDatasource: () => void;
  cancelAddDatasource: () => void;
  createDatasource: () => Promise<void>;
  creatingDatasource: boolean;
}

/**
 * Creating, hiding, disabling and deleting a data source from the canvas.
 *
 * Hide, disable and delete are three different things that look alike: hiding
 * only scopes the node out of this view, disabling stops its ingestion but
 * keeps its rules so re-enabling restores them, and deleting is the one
 * destructive path that takes the rules with it.
 */
export function useDatasourceLifecycle({
  rules,
  deleteRule,
  onSetDataSourceEnabled,
  onHideDataSource,
  onDeleteDataSource,
  onDetached,
  onDeleted,
}: UseDatasourceLifecycleOptions): UseDatasourceLifecycleResult {
  const api = useWorkflows();
  const alertApi = useAlert();
  const navigate = useNavigate();

  const [deleteDatasourceId, setDeleteDatasourceId] = useState<string | null>(
    null,
  );
  const [addDatasourceOpen, setAddDatasourceOpen] = useState(false);

  const detach = useCallback(
    (datasourceId: string) => {
      onDetached(
        datasourceId,
        new Set(
          rulesTouchingDatasource(rules, datasourceId).map(rule => rule.id),
        ),
      );
    },
    [rules, onDetached],
  );

  // Non-destructive: scopes the node out of this view only, reversible via the
  // header's data-source filter (the parent owns the scope).
  const hideDatasource = useCallback(
    (datasourceId: string) => {
      detach(datasourceId);
      onHideDataSource?.(datasourceId);
    },
    [detach, onHideDataSource],
  );

  // Disabling drops the node from the canvas once the workflows cache refetches
  // (only enabled sources render) but keeps its rules, so re-enabling restores
  // them. Deletion below is the destructive path.
  const setDatasourceEnabled = useCallback(
    async (datasourceId: string, enabled: boolean) => {
      if (!onSetDataSourceEnabled) {
        return;
      }
      if (!enabled) {
        detach(datasourceId);
      }
      await onSetDataSourceEnabled(datasourceId, enabled);
    },
    [onSetDataSourceEnabled, detach],
  );

  const requestDeleteDatasource = useCallback((datasourceId: string) => {
    setDeleteDatasourceId(datasourceId);
  }, []);

  const cancelDeleteDatasource = useCallback(() => {
    setDeleteDatasourceId(null);
  }, []);

  const deleteDatasourceText = useMemo(
    () =>
      deleteDatasourceId
        ? describeDatasourceDeletion(
            rulesTouchingDatasource(rules, deleteDatasourceId).length,
          )
        : undefined,
    [deleteDatasourceId, rules],
  );

  const confirmDeleteDatasource = useCallback(async () => {
    const datasourceId = deleteDatasourceId;
    if (!datasourceId || !onDeleteDataSource) {
      return;
    }
    const relatedRules = rulesTouchingDatasource(rules, datasourceId);
    // The data source goes first, so a failed primary delete cannot leave it
    // behind with its rules already gone.
    const { failedRuleIds } = await deleteDatasourceWithRules({
      datasourceId,
      relatedRuleIds: relatedRules.map(rule => rule.id),
      deleteDatasource: onDeleteDataSource,
      deleteRule,
    });

    setDeleteDatasourceId(null);
    detach(datasourceId);
    onDeleted(datasourceId);

    if (failedRuleIds.length > 0) {
      alertApi.post({
        message: `Data source deleted, but ${failedRuleIds.length} relationship rule${pluralS(
          failedRuleIds.length,
        )} could not be cleaned up`,
        severity: 'warning',
      });
    }
  }, [
    deleteDatasourceId,
    rules,
    deleteRule,
    onDeleteDataSource,
    detach,
    onDeleted,
    alertApi,
  ]);

  const createMutation = useInvalidatingMutation({
    mutationFn: (name: string) =>
      api.workflows.create({
        name,
        description: '',
        workflowType: 'data-ingestion',
        nodes: [],
        edges: [],
        enabled: false,
      }),
    invalidates: [queryKeys.dataIngestionWorkflows],
  });

  const openAddDatasource = useCallback(() => setAddDatasourceOpen(true), []);
  const cancelAddDatasource = useCallback(
    () => setAddDatasourceOpen(false),
    [],
  );

  const createDatasource = useCallback(async () => {
    const timestamp = new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    // Navigate / close are UI side-effects, so they live here rather than in the
    // mutation's onSuccess, which only owns cache invalidation. `mutateAsync`
    // rather than `mutate` so the promise reaches ConfirmationDialog, which
    // locks both buttons for its duration — `isPending` alone cannot stop a
    // double-click, because it only arrives on the next render.
    try {
      await createMutation.mutateAsync(`Data Source ${timestamp}`, {
        onSuccess: created => {
          setAddDatasourceOpen(false);
          navigate(dataSourceDetail(created.id));
        },
        onError: error => {
          setAddDatasourceOpen(false);
          alertApi.post({
            message: `Failed to create data source: ${formatErrorString(error)}`,
            severity: 'error',
          });
        },
      });
    } catch {
      // Surfaced by onError above; caught so the rejection isn't unhandled.
    }
  }, [createMutation, navigate, alertApi]);

  return {
    hideDatasource,
    setDatasourceEnabled,
    requestDeleteDatasource,
    deleteDatasourceId,
    deleteDatasourceText,
    confirmDeleteDatasource,
    cancelDeleteDatasource,
    addDatasourceOpen,
    openAddDatasource,
    cancelAddDatasource,
    createDatasource,
    creatingDatasource: createMutation.isPending,
  };
}
