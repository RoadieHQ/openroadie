import express from 'express';
import request from 'supertest';
import { vi } from 'vitest';
import type { DatasourceActivityDao } from '../../database/DatasourceActivityDao';
import type { BearerVerifier } from '../../webhooks/verifiers';
import { DatasourcesController } from './DatasourcesController';

const workspaceId = '00000000-0000-4000-8000-000000000002';

describe('DatasourcesController workspace isolation', () => {
  it('scopes reconciliation reads to the bearer token workspace', async () => {
    const organizationWorkspaceId = '00000000-0000-4000-8000-000000000001';
    const activityDao = {
      listUpdatedSince: vi.fn(
        async (_since: string, requestedWorkspaceId: string) =>
          [
            {
              datasourceId: 'organization-datasource',
              updatedAt: '2026-09-01T01:00:00.000Z',
              workspaceId: organizationWorkspaceId,
            },
            {
              datasourceId: 'personal-datasource',
              updatedAt: '2026-09-01T02:00:00.000Z',
              workspaceId,
            },
          ].filter(item => item.workspaceId === requestedWorkspaceId),
      ),
    };
    const verifier: BearerVerifier = {
      verify: vi.fn(async () => ({ workspaceId })),
    };
    const controller = new DatasourcesController({
      activityDao: activityDao as unknown as DatasourceActivityDao,
      verifier,
    });
    const app = express();
    app.use('/datasources', await controller.getRouter());

    const since = '2026-09-01T00:00:00.000Z';
    const response = await request(app)
      .get(`/datasources?updated_since=${encodeURIComponent(since)}`)
      .set('Authorization', 'Bearer valid-token')
      .set('x-openroadie-workspace-id', organizationWorkspaceId)
      .expect(200);

    expect(response.body).toEqual({
      items: [
        {
          datasourceId: 'personal-datasource',
          updatedAt: '2026-09-01T02:00:00.000Z',
        },
      ],
    });
    expect(activityDao.listUpdatedSince).toHaveBeenCalledWith(
      since,
      workspaceId,
    );
  });
});
