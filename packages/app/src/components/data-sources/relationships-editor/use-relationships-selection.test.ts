import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import { useRelationshipsSelection } from './use-relationships-selection';

function makeRule(overrides: Partial<RelationshipRule>): RelationshipRule {
  return {
    id: 'rule-a',
    name: 'rule',
    description: null,
    sourceDatasourceId: 'source',
    targetDatasourceId: 'target',
    sourceFieldExpression: '$.handle',
    targetFieldExpression: '$.login',
    sourceFilterExpression: null,
    targetFilterExpression: null,
    relationshipType: 'ownedBy',
    reciprocalRelationshipType: 'ownerOf',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    origin: 'generated',
    state: 'suggested',
    suggestionKind: null,
    score: null,
    confidenceBand: null,
    evidenceSummary: null,
    reviewReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const SUGGESTION = makeRule({ id: 'sug-1', state: 'suggested' });
const ACTIVE = makeRule({ id: 'act-1', state: 'active' });

function wrapperFor(initialUrl: string) {
  return function RouterWrapper({ children }: { children: ReactNode }) {
    return createElement(
      MemoryRouter,
      { initialEntries: [initialUrl] },
      children,
    );
  };
}

function renderSelection(initialUrl = '/relationships') {
  const rulesById = new Map([
    [SUGGESTION.id, SUGGESTION],
    [ACTIVE.id, ACTIVE],
  ]);
  return renderHook(() => useRelationshipsSelection(rulesById), {
    wrapper: wrapperFor(initialUrl),
  });
}

describe('useRelationshipsSelection', () => {
  it('starts with nothing selected', () => {
    const { result } = renderSelection();

    expect(result.current.selectedRuleId).toBeNull();
    expect(result.current.readOnlyDataSourceId).toBeNull();
    expect(result.current.focusedNodeId).toBeNull();
    expect(result.current.selectedDirectPairKey).toBeNull();
    expect(result.current.highlightedRuleId).toBeNull();
    expect(result.current.reviewingSuggestion).toBeNull();
  });

  describe('one slot at a time', () => {
    // Every inspector shares one drawer slot. Each of these used to be a
    // hand-written list of "clear the other five" at the call site, and the
    // lists disagreed with each other.
    it('selecting a rule drops a data source inspection', () => {
      const { result } = renderSelection();

      act(() => result.current.toggleDataSource('ds-node-ds-1', 'ds-1', true));
      expect(result.current.readOnlyDataSourceId).toBe('ds-1');

      act(() => result.current.selectRule(ACTIVE.id));

      expect(result.current.selectedRuleId).toBe(ACTIVE.id);
      expect(result.current.readOnlyDataSourceId).toBeNull();
      expect(result.current.focusedNodeId).toBeNull();
    });

    it('inspecting a data source drops a rule selection and any review', () => {
      const { result } = renderSelection();

      act(() => result.current.selectSuggestion(SUGGESTION.id));
      expect(result.current.reviewingSuggestion?.id).toBe(SUGGESTION.id);

      act(() => result.current.toggleDataSource('ds-node-ds-1', 'ds-1', false));

      expect(result.current.selectedRuleId).toBeNull();
      expect(result.current.reviewingSuggestion).toBeNull();
      expect(result.current.readOnlyDataSourceId).toBe('ds-1');
    });

    it('selecting a direct pair drops a rule selection', () => {
      const { result } = renderSelection();

      act(() => result.current.selectRule(ACTIVE.id));
      act(() => result.current.selectDirectPair('ds-1|ds-2'));

      expect(result.current.selectedDirectPairKey).toBe('ds-1|ds-2');
      expect(result.current.selectedRuleId).toBeNull();
    });

    it('clearSelection empties every slot at once', () => {
      const { result } = renderSelection();

      act(() => result.current.selectSuggestion(SUGGESTION.id));
      act(() => result.current.hoverRule(SUGGESTION.id));

      act(() => result.current.clearSelection());

      expect(result.current.selectedRuleId).toBeNull();
      expect(result.current.selectedDirectPairKey).toBeNull();
      expect(result.current.readOnlyDataSourceId).toBeNull();
      expect(result.current.focusedNodeId).toBeNull();
      expect(result.current.highlightedRuleId).toBeNull();
      expect(result.current.reviewingSuggestion).toBeNull();
    });
  });

  describe('the highlight follows selection and hover, and cannot go stale', () => {
    it('rings the selected rule when it is a suggestion', () => {
      const { result } = renderSelection();

      act(() => result.current.selectSuggestion(SUGGESTION.id));

      expect(result.current.highlightedRuleId).toBe(SUGGESTION.id);
    });

    it('rings nothing when the selected rule is not a suggestion', () => {
      const { result } = renderSelection();

      act(() => result.current.selectRule(ACTIVE.id));

      expect(result.current.highlightedRuleId).toBeNull();
    });

    it('prefers the hovered card over the selected rule', () => {
      const { result } = renderSelection();

      act(() => result.current.selectSuggestion(SUGGESTION.id));
      act(() => result.current.hoverRule(ACTIVE.id));
      expect(result.current.highlightedRuleId).toBe(ACTIVE.id);

      act(() => result.current.hoverRule(null));
      expect(result.current.highlightedRuleId).toBe(SUGGESTION.id);
    });

    it('drops the ring when a node click takes the selection away', () => {
      // Regression: handleNodeClick cleared selectedRuleId but not the
      // highlight, so a suggestion card kept its ring after the canvas had
      // moved on. Deriving the highlight makes that unrepresentable.
      const { result } = renderSelection();

      act(() => result.current.selectSuggestion(SUGGESTION.id));
      expect(result.current.highlightedRuleId).toBe(SUGGESTION.id);

      act(() => result.current.toggleDataSource('ds-node-ds-1', 'ds-1', false));

      expect(result.current.highlightedRuleId).toBeNull();
    });
  });

  describe('review drawer', () => {
    it('derives the reviewed suggestion from the URL', () => {
      const { result } = renderSelection('/relationships?suggestion=sug-1');

      expect(result.current.reviewingSuggestion?.id).toBe('sug-1');
    });

    it('selects the reviewed suggestion on the canvas when opened by deep link', () => {
      // A URL open must land like an in-app open: the edge selected and the
      // card ringed, not a drawer floating over an untouched canvas.
      const { result } = renderSelection('/relationships?suggestion=sug-1');

      expect(result.current.selectedRuleId).toBe('sug-1');
      expect(result.current.highlightedRuleId).toBe('sug-1');
    });

    it('keeps the canvas selection when only the review closes', () => {
      // Closing the drawer is not the same gesture as clearing the canvas —
      // the breadcrumb and ✕ must not un-dim the graph behind them.
      const { result } = renderSelection();

      act(() => result.current.selectSuggestion(SUGGESTION.id));
      act(() => result.current.closeReview());

      expect(result.current.reviewingSuggestion).toBeNull();
      expect(result.current.selectedRuleId).toBe(SUGGESTION.id);
    });

    it('keeps the selection across the URL write that opens the review', () => {
      // Regression: opening the review wrote ?suggestion, which churned a
      // callback identity, which re-ran a mode effect, which cleared the very
      // selection the click had just made — the canvas un-dimmed a tick after
      // it focused.
      const { result } = renderSelection();

      act(() => result.current.selectSuggestion(SUGGESTION.id));

      expect(result.current.selectedRuleId).toBe(SUGGESTION.id);
      expect(result.current.reviewingSuggestion?.id).toBe(SUGGESTION.id);
      expect(result.current.highlightedRuleId).toBe(SUGGESTION.id);
    });
  });

  describe('rule editor', () => {
    it('derives the edited rule from ?rule', () => {
      const { result } = renderSelection('/relationships?rule=act-1');

      expect(result.current.editingRule?.id).toBe('act-1');
    });

    it('selects the edited rule on the canvas when opened by deep link', () => {
      const { result } = renderSelection('/relationships?rule=act-1');

      expect(result.current.selectedRuleId).toBe('act-1');
    });

    it('focusRule points the canvas without closing an open review', () => {
      // The ?relFocus effect is a background effect, not a gesture — its
      // re-runs (refresh, a facet change re-latching focus) must never drop
      // the drawer params and close a drawer over pending review work.
      const { result } = renderSelection('/relationships?suggestion=sug-1');

      act(() => result.current.focusRule(ACTIVE.id));

      expect(result.current.selectedRuleId).toBe(ACTIVE.id);
      expect(result.current.reviewingSuggestion?.id).toBe('sug-1');
    });

    it('focusRule leaves an open rule editor alone', () => {
      const { result } = renderSelection('/relationships?rule=act-1');

      act(() => result.current.focusRule(ACTIVE.id));

      expect(result.current.editingRule?.id).toBe('act-1');
    });

    it('clearSelection closes the rule editor and the review in one write', () => {
      const { result } = renderSelection(
        '/relationships?rule=act-1&suggestion=sug-1',
      );

      act(() => result.current.clearSelection());

      expect(result.current.editingRule).toBeNull();
      expect(result.current.reviewingSuggestion).toBeNull();
    });

    it('a same-tick closeRuleEditor after a transition cannot resurrect the review', () => {
      // Regression: both params live in the URL, and two setSearchParams
      // updaters in one tick each build from the same render's params — the
      // second write (closeRuleEditor's "delete rule") put ?suggestion back
      // after the transition had removed it, reopening the review drawer.
      const { result } = renderSelection('/relationships?suggestion=sug-1');

      act(() => {
        result.current.selectDirectPair('ds-1|ds-2');
        result.current.closeRuleEditor();
      });

      expect(result.current.reviewingSuggestion).toBeNull();
      expect(result.current.selectedDirectPairKey).toBe('ds-1|ds-2');
    });

    it('deep-link sync is one-shot: clearing the canvas stays cleared', () => {
      // ?rule survives a pane click's clearSelection (the graph view drops it
      // separately) — the sync must not fight the user and re-pick the rule.
      const { result } = renderSelection('/relationships?rule=act-1');
      expect(result.current.selectedRuleId).toBe('act-1');

      act(() => result.current.clearSelection());

      expect(result.current.selectedRuleId).toBeNull();
    });

    it('never opens a suggestion in the editable drawer', () => {
      // A suggested rule belongs to the review drawer. The old reconcile
      // effect had a dedicated branch for this; deriving makes it a filter.
      const { result } = renderSelection('/relationships?rule=sug-1');

      expect(result.current.editingRule).toBeNull();
    });

    it('stays closed for a ?rule naming a rule that does not exist', () => {
      const { result } = renderSelection('/relationships?rule=gone');

      expect(result.current.editingRule).toBeNull();
    });

    it('opening writes the param and closing drops it', () => {
      const { result } = renderSelection();

      act(() => result.current.openRuleInEditor(ACTIVE.id));
      expect(result.current.editingRule?.id).toBe(ACTIVE.id);
      expect(result.current.selectedRuleId).toBe(ACTIVE.id);

      act(() => result.current.closeRuleEditor());
      expect(result.current.editingRule).toBeNull();
    });

    it('stays shut after closing, with no state left to reopen it', () => {
      // The three guard refs this replaces existed only because editingRule
      // was mirrored state: there was always a render where it and the URL
      // disagreed, and each ref patched one way that gap reopened the drawer.
      const { result } = renderSelection();

      act(() => result.current.openRuleInEditor(ACTIVE.id));
      act(() => result.current.closeRuleEditor());

      expect(result.current.editingRule).toBeNull();
      // Re-opening the same rule must still work — the old dismissedRuleRef
      // latched it shut until the param pointed somewhere else.
      act(() => result.current.openRuleInEditor(ACTIVE.id));
      expect(result.current.editingRule?.id).toBe(ACTIVE.id);
    });

    it('opening a rule editor closes the review drawer', () => {
      const { result } = renderSelection();

      act(() => result.current.selectSuggestion(SUGGESTION.id));
      act(() => result.current.openRuleInEditor(ACTIVE.id));

      expect(result.current.reviewingSuggestion).toBeNull();
      expect(result.current.editingRule?.id).toBe(ACTIVE.id);
    });
  });

  describe('toggling a data source', () => {
    it('re-clicking the same data source closes its inspector', () => {
      const { result } = renderSelection();

      act(() => result.current.toggleDataSource('ds-node-ds-1', 'ds-1', true));
      act(() => result.current.toggleDataSource('ds-node-ds-1', 'ds-1', true));

      expect(result.current.readOnlyDataSourceId).toBeNull();
      expect(result.current.focusedNodeId).toBeNull();
    });

    it('only dims by focus when asked (Edit mode)', () => {
      const { result } = renderSelection();

      act(() => result.current.toggleDataSource('ds-node-ds-1', 'ds-1', false));

      expect(result.current.readOnlyDataSourceId).toBe('ds-1');
      expect(result.current.focusedNodeId).toBeNull();
    });
  });
});
