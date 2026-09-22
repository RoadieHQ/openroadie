import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';

export const SUGGESTION_PARAM = 'suggestion';

export interface UseSuggestionDrawerStackResult {
  reviewingSuggestion: RelationshipRule | null;
  openSuggestion: (ruleId: string) => void;
  closeSuggestion: () => void;
}

/**
 * Which suggestion the drawer is reviewing, held in `?suggestion=<id>`.
 *
 * The rule is DERIVED from the param on every render rather than mirrored into
 * state. That is the whole point of a separate param: edit mode's `?rule` needs
 * three refs to reconcile a URL against a `useState` that can lag it, and every
 * one of those guards exists to stop a drawer reopening after the user closed
 * it. With nothing stored there is nothing to reconcile.
 *
 * It also means an approve or dismiss needs no cleanup — the rule stops being
 * `suggested`, so this returns null and the drawer falls back to the list.
 */
export function useSuggestionDrawerStack(
  rulesById: Map<string, RelationshipRule>,
): UseSuggestionDrawerStackResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const suggestionParam = searchParams.get(SUGGESTION_PARAM);

  const reviewingSuggestion = useMemo(() => {
    const rule = suggestionParam ? rulesById.get(suggestionParam) : undefined;
    return rule?.state === 'suggested' ? rule : null;
  }, [suggestionParam, rulesById]);

  const openSuggestion = useCallback(
    (ruleId: string) => {
      // Already reviewing this rule: re-opening (a re-click on the reviewed
      // edge is deliberately allowed) must not stack another history entry,
      // or Back needs one press per re-click to leave the review.
      if (searchParams.get(SUGGESTION_PARAM) === ruleId) {
        return;
      }
      // Pushed, not replaced, so browser Back returns to the list.
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set(SUGGESTION_PARAM, ruleId);
        return next;
      });
    },
    [searchParams, setSearchParams],
  );

  const closeSuggestion = useCallback(() => {
    // Callers fire this from canvas clicks and mode effects where no suggestion
    // is open; without this the no-op would still be a router navigation.
    if (searchParams.get(SUGGESTION_PARAM) === null) {
      return;
    }
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete(SUGGESTION_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  return { reviewingSuggestion, openSuggestion, closeSuggestion };
}
