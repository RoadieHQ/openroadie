import { useCallback, useState } from 'react';
import { useRelationshipRuleTransitions } from './use-relationship-rule-transitions';

export interface SuggestionReviewState {
  /** Approve `ruleId`. The backend suppresses the mirrored A→B / B→A
   *  suggestion itself (`reviewReason: 'inverse-suppressed'`) — arbitration is
   *  server-side so app/MCP/CLI agree. `rankShown` is the row's 0-based
   *  position in the list the reviewer saw, recorded on the verdict. Rejects
   *  after toasting on failure. */
  approveSuggestion: (ruleId: string, rankShown?: number) => Promise<void>;
  /** Dismiss marks the rule inactive (`reviewReason: 'manual-dismiss'`) rather
   *  than deleting it, so a later Generate run won't re-propose it; `reset` is
   *  the undo. `rankShown` is recorded on the verdict. Rejects after toasting
   *  on failure. */
  dismissSuggestion: (ruleId: string, rankShown?: number) => Promise<void>;
  /** Rules with an approve/dismiss in flight, so their rows can show busy. */
  pendingRuleIds: ReadonlySet<string>;
}

/**
 * The one home for reviewing a suggestion: approve and dismiss, with per-rule
 * pending state. Every review surface — panel cards, edge toolbar, review
 * editor — routes through this hook.
 *
 * Mirrored-pair arbitration is deliberately NOT done here: the backend does it
 * on approve, so the app, MCP and CLI all behave identically.
 */
export function useSuggestionReview({
  onAfterMutation,
}: {
  /** Forwarded verbatim to the underlying transitions hook — e.g. the graph
   *  view's layout-save, so approving/dismissing an edge persists layout. */
  onAfterMutation?: () => void | Promise<void>;
} = {}): SuggestionReviewState {
  const { transitionRule } = useRelationshipRuleTransitions({
    onAfterMutation,
  });
  const [pendingRuleIds, setPendingRuleIds] = useState<Set<string>>(new Set());

  const track = useCallback(async (ids: string[], run: () => Promise<void>) => {
    setPendingRuleIds(prev => new Set([...prev, ...ids]));
    try {
      await run();
    } finally {
      setPendingRuleIds(prev => {
        const next = new Set(prev);
        for (const id of ids) {
          next.delete(id);
        }
        return next;
      });
    }
  }, []);

  const approveSuggestion = useCallback(
    (ruleId: string, rankShown?: number) =>
      track([ruleId], () => transitionRule(ruleId, 'approve', { rankShown })),
    [transitionRule, track],
  );

  const dismissSuggestion = useCallback(
    (ruleId: string, rankShown?: number) =>
      track([ruleId], () => transitionRule(ruleId, 'dismiss', { rankShown })),
    [transitionRule, track],
  );

  return { approveSuggestion, dismissSuggestion, pendingRuleIds };
}
