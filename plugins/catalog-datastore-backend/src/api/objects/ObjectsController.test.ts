import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { ObjectsController } from './ObjectsController';
import type {
  ObjectDao,
  SchemaDao,
  RelationshipDao,
  ContextGroupDao,
  DatastoreRepository,
} from '../../database';
import { allowAllScopeService } from '@roadiehq/scopes';

const scopeService = allowAllScopeService;
const workspaceId = 'workspace-1';

describe('ObjectsController', () => {
  let app: express.Application;
  let mockObjectDao: {
    queryAll: Mock;
    query: Mock;
    countByDatasource: Mock;
    deleteAllDatastoreItems: Mock;
  };
  let mockSchemaDao: {
    deleteDatasourceSchemas: Mock;
  };
  let mockContextGroupDao: {
    findGroupsForObjects: Mock;
  };

  beforeEach(async () => {
    mockObjectDao = {
      queryAll: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      query: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      countByDatasource: vi.fn().mockResolvedValue([]),
      deleteAllDatastoreItems: vi.fn().mockResolvedValue(undefined),
    };
    mockSchemaDao = {
      deleteDatasourceSchemas: vi.fn().mockResolvedValue(undefined),
    };
    mockContextGroupDao = {
      findGroupsForObjects: vi.fn().mockResolvedValue(new Map()),
    };

    const controller = new ObjectsController({
      objectDao: mockObjectDao as unknown as ObjectDao,
      schemaDao: mockSchemaDao as unknown as SchemaDao,
      relationshipDao: {} as unknown as RelationshipDao,
      contextGroupDao: mockContextGroupDao as unknown as ContextGroupDao,
      datastoreRepository: {} as unknown as DatastoreRepository,
      scopeService,
      getWorkspaceId: () => workspaceId,
    });
    const router = await controller.getRouter();

    app = express();
    app.use('/objects', router);
  });

  describe('GET /objects/counts', () => {
    it('returns per-datasource object counts from the datastore', async () => {
      mockObjectDao.countByDatasource.mockResolvedValue([
        { datasourceId: 'a4f8f3f0-0000-0000-0000-000000000001', count: 17 },
        { datasourceId: 'a4f8f3f0-0000-0000-0000-000000000002', count: 3 },
      ]);

      const res = await request(app).get('/objects/counts');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [
          { datasourceId: 'a4f8f3f0-0000-0000-0000-000000000001', count: 17 },
          { datasourceId: 'a4f8f3f0-0000-0000-0000-000000000002', count: 3 },
        ],
      });
    });

    it('is not shadowed by the /:datasourceId route', async () => {
      const res = await request(app).get('/objects/counts');

      expect(res.status).toBe(200);
      expect(mockObjectDao.countByDatasource).toHaveBeenCalledTimes(1);
      expect(mockObjectDao.query).not.toHaveBeenCalled();
    });

    it('returns 500 when the DAO fails', async () => {
      mockObjectDao.countByDatasource.mockRejectedValue(new Error('boom'));

      const res = await request(app).get('/objects/counts');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'boom' });
    });
  });

  describe('GET /objects', () => {
    it('passes sorting params through to queryAll', async () => {
      const res = await request(app).get(
        '/objects?limit=10&offset=20&sortByIndex=relationshipCount&sortOrder=desc',
      );

      expect(res.status).toBe(200);
      expect(mockObjectDao.queryAll).toHaveBeenCalledWith({
        workspaceId,
        limit: 10,
        offset: 20,
        orderBy: 'relationshipCount',
        sortOrder: 'desc',
      });
    });

    it('passes a datasourceIds filter through to queryAll', async () => {
      const dsA = '550e8400-e29b-41d4-a716-446655440000';
      const dsB = '550e8400-e29b-41d4-a716-446655440001';

      const res = await request(app).get(
        `/objects?datasourceIds=${dsA},${dsB}`,
      );

      expect(res.status).toBe(200);
      expect(mockObjectDao.queryAll).toHaveBeenCalledWith(
        expect.objectContaining({ datasourceIds: [dsA, dsB] }),
      );
    });

    it('rejects a datasourceIds filter containing a non-uuid', async () => {
      const res = await request(app).get(
        '/objects?datasourceIds=not-a-uuid,550e8400-e29b-41d4-a716-446655440000',
      );

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid datasourceIds' });
      expect(mockObjectDao.queryAll).not.toHaveBeenCalled();
    });

    it('enriches all-object results with context groups', async () => {
      mockObjectDao.queryAll.mockResolvedValue({
        items: [
          {
            id: 'row-1',
            datasourceId: '550e8400-e29b-41d4-a716-446655440000',
            objectId: 'obj-1',
            object: {},
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
      });
      mockContextGroupDao.findGroupsForObjects.mockResolvedValue(
        new Map([
          [
            '550e8400-e29b-41d4-a716-446655440000:obj-1',
            [
              {
                groupId: 'group-1',
                ruleId: 'rule-1',
                ruleName: 'Teams',
                title: 'Teams: Alpha',
              },
            ],
          ],
        ]),
      );

      const res = await request(app).get('/objects');

      expect(res.status).toBe(200);
      expect(res.body.items[0].contextGroups).toEqual([
        {
          groupId: 'group-1',
          ruleId: 'rule-1',
          ruleName: 'Teams',
          title: 'Teams: Alpha',
        },
      ]);
      expect(mockContextGroupDao.findGroupsForObjects).toHaveBeenCalledWith(
        [
          {
            datasourceId: '550e8400-e29b-41d4-a716-446655440000',
            objectId: 'obj-1',
          },
        ],
        workspaceId,
      );
    });
  });

  describe('DELETE /objects/:datasourceId', () => {
    it('removes the datasource objects and schemas', async () => {
      const datasourceId = '550e8400-e29b-41d4-a716-446655440000';

      const res = await request(app).delete(`/objects/${datasourceId}`);

      expect(res.status).toBe(204);
      expect(mockObjectDao.deleteAllDatastoreItems).toHaveBeenCalledWith(
        datasourceId,
        workspaceId,
      );
      expect(mockSchemaDao.deleteDatasourceSchemas).toHaveBeenCalledWith(
        datasourceId,
        workspaceId,
      );
    });
  });

  describe('GET /objects/:datasourceId', () => {
    it('enriches datasource results with context groups', async () => {
      const datasourceId = '550e8400-e29b-41d4-a716-446655440000';
      mockObjectDao.query.mockResolvedValue({
        items: [
          {
            id: 'row-1',
            datasourceId,
            objectId: 'obj-1',
            object: {},
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
      });
      mockContextGroupDao.findGroupsForObjects.mockResolvedValue(
        new Map([
          [
            `${datasourceId}:obj-1`,
            [
              {
                groupId: 'group-1',
                ruleId: 'rule-1',
                ruleName: 'Teams',
                title: 'Teams: Alpha',
              },
            ],
          ],
        ]),
      );

      const res = await request(app).get(`/objects/${datasourceId}`);

      expect(res.status).toBe(200);
      expect(res.body.items[0].contextGroups).toEqual([
        {
          groupId: 'group-1',
          ruleId: 'rule-1',
          ruleName: 'Teams',
          title: 'Teams: Alpha',
        },
      ]);
    });
  });
});

describe('ObjectsController graph traversal endpoints', () => {
  const DS = '550e8400-e29b-41d4-a716-446655440001';
  const DS_2 = '550e8400-e29b-41d4-a716-446655440002';

  let app: express.Application;
  let mockObjectDao: {
    checkObjectExists: Mock;
    queryGraphNodesByRefs: Mock;
  };
  let mockRelationshipDao: {
    traverseFromRoot: Mock;
    findPaths: Mock;
    getGraphRelationshipsByIds: Mock;
  };

  const nodeSummary = (objectId: string) => ({
    id: `row-${objectId}`,
    datasourceId: DS,
    objectId,
    label: objectId,
    displayName: objectId,
    presentation: { title: objectId },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  beforeEach(async () => {
    mockObjectDao = {
      checkObjectExists: vi.fn().mockResolvedValue(true),
      queryGraphNodesByRefs: vi.fn().mockResolvedValue([]),
    };
    mockRelationshipDao = {
      traverseFromRoot: vi.fn().mockResolvedValue({
        nodes: [],
        relationships: [],
        hiddenNeighborCounts: new Map(),
        truncated: false,
      }),
      findPaths: vi.fn().mockResolvedValue({ paths: [], truncated: false }),
      getGraphRelationshipsByIds: vi.fn().mockResolvedValue([]),
    };

    const controller = new ObjectsController({
      objectDao: mockObjectDao as unknown as ObjectDao,
      schemaDao: {} as unknown as SchemaDao,
      relationshipDao: mockRelationshipDao as unknown as RelationshipDao,
      contextGroupDao: {} as unknown as ContextGroupDao,
      datastoreRepository: {} as unknown as DatastoreRepository,
      scopeService,
      getWorkspaceId: () => workspaceId,
    });
    const router = await controller.getRouter();

    app = express();
    app.use('/objects', router);
  });

  describe('GET /objects/graph/rooted', () => {
    const base = `/objects/graph/rooted?rootDatasourceId=${DS}&rootObjectId=a1`;

    it('is not shadowed by the /:datasourceId route', async () => {
      const res = await request(app).get(base);
      expect(res.status).toBe(200);
    });

    it('rejects a non-uuid root datasource id', async () => {
      const res = await request(app).get(
        '/objects/graph/rooted?rootDatasourceId=nope&rootObjectId=a1',
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid rootDatasourceId');
    });

    it('rejects a missing root object id', async () => {
      const res = await request(app).get(
        `/objects/graph/rooted?rootDatasourceId=${DS}`,
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid rootObjectId');
    });

    it('rejects bad direction, origin, datasourceIds and depth', async () => {
      for (const [param, error] of [
        ['direction=sideways', 'Invalid direction'],
        ['origin=alien', 'Invalid origin'],
        ['datasourceIds=not-a-uuid', 'Invalid datasourceIds'],
        ['depth=abc', 'Invalid depth'],
      ] as const) {
        const res = await request(app).get(`${base}&${param}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe(error);
      }
    });

    it('404s when the root object does not exist', async () => {
      mockObjectDao.checkObjectExists.mockResolvedValue(false);
      const res = await request(app).get(base);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Root object not found');
    });

    it('applies defaults and clamps params before the DAO call', async () => {
      await request(app).get(
        `${base}&depth=99&nodeLimit=100000&direction=out&origin=rule` +
          `&relationshipTypes=owns,%20uses&datasourceIds=${DS},${DS_2}`,
      );
      expect(mockRelationshipDao.traverseFromRoot).toHaveBeenCalledWith({
        workspaceId,
        root: { datasourceId: DS, objectId: 'a1' },
        depth: 3,
        nodeLimit: 500,
        filters: {
          direction: 'out',
          datasourceIds: [DS, DS_2],
          relationshipTypes: ['owns', 'uses'],
          origin: 'rule',
        },
      });
    });

    it('assembles the rooted result with depth and hidden counts', async () => {
      mockRelationshipDao.traverseFromRoot.mockResolvedValue({
        nodes: [
          { datasourceId: DS, objectId: 'a1', depth: 0 },
          { datasourceId: DS, objectId: 'a2', depth: 1 },
        ],
        relationships: [{ id: 'e1' }],
        hiddenNeighborCounts: new Map([[`${DS}:a2`, 4]]),
        truncated: true,
      });
      mockObjectDao.queryGraphNodesByRefs.mockResolvedValue([
        nodeSummary('a2'),
        nodeSummary('a1'),
      ]);

      const res = await request(app).get(base);

      expect(res.status).toBe(200);
      expect(res.body.rootNodeId).toBe(`${DS}:a1`);
      expect(res.body.truncated).toBe(true);
      expect(res.body.totals).toEqual({ objects: 2, relationships: 1 });
      // Traversal order wins over the label query's row order.
      expect(
        res.body.nodes.map((node: { objectId: string }) => node.objectId),
      ).toEqual(['a1', 'a2']);
      expect(res.body.nodes[0].depth).toBe(0);
      expect(res.body.nodes[0].hiddenNeighborCount).toBe(0);
      expect(res.body.nodes[1].depth).toBe(1);
      expect(res.body.nodes[1].hiddenNeighborCount).toBe(4);
    });
  });

  describe('GET /objects/graph/paths', () => {
    const base =
      `/objects/graph/paths?sourceDatasourceId=${DS}&sourceObjectId=s` +
      `&targetDatasourceId=${DS}&targetObjectId=t`;

    it('rejects identical source and target', async () => {
      const res = await request(app).get(
        `/objects/graph/paths?sourceDatasourceId=${DS}&sourceObjectId=s` +
          `&targetDatasourceId=${DS}&targetObjectId=s`,
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        'Source and target must be different objects',
      );
    });

    it('404s when an endpoint object does not exist', async () => {
      mockObjectDao.checkObjectExists.mockImplementation(
        async (_ds: string, objectId: string) => objectId !== 't',
      );
      const res = await request(app).get(base);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Target object not found');
    });

    it('applies defaults and clamps maxDepth/pathLimit', async () => {
      await request(app).get(`${base}&maxDepth=99&pathLimit=9999`);
      expect(mockRelationshipDao.findPaths).toHaveBeenCalledWith({
        workspaceId,
        source: { datasourceId: DS, objectId: 's' },
        target: { datasourceId: DS, objectId: 't' },
        maxDepth: 6,
        pathLimit: 50,
        filters: {
          direction: 'both',
          datasourceIds: undefined,
          relationshipTypes: undefined,
          origin: undefined,
        },
      });
    });

    it('unions path nodes/edges into the merged subgraph', async () => {
      mockRelationshipDao.findPaths.mockResolvedValue({
        paths: [
          {
            nodes: [
              { datasourceId: DS, objectId: 's' },
              { datasourceId: DS, objectId: 'x' },
              { datasourceId: DS, objectId: 't' },
            ],
            relationshipIds: ['e1', 'e2'],
            hops: 2,
          },
          {
            nodes: [
              { datasourceId: DS, objectId: 's' },
              { datasourceId: DS, objectId: 't' },
            ],
            relationshipIds: ['e3'],
            hops: 1,
          },
        ],
        truncated: false,
      });
      mockObjectDao.queryGraphNodesByRefs.mockResolvedValue([
        nodeSummary('s'),
        nodeSummary('x'),
        nodeSummary('t'),
      ]);
      mockRelationshipDao.getGraphRelationshipsByIds.mockResolvedValue([
        { id: 'e1' },
        { id: 'e2' },
        { id: 'e3' },
      ]);

      const res = await request(app).get(base);

      expect(res.status).toBe(200);
      // Deduped union: s/x/t once each despite appearing in both paths.
      expect(mockObjectDao.queryGraphNodesByRefs).toHaveBeenCalledWith(
        [
          { datasourceId: DS, objectId: 's' },
          { datasourceId: DS, objectId: 'x' },
          { datasourceId: DS, objectId: 't' },
        ],
        workspaceId,
      );
      expect(
        mockRelationshipDao.getGraphRelationshipsByIds,
      ).toHaveBeenCalledWith(['e1', 'e2', 'e3'], workspaceId);
      expect(res.body.paths).toHaveLength(2);
      expect(res.body.totals).toEqual({ objects: 3, relationships: 3 });
    });
  });
});
