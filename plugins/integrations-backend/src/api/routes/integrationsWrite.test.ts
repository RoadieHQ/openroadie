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

const warn = vi.fn();
const logger = {
  child: () => logger,
  info: () => {},
  warn,
  error: () => {},
  debug: () => {},
} as any;

const existing = {
  id: 'int-1',
  name: 'GitHub',
  slug: 'github',
  host: 'api.github.com',
  type: 'scm',
  authType: 'bearer-token',
  authConfig: { token: '${GITHUB_TOKEN}' },
  backendType: 'http',
  config: { some: 'thing' },
  requestsPerHour: 5000,
};

let integrationDao: any;
let integrationClient: any;

function makeApp(workspaceId?: string) {
  const app = express();
  // The real router is mounted behind `express.json()` in `api/router.ts`; these
  // routes carry no parser of their own.
  app.use(express.json());
  app.use(
    createIntegrationsRouter({
      logger,
      integrationDao,
      integrationClient,
      getUserId: async () => 'user:default/test',
      scopeService: allowAllScopeService,
      getWorkspaceId: workspaceId ? () => workspaceId : undefined,
    }),
  );
  return app;
}

beforeEach(() => {
  warn.mockClear();
  integrationDao = {
    getById: vi.fn().mockResolvedValue(existing),
    update: vi.fn().mockImplementation(async (_id, input) => ({
      ...existing,
      ...input,
    })),
  };
  integrationClient = {
    unregisterIntegration: vi.fn().mockResolvedValue(undefined),
  };
});

describe('PATCH /:id', () => {
  it('writes only the fields the body carries', async () => {
    const response = await request(makeApp())
      .patch('/int-1')
      .send({ name: 'GitHub Enterprise' });

    expect(response.status).toBe(200);
    expect(integrationDao.update).toHaveBeenCalledWith(
      'int-1',
      {
        name: 'GitHub Enterprise',
      },
      undefined,
    );
  });

  it('updates only the selected workspace', async () => {
    const workspaceId = '22222222-2222-4222-8222-222222222222';

    await request(makeApp(workspaceId))
      .patch('/int-1')
      .send({ name: 'Workspace GitHub' });

    expect(integrationDao.getById).toHaveBeenCalledWith('int-1', workspaceId);
    expect(integrationDao.update).toHaveBeenCalledWith(
      'int-1',
      { name: 'Workspace GitHub' },
      workspaceId,
    );
  });

  it('leaves an omitted rate limit and config alone', async () => {
    await request(makeApp()).patch('/int-1').send({ name: 'Renamed' });

    const [, input] = integrationDao.update.mock.calls[0];
    expect(input).not.toHaveProperty('requestsPerHour');
    expect(input).not.toHaveProperty('config');
  });

  it('keeps the stored authConfig when the body omits it', async () => {
    await request(makeApp()).patch('/int-1').send({ name: 'Renamed' });

    const [, input] = integrationDao.update.mock.calls[0];
    expect(input).not.toHaveProperty('authConfig');
  });

  it('unregisters the integration so the new config is picked up', async () => {
    await request(makeApp()).patch('/int-1').send({ name: 'Renamed' });

    expect(integrationClient.unregisterIntegration).toHaveBeenCalledWith(
      'int-1',
    );
  });

  it('rejects an empty name', async () => {
    const response = await request(makeApp())
      .patch('/int-1')
      .send({ name: '' });

    expect(response.status).toBe(400);
    expect(integrationDao.update).not.toHaveBeenCalled();
  });
});

describe('PUT /:id', () => {
  it('requires name and slug', async () => {
    const response = await request(makeApp())
      .put('/int-1')
      .send({ requestsPerHour: 10 });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('name');
    expect(response.body.error.message).toContain('slug');
    expect(integrationDao.update).not.toHaveBeenCalled();
  });

  it('clears optional fields the body omits', async () => {
    const response = await request(makeApp())
      .put('/int-1')
      .send({ name: 'GitHub', slug: 'github' });

    expect(response.status).toBe(200);
    const [, input] = integrationDao.update.mock.calls[0];
    expect(input.config).toBeNull();
    expect(input.requestsPerHour).toBeNull();
    expect(input.requestsPerSecond).toBeNull();
    expect(input.burstCapacity).toBeNull();
    expect(input.graphqlPath).toBeNull();
    expect(input.logoSvg).toBeNull();
  });

  it('keeps the stored authConfig when the body omits it', async () => {
    await request(makeApp())
      .put('/int-1')
      .send({ name: 'GitHub', slug: 'github' });

    // authConfig holds `${SECRET_REF}` placeholders rather than credentials.
    const [, input] = integrationDao.update.mock.calls[0];
    expect(input).not.toHaveProperty('authConfig');
  });

  it('passes explicit optional values through', async () => {
    await request(makeApp())
      .put('/int-1')
      .send({
        name: 'GitHub',
        slug: 'github',
        requestsPerHour: 1000,
        config: { key: 'value' },
      });

    const [, input] = integrationDao.update.mock.calls[0];
    expect(input.requestsPerHour).toBe(1000);
    expect(input.config).toEqual({ key: 'value' });
  });

  it('unregisters the integration so the new config is picked up', async () => {
    await request(makeApp())
      .put('/int-1')
      .send({ name: 'GitHub', slug: 'github' });

    expect(integrationClient.unregisterIntegration).toHaveBeenCalledWith(
      'int-1',
    );
  });
});
