import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Edge } from '@xyflow/react';
import { useAlert, useDatastore } from '../../../api';
import type {
  DatastoreObjectWithRelationships,
  Relationship,
  RelationshipRule,
} from '../../../api/datastore/datastore-client';
import {
  allDirectRelationshipsQuery,
  objectDetailQuery,
  queryKeys,
} from '../../../api/queries';
import { syncContextGroupsAfterEdgeWrite } from '../../../api/context-group-sync';
import {
  getWorkspaceScopeKey,
  workspaceQueryKeyInScope,
} from '../../../api/workspace-scope';
import { buildDirectRelationshipEdges, directFoldKey } from './build-graph';
import { pluralS } from './suggested-rules-utils';
import {
  useConfirmationRequest,
  type ConfirmationRequest,
} from './use-confirmation-request';

export interface DirectFold {
  /** `src|dst|type` keys already represented by a rule edge. */
  foldedKeys: ReadonlySet<string>;
  /** How many direct edges fold into each rule's edge. */
  countByRuleId: ReadonlyMap<string, number>;
  /** The folded edges themselves, for the rule's inspector and its delete. */
  itemsByRuleId: ReadonlyMap<string, Relationship[]>;
}

/**
 * Work out which hand-made relationships are already said by a rule.
 *
 * A direct edge matching a rule's (source, target, type) describes the same
 * relationship the rule does, so drawing it separately would put a second
 * parallel line between the same two nodes. Instead it folds into that rule's
 * edge as a "+N direct" count.
 *
 * Only rules that actually draw can absorb one: a suggested rule isn't a
 * commitment yet, an inactive rule draws nothing, and a rule with an
 * off-canvas endpoint has no edge to fold into.
 */
export function computeDirectFold(
  graphRules: readonly RelationshipRule[],
  visibleDatasourceIds: ReadonlySet<string>,
  directRelationships: readonly Relationship[],
): DirectFold {
  const ruleIdByKey = new Map<string, string>();
  for (const rule of graphRules) {
    if (
      rule.state === 'inactive' ||
      rule.state === 'suggested' ||
      !visibleDatasourceIds.has(rule.sourceDatasourceId) ||
      !visibleDatasourceIds.has(rule.targetDatasourceId)
    ) {
      continue;
    }
    const key = directFoldKey({
      sourceDatasourceId: rule.sourceDatasourceId,
      destinationDatasourceId: rule.targetDatasourceId,
      relationshipType: rule.relationshipType,
    });
    // First rule wins: several rules can describe the same pair and type, and
    // the count has to land on one edge rather than be split across them.
    if (!ruleIdByKey.has(key)) {
      ruleIdByKey.set(key, rule.id);
    }
  }

  const countByRuleId = new Map<string, number>();
  const itemsByRuleId = new Map<string, Relationship[]>();
  for (const rel of directRelationships) {
    const ruleId = ruleIdByKey.get(directFoldKey(rel));
    if (!ruleId) {
      continue;
    }
    countByRuleId.set(ruleId, (countByRuleId.get(ruleId) ?? 0) + 1);
    const list = itemsByRuleId.get(ruleId) ?? [];
    list.push(rel);
    itemsByRuleId.set(ruleId, list);
  }

  return {
    foldedKeys: new Set(ruleIdByKey.keys()),
    countByRuleId,
    itemsByRuleId,
  };
}

export interface SelectedDirectPair {
  sourceDatasourceId: string;
  targetDatasourceId: string;
  items: Relationship[];
}

/**
 * The hand-made relationships behind a selected aggregate edge.
 *
 * Folded edges are excluded, because the aggregate's own count excludes them —
 * listing them here would disagree with the label the user just clicked, and
 * show a folded edge twice (once here, once under its rule).
 */
export function selectDirectPairItems(
  selectedPairKey: string | null,
  directRelationships: readonly Relationship[],
  foldedKeys: ReadonlySet<string>,
): SelectedDirectPair | null {
  if (!selectedPairKey) {
    return null;
  }
  const [sourceDatasourceId, targetDatasourceId] = selectedPairKey.split('|');
  return {
    sourceDatasourceId,
    targetDatasourceId,
    items: directRelationships.filter(
      rel =>
        rel.sourceDatasourceId === sourceDatasourceId &&
        rel.destinationDatasourceId === targetDatasourceId &&
        !foldedKeys.has(directFoldKey(rel)),
    ),
  };
}

interface DeleteRulePayload {
  ruleId: string;
  directEdges: Relationship[];
}

interface UseDirectRelationshipLayerOptions {
  graphRules: RelationshipRule[];
  datasourceIdSet: Set<string>;
  nodePositionMap: Map<string, { x: number; y: number }>;
  selectedDirectPairKey: string | null;
  focusedNodeId: string | null;
  selectedRuleId: string | null;
  /** Deletes the rule itself; this layer only handles its direct edges. */
  deleteRule: (ruleId: string) => Promise<void>;
}

interface UseDirectRelationshipLayerResult {
  fold: DirectFold;
  /** Dashed aggregate edges, one per pair not folded into a rule. */
  aggregateEdges: Edge[];
  selectedPair: SelectedDirectPair | null;
  /**
   * Delete a rule. A rule carrying folded direct edges asks first, offering to
   * take them with it; one without them deletes straight away. Resolves false
   * if the user cancels or the delete fails, so the caller (the rule drawer's
   * Delete, holding an in-flight latch) can tell the difference.
   */
  requestDeleteRule: (ruleId: string) => Promise<boolean>;
  /** The confirmation awaiting an answer, for the dialog. */
  deleteRequest: ConfirmationRequest<DeleteRulePayload> | null;
  confirmDelete: () => Promise<void>;
  cancelDelete: () => void;
  /** Whether the confirmation's opt-in checkbox is ticked. */
  deleteDirectToo: boolean;
  setDeleteDirectToo: (value: boolean) => void;
  /** A single direct edge open in the in-graph editor. */
  editingEdge: Relationship | null;
  setEditingEdge: (edge: Relationship | null) => void;
  /** Close the editor and refresh what its save touched. */
  onEditingEdgeSaved: (workspaceScopeKey: string) => Promise<void>;
  /** The editing edge's source object: header label and duplicate detection. */
  editingEdgeSource: DatastoreObjectWithRelationships | undefined;
}

/**
 * The hand-made ("direct") relationship layer of the graph.
 *
 * These have no rule, so the rule graph wouldn't show them at all. This owns
 * how they appear — folded into a matching rule's edge as a count, or drawn as
 * a dashed aggregate per data-source pair — plus the delete flow that has to
 * ask what happens to folded edges when their rule goes.
 */
export function useDirectRelationshipLayer({
  graphRules,
  datasourceIdSet,
  nodePositionMap,
  selectedDirectPairKey,
  focusedNodeId,
  selectedRuleId,
  deleteRule,
}: UseDirectRelationshipLayerOptions): UseDirectRelationshipLayerResult {
  const datastoreApi = useDatastore();
  const alertApi = useAlert();
  const queryClient = useQueryClient();

  const { data } = useQuery(allDirectRelationshipsQuery(datastoreApi));
  // Memoised: `?? []` would be a fresh array on every render while the query is
  // still loading, invalidating everything derived from it each time.
  const directRelationships = useMemo(() => data?.items ?? [], [data]);

  const [deleteDirectToo, setDeleteDirectToo] = useState(false);
  const [editingEdge, setEditingEdge] = useState<Relationship | null>(null);

  const {
    pending: deleteRequest,
    request: requestConfirmation,
    resolve: resolveConfirmation,
  } = useConfirmationRequest<DeleteRulePayload>();

  const fold = useMemo(
    () => computeDirectFold(graphRules, datasourceIdSet, directRelationships),
    [graphRules, datasourceIdSet, directRelationships],
  );

  const aggregateEdges = useMemo(
    () =>
      buildDirectRelationshipEdges(
        directRelationships,
        datasourceIdSet,
        focusedNodeId,
        nodePositionMap,
        selectedDirectPairKey,
        fold.foldedKeys,
        selectedRuleId,
      ),
    [
      directRelationships,
      datasourceIdSet,
      focusedNodeId,
      nodePositionMap,
      selectedDirectPairKey,
      fold.foldedKeys,
      selectedRuleId,
    ],
  );

  const selectedPair = useMemo(
    () =>
      selectDirectPairItems(
        selectedDirectPairKey,
        directRelationships,
        fold.foldedKeys,
      ),
    [selectedDirectPairKey, directRelationships, fold.foldedKeys],
  );

  const requestDeleteRule = useCallback(
    async (ruleId: string): Promise<boolean> => {
      const directEdges = fold.itemsByRuleId.get(ruleId) ?? [];
      if (directEdges.length === 0) {
        await deleteRule(ruleId);
        return true;
      }
      setDeleteDirectToo(false);
      return requestConfirmation({ ruleId, directEdges });
    },
    [fold.itemsByRuleId, deleteRule, requestConfirmation],
  );

  const deleteDirectEdges = useMutation({
    mutationFn: async (edges: Relationship[]) => {
      const workspaceScopeKey = getWorkspaceScopeKey();
      const results = await Promise.allSettled(
        edges.map(edge => datastoreApi.deleteRelationship(edge.id)),
      );
      const deleted = edges.filter(
        (_, i) => results.at(i)?.status === 'fulfilled',
      );
      return {
        failed: edges.length - deleted.length,
        deleted,
        workspaceScopeKey,
      };
    },
    onSuccess: ({ deleted, workspaceScopeKey }) => {
      // Object detail pages list these edges too, so refresh both endpoints of
      // every edge that actually deleted.
      const touched = new Map<string, { ds: string; obj: string }>();
      for (const edge of deleted) {
        touched.set(`${edge.sourceDatasourceId}\0${edge.sourceObjectId}`, {
          ds: edge.sourceDatasourceId,
          obj: edge.sourceObjectId,
        });
        touched.set(
          `${edge.destinationDatasourceId}\0${edge.destinationObjectId}`,
          { ds: edge.destinationDatasourceId, obj: edge.destinationObjectId },
        );
      }
      return Promise.all([
        syncContextGroupsAfterEdgeWrite(
          queryClient,
          datastoreApi,
          deleted.map(edge => edge.sourceDatasourceId),
          workspaceScopeKey,
        ),
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeyInScope(
            queryKeys.directRelationshipsPrefix,
            workspaceScopeKey,
          ),
        }),
        ...[...touched.values()].map(({ ds, obj }) =>
          queryClient.invalidateQueries({
            queryKey: workspaceQueryKeyInScope(
              queryKeys.objectDetail(ds, obj),
              workspaceScopeKey,
            ),
          }),
        ),
      ]);
    },
  });

  const confirmDelete = useCallback(async () => {
    const request = deleteRequest;
    if (!request) {
      return;
    }
    try {
      await deleteRule(request.payload.ruleId);
    } catch {
      // Toasted by deleteRule; the rule survives, so the awaiting caller must
      // not treat this as deleted.
      request.settle(false);
      return;
    }
    try {
      if (deleteDirectToo) {
        const { failed } = await deleteDirectEdges.mutateAsync(
          request.payload.directEdges,
        );
        if (failed > 0) {
          alertApi.post({
            message: `${failed} direct relationship${pluralS(failed)} failed to delete.`,
            severity: 'error',
          });
        }
      }
    } catch {
      alertApi.post({
        message: 'Failed to delete the direct relationships.',
        severity: 'error',
      });
    } finally {
      // The RULE went regardless of how the direct cleanup fared — always
      // settle, or the caller awaiting requestDeleteRule hangs forever.
      request.settle(true);
    }
  }, [deleteRequest, deleteDirectToo, deleteRule, deleteDirectEdges, alertApi]);

  const cancelDelete = useCallback(
    () => resolveConfirmation(false),
    [resolveConfirmation],
  );

  const onEditingEdgeSaved = useCallback(
    async (workspaceScopeKey: string) => {
      setEditingEdge(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeyInScope(
            queryKeys.directRelationshipsPrefix,
            workspaceScopeKey,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeyInScope(
            queryKeys.objectDetailPrefix,
            workspaceScopeKey,
          ),
        }),
      ]);
    },
    [queryClient],
  );

  const { data: editingEdgeSource } = useQuery({
    ...objectDetailQuery(
      datastoreApi,
      editingEdge?.sourceDatasourceId ?? '',
      editingEdge?.sourceObjectId ?? '',
    ),
    enabled: editingEdge !== null,
  });

  return {
    fold,
    aggregateEdges,
    selectedPair,
    requestDeleteRule,
    deleteRequest,
    confirmDelete,
    cancelDelete,
    deleteDirectToo,
    setDeleteDirectToo,
    editingEdge,
    setEditingEdge,
    onEditingEdgeSaved,
    editingEdgeSource,
  };
}
