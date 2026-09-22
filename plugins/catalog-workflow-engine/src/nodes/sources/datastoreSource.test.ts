import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDatastoreSource } from './datastoreSource';
import { NODE_TYPES } from '@roadiehq/catalog-workflow-common';
import type { CatalogDatastoreService } from '@roadiehq/catalog-datastore-node';

type StoredObject = Record<string, unknown>;

const createDatastore = (objects: StoredObject[]) => {
  const getDatasourceItems = vi.fn(
    async (
      datasourceId: string,
      options?: { limit?: number; offset?: number },
    ) => {
      if (datasourceId === 'unknown-ds') {
        throw new Error(`Data source not found: ${datasourceId}`);
      }
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 50;
      return {
        items: objects.slice(offset, offset + limit),
        total: objects.length,
      };
    },
  );
  return {
    replaceDatasourceItems: vi.fn(),
    getDatasourceItems,
  } as unknown as CatalogDatastoreService & {
    getDatasourceItems: typeof getDatasourceItems;
  };
};

const createMockContext = (
  config: Record<string, unknown>,
  extras?: { previewLimit?: number },
) => ({
  config,
  log: vi.fn(),
  signal: { aborted: false },
  executionId: 'test-execution-123',
  workspaceId: 'workspace-1',
  previewLimit: extras?.previewLimit,
});

describe('buildDatastoreSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('node definition', () => {
    const node = buildDatastoreSource({ datastore: createDatastore([]) });

    it('exposes the expected node definition', () => {
      expect(node.type).toBe(NODE_TYPES.SOURCE_DATASTORE);
      expect(node.category).toBe('source');
      expect(node.supportsDryRun).toBe(true);
      expect(node.configSchema).toMatchObject({
        required: ['datasourceId'],
      });
    });
  });

  describe('pagedHandler', () => {
    const createPagedContext = (
      config: Record<string, unknown>,
      extras?: { previewLimit?: number },
    ) => {
      const emitted: Array<{ object: unknown; orderKey: readonly number[] }> =
        [];
      return {
        emitted,
        ctx: {
          ...createMockContext(config, extras),
          io: {
            inputs: new Map(),
            emit: async (items: any[]) => {
              emitted.push(...items);
            },
          },
        },
      };
    };

    it('emits every stored object with its fetch ordinal as order key', async () => {
      const objects = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      const node = buildDatastoreSource({
        datastore: createDatastore(objects),
      });
      const { ctx, emitted } = createPagedContext({ datasourceId: 'ds-1' });

      await node.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual(objects);
      expect(emitted.map(i => i.orderKey)).toEqual([[0], [1], [2]]);
    });

    it('caps at the smaller of the configured limit and previewLimit', async () => {
      const objects = Array.from({ length: 100 }, (_, i) => ({ id: `o-${i}` }));
      const node = buildDatastoreSource({
        datastore: createDatastore(objects),
      });
      const { ctx, emitted } = createPagedContext(
        { datasourceId: 'ds-1', limit: 20 },
        { previewLimit: 3 },
      );

      await node.pagedHandler!(ctx as any);

      expect(emitted).toHaveLength(3);
    });

    it('throws when datasourceId is missing', async () => {
      const node = buildDatastoreSource({ datastore: createDatastore([]) });
      const { ctx } = createPagedContext({});

      await expect(node.pagedHandler!(ctx as any)).rejects.toThrow(
        'Data source is required',
      );
    });

    it('propagates the unknown-datasource error from the service', async () => {
      const node = buildDatastoreSource({ datastore: createDatastore([]) });
      const { ctx } = createPagedContext({ datasourceId: 'unknown-ds' });

      await expect(node.pagedHandler!(ctx as any)).rejects.toThrow(
        'Data source not found: unknown-ds',
      );
    });

    it('emits nothing for an empty data source', async () => {
      const node = buildDatastoreSource({ datastore: createDatastore([]) });
      const { ctx, emitted } = createPagedContext({ datasourceId: 'ds-1' });

      await node.pagedHandler!(ctx as any);

      expect(emitted).toEqual([]);
    });

    it('pages through the data source across multiple fetches', async () => {
      const objects = Array.from({ length: 1250 }, (_, i) => ({
        id: `o-${i}`,
      }));
      const datastore = createDatastore(objects);
      const node = buildDatastoreSource({ datastore });
      const { ctx, emitted } = createPagedContext({ datasourceId: 'ds-1' });

      await node.pagedHandler!(ctx as any);

      expect(emitted).toHaveLength(1250);
      expect(emitted[0].object).toEqual({ id: 'o-0' });
      expect(emitted[1249].object).toEqual({ id: 'o-1249' });
      expect(datastore.getDatasourceItems).toHaveBeenCalledTimes(3);
      expect(datastore.getDatasourceItems).toHaveBeenNthCalledWith(1, 'ds-1', {
        workspaceId: 'workspace-1',
        limit: 500,
        offset: 0,
      });
      expect(datastore.getDatasourceItems).toHaveBeenNthCalledWith(3, 'ds-1', {
        workspaceId: 'workspace-1',
        limit: 500,
        offset: 1000,
      });
    });

    it('fetches only previewLimit items during a dry run', async () => {
      const objects = Array.from({ length: 100 }, (_, i) => ({ id: `o-${i}` }));
      const datastore = createDatastore(objects);
      const node = buildDatastoreSource({ datastore });
      const { ctx, emitted } = createPagedContext(
        { datasourceId: 'ds-1' },
        { previewLimit: 10 },
      );

      await node.pagedHandler!(ctx as any);

      expect(emitted).toHaveLength(10);
      expect(datastore.getDatasourceItems).toHaveBeenCalledTimes(1);
      expect(datastore.getDatasourceItems).toHaveBeenCalledWith('ds-1', {
        workspaceId: 'workspace-1',
        limit: 10,
        offset: 0,
      });
    });
  });
});
