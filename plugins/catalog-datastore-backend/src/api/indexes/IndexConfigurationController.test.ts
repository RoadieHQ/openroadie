import { vi, type Mock } from 'vitest';

/*
 * Copyright 2026 Larder Software Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import express from 'express';
import request from 'supertest';
import { IndexConfigurationController } from './IndexConfigurationController';
import { IndexDao, DatastoreRepository } from '../../database';
import { allowAllScopeService } from '@roadiehq/scopes';

const scopeService = allowAllScopeService;
const workspaceId = 'workspace-1';

describe('IndexConfigurationController', () => {
  let app: express.Application;
  let mockIndexDao: {
    listIndexConfigurations: Mock;
    getIndexConfiguration: Mock;
    deleteIndexConfiguration: Mock;
    deleteAllIndexConfigurations: Mock;
  };
  let mockDatastoreService: {
    createIndexConfiguration: Mock;
  };

  beforeEach(async () => {
    mockIndexDao = {
      listIndexConfigurations: vi.fn(),
      getIndexConfiguration: vi.fn(),
      deleteIndexConfiguration: vi.fn(),
      deleteAllIndexConfigurations: vi.fn(),
    };
    mockDatastoreService = {
      createIndexConfiguration: vi.fn(),
    };

    const controller = new IndexConfigurationController({
      indexDao: mockIndexDao as unknown as IndexDao,
      datastoreRepository:
        mockDatastoreService as unknown as DatastoreRepository,
      scopeService,
      getWorkspaceId: () => workspaceId,
    });
    const router = await controller.getRouter();
    app = express();
    app.use('/indexes', router);
  });

  describe('invalid UUID validation', () => {
    it.each([
      [
        'GET',
        '/indexes/not-a-uuid',
        () => mockIndexDao.listIndexConfigurations,
      ],
      [
        'POST',
        '/indexes/not-a-uuid',
        () => mockDatastoreService.createIndexConfiguration,
      ],
      [
        'DELETE',
        '/indexes/not-a-uuid',
        () => mockIndexDao.deleteAllIndexConfigurations,
      ],
      [
        'GET',
        '/indexes/not-a-uuid/name',
        () => mockIndexDao.getIndexConfiguration,
      ],
      [
        'DELETE',
        '/indexes/not-a-uuid/name',
        () => mockIndexDao.deleteIndexConfiguration,
      ],
    ] as const)(
      'returns 400 for %s %s',
      async (method, path, daoMethodNotCalled) => {
        let req = request(app).get(path);
        if (method === 'POST') {
          req = request(app)
            .post(path)
            .send({ key: 'name', valueExpression: 'name' });
        } else if (method === 'DELETE') {
          req = request(app).delete(path);
        }
        const response = await req;

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid datasourceId' });
        expect(daoMethodNotCalled()).not.toHaveBeenCalled();
      },
    );
  });

  describe('GET /:datasourceId', () => {
    it('returns index configurations for valid UUID', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';
      const mockResult = [
        {
          id: '1',
          datasourceId: datastoreId,
          key: 'name',
          valueExpression: 'name',
        },
        {
          id: '2',
          datasourceId: datastoreId,
          key: 'type',
          valueExpression: 'type',
        },
      ];
      mockIndexDao.listIndexConfigurations.mockResolvedValue(mockResult);

      const response = await request(app).get(`/indexes/${datastoreId}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ items: mockResult });
      expect(mockIndexDao.listIndexConfigurations).toHaveBeenCalledWith(
        datastoreId,
        workspaceId,
      );
    });

    it('returns empty list when no configurations exist', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';
      mockIndexDao.listIndexConfigurations.mockResolvedValue([]);

      const response = await request(app).get(`/indexes/${datastoreId}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ items: [] });
    });

    it('returns 500 when dao throws an error', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';
      mockIndexDao.listIndexConfigurations.mockRejectedValue(
        new Error('Database connection failed'),
      );

      const response = await request(app).get(`/indexes/${datastoreId}`);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Database connection failed' });
    });
  });

  describe('POST /:datasourceId', () => {
    it('returns 400 when key is missing', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';

      const response = await request(app)
        .post(`/indexes/${datastoreId}`)
        .send({ valueExpression: 'name' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Invalid request: key and valueExpression are required',
      });
    });

    it('returns 400 when valueExpression is missing', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';

      const response = await request(app)
        .post(`/indexes/${datastoreId}`)
        .send({ key: 'name' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Invalid request: key and valueExpression are required',
      });
    });

    it('returns 400 for invalid JSONata expression', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';

      const response = await request(app)
        .post(`/indexes/${datastoreId}`)
        .send({ key: 'name', valueExpression: '{{invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(
        /Invalid value expression provided, it supports JSONata syntax/,
      );
      expect(response.body.error).not.toContain('[object Object]');
      expect(response.body.error).not.toContain('Unknown error');
    });

    it('returns 409 when index configuration already exists', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';
      mockIndexDao.getIndexConfiguration.mockResolvedValue({
        id: '1',
        datasourceId: datastoreId,
        key: 'name',
        valueExpression: 'name',
      });

      const response = await request(app)
        .post(`/indexes/${datastoreId}`)
        .send({ key: 'name', valueExpression: 'name' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: "Index configuration for key 'name' already exists",
      });
      expect(
        mockDatastoreService.createIndexConfiguration,
      ).not.toHaveBeenCalled();
    });

    it('creates index configuration successfully', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';
      mockIndexDao.getIndexConfiguration.mockResolvedValue(undefined);
      mockDatastoreService.createIndexConfiguration.mockResolvedValue(
        undefined,
      );

      const response = await request(app)
        .post(`/indexes/${datastoreId}`)
        .send({ key: 'name', valueExpression: 'name' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ success: true });
      expect(
        mockDatastoreService.createIndexConfiguration,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          datasourceId: datastoreId,
          key: 'name',
          valueExpression: 'name',
        }),
        workspaceId,
      );
    });

    it('returns 500 when dao throws an error', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';
      mockIndexDao.getIndexConfiguration.mockResolvedValue(undefined);
      mockDatastoreService.createIndexConfiguration.mockRejectedValue(
        new Error('Insert failed'),
      );

      const response = await request(app)
        .post(`/indexes/${datastoreId}`)
        .send({ key: 'name', valueExpression: 'name' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Insert failed' });
    });
  });

  describe('DELETE /:datasourceId', () => {
    it('deletes all index configurations for valid UUID', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';
      mockIndexDao.deleteAllIndexConfigurations.mockResolvedValue(undefined);

      const response = await request(app).delete(`/indexes/${datastoreId}`);

      expect(response.status).toBe(204);
      expect(mockIndexDao.deleteAllIndexConfigurations).toHaveBeenCalledWith(
        datastoreId,
        workspaceId,
      );
    });

    it('returns 500 when dao throws an error', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';
      mockIndexDao.deleteAllIndexConfigurations.mockRejectedValue(
        new Error('Delete failed'),
      );

      const response = await request(app).delete(`/indexes/${datastoreId}`);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Delete failed' });
    });
  });

  describe('GET /:datasourceId/:key', () => {
    it('returns 404 when index configuration not found', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';
      mockIndexDao.getIndexConfiguration.mockResolvedValue(undefined);

      const response = await request(app).get(`/indexes/${datastoreId}/name`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Index configuration not found' });
    });

    it('returns index configuration when found', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';
      const mockConfig = {
        id: '1',
        datasourceId: datastoreId,
        key: 'name',
        valueExpression: 'name',
      };
      mockIndexDao.getIndexConfiguration.mockResolvedValue(mockConfig);

      const response = await request(app).get(`/indexes/${datastoreId}/name`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockConfig);
      expect(mockIndexDao.getIndexConfiguration).toHaveBeenCalledWith(
        datastoreId,
        'name',
        workspaceId,
      );
    });

    it('returns 500 when dao throws an error', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';
      mockIndexDao.getIndexConfiguration.mockRejectedValue(
        new Error('Fetch failed'),
      );

      const response = await request(app).get(`/indexes/${datastoreId}/name`);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Fetch failed' });
    });
  });

  describe('DELETE /:datasourceId/:key', () => {
    it('deletes index configuration for valid IDs', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';
      mockIndexDao.deleteIndexConfiguration.mockResolvedValue(undefined);

      const response = await request(app).delete(
        `/indexes/${datastoreId}/name`,
      );

      expect(response.status).toBe(204);
      expect(mockIndexDao.deleteIndexConfiguration).toHaveBeenCalledWith(
        datastoreId,
        'name',
        workspaceId,
      );
    });

    it('returns 500 when dao throws an error', async () => {
      const datastoreId = '550e8400-e29b-41d4-a716-446655440000';
      mockIndexDao.deleteIndexConfiguration.mockRejectedValue(
        new Error('Delete failed'),
      );

      const response = await request(app).delete(
        `/indexes/${datastoreId}/name`,
      );

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Delete failed' });
    });
  });
});
