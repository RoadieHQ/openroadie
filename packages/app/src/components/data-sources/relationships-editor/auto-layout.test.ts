import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { computeDagreLayout } from './auto-layout';

function makeNode(id: string): Node {
  return {
    id,
    type: 'default',
    data: {},
    position: { x: 0, y: 0 },
  };
}

describe('computeDagreLayout', () => {
  it('returns a position for every input node', () => {
    const nodes: Node[] = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges: Edge[] = [
      { id: 'a-b', source: 'a', target: 'b' },
      { id: 'b-c', source: 'b', target: 'c' },
    ];

    const { positions } = computeDagreLayout(nodes, edges);

    expect(positions.size).toBe(3);
    for (const id of ['a', 'b', 'c']) {
      expect(positions.has(id)).toBe(true);
      const pos = positions.get(id)!;
      expect(typeof pos.x).toBe('number');
      expect(typeof pos.y).toBe('number');
    }
  });

  it('lays out nodes left-to-right by default — downstream nodes get larger x', () => {
    const nodes: Node[] = [makeNode('source'), makeNode('target')];
    const edges: Edge[] = [{ id: 's-t', source: 'source', target: 'target' }];

    const { positions } = computeDagreLayout(nodes, edges);

    expect(positions.get('target')!.x).toBeGreaterThan(
      positions.get('source')!.x,
    );
  });

  it('lays out nodes top-to-bottom when direction is TB', () => {
    const nodes: Node[] = [makeNode('source'), makeNode('target')];
    const edges: Edge[] = [{ id: 's-t', source: 'source', target: 'target' }];

    const { positions } = computeDagreLayout(nodes, edges, { direction: 'TB' });

    expect(positions.get('target')!.y).toBeGreaterThan(
      positions.get('source')!.y,
    );
  });

  it('uses provided measurements to size nodes (so larger nodes get more spacing)', () => {
    const nodes: Node[] = [makeNode('a'), makeNode('b')];
    const edges: Edge[] = [{ id: 'a-b', source: 'a', target: 'b' }];

    const tight = computeDagreLayout(nodes, edges, {
      measurements: new Map([
        ['a', { id: 'a', width: 100, height: 40 }],
        ['b', { id: 'b', width: 100, height: 40 }],
      ]),
    });
    const wide = computeDagreLayout(nodes, edges, {
      measurements: new Map([
        ['a', { id: 'a', width: 800, height: 40 }],
        ['b', { id: 'b', width: 800, height: 40 }],
      ]),
    });

    const tightGap = tight.positions.get('b')!.x - tight.positions.get('a')!.x;
    const wideGap = wide.positions.get('b')!.x - wide.positions.get('a')!.x;
    expect(wideGap).toBeGreaterThan(tightGap);
  });

  it('leaves a comfortable horizontal gap between connected ranks', () => {
    const nodes: Node[] = [makeNode('source'), makeNode('target')];
    const edges: Edge[] = [{ id: 's-t', source: 'source', target: 'target' }];

    const { positions } = computeDagreLayout(nodes, edges, {
      measurements: new Map([
        ['source', { id: 'source', width: 220, height: 120 }],
        ['target', { id: 'target', width: 220, height: 120 }],
      ]),
    });

    const sourceRight = positions.get('source')!.x + 220;
    const targetLeft = positions.get('target')!.x;
    expect(targetLeft - sourceRight).toBeGreaterThanOrEqual(200);
  });

  it('packs disconnected components with a vertical gutter', () => {
    const nodes: Node[] = [
      makeNode('a'),
      makeNode('b'),
      makeNode('c'),
      makeNode('d'),
    ];
    const edges: Edge[] = [
      { id: 'a-b', source: 'a', target: 'b' },
      { id: 'c-d', source: 'c', target: 'd' },
    ];

    const { positions } = computeDagreLayout(nodes, edges, {
      measurements: new Map(
        nodes.map(node => [node.id, { id: node.id, width: 220, height: 120 }]),
      ),
    });

    const firstComponentBottom = Math.max(
      positions.get('a')!.y + 120,
      positions.get('b')!.y + 120,
    );
    const secondComponentTop = Math.min(
      positions.get('c')!.y,
      positions.get('d')!.y,
    );
    expect(secondComponentTop - firstComponentBottom).toBeGreaterThanOrEqual(
      150,
    );
  });

  it('returns stable positions for the same graph inputs', () => {
    const nodes: Node[] = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges: Edge[] = [
      { id: 'a-b', source: 'a', target: 'b' },
      { id: 'a-c', source: 'a', target: 'c' },
    ];

    const first = computeDagreLayout(nodes, edges);
    const second = computeDagreLayout(nodes, edges);

    expect([...second.positions.entries()]).toEqual([
      ...first.positions.entries(),
    ]);
    expect([...second.edgeWaypoints.entries()]).toEqual([
      ...first.edgeWaypoints.entries(),
    ]);
  });

  it('handles a graph with no edges', () => {
    const nodes: Node[] = [makeNode('a'), makeNode('b')];
    const { positions, edgeWaypoints } = computeDagreLayout(nodes, []);

    expect(positions.size).toBe(2);
    expect(edgeWaypoints.size).toBe(0);
  });

  it('handles an empty graph', () => {
    const { positions, edgeWaypoints } = computeDagreLayout([], []);
    expect(positions.size).toBe(0);
    expect(edgeWaypoints.size).toBe(0);
  });

  it('returns waypoints keyed by edge id with at least two points per edge', () => {
    const nodes: Node[] = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges: Edge[] = [
      { id: 'a-b', source: 'a', target: 'b' },
      { id: 'b-c', source: 'b', target: 'c' },
    ];

    const { edgeWaypoints } = computeDagreLayout(nodes, edges);

    expect(edgeWaypoints.size).toBe(2);
    for (const id of ['a-b', 'b-c']) {
      const points = edgeWaypoints.get(id)!;
      expect(points.length).toBeGreaterThanOrEqual(2);
      for (const p of points) {
        expect(typeof p.x).toBe('number');
        expect(typeof p.y).toBe('number');
      }
    }
  });
});
