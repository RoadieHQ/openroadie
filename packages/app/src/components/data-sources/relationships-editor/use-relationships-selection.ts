import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import {
  SUGGESTION_PARAM,
  useSuggestionDrawerStack,
} from './use-suggestion-drawer-stack';

/**
 * What the canvas currently has picked out: a focused node, an inspected data
 * source, a selected rule, a selected direct pair, a hovered suggestion, and
 * the suggestion under review.
 *
 * These used to be seven `useState`s plus two URL params, mutated independently
 * at ~60 call sites across a 2,700-line component. Nothing owned which
 * combinations were legal, so every handler hand-wrote its own "clear the
 * others" list — and they disagreed: `handlePaneClick` cleared the hover
 * highlight, `handleNodeClick` did not, so clicking a node left a stale ring on
 * a suggestion card.
 *
 * Two of them are now derived from the URL rather than mirrored into state
 * (`editingRule`, `reviewingSuggestion`), and the mutually exclusive rest are
 * one tagged value, so a double selection cannot be constructed. Callers see
 * only transitions, so the representation stays this file's business.
 */
export interface RelationshipsSelection {
  /** Node whose neighbours stay lit while everything else dims (Edit only). */
  focusedNodeId: string | null;
  /** Data source open in the read-only inspector. */
  readOnlyDataSourceId: string | null;
  /** Rule the canvas is pointing at. Dims every other edge. */
  selectedRuleId: string | null;
  /** Direct-relationship pair open in its inspector. */
  selectedDirectPairKey: string | null;
  /**
   * Suggestion to ring in the suggestions list — the hovered card, else the
   * selected rule when it is itself a suggestion. Derived, never stored: the
   * two used to be one `useState` written from both places, which is how it
   * went stale.
   */
  highlightedRuleId: string | null;
  /** Suggestion under review, derived from `?suggestion`. */
  reviewingSuggestion: RelationshipRule | null;

  /** Nothing selected: canvas click, or any action that closes everything. */
  clearSelection: () => void;
  /**
   * Canvas node click. `nodeId` is the prefixed graph node id, `dataSourceId`
   * the bare id — they are deliberately different keys, one for the focus dim
   * and one for the inspector. `withFocusDim` is Edit-mode only; re-clicking
   * the same node clears.
   */
  toggleDataSource: (
    nodeId: string,
    dataSourceId: string,
    withFocusDim: boolean,
  ) => void;
  /** Point the canvas at a rule without opening the review drawer. Closes
   *  both drawers — a user gesture that moves the selection moves the whole
   *  surface with it. */
  selectRule: (ruleId: string) => void;
  /**
   * Point the canvas at a rule WITHOUT touching the drawer params. For
   * background effects (the `?relFocus` deep link) rather than user gestures:
   * an effect re-run must never close a drawer over pending work — the URL
   * params belong to the drawers, and only gestures that run the leave guards
   * may clear them.
   */
  focusRule: (ruleId: string) => void;
  /** Point at a suggestion and open it for review. */
  selectSuggestion: (ruleId: string) => void;
  /** Select a direct-relationship aggregate edge. */
  selectDirectPair: (pairKey: string) => void;
  /** Hover a suggestion card. Null on mouse-out. */
  hoverRule: (ruleId: string | null) => void;
  /**
   * Drop `ruleId` from the selection if it is what's selected, leaving
   * everything else alone. For a rule that stopped being showable — an
   * endpoint was disabled, or a mode switch made it irrelevant — where
   * clearing outright would also close an unrelated inspector.
   */
  deselectRule: (ruleId: string) => void;
  /** Drop a direct-pair selection, e.g. when a new-rule drawer replaces it. */
  clearDirectPair: () => void;
  /** Stop dimming around a focused node, without closing any inspector. */
  clearNodeFocus: () => void;
  /** Close the data source inspector and its focus dim together. */
  clearDataSourceInspection: () => void;
  /** Close the review drawer, leaving the canvas selection alone. */
  closeReview: () => void;

  /**
   * Rule open in the editable drawer, derived from `?rule`. Never a suggestion
   * — those go to the review drawer instead.
   *
   * Derived, not stored. Mirroring it into state is what made the old
   * reconcile effect need three refs: React Router's URL write isn't batched
   * with a `setState`, so there was always a render where the two disagreed,
   * and each ref patched one way that disagreement reopened a drawer the user
   * had just closed.
   */
  editingRule: RelationshipRule | null;
  /** Open a rule in the editable drawer, and put it in the URL. */
  openRuleInEditor: (ruleId: string) => void;
  /** Close the editable drawer and drop `?rule`. */
  closeRuleEditor: () => void;
}

export const RULE_PARAM = 'rule';

/**
 * The one thing the canvas has picked out. `dataSource` carries two ids on
 * purpose: `nodeId` is the prefixed graph node (and null when Suggest mode
 * inspects without dimming), `dataSourceId` the bare id the inspector wants.
 */
type Picked =
  | { kind: 'none' }
  | { kind: 'dataSource'; nodeId: string | null; dataSourceId: string }
  | { kind: 'rule'; ruleId: string }
  | { kind: 'directPair'; pairKey: string };

export function useRelationshipsSelection(
  rulesById: Map<string, RelationshipRule>,
): RelationshipsSelection {
  // One slot. Every inspector shares the same drawer, so at most one of these
  // can be picked at a time — as five independent `useState`s that was a rule
  // nothing enforced, and handlers drifted out of agreement about it. A tagged
  // value makes "a rule AND a direct pair are both selected" unrepresentable
  // rather than merely unlikely.
  const [picked, setPicked] = useState<Picked>({ kind: 'none' });
  // Genuinely orthogonal: you can hover one card while another is selected.
  const [hoveredRuleId, setHoveredRuleId] = useState<string | null>(null);

  const { reviewingSuggestion, openSuggestion, closeSuggestion } =
    useSuggestionDrawerStack(rulesById);
  const [searchParams, setSearchParams] = useSearchParams();

  const ruleParam = searchParams.get(RULE_PARAM);
  const editingRule = useMemo(() => {
    const rule = ruleParam ? rulesById.get(ruleParam) : undefined;
    // A suggested rule in `?rule` belongs to the review drawer, not this one.
    return rule && rule.state !== 'suggested' ? rule : null;
  }, [ruleParam, rulesById]);

  // A deep link can open a drawer via `?rule` / `?suggestion` without going
  // through openRuleInEditor / selectSuggestion, leaving the canvas with
  // nothing picked — the edge isn't selected or dimmed the way an in-app open
  // is. Sync once, when a drawer param first resolves against loaded rules;
  // from then on the params and the selection move together through the
  // handlers (and closing a drawer deliberately leaves the selection alone,
  // so this must never re-fire).
  const syncedDrawerParamRef = useRef(false);
  const drawerRuleId = editingRule?.id ?? reviewingSuggestion?.id ?? null;
  useEffect(() => {
    if (syncedDrawerParamRef.current || !drawerRuleId) {
      return;
    }
    syncedDrawerParamRef.current = true;
    setPicked(prev =>
      prev.kind === 'none' ? { kind: 'rule', ruleId: drawerRuleId } : prev,
    );
  }, [drawerRuleId]);

  const setRuleParam = useCallback(
    (ruleId: string | null) => {
      // No-op without a navigation when already clear — a second updater in
      // the same tick builds from the same render's params, so a redundant
      // "delete rule" write would put back whatever another updater just
      // removed (the same-tick gotcha openRuleInEditor documents below).
      if (!ruleId && searchParams.get(RULE_PARAM) === null) {
        return;
      }
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (ruleId) {
            next.set(RULE_PARAM, ruleId);
          } else {
            next.delete(RULE_PARAM);
          }
          return next;
        },
        { replace: true },
      );
    },
    [searchParams, setSearchParams],
  );

  // Every transition that closes the review also closes the rule editor —
  // both live in URL params, and they must go in ONE write. Sequential
  // updaters in a tick (closeSuggestion, then closeRuleEditor) each build
  // from the same render's params, so the second write resurrects the param
  // the first removed and the drawer reopens behind the user's back.
  const clearDrawerParams = useCallback(() => {
    if (
      searchParams.get(RULE_PARAM) === null &&
      searchParams.get(SUGGESTION_PARAM) === null
    ) {
      return;
    }
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete(RULE_PARAM);
        next.delete(SUGGESTION_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  const focusedNodeId = picked.kind === 'dataSource' ? picked.nodeId : null;
  const readOnlyDataSourceId =
    picked.kind === 'dataSource' ? picked.dataSourceId : null;
  const selectedRuleId = picked.kind === 'rule' ? picked.ruleId : null;
  const selectedDirectPairKey =
    picked.kind === 'directPair' ? picked.pairKey : null;

  const highlightedRuleId = useMemo(() => {
    if (hoveredRuleId) {
      return hoveredRuleId;
    }
    const selected = selectedRuleId ? rulesById.get(selectedRuleId) : undefined;
    return selected?.state === 'suggested' ? selected.id : null;
  }, [hoveredRuleId, selectedRuleId, rulesById]);

  const clearSelection = useCallback(() => {
    setPicked({ kind: 'none' });
    setHoveredRuleId(null);
    clearDrawerParams();
  }, [clearDrawerParams]);

  const toggleDataSource = useCallback(
    (nodeId: string, dataSourceId: string, withFocusDim: boolean) => {
      setPicked(prev =>
        prev.kind === 'dataSource' && prev.dataSourceId === dataSourceId
          ? { kind: 'none' }
          : {
              kind: 'dataSource',
              dataSourceId,
              nodeId: withFocusDim ? nodeId : null,
            },
      );
      setHoveredRuleId(null);
      clearDrawerParams();
    },
    [clearDrawerParams],
  );

  const selectRule = useCallback(
    (ruleId: string) => {
      setPicked({ kind: 'rule', ruleId });
      clearDrawerParams();
    },
    [clearDrawerParams],
  );

  const focusRule = useCallback((ruleId: string) => {
    setPicked({ kind: 'rule', ruleId });
  }, []);

  const selectSuggestion = useCallback(
    (ruleId: string) => {
      setPicked({ kind: 'rule', ruleId });
      openSuggestion(ruleId);
    },
    [openSuggestion],
  );

  const selectDirectPair = useCallback(
    (pairKey: string) => {
      setPicked({ kind: 'directPair', pairKey });
      setHoveredRuleId(null);
      clearDrawerParams();
    },
    [clearDrawerParams],
  );

  const hoverRule = useCallback((ruleId: string | null) => {
    setHoveredRuleId(ruleId);
  }, []);

  const deselectRule = useCallback((ruleId: string) => {
    setPicked(prev =>
      prev.kind === 'rule' && prev.ruleId === ruleId ? { kind: 'none' } : prev,
    );
  }, []);

  const clearDirectPair = useCallback(() => {
    setPicked(prev => (prev.kind === 'directPair' ? { kind: 'none' } : prev));
  }, []);

  const clearNodeFocus = useCallback(() => {
    setPicked(prev =>
      prev.kind === 'dataSource' ? { ...prev, nodeId: null } : prev,
    );
  }, []);

  const openRuleInEditor = useCallback(
    (ruleId: string) => {
      setPicked({ kind: 'rule', ruleId });
      // Both params move in ONE write. Calling closeSuggestion() and then
      // setRuleParam() would be two updaters in a tick, each building from the
      // same render's params — the second silently drops the first's edit.
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          next.set(RULE_PARAM, ruleId);
          next.delete(SUGGESTION_PARAM);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const closeRuleEditor = useCallback(() => {
    // Dropping the param IS closing the drawer — there is no state left over
    // to disagree with it, so nothing can reopen behind the user's back.
    setRuleParam(null);
  }, [setRuleParam]);

  const clearDataSourceInspection = useCallback(() => {
    setPicked(prev => (prev.kind === 'dataSource' ? { kind: 'none' } : prev));
  }, []);

  return {
    focusedNodeId,
    readOnlyDataSourceId,
    selectedRuleId,
    selectedDirectPairKey,
    highlightedRuleId,
    reviewingSuggestion,
    clearSelection,
    toggleDataSource,
    selectRule,
    focusRule,
    selectSuggestion,
    selectDirectPair,
    hoverRule,
    deselectRule,
    clearDirectPair,
    clearNodeFocus,
    clearDataSourceInspection,
    closeReview: closeSuggestion,
    editingRule,
    openRuleInEditor,
    closeRuleEditor,
  };
}
