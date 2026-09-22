import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useNavigate, useSearchParams } from 'react-router';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import { useSuggestionDrawerStack } from './use-suggestion-drawer-stack';

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
    suggestionKind: 'identity',
    score: null,
    confidenceBand: null,
    evidenceSummary: null,
    reviewReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function wrapperFor(initialUrl: string) {
  return function RouterWrapper({ children }: { children: ReactNode }) {
    return createElement(
      MemoryRouter,
      { initialEntries: [initialUrl] },
      children,
    );
  };
}

/**
 * Renders the hook alongside the live search params so tests can assert URL
 * writes, plus `navigate` so they can drive browser Back. Asserting the
 * resulting param alone cannot tell push from replace — only walking the
 * history can, and Back returning to the list is the whole reason the open
 * pushes.
 */
function renderStack(rules: RelationshipRule[], initialUrl = '/relationships') {
  const rulesById = new Map(rules.map(r => [r.id, r]));
  return renderHook(
    () => ({
      stack: useSuggestionDrawerStack(rulesById),
      params: useSearchParams()[0],
      navigate: useNavigate(),
    }),
    { wrapper: wrapperFor(initialUrl) },
  );
}

describe('useSuggestionDrawerStack', () => {
  it('has no suggestion under review without the param', () => {
    const { result } = renderStack([makeRule({})]);

    expect(result.current.stack.reviewingSuggestion).toBeNull();
  });

  it('derives the suggestion under review from ?suggestion', () => {
    const { result } = renderStack(
      [makeRule({ id: 'rule-a' })],
      '/relationships?suggestion=rule-a',
    );

    expect(result.current.stack.reviewingSuggestion?.id).toBe('rule-a');
  });

  it('falls back to no review when the param points at a rule that is no longer suggested', () => {
    // An approved rule keeps its id but flips state — a stale link, or the
    // rule the user just approved from the review view.
    const { result } = renderStack(
      [makeRule({ id: 'rule-a', state: 'active' })],
      '/relationships?suggestion=rule-a',
    );

    expect(result.current.stack.reviewingSuggestion).toBeNull();
  });

  it('falls back to no review when the param points at an unknown id', () => {
    const { result } = renderStack([], '/relationships?suggestion=gone');

    expect(result.current.stack.reviewingSuggestion).toBeNull();
  });

  it('writes the param when a suggestion is opened', () => {
    const { result } = renderStack([makeRule({ id: 'rule-a' })]);

    act(() => result.current.stack.openSuggestion('rule-a'));

    expect(result.current.params.get('suggestion')).toBe('rule-a');
    expect(result.current.stack.reviewingSuggestion?.id).toBe('rule-a');
  });

  it('clears the param when the review is closed', () => {
    const { result } = renderStack(
      [makeRule({ id: 'rule-a' })],
      '/relationships?suggestion=rule-a',
    );

    act(() => result.current.stack.closeSuggestion());

    expect(result.current.params.get('suggestion')).toBeNull();
    expect(result.current.stack.reviewingSuggestion).toBeNull();
  });

  it('preserves other params when navigating', () => {
    const { result } = renderStack(
      [makeRule({ id: 'rule-a' })],
      '/relationships?mode=suggest&ds=one,two',
    );

    act(() => result.current.stack.openSuggestion('rule-a'));

    expect(result.current.params.get('mode')).toBe('suggest');
    expect(result.current.params.get('ds')).toBe('one,two');
  });

  // These two are the only tests that can tell push from replace. Asserting
  // the resulting param passes either way, so without them the reviewer could
  // swap the two and nothing would notice.
  it('leaves a history entry on open, so browser Back returns to the list', () => {
    const { result } = renderStack([makeRule({ id: 'rule-a' })]);

    act(() => result.current.stack.openSuggestion('rule-a'));
    expect(result.current.params.get('suggestion')).toBe('rule-a');

    act(() => result.current.navigate(-1));

    // Were the open a replace, there would be no entry to go back to and the
    // param would still be here.
    expect(result.current.params.get('suggestion')).toBeNull();
  });

  it('re-opening the reviewed suggestion does not stack a history entry', () => {
    // A re-click on the reviewed edge is deliberately allowed and re-opens
    // the same rule — pushing again would make Back need one press per
    // re-click to leave the review.
    const { result } = renderStack([makeRule({ id: 'rule-a' })]);

    act(() => result.current.stack.openSuggestion('rule-a'));
    act(() => result.current.stack.openSuggestion('rule-a'));
    expect(result.current.params.get('suggestion')).toBe('rule-a');

    act(() => result.current.navigate(-1));

    // One Back leaves the review — the second open was a no-op.
    expect(result.current.params.get('suggestion')).toBeNull();
  });

  it('replaces on close, so Back does not land back on the review', () => {
    const { result } = renderStack([makeRule({ id: 'rule-a' })]);

    act(() => result.current.stack.openSuggestion('rule-a'));
    act(() => result.current.stack.closeSuggestion());

    act(() => result.current.navigate(-1));

    // Going back from the list must reach whatever preceded the review, not
    // re-enter it. A pushing close would strand the user bouncing between the
    // list and the rule they just left.
    expect(result.current.params.get('suggestion')).toBeNull();
  });
});
