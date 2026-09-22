import { describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import { areEdgeListsEquivalent } from './graph-edge-equality';

function edge(overrides: Partial<Edge> = {}): Edge {
  return {
    id: 'rule-1',
    source: 'workflow-ds-a',
    target: 'workflow-ds-b',
    sourceHandle: 'handle-right',
    targetHandle: 'handle-left',
    data: {
      edgeId: 'rule-1',
      ruleId: 'rule-1',
      sourceText: 'dependsOn',
      targetText: '',
      edgeColor: '#123456',
      isSelected: false,
      isSuggested: false,
      dimmed: false,
      hasSelection: false,
      directCount: 0,
    },
    ...overrides,
  };
}

/** Same edge, with one data field changed. */
function withData(changes: Record<string, unknown>): Edge {
  const base = edge();
  return { ...base, data: { ...base.data, ...changes } };
}

describe('areEdgeListsEquivalent', () => {
  it('treats structurally identical lists as equivalent', () => {
    expect(areEdgeListsEquivalent([edge()], [edge()])).toBe(true);
  });

  it('rejects lists of different lengths', () => {
    expect(areEdgeListsEquivalent([edge()], [edge(), edge()])).toBe(false);
  });

  it.each([
    ['id', { id: 'rule-2' }],
    ['source', { source: 'workflow-ds-z' }],
    ['target', { target: 'workflow-ds-z' }],
    ['sourceHandle', { sourceHandle: 'handle-left' }],
    ['targetHandle', { targetHandle: 'handle-right' }],
    ['selected', { selected: true }],
  ])('detects a changed %s', (_name, change) => {
    expect(areEdgeListsEquivalent([edge()], [edge(change)])).toBe(false);
  });

  it.each([
    ['dimmed', { dimmed: true }],
    ['isSelected', { isSelected: true }],
    ['isSuggested', { isSuggested: true }],
    ['isPending', { isPending: true }],
    ['hasSelection', { hasSelection: true }],
    ['sourceText', { sourceText: 'ownedBy' }],
    ['targetText', { targetText: 'owns' }],
    ['edgeColor', { edgeColor: '#abcdef' }],
    ['edgeDashPattern', { edgeDashPattern: '4 3' }],
    ['directCount', { directCount: 3 }],
    ['ruleId', { ruleId: 'rule-9' }],
    ['pairKey', { pairKey: 'ds-a|ds-z' }],
    ['isDirectAggregate', { isDirectAggregate: true }],
  ])('detects a changed data.%s', (_name, change) => {
    expect(areEdgeListsEquivalent([edge()], [withData(change)])).toBe(false);
  });

  // These reach RuleEdge as the edge's actions. A swapped handler is a real
  // change: keeping the old edge would leave the stale closure wired up. Safe to
  // compare only because the graph view passes them through useEventCallback —
  // see the note on COMPARED_DATA_KEYS.
  it.each(['onApprove', 'onDismiss', 'onDelete'])(
    'detects a replaced %s handler',
    key => {
      expect(
        areEdgeListsEquivalent(
          [withData({ [`${key}`]: vi.fn() })],
          [withData({ [`${key}`]: vi.fn() })],
        ),
      ).toBe(false);
    },
  );

  it('holds a handler of the same identity equivalent', () => {
    const onDelete = vi.fn();

    expect(
      areEdgeListsEquivalent(
        [withData({ onDelete })],
        [withData({ onDelete })],
      ),
    ).toBe(true);
  });

  it('ignores fields nothing renders', () => {
    expect(
      areEdgeListsEquivalent(
        [withData({ someInternalScratch: 1 })],
        [withData({ someInternalScratch: 2 })],
      ),
    ).toBe(true);
  });

  it('compares position-wise, so a reorder is not equivalent', () => {
    const a = edge({ id: 'rule-a' });
    const b = edge({ id: 'rule-b' });

    expect(areEdgeListsEquivalent([a, b], [b, a])).toBe(false);
  });

  it('handles edges with no data at all', () => {
    expect(
      areEdgeListsEquivalent(
        [edge({ data: undefined })],
        [edge({ data: undefined })],
      ),
    ).toBe(true);
    expect(areEdgeListsEquivalent([edge({ data: undefined })], [edge()])).toBe(
      false,
    );
  });

  it('does not allocate per comparison', () => {
    // Guards the reason this exists: the old implementation JSON.stringify'd
    // every edge's data on every rebuild.
    const stringify = vi.spyOn(JSON, 'stringify');

    areEdgeListsEquivalent([edge()], [withData({ dimmed: true })]);

    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();
  });
});
