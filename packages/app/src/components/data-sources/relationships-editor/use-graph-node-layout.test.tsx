// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ReactFlowProvider, type Edge, type Node } from '@xyflow/react';
import {
  buildLayoutEdges,
  buildLayoutNodes,
  measuredNodeWidth,
  mergeSavedPositions,
  mergeSavedWidths,
  useGraphNodeLayout,
  type XYPosition,
} from './use-graph-node-layout';
import { NODE_PREFIX } from './types';

const savedNodes = [
  {
    id: `${NODE_PREFIX}ds-a`,
    datasourceId: 'ds-a',
    position: { x: 10, y: 20 },
    width: 300,
  },
  {
    id: `${NODE_PREFIX}ds-b`,
    datasourceId: 'ds-b',
    position: { x: 30, y: 40 },
  },
];

describe('mergeSavedPositions', () => {
  it('seeds positions for nodes not placed yet', () => {
    expect(mergeSavedPositions(new Map(), savedNodes)).toEqual(
      new Map([
        ['ds-a', { x: 10, y: 20 }],
        ['ds-b', { x: 30, y: 40 }],
      ]),
    );
  });

  // The saved layout is a fallback, not an authority: it loads after first
  // paint, so a position the user already dragged must win.
  it('never clobbers a position adjusted in this session', () => {
    const current = new Map([['ds-a', { x: 999, y: 999 }]]);

    expect(mergeSavedPositions(current, savedNodes).get('ds-a')).toEqual({
      x: 999,
      y: 999,
    });
  });

  it('returns the same map when there is nothing new to add', () => {
    const current = new Map([
      ['ds-a', { x: 1, y: 1 }],
      ['ds-b', { x: 2, y: 2 }],
    ]);

    expect(mergeSavedPositions(current, savedNodes)).toBe(current);
  });
});

describe('mergeSavedWidths', () => {
  it('seeds only the widths that were persisted', () => {
    expect(mergeSavedWidths(new Map(), savedNodes)).toEqual(
      new Map([['ds-a', 300]]),
    );
  });

  it('ignores a non-finite persisted width', () => {
    const merged = mergeSavedWidths(new Map(), [
      { ...savedNodes[0], width: Number.NaN },
    ]);

    expect(merged.has('ds-a')).toBe(false);
  });

  it('keeps a width already set in this session', () => {
    const current = new Map([['ds-a', 500]]);

    expect(mergeSavedWidths(current, savedNodes).get('ds-a')).toBe(500);
  });

  it('returns the same map when there is nothing new to add', () => {
    const current = new Map([['ds-a', 300]]);

    expect(mergeSavedWidths(current, savedNodes)).toBe(current);
  });
});

describe('measuredNodeWidth', () => {
  it('prefers the width the node reports in its data', () => {
    expect(
      measuredNodeWidth({ data: { width: 320 }, width: 10 } as unknown as Node),
    ).toBe(320);
  });

  it('falls back to the node width, then the measured width', () => {
    expect(measuredNodeWidth({ data: {}, width: 210 } as unknown as Node)).toBe(
      210,
    );
    expect(
      measuredNodeWidth({
        data: {},
        measured: { width: 190 },
      } as unknown as Node),
    ).toBe(190);
  });

  it('is undefined when nothing has been measured', () => {
    expect(measuredNodeWidth({ data: {} } as unknown as Node)).toBeUndefined();
    expect(
      measuredNodeWidth({
        data: { width: Number.POSITIVE_INFINITY },
      } as unknown as Node),
    ).toBeUndefined();
  });
});

describe('buildLayoutNodes', () => {
  const positions = new Map([
    ['ds-a', { x: 1, y: 2 }],
    ['ds-b', { x: 3, y: 4 }],
  ]);

  it('pairs each position with its persisted width', () => {
    expect(
      buildLayoutNodes(positions, new Map([['ds-a', 300]]), ['ds-a']),
    ).toEqual([
      {
        id: `${NODE_PREFIX}ds-a`,
        datasourceId: 'ds-a',
        position: { x: 1, y: 2 },
        width: 300,
      },
    ]);
  });

  // Otherwise a deleted data source's position is written back forever, and
  // the stored layout grows without bound.
  it('drops positions for data sources that no longer exist', () => {
    const built = buildLayoutNodes(positions, new Map(), ['ds-a']);

    expect(built.map(n => n.datasourceId)).toEqual(['ds-a']);
  });
});

describe('buildLayoutEdges', () => {
  const edge = (overrides: Partial<Edge> = {}): Edge => ({
    id: 'rule-1',
    source: `${NODE_PREFIX}ds-a`,
    target: `${NODE_PREFIX}ds-b`,
    sourceHandle: 'handle-right',
    targetHandle: 'handle-left',
    data: { ruleId: 'rule-1' },
    ...overrides,
  });

  it('records the rule each edge came from', () => {
    expect(buildLayoutEdges([edge()])).toEqual([
      {
        id: 'rule-1',
        ruleId: 'rule-1',
        source: `${NODE_PREFIX}ds-a`,
        target: `${NODE_PREFIX}ds-b`,
        sourceHandle: 'handle-right',
        targetHandle: 'handle-left',
      },
    ]);
  });

  // It has no rule yet, so persisting it would restore an edge for a rule
  // that was never created.
  it('skips the in-progress connection edge', () => {
    expect(buildLayoutEdges([edge({ id: 'pending-new-rule' })])).toEqual([]);
  });

  it('normalises a missing rule id and absent handles', () => {
    expect(
      buildLayoutEdges([
        edge({ data: undefined, sourceHandle: null, targetHandle: null }),
      ]),
    ).toEqual([
      {
        id: 'rule-1',
        ruleId: '',
        source: `${NODE_PREFIX}ds-a`,
        target: `${NODE_PREFIX}ds-b`,
        sourceHandle: undefined,
        targetHandle: undefined,
      },
    ]);
  });
});

describe('useGraphNodeLayout seeding', () => {
  const KEY = 'graph-layout-datasources';

  beforeEach(() => {
    localStorage.clear();
  });

  function renderLayout() {
    // Every render's positions, so the FIRST one can be asserted on.
    const seen: Array<ReadonlyMap<string, XYPosition>> = [];
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ReactFlowProvider>{children}</ReactFlowProvider>
    );
    const hook = renderHook(
      () => {
        const result = useGraphNodeLayout({ knownDatasourceIds: ['ds-a'] });
        seen.push(result.positions);
        return result;
      },
      { wrapper },
    );
    return { ...hook, seen };
  }

  /**
   * The saved layout resolves synchronously, so it has to be in place on the
   * very first render. Merging it in an effect instead let React Flow measure
   * and run its one-shot initial fitView against the fallback grid, and the
   * fit is latched — so the nodes then jumped to their saved spots with the
   * viewport framing where they used to be.
   */
  it('has the saved positions on the first render, not after an effect', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        nodes: [
          {
            id: 'workflow-ds-a',
            datasourceId: 'ds-a',
            position: { x: 640, y: 480 },
            width: 320,
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    );

    const { seen, result } = renderLayout();

    expect(seen[0].get('ds-a')).toEqual({ x: 640, y: 480 });
    expect(result.current.nodeWidths.get('ds-a')).toBe(320);
  });

  it('starts empty when nothing was saved', () => {
    const { seen } = renderLayout();

    expect(seen[0].size).toBe(0);
  });
});
