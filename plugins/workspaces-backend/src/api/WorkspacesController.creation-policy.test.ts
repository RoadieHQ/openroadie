import express from 'express';
import { mockServices } from '@roadiehq/backend-test-utils';
import { allowAllScopeService } from '@roadiehq/scopes';
import { WorkspaceDao } from '../database';
import { WorkspacesController } from './WorkspacesController';

describe('WorkspacesController creation policy', () => {
  it('rejects workspace creation when the server policy is disabled', async () => {
    const controller = new WorkspacesController({
      workspaceDao: Object.create(WorkspaceDao.prototype),
      scopeService: allowAllScopeService,
      httpAuth: mockServices.httpAuth.mock(),
      workspaceService: {
        resolveWorkspaceId: vi.fn(),
        workspaceExists: vi.fn(),
      },
      workspaceCreationPolicy: {
        isCreationEnabled: vi.fn().mockResolvedValue(false),
      },
    });
    const app = express();
    app.use(controller.getRouter());

    const server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind to a TCP port');
    }

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Blocked',
          slug: 'blocked',
          type: 'personal',
        }),
      });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: 'Workspace creation is disabled',
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      );
    }
  });
});
