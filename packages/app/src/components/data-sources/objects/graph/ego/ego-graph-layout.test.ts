import { describe, expect, it } from 'vitest';
import {
  computeEgoLayout,
  convexHull,
  paddedHullPath,
  summaryNodeKey,
  type EgoGraphEdgeInput,
  type EgoGraphNodeInput,
} from './ego-graph-layout';

function node(key: string, hiddenNeighborCount = 0): EgoGraphNodeInput {
  return {
    key,
    datasourceId: 'ds-1',
    objectId: key,
    label: `Object ${key.toUpperCase()}`,
    hiddenNeighborCount,
  };
}

function edge(sourceKey: string, targetKey: string): EgoGraphEdgeInput {
  return {
    id: `rel-${sourceKey}-${targetKey}`,
    sourceKey,
    targetKey,
    relationshipType: 'related-to',
    direct: false,
  };
}

describe('computeEgoLayout', () => {
  it('places the root at the origin with ring-1 neighbors around it', () => {
    const layout = computeEgoLayout({
      rootKey: 'root',
      nodes: [node('root'), node('a'), node('b')],
      edges: [edge('root', 'a'), edge('root', 'b')],
      expandedKeys: new Set(),
    });

    const root = layout.nodeByKey.get('root');
    expect(root).toMatchObject({ x: 0, y: 0, depth: 0 });
    const a = layout.nodeByKey.get('a');
    const b = layout.nodeByKey.get('b');
    expect(a?.depth).toBe(1);
    expect(b?.depth).toBe(1);
    // both sit on the ring, not at the origin
    expect(Math.hypot(a?.x ?? 0, a?.y ?? 0)).toBeGreaterThan(50);
    expect(layout.edges).toHaveLength(2);
    expect(layout.edges.every(e => e.touchesRoot)).toBe(true);
  });

  it('collapses an oversized same-kind group into one summary node', () => {
    const children = ['c1', 'c2', 'c3', 'c4'];
    const layout = computeEgoLayout({
      rootKey: 'root',
      nodes: [node('root'), node('hub'), ...children.map(key => node(key))],
      edges: [edge('root', 'hub'), ...children.map(key => edge('hub', key))],
      expandedKeys: new Set(),
      groupThreshold: 2,
    });

    // none of the four drawn individually — one summary stands in for them
    expect(children.some(key => layout.nodeByKey.has(key))).toBe(false);
    const summary = layout.nodes.find(n => n.kind === 'summary');
    expect(summary).toMatchObject({
      summaryCount: 4,
      summaryRelationshipType: 'related-to',
      parentKey: 'hub',
      depth: 2,
    });
    // one root→hub edge plus the synthesized bundle edge
    expect(layout.edges).toHaveLength(2);
    const bundle = layout.edges.find(e => e.isSummary);
    expect(bundle).toMatchObject({ sourceKey: 'hub' });
  });

  it('keeps small groups whole and splits mixed relationship types', () => {
    const layout = computeEgoLayout({
      rootKey: 'root',
      nodes: [node('root'), node('a'), node('b'), node('c')],
      edges: [
        edge('root', 'a'),
        edge('root', 'b'),
        { ...edge('root', 'c'), relationshipType: 'owns' },
      ],
      expandedKeys: new Set(),
      groupThreshold: 2,
    });
    // 2 related-to + 1 owns — both groups within threshold, all drawn
    expect(layout.nodes.filter(n => n.kind === 'summary')).toHaveLength(0);
    expect(layout.nodes).toHaveLength(4);
  });

  it('reveals paged members out of a summarized group', () => {
    const children = ['c1', 'c2', 'c3', 'c4', 'c5'];
    const groupKey = 'hub|out|related-to|ds-1';
    const layout = computeEgoLayout({
      rootKey: 'root',
      nodes: [node('root'), node('hub'), ...children.map(key => node(key))],
      edges: [edge('root', 'hub'), ...children.map(key => edge('hub', key))],
      expandedKeys: new Set(),
      revealCounts: new Map([[groupKey, 2]]),
      groupThreshold: 2,
    });

    const revealed = children.filter(key => layout.nodeByKey.has(key));
    expect(revealed).toHaveLength(2);
    const summary = layout.nodeByKey.get(summaryNodeKey(groupKey));
    expect(summary?.summaryCount).toBe(3);
    // revealing everything removes the summary node
    const fullReveal = computeEgoLayout({
      rootKey: 'root',
      nodes: [node('root'), node('hub'), ...children.map(key => node(key))],
      edges: [edge('root', 'hub'), ...children.map(key => edge('hub', key))],
      expandedKeys: new Set(),
      revealCounts: new Map([[groupKey, 5]]),
      groupThreshold: 2,
    });
    expect(fullReveal.nodes.filter(n => n.kind === 'summary')).toHaveLength(0);
    expect(children.every(key => fullReveal.nodeByKey.has(key))).toBe(true);
  });

  it('badges object nodes with their unfetched neighbor count only', () => {
    const layout = computeEgoLayout({
      rootKey: 'root',
      nodes: [node('root'), node('a', 3)],
      edges: [edge('root', 'a')],
      expandedKeys: new Set(),
    });
    expect(layout.nodeByKey.get('a')?.badge).toBe(3);
    expect(layout.nodeByKey.get('a')?.expanded).toBe(false);
  });

  it('clusters flagged nodes adjacently on ring 1', () => {
    const ringKeys = ['a', 'b', 'c', 'd', 'e', 'f'];
    const layout = computeEgoLayout({
      rootKey: 'root',
      nodes: [node('root'), ...ringKeys.map(key => node(key))],
      edges: ringKeys.map(key => edge('root', key)),
      expandedKeys: new Set(),
      clusterKeys: new Set(['e', 'f']),
    });
    // clustered nodes take the first two even slots — adjacent angles
    const angleOf = (key: string) => {
      const placed = layout.nodeByKey.get(key);
      return Math.atan2((placed?.y ?? 0) / 0.72, placed?.x ?? 0);
    };
    const gap = Math.abs(angleOf('e') - angleOf('f'));
    const step = (2 * Math.PI) / ringKeys.length;
    expect(gap).toBeCloseTo(step, 1);
  });

  it('keeps deeper nodes near their parent angle on outer rings', () => {
    const layout = computeEgoLayout({
      rootKey: 'root',
      nodes: [node('root'), node('a'), node('b'), node('a1'), node('b1')],
      edges: [
        edge('root', 'a'),
        edge('root', 'b'),
        edge('a', 'a1'),
        edge('b', 'b1'),
      ],
      expandedKeys: new Set(),
    });
    const distanceBetween = (k1: string, k2: string) => {
      const p1 = layout.nodeByKey.get(k1);
      const p2 = layout.nodeByKey.get(k2);
      return Math.hypot(
        (p1?.x ?? 0) - (p2?.x ?? 0),
        (p1?.y ?? 0) - (p2?.y ?? 0),
      );
    };
    // each grandchild sits closer to its own parent than to the other one
    expect(distanceBetween('a1', 'a')).toBeLessThan(distanceBetween('a1', 'b'));
    expect(distanceBetween('b1', 'b')).toBeLessThan(distanceBetween('b1', 'a'));
  });

  it('produces a viewBox that contains every node', () => {
    const ringKeys = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const layout = computeEgoLayout({
      rootKey: 'root',
      nodes: [node('root'), ...ringKeys.map(key => node(key))],
      edges: ringKeys.map(key => edge('root', key)),
      expandedKeys: new Set(),
    });
    const { x, y, width, height } = layout.viewBox;
    for (const placed of layout.nodes) {
      expect(placed.x).toBeGreaterThan(x);
      expect(placed.x).toBeLessThan(x + width);
      expect(placed.y).toBeGreaterThan(y);
      expect(placed.y).toBeLessThan(y + height);
    }
  });
});

describe('convexHull / paddedHullPath', () => {
  it('computes the hull of a square and pads it into a closed path', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }, // interior point excluded
    ]);
    expect(hull).toHaveLength(4);
    const path = paddedHullPath(hull, 10);
    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
  });

  it('handles one- and two-point degenerate inputs', () => {
    expect(convexHull([{ x: 1, y: 1 }])).toHaveLength(3);
    expect(
      convexHull([
        { x: 0, y: 0 },
        { x: 4, y: 4 },
      ]),
    ).toHaveLength(3);
  });
});
