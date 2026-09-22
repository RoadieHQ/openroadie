import { vi, type Mock } from 'vitest';

import express from 'express';
import request from 'supertest';
import { RelationshipsController } from './RelationshipsController';
import { ObjectDao, RelationshipDao } from '../../database';
import { HttpAuthService } from '@roadiehq/extensions-api';
import { v4 as uuid } from 'uuid';
import { allowAllScopeService } from '@roadiehq/scopes';
import type { DatasourceEvents } from '../../webhooks/DatasourceEvents';

const scopeService = allowAllScopeService;
const workspaceId = 'workspace-1';

describe('RelationshipsController', () => {
  let app: express.Application;
  let mockObjectDao: {
    checkObjectExists: Mock;
  };
  let mockRelationshipDao: {
    upsertRelationship: Mock;
    upsertRelationships: Mock;
    getRelationship: Mock;
    deleteRelationship: Mock;
    queryAll: Mock;
    queryRelationshipsBySource: Mock;
    queryRelationshipsByDestination: Mock;
    deleteRelationshipsBySource: Mock;
    deleteRelationshipsByDestination: Mock;
    listRelationshipTypesByDatasource: Mock;
    listRelationshipTypes: Mock;
    summarizeGraphEdges: Mock;
  };

  let emitRelationshipsChanged: Mock;

  const testDatasourceId = '550e8400-e29b-41d4-a716-446655440000';
  const testDestDatasourceId = '660e8400-e29b-41d4-a716-446655440000';
  const testRelationshipId = '770e8400-e29b-41d4-a716-446655440000';

  beforeEach(async () => {
    mockObjectDao = {
      checkObjectExists: vi.fn().mockResolvedValue(true),
    };

    mockRelationshipDao = {
      upsertRelationship: vi.fn(),
      upsertRelationships: vi.fn(),
      getRelationship: vi.fn(),
      deleteRelationship: vi.fn(),
      queryAll: vi.fn(),
      queryRelationshipsBySource: vi.fn(),
      queryRelationshipsByDestination: vi.fn(),
      deleteRelationshipsBySource: vi.fn(),
      deleteRelationshipsByDestination: vi.fn(),
      listRelationshipTypesByDatasource: vi.fn(),
      listRelationshipTypes: vi.fn().mockResolvedValue([]),
      summarizeGraphEdges: vi
        .fn()
        .mockResolvedValue({ items: [], totalRelationships: 0 }),
    };

    const mockHttpAuth = {
      credentials: vi.fn().mockResolvedValue({
        principal: { type: 'user', userId: 'test-user' },
      }),
    } as unknown as HttpAuthService;

    emitRelationshipsChanged = vi.fn();

    const controller = new RelationshipsController({
      objectDao: mockObjectDao as unknown as ObjectDao,
      relationshipDao: mockRelationshipDao as unknown as RelationshipDao,
      httpAuth: mockHttpAuth,
      scopeService,
      events: { emitRelationshipsChanged } as unknown as DatasourceEvents,
      getWorkspaceId: () => workspaceId,
    });
    const router = await controller.getRouter();
    app = express();
    app.use('/relationships', router);
  });

  describe('PUT / (upsert single)', () => {
    it('returns 400 when required fields are missing', async () => {
      const response = await request(app)
        .put('/relationships')
        .send({ sourceDatasourceId: testDatasourceId });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });

    it('returns 400 for invalid sourceDatasourceId format', async () => {
      const response = await request(app).put('/relationships').send({
        sourceDatasourceId: 'not-a-uuid',
        sourceObjectId: 'obj-1',
        destinationDatasourceId: testDestDatasourceId,
        destinationObjectId: 'obj-2',
        relationshipType: 'depends_on',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('sourceDatasourceId');
    });

    it('returns 400 for invalid destinationDatasourceId format', async () => {
      const response = await request(app).put('/relationships').send({
        sourceDatasourceId: testDatasourceId,
        sourceObjectId: 'obj-1',
        destinationDatasourceId: 'not-a-uuid',
        destinationObjectId: 'obj-2',
        relationshipType: 'depends_on',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('destinationDatasourceId');
    });

    it('returns 400 when source object does not exist', async () => {
      mockObjectDao.checkObjectExists.mockResolvedValueOnce(false);

      const response = await request(app).put('/relationships').send({
        sourceDatasourceId: testDatasourceId,
        sourceObjectId: 'nonexistent',
        destinationDatasourceId: testDestDatasourceId,
        destinationObjectId: 'obj-2',
        relationshipType: 'depends_on',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Source object');
    });

    it('returns 400 when destination object does not exist', async () => {
      mockObjectDao.checkObjectExists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const response = await request(app).put('/relationships').send({
        sourceDatasourceId: testDatasourceId,
        sourceObjectId: 'obj-1',
        destinationDatasourceId: testDestDatasourceId,
        destinationObjectId: 'nonexistent',
        relationshipType: 'depends_on',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Destination object');
    });

    it('upserts a relationship and sets updatedBy from auth', async () => {
      const mockRelationship = {
        id: testRelationshipId,
        sourceDatasourceId: testDatasourceId,
        sourceObjectId: 'obj-1',
        destinationDatasourceId: testDestDatasourceId,
        destinationObjectId: 'obj-2',
        relationshipType: 'depends_on',
        updatedBy: 'test-user',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      mockRelationshipDao.upsertRelationship.mockResolvedValue(
        mockRelationship,
      );

      const response = await request(app).put('/relationships').send({
        sourceDatasourceId: testDatasourceId,
        sourceObjectId: 'obj-1',
        destinationDatasourceId: testDestDatasourceId,
        destinationObjectId: 'obj-2',
        relationshipType: 'depends_on',
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockRelationship);
      expect(mockRelationshipDao.upsertRelationship).toHaveBeenCalledWith(
        expect.objectContaining({
          updatedBy: 'test-user',
        }),
        workspaceId,
      );
    });
  });

  describe('PUT /bulk (upsert multiple)', () => {
    it('returns 400 when relationships is not an array', async () => {
      const response = await request(app)
        .put('/relationships/bulk')
        .send({ relationships: 'not-array' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('non-empty array');
    });

    it('returns 400 when relationships is empty', async () => {
      const response = await request(app)
        .put('/relationships/bulk')
        .send({ relationships: [] });

      expect(response.status).toBe(400);
    });

    it('returns 400 when a relationship is missing required fields', async () => {
      const response = await request(app)
        .put('/relationships/bulk')
        .send({
          relationships: [{ sourceDatasourceId: testDatasourceId }],
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 when source object does not exist', async () => {
      mockObjectDao.checkObjectExists.mockResolvedValue(false);

      const response = await request(app)
        .put('/relationships/bulk')
        .send({
          relationships: [
            {
              sourceDatasourceId: testDatasourceId,
              sourceObjectId: 'nonexistent',
              destinationDatasourceId: testDestDatasourceId,
              destinationObjectId: 'obj-2',
              relationshipType: 'depends_on',
            },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('does not exist');
    });

    it('returns 400 when destination object does not exist', async () => {
      mockObjectDao.checkObjectExists.mockImplementation(
        (datasourceId: string, objectId: string) => {
          if (
            datasourceId === testDestDatasourceId &&
            objectId === 'nonexistent'
          ) {
            return Promise.resolve(false);
          }
          return Promise.resolve(true);
        },
      );

      const response = await request(app)
        .put('/relationships/bulk')
        .send({
          relationships: [
            {
              sourceDatasourceId: testDatasourceId,
              sourceObjectId: 'obj-1',
              destinationDatasourceId: testDestDatasourceId,
              destinationObjectId: 'nonexistent',
              relationshipType: 'depends_on',
            },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('does not exist');
    });

    it('upserts multiple relationships', async () => {
      const mockResults = [
        {
          id: uuid(),
          sourceDatasourceId: testDatasourceId,
          sourceObjectId: 'obj-1',
          destinationDatasourceId: testDestDatasourceId,
          destinationObjectId: 'obj-2',
          relationshipType: 'depends_on',
          updatedBy: 'test-user',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ];
      mockRelationshipDao.upsertRelationships.mockResolvedValue(mockResults);

      const response = await request(app)
        .put('/relationships/bulk')
        .send({
          relationships: [
            {
              sourceDatasourceId: testDatasourceId,
              sourceObjectId: 'obj-1',
              destinationDatasourceId: testDestDatasourceId,
              destinationObjectId: 'obj-2',
              relationshipType: 'depends_on',
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResults);
      expect(mockRelationshipDao.upsertRelationships).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            updatedBy: 'test-user',
          }),
        ]),
        workspaceId,
      );
    });
  });

  describe('invalid UUID validation', () => {
    it.each([
      ['GET', '/relationships/not-a-uuid', 'Invalid relationship ID'],
      ['DELETE', '/relationships/not-a-uuid', 'Invalid relationship ID'],
      ['GET', '/relationships/source/not-a-uuid/obj-1', 'Invalid datasourceId'],
      [
        'DELETE',
        '/relationships/source/not-a-uuid/obj-1',
        'Invalid datasourceId',
      ],
      [
        'GET',
        '/relationships/destination/not-a-uuid/obj-1',
        'Invalid datasourceId',
      ],
      ['GET', '/relationships/types/not-a-uuid', 'Invalid datasourceId'],
    ])('returns 400 for %s %s', async (method, path, expectedError) => {
      const response =
        method === 'GET'
          ? await request(app).get(path)
          : await request(app).delete(path);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain(expectedError);
    });
  });

  describe('GET /:id', () => {
    it('returns 404 when relationship not found', async () => {
      mockRelationshipDao.getRelationship.mockResolvedValue(undefined);

      const response = await request(app).get(
        `/relationships/${testRelationshipId}`,
      );

      expect(response.status).toBe(404);
    });

    it('returns relationship when found', async () => {
      const mockRelationship = {
        id: testRelationshipId,
        relationshipType: 'depends_on',
      };
      mockRelationshipDao.getRelationship.mockResolvedValue(mockRelationship);

      const response = await request(app).get(
        `/relationships/${testRelationshipId}`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockRelationship);
    });
  });

  describe('DELETE /:id', () => {
    it('deletes relationship', async () => {
      mockRelationshipDao.deleteRelationship.mockResolvedValue(undefined);

      const response = await request(app).delete(
        `/relationships/${testRelationshipId}`,
      );

      expect(response.status).toBe(204);
      expect(mockRelationshipDao.deleteRelationship).toHaveBeenCalledWith(
        testRelationshipId,
        workspaceId,
      );
    });
  });

  describe('GET / (query all)', () => {
    it('passes direct=true to the dao as a boolean', async () => {
      mockRelationshipDao.queryAll.mockResolvedValue({ items: [], total: 0 });

      const response = await request(app).get('/relationships?direct=true');

      expect(response.status).toBe(200);
      expect(mockRelationshipDao.queryAll).toHaveBeenCalledWith(
        expect.objectContaining({ direct: true }),
      );
    });

    it('does not filter by direct when the param is absent', async () => {
      mockRelationshipDao.queryAll.mockResolvedValue({ items: [], total: 0 });

      await request(app).get('/relationships');

      expect(mockRelationshipDao.queryAll).toHaveBeenCalledWith(
        expect.objectContaining({ direct: undefined }),
      );
    });
  });

  describe('GET /source/:datasourceId/:objectId', () => {
    it('returns outgoing relationships', async () => {
      const mockResult = { items: [], total: 0 };
      mockRelationshipDao.queryRelationshipsBySource.mockResolvedValue(
        mockResult,
      );

      const response = await request(app).get(
        `/relationships/source/${testDatasourceId}/obj-1`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
      expect(
        mockRelationshipDao.queryRelationshipsBySource,
      ).toHaveBeenCalledWith(testDatasourceId, 'obj-1', {
        workspaceId,
        relationshipType: undefined,
        limit: undefined,
        offset: undefined,
        origin: undefined,
        ruleId: undefined,
        direct: undefined,
      });
    });

    it('passes query params to dao', async () => {
      mockRelationshipDao.queryRelationshipsBySource.mockResolvedValue({
        items: [],
        total: 0,
      });

      await request(app).get(
        `/relationships/source/${testDatasourceId}/obj-1?relationshipType=depends_on&limit=10&offset=5`,
      );

      expect(
        mockRelationshipDao.queryRelationshipsBySource,
      ).toHaveBeenCalledWith(testDatasourceId, 'obj-1', {
        workspaceId,
        relationshipType: 'depends_on',
        limit: 10,
        offset: 5,
        origin: undefined,
        ruleId: undefined,
        direct: undefined,
      });
    });

    it('passes origin and ruleId query params to dao', async () => {
      const ruleId = uuid();
      mockRelationshipDao.queryRelationshipsBySource.mockResolvedValue({
        items: [],
        total: 0,
      });

      await request(app).get(
        `/relationships/source/${testDatasourceId}/obj-1?origin=generated&ruleId=${ruleId}`,
      );

      expect(
        mockRelationshipDao.queryRelationshipsBySource,
      ).toHaveBeenCalledWith(testDatasourceId, 'obj-1', {
        workspaceId,
        relationshipType: undefined,
        limit: undefined,
        offset: undefined,
        origin: 'generated',
        ruleId,
        direct: undefined,
      });
    });
  });

  describe('DELETE /source/:datasourceId/:objectId', () => {
    it('deletes outgoing relationships', async () => {
      mockRelationshipDao.deleteRelationshipsBySource.mockResolvedValue(
        undefined,
      );

      const response = await request(app).delete(
        `/relationships/source/${testDatasourceId}/obj-1`,
      );

      expect(response.status).toBe(204);
      expect(
        mockRelationshipDao.deleteRelationshipsBySource,
      ).toHaveBeenCalledWith(testDatasourceId, 'obj-1', workspaceId);
    });
  });

  describe('GET /destination/:datasourceId/:objectId', () => {
    it('returns incoming relationships', async () => {
      const mockResult = { items: [], total: 0 };
      mockRelationshipDao.queryRelationshipsByDestination.mockResolvedValue(
        mockResult,
      );

      const response = await request(app).get(
        `/relationships/destination/${testDatasourceId}/obj-1`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
      expect(
        mockRelationshipDao.queryRelationshipsByDestination,
      ).toHaveBeenCalledWith(testDatasourceId, 'obj-1', {
        workspaceId,
        relationshipType: undefined,
        limit: undefined,
        offset: undefined,
        origin: undefined,
        ruleId: undefined,
        direct: undefined,
      });
    });

    it('passes origin and ruleId query params to dao', async () => {
      const ruleId = uuid();
      mockRelationshipDao.queryRelationshipsByDestination.mockResolvedValue({
        items: [],
        total: 0,
      });

      await request(app).get(
        `/relationships/destination/${testDatasourceId}/obj-1?origin=manual&ruleId=${ruleId}`,
      );

      expect(
        mockRelationshipDao.queryRelationshipsByDestination,
      ).toHaveBeenCalledWith(testDatasourceId, 'obj-1', {
        workspaceId,
        relationshipType: undefined,
        limit: undefined,
        offset: undefined,
        origin: 'manual',
        ruleId,
        direct: undefined,
      });
    });
  });

  describe('DELETE /destination/:datasourceId/:objectId', () => {
    it('deletes incoming relationships', async () => {
      mockRelationshipDao.deleteRelationshipsByDestination.mockResolvedValue(
        undefined,
      );

      const response = await request(app).delete(
        `/relationships/destination/${testDatasourceId}/obj-1`,
      );

      expect(response.status).toBe(204);
      expect(
        mockRelationshipDao.deleteRelationshipsByDestination,
      ).toHaveBeenCalledWith(testDatasourceId, 'obj-1', workspaceId);
    });
  });

  describe('GET /types/:datasourceId', () => {
    it('returns relationship types', async () => {
      mockRelationshipDao.listRelationshipTypesByDatasource.mockResolvedValue([
        'depends_on',
        'owned_by',
      ]);

      const response = await request(app).get(
        `/relationships/types/${testDatasourceId}`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ items: ['depends_on', 'owned_by'] });
    });
  });

  describe('GET /relationships/summary', () => {
    it('is not swallowed by the /:id route', async () => {
      const response = await request(app).get('/relationships/summary');
      expect(response.status).toBe(200);
      expect(mockRelationshipDao.summarizeGraphEdges).toHaveBeenCalled();
    });

    it('parses csv scope and filter params', async () => {
      await request(app).get(
        `/relationships/summary?datasourceIds=${testDatasourceId},${testDestDatasourceId}` +
          '&relationshipTypes=owns,uses&origin=direct',
      );
      expect(mockRelationshipDao.summarizeGraphEdges).toHaveBeenCalledWith({
        workspaceId,
        datasourceIds: [testDatasourceId, testDestDatasourceId],
        relationshipTypes: ['owns', 'uses'],
        origin: 'direct',
      });
    });

    it('rejects invalid datasourceIds and origin', async () => {
      const badIds = await request(app).get(
        '/relationships/summary?datasourceIds=nope',
      );
      expect(badIds.status).toBe(400);

      const badOrigin = await request(app).get(
        '/relationships/summary?origin=alien',
      );
      expect(badOrigin.status).toBe(400);
    });

    it('returns the aggregate payload', async () => {
      mockRelationshipDao.summarizeGraphEdges.mockResolvedValue({
        items: [
          {
            sourceDatasourceId: testDatasourceId,
            destinationDatasourceId: testDestDatasourceId,
            relationshipType: 'owns',
            count: 12,
          },
        ],
        totalRelationships: 12,
      });
      const response = await request(app).get('/relationships/summary');
      expect(response.status).toBe(200);
      expect(response.body.totalRelationships).toBe(12);
      expect(response.body.items).toHaveLength(1);
    });
  });

  describe('GET /relationships/types', () => {
    it('is not swallowed by the /:id route', async () => {
      mockRelationshipDao.listRelationshipTypes.mockResolvedValue([
        'owns',
        'uses',
      ]);
      const response = await request(app).get('/relationships/types');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ items: ['owns', 'uses'] });
      expect(mockRelationshipDao.listRelationshipTypes).toHaveBeenCalledWith({
        workspaceId,
        datasourceIds: undefined,
      });
    });

    it('passes the datasource scope through', async () => {
      await request(app).get(
        `/relationships/types?datasourceIds=${testDatasourceId}`,
      );
      expect(mockRelationshipDao.listRelationshipTypes).toHaveBeenCalledWith({
        workspaceId,
        datasourceIds: [testDatasourceId],
      });
    });

    it('rejects invalid datasourceIds', async () => {
      const response = await request(app).get(
        '/relationships/types?datasourceIds=nope',
      );
      expect(response.status).toBe(400);
    });

    it('keeps the per-datasource route working', async () => {
      mockRelationshipDao.listRelationshipTypesByDatasource.mockResolvedValue([
        'owned_by',
      ]);
      const response = await request(app).get(
        `/relationships/types/${testDatasourceId}`,
      );
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ items: ['owned_by'] });
    });
  });

  // Context groups materialize merges from edges, so every direct edge write
  // must announce the change — otherwise groups built on a manually drawn
  // edge (or missing a deleted one) go stale until the next ingest.
  describe('relationships-changed notifications', () => {
    it('emits for both datasources on a single upsert', async () => {
      mockRelationshipDao.upsertRelationship.mockResolvedValue({
        id: testRelationshipId,
      });

      const response = await request(app).put('/relationships').send({
        sourceDatasourceId: testDatasourceId,
        sourceObjectId: 'obj-1',
        destinationDatasourceId: testDestDatasourceId,
        destinationObjectId: 'obj-2',
        relationshipType: 'samePerson',
      });

      expect(response.status).toBe(200);
      expect(emitRelationshipsChanged.mock.calls.map(c => c[0]).sort()).toEqual(
        [testDatasourceId, testDestDatasourceId].sort(),
      );
      expect(
        emitRelationshipsChanged.mock.calls.every(c => c[1] === workspaceId),
      ).toBe(true);
    });

    it('emits once per involved datasource on a bulk upsert', async () => {
      mockRelationshipDao.upsertRelationships.mockResolvedValue([]);

      const edge = (sourceObjectId: string) => ({
        sourceDatasourceId: testDatasourceId,
        sourceObjectId,
        destinationDatasourceId: testDestDatasourceId,
        destinationObjectId: `dest-of-${sourceObjectId}`,
        relationshipType: 'samePerson',
      });
      const response = await request(app)
        .put('/relationships/bulk')
        .send({ relationships: [edge('obj-1'), edge('obj-2')] });

      expect(response.status).toBe(200);
      expect(emitRelationshipsChanged.mock.calls.map(c => c[0]).sort()).toEqual(
        [testDatasourceId, testDestDatasourceId].sort(),
      );
    });

    it('emits for the deleted edge’s datasources', async () => {
      mockRelationshipDao.getRelationship.mockResolvedValue({
        id: testRelationshipId,
        sourceDatasourceId: testDatasourceId,
        destinationDatasourceId: testDestDatasourceId,
      });

      const response = await request(app).delete(
        `/relationships/${testRelationshipId}`,
      );

      expect(response.status).toBe(204);
      expect(emitRelationshipsChanged.mock.calls.map(c => c[0]).sort()).toEqual(
        [testDatasourceId, testDestDatasourceId].sort(),
      );
    });

    it('does not emit when the deleted edge does not exist', async () => {
      mockRelationshipDao.getRelationship.mockResolvedValue(undefined);

      const response = await request(app).delete(
        `/relationships/${testRelationshipId}`,
      );

      expect(response.status).toBe(204);
      expect(emitRelationshipsChanged).not.toHaveBeenCalled();
    });

    it('emits on delete-by-source and delete-by-destination', async () => {
      await request(app).delete(
        `/relationships/source/${testDatasourceId}/obj-1`,
      );
      expect(emitRelationshipsChanged).toHaveBeenCalledWith(
        testDatasourceId,
        workspaceId,
      );

      emitRelationshipsChanged.mockClear();
      await request(app).delete(
        `/relationships/destination/${testDestDatasourceId}/obj-2`,
      );
      expect(emitRelationshipsChanged).toHaveBeenCalledWith(
        testDestDatasourceId,
        workspaceId,
      );
    });
  });
});
