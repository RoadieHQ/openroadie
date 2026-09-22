import { describe, expect, it } from 'vitest';
import {
  computePathsLayout,
  type PathsGraphEdgeInput,
  type PathsGraphNodeInput,
  type PathsGraphPathInput,
} from './paths-graph-layout';

const DS = 'ds-1';

const key = (objectId: string) => `${DS}:${objectId}`;

function node(objectId: string): PathsGraphNodeInput {
  return {
    key: key(objectId),
    datasourceId: DS,
    objectId,
    label: objectId,
  };
}

function groupNode(groupId: string, memberCount: number): PathsGraphNodeInput {
  return {
    key: `group:${groupId}`,
    datasourceId: '',
    objectId: '',
    label: `Group ${groupId}`,
    group: {
      groupId,
      ruleId: `rule-${groupId}`,
      ruleName: `Rule ${groupId}`,
      title: `Group ${groupId}`,
      memberCount,
    },
  };
}

function edge(
  id: string,
  sourceKey: string,
  targetKey: string,
  ruleId: string | null = null,
): PathsGraphEdgeInput {
  return {
    id,
    sourceKey,
    targetKey,
    relationshipType: 'linked-to',
    direct: ruleId === null,
    ruleId,
  };
}

function path(objectIds: string[], edgeIds: string[]): PathsGraphPathInput {
  return {
    nodeKeys: objectIds.map(objectId => [key(objectId)]),
    edgeIds,
  };
}

// A diamond: s → x1 → t and s → x2 → t, where the x2 leg's second edge is
// stored backwards (t → x2) — the traversal is undirected.
const DIAMOND = {
  nodes: [node('s'), node('x1'), node('x2'), node('t')],
  edges: [
    edge('e1', key('s'), key('x1')),
    edge('e2', key('x1'), key('t')),
    edge('e3', key('s'), key('x2')),
    edge('e4', key('t'), key('x2'), 'rule-1'),
  ],
  paths: [
    path(['s', 'x1', 't'], ['e1', 'e2']),
    path(['s', 'x2', 't'], ['e3', 'e4']),
  ],
  sourceKey: key('s'),
  targetKey: key('t'),
};

describe('computePathsLayout', () => {
  it('ranks A leftmost and B rightmost even with backwards stored edges', () => {
    const layout = computePathsLayout(DIAMOND);
    const byKey = layout.nodeByKey;
    const source = byKey.get(key('s'))!;
    const target = byKey.get(key('t'))!;
    for (const placed of layout.nodes) {
      expect(source.x).toBeLessThanOrEqual(placed.x);
      expect(target.x).toBeGreaterThanOrEqual(placed.x);
    }
    expect(source.isEndpoint).toBe(true);
    expect(target.isEndpoint).toBe(true);
    expect(byKey.get(key('x1'))!.isEndpoint).toBe(false);
  });

  it('is deterministic across input shuffles', () => {
    const forward = computePathsLayout(DIAMOND);
    const shuffled = computePathsLayout({
      ...DIAMOND,
      nodes: [...DIAMOND.nodes].reverse(),
      edges: [...DIAMOND.edges].reverse(),
    });
    expect(shuffled.nodes).toEqual(forward.nodes);
    expect(shuffled.edges).toEqual(forward.edges);
  });

  it('tags nodes and edges with their path memberships and direct flags', () => {
    const layout = computePathsLayout(DIAMOND);
    expect(layout.nodeByKey.get(key('s'))!.pathIndices).toEqual([0, 1]);
    expect(layout.nodeByKey.get(key('x1'))!.pathIndices).toEqual([0]);
    const e4 = layout.edges.find(placed => placed.id === 'e4')!;
    expect(e4.pathIndices).toEqual([1]);
    expect(e4.direct).toBe(false);
    expect(layout.edges.find(placed => placed.id === 'e1')!.direct).toBe(true);
  });

  it('drops edges with unplaced endpoints and handles empty input', () => {
    const layout = computePathsLayout({
      nodes: [node('s')],
      edges: [edge('e1', key('s'), key('ghost'))],
      paths: [],
      sourceKey: key('s'),
      targetKey: key('t'),
    });
    expect(layout.edges).toHaveLength(0);

    const empty = computePathsLayout({
      nodes: [],
      edges: [],
      paths: [],
      sourceKey: key('s'),
      targetKey: key('t'),
    });
    expect(empty.nodes).toHaveLength(0);
    expect(empty.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('keeps all nodes within the bounds', () => {
    const layout = computePathsLayout(DIAMOND);
    for (const placed of layout.nodes) {
      expect(placed.x).toBeGreaterThanOrEqual(layout.bounds.x);
      expect(placed.x).toBeLessThanOrEqual(
        layout.bounds.x + layout.bounds.width,
      );
      expect(placed.y).toBeGreaterThanOrEqual(layout.bounds.y);
      expect(placed.y).toBeLessThanOrEqual(
        layout.bounds.y + layout.bounds.height,
      );
    }
  });

  it('places collapsed group nodes: multi-key hops, self-pairs ranked away, larger radius', () => {
    const group = groupNode('g1', 2);
    // s → m1 → m2 → t where m1/m2 folded into g1: the internal hop realizes
    // no display edge, and consecutive same-key hops must not self-rank.
    const layout = computePathsLayout({
      nodes: [node('s'), group, node('t')],
      edges: [edge('a1', key('s'), group.key), edge('a2', group.key, key('t'))],
      paths: [
        {
          nodeKeys: [[key('s')], [group.key], [group.key], [key('t')]],
          edgeIds: ['a1', 'a2'],
        },
      ],
      sourceKey: key('s'),
      targetKey: key('t'),
    });

    const placedGroup = layout.nodeByKey.get(group.key)!;
    expect(placedGroup.group?.memberCount).toBe(2);
    expect(placedGroup.pathIndices).toEqual([0]);
    expect(placedGroup.r).toBeGreaterThan(layout.nodeByKey.get(key('s'))!.r);
    expect(layout.edges.map(placed => placed.id)).toEqual(['a1', 'a2']);
    // The group sits strictly between the endpoints.
    expect(placedGroup.x).toBeGreaterThan(layout.nodeByKey.get(key('s'))!.x);
    expect(placedGroup.x).toBeLessThan(layout.nodeByKey.get(key('t'))!.x);
  });
});
