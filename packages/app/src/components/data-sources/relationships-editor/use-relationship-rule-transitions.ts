import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAlert, useDatastore } from '../../../api';
import { queryKeys } from '../../../api/queries';
import {
  getWorkspaceScopeKey,
  workspaceQueryKeyInScope,
} from '../../../api/workspace-scope';
import { useInvalidatingMutation } from '../../../api/query-hooks';
import { formatErrorString } from '../../../api/workflow/parse-execution-error';
import { pluralS } from './suggested-rules-utils';

interface UseRelationshipRuleTransitionsOptions {
  /** Invoked once after each successful approve/dismiss, or once after bulk completes. */
  onAfterMutation?: () => void | Promise<void>;
}

/**
 * Single-rule approve uses the single route so the reviewer's `rankShown`
 * reaches the verdict; bulk approve uses the bulk route (no per-row rank).
 * Either way the backend arbitrates mirrored suggestions. Dismiss marks the
 * rule inactive (`reviewReason: 'manual-dismiss'`); a later Generate run will
 * not re-propose it, and `reset` is the undo.
 */
export function useRelationshipRuleTransitions({
  onAfterMutation,
}: UseRelationshipRuleTransitionsOptions = {}) {
  const datastoreApi = useDatastore();
  const alertApi = useAlert();
  const queryClient = useQueryClient();

  const transitionMutation = useInvalidatingMutation({
    mutationFn: async ({
      ruleId,
      action,
      rankShown,
    }: {
      ruleId: string;
      action: 'approve' | 'dismiss';
      rankShown?: number;
    }) => {
      if (action === 'approve') {
        // Single-rule approve goes through the single route so the reviewer's
        // rankShown reaches the verdict; that route still suppresses the
        // mirror server-side and 409s on an already-actioned rule (thrown +
        // toasted below). The bulk route (transitionMany) has no per-row rank.
        await datastoreApi.approveRelationshipRule(ruleId, { rankShown });
      } else {
        await datastoreApi.dismissRelationshipRule(ruleId, { rankShown });
      }
    },
    invalidates: [
      queryKeys.relationshipRules,
      queryKeys.dataSourceDetailsPrefix,
    ],
  });
  const { mutateAsync: mutateTransition } = transitionMutation;

  // Callers `await` this and rely on it rejecting so they can conditionally
  // sequence a follow-up transition; `mutateAsync` is wrapped to keep that
  // contract while React Query owns the cache invalidation.
  const transitionRule = useCallback(
    async (
      ruleId: string,
      action: 'approve' | 'dismiss',
      options?: { rankShown?: number },
    ) => {
      const workspaceScopeKey = getWorkspaceScopeKey();
      try {
        await mutateTransition({
          ruleId,
          action,
          rankShown: options?.rankShown,
        });
        if (getWorkspaceScopeKey() === workspaceScopeKey) {
          await onAfterMutation?.();
        }
      } catch (error) {
        alertApi.post({
          message: `Failed to ${action} rule: ${formatErrorString(error)}`,
          severity: 'error',
        });
        throw error;
      }
    },
    [mutateTransition, alertApi, onAfterMutation],
  );

  const transitionMany = useCallback(
    async (ruleIds: string[], action: 'approve' | 'dismiss') => {
      const workspaceScopeKey = getWorkspaceScopeKey();
      // A bulk action covers a whole set of rows at once, so there's no single
      // displayed position — no rankShown for the batch.
      let failedCount = 0;
      let dismissedAsInverseCount = 0;
      let inverseDismissFailedCount = 0;
      if (action === 'approve') {
        const result = await datastoreApi.approveRelationshipRules(ruleIds);
        // `failed` carries requested ids only, so this counts what the user
        // asked for — a mirror the backend could not suppress is reported
        // separately and must not read as a failed approve.
        failedCount = result.failed.length;
        dismissedAsInverseCount = result.dismissedAsInverse.length;
        inverseDismissFailedCount = result.inverseDismissFailed?.length ?? 0;
      } else {
        // Dismiss has no bulk route; partial failure still needs a tally.
        const results = await Promise.allSettled(
          ruleIds.map(ruleId => datastoreApi.dismissRelationshipRule(ruleId)),
        );
        failedCount = results.filter(
          result => result.status === 'rejected',
        ).length;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeyInScope(
            queryKeys.relationshipRules,
            workspaceScopeKey,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeyInScope(
            queryKeys.dataSourceDetailsPrefix,
            workspaceScopeKey,
          ),
        }),
      ]);
      if (getWorkspaceScopeKey() === workspaceScopeKey) {
        await onAfterMutation?.();
      }
      if (dismissedAsInverseCount > 0) {
        // Those rows vanish from the list without the user having actioned
        // them; say why rather than letting them look like a glitch.
        alertApi.post({
          message: `Dismissed ${dismissedAsInverseCount} mirrored suggestion${pluralS(
            dismissedAsInverseCount,
          )} because the opposite direction was approved`,
          severity: 'info',
        });
      }
      if (inverseDismissFailedCount > 0) {
        // Not a failed approve — those rules are still suggested and will keep
        // showing up in the list, so say why rather than letting them look like
        // suggestions the approve missed.
        alertApi.post({
          message: `${inverseDismissFailedCount} mirrored suggestion${pluralS(
            inverseDismissFailedCount,
          )} could not be dismissed and ${
            inverseDismissFailedCount === 1 ? 'remains' : 'remain'
          } in the list`,
          severity: 'warning',
        });
      }
      if (failedCount > 0) {
        alertApi.post({
          message: `Failed to ${action} ${failedCount} relationship rule${pluralS(
            failedCount,
          )}`,
          severity: 'error',
        });
      }
    },
    [datastoreApi, alertApi, onAfterMutation, queryClient],
  );

  return { transitionRule, transitionMany };
}
