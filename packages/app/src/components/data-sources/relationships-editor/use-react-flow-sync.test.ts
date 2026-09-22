import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { mergeEdgeList, mergeNodePositions } from './use-react-flow-sync';

function node(id: string, x: number, extra: Partial<Node> = {}): Node {
  return {
    id,
    type: 'workflowGraphNode',
    position: { x, y: 0 },
    data: {},
    ...extra,
  };
}

function edge(id: string, overrides: Partial<Edge> = {}): Edge {
  return {
    id,
    source: 'n1',
    target: 'n2',
    data: { edgeId: id, sourceText: '', targetText: '', edgeColor: '#000' },
    ...overrides,
  };
}

describe('mergeNodePositions', () => {
  // React Flow's EdgeWrapper renders null when an endpoint's edge position is
  // unresolvable, which unmounts the edge component beneath it. `measured` is
  // React Flow's, set after it observes the DOM — buildNodes cannot know it. If
  // a rebuild hands back nodes without it, every edge unmounts for a frame and
  // remounts, replaying its one-time draw-in animation.
  it('carries React Flow measurements over from the current node', () => {
    const measured = { width: 320, height: 120 };
    const merged = mergeNodePositions(
      [{ ...node('n1', 0), measured }],
      [node('n1', 0)],
      false,
    );

    expect(merged[0].measured).toEqual(measured);
  });

  it('carries measurements over even when the committed layout changed', () => {
    const measured = { width: 320, height: 120 };
    const merged = mergeNodePositions(
      [{ ...node('n1', 0), measured }],
      [node('n1', 99)],
      true,
    );

    expect(merged[0].measured).toEqual(measured);
    expect(merged[0].position).toEqual({ x: 99, y: 0 });
  });

  // Handing React Flow a new array is what makes it re-render every node and
  // recompute every edge path, so an unchanged rebuild must not.
  it('returns the existing array when nothing changed', () => {
    const current = [{ ...node('n1', 0), measured: { width: 1, height: 2 } }];

    expect(mergeNodePositions(current, [node('n1', 0)], false)).toBe(current);
  });

  it('still returns a new array when something did change', () => {
    const current = [node('n1', 0)];
    const merged = mergeNodePositions(
      current,
      [node('n1', 0, { data: { focused: true } })],
      false,
    );

    expect(merged).not.toBe(current);
    expect(merged[0].data.focused).toBe(true);
  });

  // React Flow owns positions between rebuilds: it writes drags straight into
  // its own state, and `computedNodes` only learns about them once the layout
  // is captured. Taking computedNodes' positions unconditionally would snap a
  // dragged node back.
  it('keeps the live position when the committed layout has not changed', () => {
    const merged = mergeNodePositions(
      [node('n1', 500)],
      [node('n1', 0)],
      false,
    );

    expect(merged[0].position).toEqual({ x: 500, y: 0 });
  });

  // ...but an auto-arrange or a restored layout is exactly the case where the
  // computed positions must win.
  it('takes the computed position when the committed layout changed', () => {
    const merged = mergeNodePositions([node('n1', 500)], [node('n1', 0)], true);

    expect(merged[0].position).toEqual({ x: 0, y: 0 });
  });

  it('adds nodes that are not on the canvas yet', () => {
    const merged = mergeNodePositions([], [node('n1', 7)], false);

    expect(merged).toHaveLength(1);
    expect(merged[0].position).toEqual({ x: 7, y: 0 });
  });

  it('drops nodes that are no longer computed', () => {
    const merged = mergeNodePositions(
      [node('n1', 0), node('n2', 0)],
      [node('n1', 0)],
      false,
    );

    expect(merged.map(n => n.id)).toEqual(['n1']);
  });

  // buildNodes resolves focus, scope rings and dim, so the rebuild is
  // authoritative for everything except position.
  it('takes all other node data from the rebuild', () => {
    const merged = mergeNodePositions(
      [node('n1', 500, { data: { focused: true }, style: { opacity: 1 } })],
      [node('n1', 0, { data: { focused: false }, style: { opacity: 0.15 } })],
      false,
    );

    expect(merged[0].data.focused).toBe(false);
    expect(merged[0].style?.opacity).toBe(0.15);
  });
});

describe('mergeEdgeList', () => {
  const mounted = new Set(['n1', 'n2']);

  it('keeps the existing array when nothing changed, so React Flow can bail', () => {
    const current = [edge('e1')];

    expect(mergeEdgeList(current, [edge('e1')], mounted)).toBe(current);
  });

  it('adopts the rebuilt list when an edge changed', () => {
    const current = [edge('e1')];
    const next = [edge('e1', { data: { edgeId: 'e1', dimmed: true } })];

    const merged = mergeEdgeList(current, next, mounted);

    expect(merged).not.toBe(current);
    expect(merged[0].data?.dimmed).toBe(true);
  });

  // computedEdges filters on enabled data sources, but React Flow's node state
  // lags that by a render or two around a delete, and the pending connection
  // edge is not filtered at all. Without this an edge outlives its node.
  it('drops edges whose endpoints are not on the canvas', () => {
    const merged = mergeEdgeList(
      [],
      [edge('e1'), edge('e2', { target: 'gone' })],
      mounted,
    );

    expect(merged.map(e => e.id)).toEqual(['e1']);
  });

  // The builders derive `selected` from the canvas selection, so the rebuild is
  // authoritative for it. Carrying the old value forward would strand a stale
  // selection on an edge the user has since moved away from.
  it('takes the rebuilt selection rather than the current one', () => {
    const merged = mergeEdgeList(
      [edge('e1', { selected: true })],
      [edge('e1', { selected: false })],
      mounted,
    );

    expect(merged[0].selected).toBe(false);
  });

  it('adopts a newly selected edge', () => {
    const merged = mergeEdgeList(
      [edge('e1', { selected: false })],
      [edge('e1', { selected: true })],
      mounted,
    );

    expect(merged[0].selected).toBe(true);
  });
});
