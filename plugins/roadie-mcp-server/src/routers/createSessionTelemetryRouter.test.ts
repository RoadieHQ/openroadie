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
import express, { json } from 'express';
import request from 'supertest';
import { mockServices } from '@roadiehq/backend-test-utils';
import { createScopeService } from '@roadiehq/scopes';
import { createSessionTelemetryRouter } from './createSessionTelemetryRouter';
import type { SessionTelemetryStore } from '../stores/session-telemetry-store';

describe('createSessionTelemetryRouter scope enforcement', () => {
  const insert = vi.fn(async () => {});
  let granted: string[] = [];

  const buildApp = () => {
    const store = {
      insert,
      facets: async () => ({}),
      query: async () => ({ items: [], total: 0, page: 0, pageSize: 25 }),
      queryBySession: async () => [],
    } as unknown as SessionTelemetryStore;

    const router = createSessionTelemetryRouter({
      store,
      httpAuth: mockServices.httpAuth.mock({
        credentials: (async () => ({
          $$type: '@roadiehq/RoadieCredentials',
          principal: { type: 'user' as const, userId: 'alice' },
        })) as any,
      }),
      logger: mockServices.logger.mock(),
      scopeService: createScopeService(() => granted),
      workspaceService: {
        resolveWorkspaceId: async () => 'workspace-a',
        workspaceExists: async () => true,
      },
    });

    const app = express();
    app.use(json());
    app.use('/session-telemetry', router);
    return app;
  };

  beforeEach(() => {
    insert.mockClear();
    granted = [];
  });

  it('allows a write when the token holds mcp-telemetry:create', async () => {
    granted = ['mcp-telemetry:create'];
    const res = await request(buildApp())
      .post('/session-telemetry/claude-code')
      .send({ hook_event_name: 'SessionStart', session_id: 'session-1' });
    expect(res.status).not.toBe(403);
    expect(insert).toHaveBeenCalledWith(expect.anything(), 'workspace-a');
  });

  it('rejects a write when the token lacks mcp-telemetry:create', async () => {
    granted = ['mcp:query'];
    const res = await request(buildApp())
      .post('/session-telemetry/claude-code')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.missing).toContain('mcp-telemetry:create');
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not let a telemetry-only token read telemetry back', async () => {
    granted = ['mcp-telemetry:create'];
    const res = await request(buildApp()).get('/session-telemetry/');
    expect(res.status).toBe(403);
    expect(res.body.missing).toContain('mcp:query');
  });

  it('allows reads when the token holds mcp:query', async () => {
    granted = ['mcp:query'];
    const res = await request(buildApp()).get('/session-telemetry/');
    expect(res.status).toBe(200);
  });
});
