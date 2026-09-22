import express from 'express';
import request from 'supertest';
import { vi } from 'vitest';
import { allowAllScopeService } from '@roadiehq/scopes';
import { createGraphLayoutsRouter } from './graphLayouts';

const workspaceId = '22222222-2222-4222-8222-222222222222';
const layout = {
  id: 'layout-1',
  name: 'datasources',
  nodes: [],
  edges: [],
  viewport: null,
  updatedBy: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('createGraphLayoutsRouter', () => {
  it('scopes every graph layout operation to the request workspace', async () => {
    const graphLayoutDao = {
      list: vi.fn().mockResolvedValue([layout]),
      getByName: vi.fn().mockResolvedValue(layout),
      upsert: vi.fn().mockResolvedValue(layout),
      delete: vi.fn().mockResolvedValue(true),
    };
    const app = express();
    app.use(express.json());
    app.use(
      createGraphLayoutsRouter({
        graphLayoutDao,
        getUserId: async () => 'user:default/test',
        getWorkspaceId: () => workspaceId,
        scopeService: allowAllScopeService,
      }),
    );

    await request(app).get('/').expect(200);
    await request(app).get('/datasources').expect(200);
    await request(app).put('/datasources').send({ nodes: [] }).expect(200);
    await request(app).delete('/datasources').expect(204);

    expect(graphLayoutDao.list).toHaveBeenCalledWith(workspaceId);
    expect(graphLayoutDao.getByName).toHaveBeenCalledWith(
      'datasources',
      workspaceId,
    );
    expect(graphLayoutDao.upsert).toHaveBeenCalledWith(
      'datasources',
      expect.objectContaining({ updatedBy: 'user:default/test' }),
      workspaceId,
    );
    expect(graphLayoutDao.delete).toHaveBeenCalledWith(
      'datasources',
      workspaceId,
    );
  });
});
