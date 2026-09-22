import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAlert, useDatastore } from '../../../api';
import { directRelationshipsQuery, queryKeys } from '../../../api/queries';
import { syncContextGroupsAfterEdgeWrite } from '../../../api/context-group-sync';
import {
  getWorkspaceScopeKey,
  workspaceQueryKeyInScope,
} from '../../../api/workspace-scope';
import type { Relationship } from '../../../api/datastore/datastore-client';

/** A direct edge as shown in the preview: a persisted manual edge, a buffered
 *  addition, or a persisted edge buffered for removal. Nothing is written until
 *  the rule is saved ({@link DirectRelationshipsState.flush}). */
export interface DirectEdgeDraft {
  /** Stable identity: the relationship id for a persisted/removed edge, or a
   *  synthesized `add|src|tgt` key for a buffered addition. */
  key: string;
  targetObjectId: string;
  status: 'persisted' | 'added' | 'removed';
}

export interface UseDirectRelationshipsOptions {
  sourceDatasourceId: string;
  targetDatasourceId: string;
  relationshipType: string;
  reciprocalRelationshipType?: string;
  /**
   * The saved rule's relationship type at session start (undefined for a new
   * rule). Seeds the fetch anchor so the layer survives a mid-session type
   * edit; on flush, kept edges are re-typed under the editor type and the
   * anchor advances so a stay-open retry (existing rules) still sees them.
   */
  persistedRelationshipType?: string;
  /**
   * Identity of the current editing session (the rule id, or a new-rule slot
   * keyed on the datasource pair) — `null` while the editor is closed.
   */
  resetKey: string | null;
}

export interface DirectRelationshipsState {
  /** Merged draft view (persisted ± buffered), keyed by source object. */
  directBySourceObjectId: Map<string, DirectEdgeDraft[]>;
  loading: boolean;
  hasPendingChanges: boolean;
  /** Edges whose retype failed on the last flush. Unlike plain buffered edits
   *  these represent a half-applied SAVE (the rule already carries the new
   *  type), so closing the editor while any remain detaches them from the
   *  rule — the editor warns before discarding. */
  pendingRetypeCount: number;
  /** Buffer a new direct edge. No-op for a pair already linked; restores a
   *  pair that was buffered for removal. */
  addDirect: (sourceObjectId: string, targetObjectId: string) => void;
  /** Buffer removal of a persisted edge. */
  markRemoval: (relationshipId: string) => void;
  /** Undo a buffered addition or removal by its draft key. */
  undoDirect: (key: string) => void;
  /** Write the buffered additions/removals. Called by the rule save; stamps
   *  `createdFromRuleId` provenance when a rule id is available. Failed ops
   *  stay in the buffer so the caller can keep the editor open for retry. */
  flush: (ruleId: string | null) => Promise<{ failed: number }>;
  flushing: boolean;
}

interface PendingAddition {
  key: string;
  sourceObjectId: string;
  targetObjectId: string;
}

const additionKey = (sourceObjectId: string, targetObjectId: string) =>
  `add|${sourceObjectId}|${targetObjectId}`;

/**
 * The direct-relationship layer under a relationship rule: the manually created
 * edges between the rule's two datasources that share its relationship type.
 * Lets the rule editor resolve preview rows the rule can't match (e.g. a GitHub
 * and a Shortcut user with different emails) by linking them directly.
 *
 * Edits are buffered locally and only written when the rule is saved, so the
 * editor stays atomic — closing without saving discards them, matching the rest
 * of the editor. The written edges have no `ruleId`, so rule re-applies never
 * touch them.
 */
export function useDirectRelationships({
  sourceDatasourceId,
  targetDatasourceId,
  relationshipType,
  reciprocalRelationshipType,
  persistedRelationshipType,
  resetKey,
}: UseDirectRelationshipsOptions): DirectRelationshipsState {
  const api = useDatastore();
  const alertApi = useAlert();
  const queryClient = useQueryClient();

  const [pendingAdditions, setPendingAdditions] = useState<PendingAddition[]>(
    [],
  );
  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(
    () => new Set(),
  );
  // Session-local fetch anchor — seeded from the prop on session start, then
  // advanced after a type-changing flush. Owned here (not read continuously
  // from the prop) so a parent updating `existingRule` mid-save cannot flip
  // the query key before retypes run, and so a stay-open flush failure still
  // shows edges that already moved to the new type.
  const [fetchType, setFetchType] = useState(
    () => persistedRelationshipType?.trim() ?? '',
  );
  // Edges whose retype failed on the last flush. Kept visible after the fetch
  // anchor advances so a retry can finish moving them.
  const [pendingRetypes, setPendingRetypes] = useState<Relationship[]>([]);

  const type = relationshipType.trim();
  // Persisted edges live under the SAVED rule's type — fetching by the live
  // editor value would make the whole layer vanish the moment the user edits
  // the type. For a new rule there is no saved type, so the live value is it.
  const persistedType = fetchType || type;

  // Drop staged edits when the editing session changes. The inspector is
  // reused across rule/pair switches (props change, no remount), so without
  // this a buffer staged for one rule would flush against the next. A ref
  // guards against clearing on unrelated re-renders. A mid-session type edit
  // deliberately does NOT clear the buffer: additions are object pairs (the
  // type is applied at flush) and removals reference persisted-type edge ids
  // that remain valid until flushed. The prop seed is read via a ref so a
  // parent refreshing `existingRule` after save cannot re-seed (or clear
  // pending retypes) mid-session.
  const persistedTypeSeedRef = useRef(persistedRelationshipType);
  persistedTypeSeedRef.current = persistedRelationshipType;
  const bufferScopeRef = useRef<{
    resetKey: string | null;
  } | null>(null);
  useEffect(() => {
    const prev = bufferScopeRef.current;
    if (prev && prev.resetKey === resetKey) {
      return;
    }
    bufferScopeRef.current = { resetKey };
    setPendingAdditions([]);
    setPendingRemovals(new Set());
    setPendingRetypes([]);
    setFetchType(persistedTypeSeedRef.current?.trim() ?? '');
  }, [resetKey]);

  const enabled =
    !!persistedType && !!sourceDatasourceId && !!targetDatasourceId;

  const relationshipsQuery = useQuery({
    ...directRelationshipsQuery(api, persistedType),
    enabled,
  });

  // Persisted edges of this type between the pair, keyed by source object.
  const persistedBySource = useMemo(() => {
    const map = new Map<string, Relationship[]>();
    for (const edge of relationshipsQuery.data?.items ?? []) {
      if (
        edge.sourceDatasourceId !== sourceDatasourceId ||
        edge.destinationDatasourceId !== targetDatasourceId
      ) {
        continue;
      }
      const list = map.get(edge.sourceObjectId) ?? [];
      list.push(edge);
      map.set(edge.sourceObjectId, list);
    }
    return map;
  }, [relationshipsQuery.data, sourceDatasourceId, targetDatasourceId]);

  const persistedById = useMemo(() => {
    const map = new Map<string, Relationship>();
    for (const edges of persistedBySource.values()) {
      for (const edge of edges) {
        map.set(edge.id, edge);
      }
    }
    return map;
  }, [persistedBySource]);

  const directBySourceObjectId = useMemo(() => {
    const map = new Map<string, DirectEdgeDraft[]>();
    for (const [source, edges] of persistedBySource) {
      map.set(
        source,
        edges.map(edge => ({
          key: edge.id,
          targetObjectId: edge.destinationObjectId,
          status: pendingRemovals.has(edge.id)
            ? ('removed' as const)
            : ('persisted' as const),
        })),
      );
    }
    // Failed retypes still live under the pre-flush type; keep them listed
    // after the fetch anchor advances so the playground does not go blank.
    for (const edge of pendingRetypes) {
      if (map.get(edge.sourceObjectId)?.some(d => d.key === edge.id)) {
        continue;
      }
      const list = map.get(edge.sourceObjectId) ?? [];
      list.push({
        key: edge.id,
        targetObjectId: edge.destinationObjectId,
        status: pendingRemovals.has(edge.id)
          ? ('removed' as const)
          : ('persisted' as const),
      });
      map.set(edge.sourceObjectId, list);
    }
    for (const add of pendingAdditions) {
      const list = map.get(add.sourceObjectId) ?? [];
      list.push({
        key: add.key,
        targetObjectId: add.targetObjectId,
        status: 'added',
      });
      map.set(add.sourceObjectId, list);
    }
    return map;
  }, [persistedBySource, pendingAdditions, pendingRemovals, pendingRetypes]);

  // Until the first fetch settles, persistedBySource is empty — linking then
  // would buffer a duplicate of a pair that already exists server-side.
  const relationshipsReady = !enabled || relationshipsQuery.isFetched;

  const addDirect = useCallback(
    (source: string, target: string) => {
      if (!relationshipsReady) {
        return;
      }
      const key = additionKey(source, target);
      // Already buffered as an addition — nothing to do.
      if (pendingAdditions.some(a => a.key === key)) {
        return;
      }
      const persistedMatch =
        (persistedBySource.get(source) ?? []).find(
          e => e.destinationObjectId === target,
        ) ??
        pendingRetypes.find(
          e => e.sourceObjectId === source && e.destinationObjectId === target,
        );
      if (persistedMatch) {
        // The pair exists; if it was buffered for removal, re-linking just
        // cancels that removal rather than creating a duplicate.
        if (pendingRemovals.has(persistedMatch.id)) {
          setPendingRemovals(prev => {
            const next = new Set(prev);
            next.delete(persistedMatch.id);
            return next;
          });
        }
        return;
      }
      setPendingAdditions(prev => [
        ...prev,
        { key, sourceObjectId: source, targetObjectId: target },
      ]);
    },
    [
      relationshipsReady,
      pendingAdditions,
      pendingRemovals,
      pendingRetypes,
      persistedBySource,
    ],
  );

  const markRemoval = useCallback((relationshipId: string) => {
    setPendingRemovals(prev => {
      if (prev.has(relationshipId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(relationshipId);
      return next;
    });
  }, []);

  const undoDirect = useCallback((key: string) => {
    // A buffered addition's key is the synthesized `add|…`; anything else is a
    // persisted edge id buffered for removal.
    if (key.startsWith('add|')) {
      setPendingAdditions(prev => prev.filter(a => a.key !== key));
      return;
    }
    setPendingRemovals(prev => {
      if (!prev.has(key)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  // Persisted edges still live under the old type after a mid-session type
  // edit — recreate them under the new type and drop the old rows, so the
  // layer follows the rule instead of being orphaned. Also retries edges
  // whose previous retype failed (held in `pendingRetypes` after the fetch
  // anchor advanced). Computed outside the mutation so a no-op flush can
  // skip it entirely (below).
  const retypes = useMemo(() => {
    // A union, not either/or: after a failed retype the anchor has advanced,
    // so a further type edit leaves edges under the anchor AND the failed
    // retries under the older type — a retry must move both, or the anchor
    // edges are orphaned when the anchor advances past them.
    const fromAnchor =
      type && type !== persistedType ? [...persistedById.values()] : [];
    const anchorIds = new Set(fromAnchor.map(e => e.id));
    return [
      ...fromAnchor,
      ...pendingRetypes.filter(e => !anchorIds.has(e.id)),
    ].filter(e => !pendingRemovals.has(e.id));
  }, [type, persistedType, persistedById, pendingRemovals, pendingRetypes]);

  // The buffered writes as a mutation: `isPending` is the busy flag, the
  // buffer/cache bookkeeping lives in `onSuccess`. `mutateAsync` awaits
  // `onSuccess`, so callers still observe settled invalidation before closing.
  const flushMutation = useMutation({
    mutationFn: async (ruleId: string | null) => {
      const workspaceScopeKey = getWorkspaceScopeKey();
      const additions = pendingAdditions;
      const removalIds = [...pendingRemovals];
      const reciprocal = reciprocalRelationshipType?.trim();
      // Capture for onSuccess: the live editor type becomes the new fetch
      // anchor once retypes settle (including when none were needed).
      const flushType = type;
      const priorFetchType = persistedType;

      const addResults = await Promise.allSettled(
        additions.map(async a => {
          const created = await api.createRelationship({
            sourceDatasourceId,
            sourceObjectId: a.sourceObjectId,
            destinationDatasourceId: targetDatasourceId,
            destinationObjectId: a.targetObjectId,
            relationshipType: type,
            origin: 'manual',
            ...(reciprocal ? { reciprocalRelationshipType: reciprocal } : {}),
            ...(ruleId ? { metadata: { createdFromRuleId: ruleId } } : {}),
          });
          // createRelationship is an upsert: a collision with a
          // rule-materialized edge for the same tuple merges into it (its
          // ruleId survives), so no DIRECT edge exists afterwards. The layer
          // only fetches direct edges, so reporting this as a plain success
          // would make the row silently vanish on refetch — surface it.
          return created?.ruleId ? ('conflicted' as const) : ('added' as const);
        }),
      );
      const removeResults = await Promise.allSettled(
        removalIds.map(id => api.deleteRelationship(id)),
      );
      // Retypes whose replacement landed but whose old-row delete failed: the
      // op stays failed (the edge is kept pending for retry — the create is an
      // upsert, so retrying is safe), but caches must still refresh, because
      // the new-type row now exists server-side.
      const partialRetypes: Relationship[] = [];
      const retypeResults = await Promise.allSettled(
        retypes.map(async edge => {
          // Setting the type back to the edge's own type (e.g. retrying a
          // failed retype after undoing the type edit): the row is already
          // right, and the create-then-delete dance below would upsert onto
          // the SAME row and then delete it — permanently losing the edge.
          if (edge.relationshipType === type) {
            return 'noop' as const;
          }
          const created = await api.createRelationship({
            sourceDatasourceId: edge.sourceDatasourceId,
            sourceObjectId: edge.sourceObjectId,
            destinationDatasourceId: edge.destinationDatasourceId,
            destinationObjectId: edge.destinationObjectId,
            relationshipType: type,
            origin: 'manual',
            ...(reciprocal ? { reciprocalRelationshipType: reciprocal } : {}),
            ...(edge.metadata || ruleId
              ? {
                  metadata: {
                    ...(edge.metadata ?? {}),
                    ...(ruleId ? { createdFromRuleId: ruleId } : {}),
                  },
                }
              : {}),
          });
          // Same upsert hazard as additions: colliding with a
          // rule-materialized edge of the new type keeps its ruleId. Deleting
          // the old row would silently absorb the manual edge into the rule
          // (whose re-apply/delete then owns it) — keep the old row and
          // report the retype as failed instead.
          if (created?.ruleId) {
            throw new Error(
              'conflicts with a relationship materialized by a rule',
            );
          }
          // Delete only after the replacement landed — a failed create keeps
          // the old-type edge instead of silently dropping it.
          try {
            await api.deleteRelationship(edge.id);
          } catch (e: unknown) {
            partialRetypes.push(edge);
            throw e;
          }
          return 'moved' as const;
        }),
      );

      const failedAdditions = additions.filter(
        (_, i) => addResults.at(i)?.status === 'rejected',
      );
      const failedRemovalIds = new Set(
        removalIds.filter((_, i) => removeResults.at(i)?.status === 'rejected'),
      );
      // Conflicted adds merged into a rule-materialized edge: not retryable
      // (the upsert would keep colliding), so they leave the buffer — but no
      // direct edge was created, which the caller reports separately.
      const conflictedAdds = addResults.filter(
        r => r.status === 'fulfilled' && r.value === 'conflicted',
      ).length;
      const addedOk = addResults.filter(
        r => r.status === 'fulfilled' && r.value === 'added',
      ).length;
      const removedOk = removalIds.length - failedRemovalIds.size;
      // No-op retypes (the edge already carries the type) are excluded: they
      // clear from the pending buffer but were not "moved".
      const retypedOk = retypeResults.filter(
        r => r.status === 'fulfilled' && r.value === 'moved',
      ).length;
      const failedRetypeEdges = retypes.filter(
        (_, i) => retypeResults.at(i)?.status === 'rejected',
      );
      const failedRetypes = failedRetypeEdges.length;
      const failed =
        failedAdditions.length + failedRemovalIds.size + failedRetypes;

      // Invalidate only for ops that actually landed. Alongside the touched
      // objects, keep each landed edge's source datasource — enough to find
      // every context rule the edge can affect (a rule can only merge on an
      // edge whose two datasources are both in the rule).
      const touched = new Map<string, { ds: string; obj: string }>();
      const syncDatasourceIds = new Set<string>();
      const touch = (ds: string, obj: string) =>
        touched.set(`${ds}\0${obj}`, { ds, obj });
      for (const [i, a] of additions.entries()) {
        const r = addResults.at(i);
        if (r?.status !== 'fulfilled' || r.value !== 'added') continue;
        touch(sourceDatasourceId, a.sourceObjectId);
        touch(targetDatasourceId, a.targetObjectId);
        syncDatasourceIds.add(sourceDatasourceId);
      }
      for (const [i, id] of removalIds.entries()) {
        if (removeResults.at(i)?.status !== 'fulfilled') continue;
        const e =
          persistedById.get(id) ?? pendingRetypes.find(r => r.id === id);
        if (!e) continue;
        touch(e.sourceDatasourceId, e.sourceObjectId);
        touch(e.destinationDatasourceId, e.destinationObjectId);
        syncDatasourceIds.add(e.sourceDatasourceId);
      }
      for (const [i, edge] of retypes.entries()) {
        const r = retypeResults.at(i);
        if (r?.status !== 'fulfilled' || r.value !== 'moved') continue;
        touch(edge.sourceDatasourceId, edge.sourceObjectId);
        touch(edge.destinationDatasourceId, edge.destinationObjectId);
        syncDatasourceIds.add(edge.sourceDatasourceId);
      }
      // Partial retypes wrote the new-type row even though the op failed.
      for (const edge of partialRetypes) {
        touch(edge.sourceDatasourceId, edge.sourceObjectId);
        touch(edge.destinationDatasourceId, edge.destinationObjectId);
        syncDatasourceIds.add(edge.sourceDatasourceId);
      }

      return {
        failed,
        addedOk,
        conflictedAdds,
        removedOk,
        retypedOk,
        retypedPartial: partialRetypes.length,
        failedAdditions,
        failedRemovalIds,
        failedRetypeEdges,
        flushType,
        priorFetchType,
        touched,
        syncDatasourceIds,
        workspaceScopeKey,
      };
    },
    onSuccess: async outcome => {
      const {
        addedOk,
        removedOk,
        retypedOk,
        retypedPartial,
        touched,
        flushType,
        priorFetchType,
        failedRetypeEdges,
      } = outcome;
      // Keep failed ops in the buffer so the editor can stay open for retry.
      setPendingAdditions(outcome.failedAdditions);
      setPendingRemovals(outcome.failedRemovalIds);
      setPendingRetypes(failedRetypeEdges);
      // Advance the fetch anchor to the type edges now live under, even when
      // some retypes failed (those stay listed via pendingRetypes) or when
      // only additions/removals ran after a type-changing rule save.
      if (flushType && flushType !== priorFetchType) {
        setFetchType(flushType);
      }

      if (addedOk > 0 || removedOk > 0 || retypedOk > 0 || retypedPartial > 0) {
        await Promise.all([
          syncContextGroupsAfterEdgeWrite(
            queryClient,
            api,
            outcome.syncDatasourceIds,
            outcome.workspaceScopeKey,
          ),
          queryClient.invalidateQueries({
            queryKey: workspaceQueryKeyInScope(
              queryKeys.directRelationshipsPrefix,
              outcome.workspaceScopeKey,
            ),
          }),
          ...[...touched.values()].map(({ ds, obj }) =>
            queryClient.invalidateQueries({
              queryKey: workspaceQueryKeyInScope(
                queryKeys.objectDetail(ds, obj),
                outcome.workspaceScopeKey,
              ),
            }),
          ),
        ]);
      }
    },
  });
  const { mutateAsync: runFlush } = flushMutation;

  const flush = useCallback(
    async (ruleId: string | null): Promise<{ failed: number }> => {
      // Skip the mutation entirely when there is nothing to write —
      // `mutateAsync` flips `isPending` before the mutationFn runs, so even an
      // early-returning no-op would flash the busy flag on every plain save.
      if (
        pendingAdditions.length === 0 &&
        pendingRemovals.size === 0 &&
        retypes.length === 0
      ) {
        return { failed: 0 };
      }
      const outcome = await runFlush(ruleId);
      // The toasts live here (not in onSuccess) so the mutation keeps only
      // cache/buffer bookkeeping and the UI side-effect stays at the call site.
      if (outcome.failed > 0) {
        alertApi.post({
          message: `${outcome.failed} direct relationship${
            outcome.failed === 1 ? '' : 's'
          } failed to save.`,
          severity: 'error',
        });
      } else {
        const parts: string[] = [];
        if (outcome.addedOk > 0) parts.push(`${outcome.addedOk} added`);
        if (outcome.removedOk > 0) parts.push(`${outcome.removedOk} removed`);
        if (outcome.retypedOk > 0) {
          parts.push(`${outcome.retypedOk} moved to "${type}"`);
        }
        // No-op retypes and conflicted adds contribute no part — a flush that
        // was ONLY those posts no success toast (nothing actually changed).
        if (parts.length > 0) {
          alertApi.post({
            message: `Direct relationships: ${parts.join(', ')}.`,
            severity: 'success',
          });
        }
      }
      if (outcome.conflictedAdds > 0) {
        alertApi.post({
          message: `${outcome.conflictedAdds} direct relationship${
            outcome.conflictedAdds === 1 ? '' : 's'
          } not created — a relationship rule already links ${
            outcome.conflictedAdds === 1 ? 'that pair' : 'those pairs'
          } with this type.`,
          severity: 'warning',
        });
      }
      return { failed: outcome.failed };
    },
    [pendingAdditions, pendingRemovals, retypes, runFlush, alertApi, type],
  );

  return {
    directBySourceObjectId,
    loading: enabled && !relationshipsReady,
    hasPendingChanges:
      pendingAdditions.length > 0 ||
      pendingRemovals.size > 0 ||
      pendingRetypes.length > 0,
    pendingRetypeCount: pendingRetypes.length,
    addDirect,
    markRemoval,
    undoDirect,
    flush,
    flushing: flushMutation.isPending,
  };
}
