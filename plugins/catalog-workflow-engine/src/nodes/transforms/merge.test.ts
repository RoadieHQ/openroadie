import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMergeNode } from './merge';
import { InMemoryDataPlane } from '../../engine';
import type { MergeJoinSide, JoinSidePagedItem } from '../../engine';

const mockClient = vi.hoisted(() => ({
  rebuildIndexConfiguration: vi.fn(),
  queryWithJoin: vi.fn(),
  queryObjects: vi.fn(),
}));

vi.mock('@roadiehq/catalog-datastore-common', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@roadiehq/catalog-datastore-common')>();
  return {
    ...actual,
    CatalogDatastoreClient: vi.fn().mockImplementation(function mockCtor() {
      return mockClient;
    }),
  };
});

const discovery = {
  getBaseUrl: async () => 'http://localhost:7007',
} as any;

describe('merge node pagedHandler', () => {
  const node = buildMergeNode({ discovery, fetchApi: { fetch } });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createPagedContext = (args: {
    config: Record<string, unknown>;
    left?: Array<{ object: unknown; orderKey: number[] }>;
    right?: Array<{ object: unknown; orderKey: number[] }>;
    previewLimit?: number;
  }) => {
    const plane = new InMemoryDataPlane();
    const nodeId = 'merge-node';
    const emitted: Array<{ object: any; orderKey: readonly number[] }> = [];
    const inputs = new Map<string, unknown[]>();
    const stream = (items: Array<{ object: unknown; orderKey: number[] }>) => [
      {
        edgeId: 'e',
        sourceNodeId: 'src',
        pages: (async function* pages() {
          if (items.length > 0) {
            yield items;
          }
        })(),
      },
    ];
    if (args.left) {
      inputs.set('left', stream(args.left));
    }
    if (args.right) {
      inputs.set('right', stream(args.right));
    }
    const ctx = {
      config: args.config,
      previewLimit: args.previewLimit,
      log: vi.fn(),
      signal: new AbortController().signal,
      io: {
        inputs,
        emit: async (items: any[]) => {
          emitted.push(...items);
        },
      },
      mergeJoin: {
        spill: (side: MergeJoinSide, items: readonly JoinSidePagedItem[]) =>
          plane.writeJoinSidePage(nodeId, side, items),
        joinedPages: () => plane.readJoinedPages(nodeId),
      },
    };
    return { ctx, emitted };
  };

  const stagingConfig = {
    leftIndexKey: 'team',
    rightIndexKey: 'group',
    rightAlias: 'members',
  };

  it('joins staged inputs and nests right matches under the alias', async () => {
    const { ctx, emitted } = createPagedContext({
      config: stagingConfig,
      left: [
        { object: { id: 'l1', team: 'a' }, orderKey: [0] },
        { object: { id: 'l2', team: 'b' }, orderKey: [1] },
        { object: { id: 'l3' }, orderKey: [2] },
      ],
      right: [
        { object: { id: 'r1', group: 'b' }, orderKey: [0] },
        { object: { id: 'r2', group: 'a' }, orderKey: [1] },
        { object: { id: 'r3', group: 'a' }, orderKey: [2] },
      ],
    });

    await node.pagedHandler!(ctx as any);

    expect(emitted.map(i => i.object.id)).toEqual(['l1', 'l2', 'l3']);
    expect(emitted[0].object.members.map((m: any) => m.id)).toEqual([
      'r2',
      'r3',
    ]);
    expect(emitted[1].object.members.map((m: any) => m.id)).toEqual(['r1']);
    // A missing join key keeps the left row with no matches.
    expect(emitted[2].object.members).toEqual([]);
    // Joined rows keep the left item's order key.
    expect(emitted.map(i => i.orderKey)).toEqual([[0], [1], [2]]);
  });

  it('defaults the alias to "merged"', async () => {
    const { ctx, emitted } = createPagedContext({
      config: { leftIndexKey: 'k', rightIndexKey: 'k' },
      left: [{ object: { id: 'l', k: 'x' }, orderKey: [0] }],
      right: [{ object: { id: 'r', k: 'x' }, orderKey: [0] }],
    });

    await node.pagedHandler!(ctx as any);

    expect(emitted[0].object.merged.map((m: any) => m.id)).toEqual(['r']);
  });

  it('honors the preview limit on staged joins', async () => {
    const { ctx, emitted } = createPagedContext({
      config: stagingConfig,
      left: [
        { object: { id: 'l1', team: 'a' }, orderKey: [0] },
        { object: { id: 'l2', team: 'a' }, orderKey: [1] },
        { object: { id: 'l3', team: 'a' }, orderKey: [2] },
      ],
      right: [{ object: { id: 'r1', group: 'a' }, orderKey: [0] }],
      previewLimit: 2,
    });

    await node.pagedHandler!(ctx as any);

    expect(emitted).toHaveLength(2);
  });

  it('spills a configured published datasource for a mixed join', async () => {
    mockClient.queryObjects.mockResolvedValue({
      items: [
        { id: '1', objectId: 'r1', object: { id: 'r1', group: 'a' } },
        { id: '2', objectId: 'r2', object: { id: 'r2', group: 'b' } },
      ],
      total: 2,
    });
    const { ctx, emitted } = createPagedContext({
      config: {
        ...stagingConfig,
        rightDatasourceId: 'ds-right',
      },
      left: [{ object: { id: 'l1', team: 'b' }, orderKey: [0] }],
    });

    await node.pagedHandler!(ctx as any);

    expect(mockClient.queryObjects).toHaveBeenCalledWith('ds-right', {
      limit: 1000,
      offset: 0,
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].object.members.map((m: any) => m.id)).toEqual(['r2']);
  });

  it('throws when a side has neither an input stream nor a datasource id', async () => {
    const { ctx } = createPagedContext({
      config: stagingConfig,
      left: [{ object: { id: 'l1', team: 'a' }, orderKey: [0] }],
    });

    await expect(node.pagedHandler!(ctx as any)).rejects.toThrow(
      'right input required',
    );
  });

  it('uses the legacy live-table join when both sides are published datasources', async () => {
    mockClient.queryWithJoin.mockResolvedValue({
      items: [
        {
          id: 'row-1',
          object: { id: 'l1', team: 'a' },
          members: [{ id: 'x', objectId: 'r1', object: { id: 'r1' } }],
        },
      ],
      total: 1,
    });
    const { ctx, emitted } = createPagedContext({
      config: {
        ...stagingConfig,
        leftDatasourceId: 'ds-left',
        rightDatasourceId: 'ds-right',
      },
    });

    await node.pagedHandler!(ctx as any);

    expect(mockClient.rebuildIndexConfiguration).toHaveBeenCalledWith(
      'ds-left',
      'team',
    );
    expect(mockClient.rebuildIndexConfiguration).toHaveBeenCalledWith(
      'ds-right',
      'group',
    );
    expect(mockClient.queryWithJoin).toHaveBeenCalledWith(
      expect.objectContaining({
        leftDatasourceId: 'ds-left',
        rightDatasourceId: 'ds-right',
        leftIndexKey: 'team',
        rightIndexKey: 'group',
        rightAlias: 'members',
      }),
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0].object.id).toBe('l1');
    // Legacy parity: published joins nest the full datastore wrappers.
    expect(emitted[0].object.members[0].objectId).toBe('r1');
    expect(emitted[0].orderKey).toEqual([0]);
  });
});
