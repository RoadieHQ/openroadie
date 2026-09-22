/*
 * Copyright 2026 Larder Software Limited
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { allowAllScopeService } from '@roadiehq/scopes';
import { createIntegrationsRouter } from './integrations';
import type { IntegrationUsage } from '../../service/IntegrationUsageService';

const logger = {
  child: () => logger,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any;

let integrationDao: any;
let integrationClient: any;
let findUsage: ReturnType<typeof vi.fn>;

function makeApp(usage?: IntegrationUsage) {
  findUsage = vi
    .fn()
    .mockResolvedValue(usage ?? { references: [], unavailable: [] });
  const app = express();
  app.use(
    createIntegrationsRouter({
      logger,
      integrationDao,
      integrationClient,
      getUserId: async () => 'user:default/test',
      scopeService: allowAllScopeService,
      integrationUsage: { findUsage } as any,
    }),
  );
  return app;
}

beforeEach(() => {
  integrationDao = { delete: vi.fn().mockResolvedValue(undefined) };
  integrationClient = {
    unregisterIntegration: vi.fn().mockResolvedValue(undefined),
  };
});

describe('DELETE /:id', () => {
  it('deletes when nothing references the integration', async () => {
    const response = await request(makeApp()).delete('/int-1');

    expect(response.status).toBe(200);
    expect(integrationDao.delete).toHaveBeenCalledWith('int-1', undefined);
    expect(integrationClient.unregisterIntegration).toHaveBeenCalledWith(
      'int-1',
    );
  });

  it('checks usage before touching the database', async () => {
    await request(makeApp()).delete('/int-1');

    expect(findUsage.mock.invocationCallOrder[0]).toBeLessThan(
      integrationDao.delete.mock.invocationCallOrder[0],
    );
  });

  it('looks up usage for the integration being deleted', async () => {
    // Credentials are the internal fetch's job (ambient, per-call), so the
    // handler passes nothing but the id.
    await request(makeApp()).delete('/int-1');

    expect(findUsage).toHaveBeenCalledWith('int-1');
  });

  it('returns 409 and deletes nothing when the integration is in use', async () => {
    const app = makeApp({
      references: [
        { kind: 'action', id: 'act-1', name: 'Create Issue', slug: 'create' },
        { kind: 'data-source', id: 'ws-1', name: 'GitHub Repos' },
      ],
      unavailable: [],
    });

    const response = await request(app).delete('/int-1');

    expect(response.status).toBe(409);
    expect(response.body.usage.total).toBe(2);
    expect(response.body.usage.references[0].kind).toBe('action');
    expect(integrationDao.delete).not.toHaveBeenCalled();
    expect(integrationClient.unregisterIntegration).not.toHaveBeenCalled();
  });

  it('names the blockers in the message, which is all the client keeps', async () => {
    // `ResponseError` on the frontend flattens the body to this string alone.
    const app = makeApp({
      references: [{ kind: 'action', id: 'act-1', name: 'Create Issue' }],
      unavailable: [],
    });

    const response = await request(app).delete('/int-1');

    expect(response.body.error.message).toContain('action "Create Issue"');
  });

  it('truncates a long blocker list', async () => {
    const app = makeApp({
      references: Array.from({ length: 5 }, (_, i) => ({
        kind: 'action' as const,
        id: `act-${i}`,
        name: `Action ${i}`,
      })),
      unavailable: [],
    });

    const response = await request(app).delete('/int-1');
    expect(response.body.error.message).toContain('and 2 more');
  });

  it('fails closed with 503 when a probe could not be reached', async () => {
    // An unanswered probe is "unknown", not "no usage" — deleting here would
    // be an uncorrectable, silently-deferred break.
    const app = makeApp({ references: [], unavailable: ['actions'] });

    const response = await request(app).delete('/int-1');

    expect(response.status).toBe(503);
    expect(response.body.unavailableProbes).toEqual(['actions']);
    expect(integrationDao.delete).not.toHaveBeenCalled();
    expect(integrationClient.unregisterIntegration).not.toHaveBeenCalled();
  });

  it('prefers 503 over 409 when usage is both present and unverifiable', async () => {
    const app = makeApp({
      references: [{ kind: 'action', id: 'act-1', name: 'A' }],
      unavailable: ['catalog-datastore'],
    });

    const response = await request(app).delete('/int-1');
    expect(response.status).toBe(503);
  });
});
