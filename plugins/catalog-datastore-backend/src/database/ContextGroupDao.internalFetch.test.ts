import express from 'express';
import request from 'supertest';
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createInternalFetch,
  internalRequestContextMiddleware,
  type AuthService,
} from '@roadiehq/extensions-api';
import { CatalogWorkflowClient } from '@roadiehq/catalog-workflow-common';
import { ContextGroupDao } from './ContextGroupDao';

/**
 * Regression test for the production "Request failed" render-preview bug
 * (sc-34243): the DAO's workflow lookups run through the internal-fetch
 * service, so the caller's credentials reach the workflow backend without any
 * per-call requestInit threading.
 */
describe('ContextGroupDao workflow lookups through internalFetch', () => {
  let workflowBackend: Server;
  let seenAuthorization: Array<string | undefined>;

  beforeAll(async () => {
    const upstream = express();
    upstream.get('/api/catalog-workflow/workflows', (req, res) => {
      seenAuthorization.push(req.headers.authorization);
      res.json({
        data: [{ id: 'ds-1', slug: 'github-members', nodes: [] }],
        total: 1,
      });
    });
    workflowBackend = await new Promise<Server>(resolve => {
      const server = upstream.listen(0, () => resolve(server));
    });
  });

  afterAll(() => {
    workflowBackend.close();
  });

  it('forwards the caller authorization to the workflow listing', async () => {
    seenAuthorization = [];
    const { port } = workflowBackend.address() as AddressInfo;

    // Blank minted token, as in OSS — only ambient forwarding can succeed.
    const auth = {
      getOwnServiceCredentials: async () => ({}),
      getPluginRequestToken: async () => ({ token: '' }),
    } as unknown as AuthService;

    const dao = new ContextGroupDao({
      knex: {} as any,
      catalogWorkflowClient: new CatalogWorkflowClient({
        discoveryApi: {
          getBaseUrl: async (pluginId: string) =>
            `http://127.0.0.1:${port}/api/${pluginId}`,
        },
        fetchApi: createInternalFetch({ auth }),
      }),
    });

    const app = express();
    app.use(internalRequestContextMiddleware());
    app.get('/keys', async (_req, res) => {
      const keys = await dao.getRuleDocumentKeys({
        datasources: [{ datasourceId: 'ds-1' }],
      } as any);
      res.json(keys);
    });

    const response = await request(app)
      .get('/keys')
      .set('authorization', 'Bearer caller-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { datasourceId: 'ds-1', key: 'github-members' },
    ]);
    expect(seenAuthorization).toEqual(['Bearer caller-token']);
  });
});
