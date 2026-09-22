import { waitFor } from '@testing-library/react';
import { renderHookWithQuery } from '../../../../../test-utils';
import type {
  RootedObjectGraphNodeSummary,
  RootedObjectGraphResult,
} from '../../../../../api/datastore/datastore-client';
import {
  useRootedObjectGraph,
  type ObjectGraphModeFilters,
} from './use-rooted-object-graph';

const queryRootedObjectGraph = vi.fn();

vi.mock('../../../../../api', () => ({
  useDatastore: () => ({
    queryRootedObjectGraph: (options: unknown, signal: AbortSignal) =>
      queryRootedObjectGraph(options, signal),
  }),
}));

const DS = 'ds-1';

function node(
  objectId: string,
  depth: number,
  hiddenNeighborCount = 0,
): RootedObjectGraphNodeSummary {
  return {
    id: `row-${objectId}`,
    datasourceId: DS,
    objectId,
    label: objectId,
    displayName: objectId,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    depth,
    hiddenNeighborCount,
  };
}

function edge(id: string, source: string, target: string) {
  return {
    id,
    sourceDatasourceId: DS,
    sourceObjectId: source,
    destinationDatasourceId: DS,
    destinationObjectId: target,
    relationshipType: 'linked-to',
    origin: 'manual',
  };
}

function result(
  rootObjectId: string,
  nodes: RootedObjectGraphNodeSummary[],
  relationships: ReturnType<typeof edge>[],
  truncated = false,
): RootedObjectGraphResult {
  return {
    nodes,
    relationships,
    totals: { objects: nodes.length, relationships: relationships.length },
    truncated,
    rootNodeId: `${DS}:${rootObjectId}`,
  };
}

const FILTERS: ObjectGraphModeFilters = {
  datasourceIds: [],
  relationshipTypes: [],
  direction: 'both',
};

describe('useRootedObjectGraph', () => {
  beforeEach(() => {
    queryRootedObjectGraph.mockReset();
  });

  it('stays idle without a focus', () => {
    const { result: hook } = renderHookWithQuery(() =>
      useRootedObjectGraph({
        enabled: true,
        focus: null,
        depth: 2,
        filters: FILTERS,
        expandedKeys: [],
      }),
    );
    expect(hook.current.loading).toBe(false);
    expect(hook.current.rootNodeId).toBeNull();
    expect(queryRootedObjectGraph).not.toHaveBeenCalled();
  });

  it('fetches the base graph with every filter input', async () => {
    queryRootedObjectGraph.mockResolvedValue(result('a1', [node('a1', 0)], []));
    const { result: hook } = renderHookWithQuery(() =>
      useRootedObjectGraph({
        enabled: true,
        focus: { datasourceId: DS, objectId: 'a1' },
        depth: 3,
        filters: {
          datasourceIds: ['ds-2', 'ds-1'],
          relationshipTypes: ['uses', 'owns'],
          direction: 'out',
        },
        expandedKeys: [],
      }),
    );

    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(queryRootedObjectGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        rootDatasourceId: DS,
        rootObjectId: 'a1',
        depth: 3,
        datasourceIds: ['ds-1', 'ds-2'],
        relationshipTypes: ['owns', 'uses'],
        direction: 'out',
      }),
      expect.any(AbortSignal),
    );
    expect(hook.current.rootNodeId).toBe(`${DS}:a1`);
    expect(hook.current.nodes).toHaveLength(1);
  });

  it('merges expansion responses, dedupes, and recomputes hidden counts', async () => {
    // Base: a1 — a2, where a2 hides one more neighbor (a3).
    const base = result(
      'a1',
      [node('a1', 0), node('a2', 1, 1)],
      [edge('e1', 'a1', 'a2')],
    );
    // Expanding a2 reveals a3 (and re-returns the shared edge e1); within
    // that response every neighbor of a2 is present, so its hidden count
    // comes back as zero.
    const expansion = result(
      'a2',
      [node('a2', 0, 0), node('a1', 1), node('a3', 1)],
      [edge('e1', 'a1', 'a2'), edge('e2', 'a2', 'a3')],
    );
    queryRootedObjectGraph.mockImplementation(
      async (options: { rootObjectId: string }) =>
        options.rootObjectId === 'a1' ? base : expansion,
    );

    const { result: hook } = renderHookWithQuery(() =>
      useRootedObjectGraph({
        enabled: true,
        focus: { datasourceId: DS, objectId: 'a1' },
        depth: 1,
        filters: FILTERS,
        expandedKeys: [`${DS}:a2`],
      }),
    );

    await waitFor(() => {
      expect(hook.current.nodes).toHaveLength(3);
    });
    // e1 arrived twice but merges once.
    expect(hook.current.relationships).toHaveLength(2);
    // a2's badge shrinks to zero: its total (2 neighbors) are all visible.
    const a2 = hook.current.nodes.find(n => n.objectId === 'a2');
    expect(a2?.hiddenNeighborCount).toBe(0);
    // a2 keeps its base depth (1), not the expansion's 0.
    expect(a2?.depth).toBe(1);
  });

  it('clamps hidden counts at zero when responses disagree', async () => {
    // Server said one hidden neighbor, but the merged graph shows two —
    // the badge must not go negative.
    const base = result(
      'a1',
      [node('a1', 0, 1), node('a2', 1), node('a3', 1)],
      [edge('e1', 'a1', 'a2'), edge('e2', 'a1', 'a3'), edge('e3', 'a2', 'a3')],
    );
    queryRootedObjectGraph.mockResolvedValue(base);

    const { result: hook } = renderHookWithQuery(() =>
      useRootedObjectGraph({
        enabled: true,
        focus: { datasourceId: DS, objectId: 'a1' },
        depth: 2,
        filters: FILTERS,
        expandedKeys: [],
      }),
    );

    await waitFor(() => expect(hook.current.nodes).toHaveLength(3));
    const a1 = hook.current.nodes.find(n => n.objectId === 'a1');
    // total = 2 present + 1 hidden = 3; merged shows 2 → badge 1.
    expect(a1?.hiddenNeighborCount).toBe(1);
  });

  it('surfaces base errors and truncation', async () => {
    queryRootedObjectGraph.mockRejectedValue(new Error('boom'));
    const { result: hook } = renderHookWithQuery(() =>
      useRootedObjectGraph({
        enabled: true,
        focus: { datasourceId: DS, objectId: 'a1' },
        depth: 2,
        filters: FILTERS,
        expandedKeys: [],
      }),
    );
    await waitFor(() => expect(hook.current.error).toBe('boom'));

    queryRootedObjectGraph.mockResolvedValue(
      result('a1', [node('a1', 0)], [], true),
    );
    const { result: truncatedHook } = renderHookWithQuery(() =>
      useRootedObjectGraph({
        enabled: true,
        focus: { datasourceId: DS, objectId: 'a1' },
        depth: 2,
        filters: FILTERS,
        expandedKeys: [],
      }),
    );
    await waitFor(() => expect(truncatedHook.current.truncated).toBe(true));
  });
});
