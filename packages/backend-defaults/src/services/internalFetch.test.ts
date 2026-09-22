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

// Exercises the internal-fetch service end to end — the implementation lives
// in @roadiehq/extensions-api, but the express-level test rig (real servers,
// real middleware chain) belongs here with the rest of the assembled-backend
// tests.

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createInternalFetch,
  internalRequestContextMiddleware,
  runWithoutRequestContext,
  type AuthService,
} from '@roadiehq/extensions-api';

function listen(app: express.Express): Promise<Server> {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

function baseUrl(server: Server): string {
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe('internalFetch', () => {
  let upstream: Server;
  let upstreamUrl: string;
  let seenHeaders: Array<Record<string, string | string[] | undefined>>;

  const makeAuth = (mintedToken: string): AuthService =>
    ({
      getOwnServiceCredentials: vi.fn(async () => ({
        $$type: '@roadiehq/RoadieCredentials',
        principal: { type: 'service', subject: 'test' },
      })),
      getPluginRequestToken: vi.fn(async () => ({ token: mintedToken })),
    }) as unknown as AuthService;

  beforeAll(async () => {
    const app = express();
    app.get('/api/catalog-workflow/workflows', (req, res) => {
      seenHeaders.push({
        authorization: req.headers.authorization,
        'x-scope-id': req.headers['x-scope-id'],
        'x-openroadie-workspace-id': req.headers['x-openroadie-workspace-id'],
      });
      res.json({ ok: true });
    });
    upstream = await listen(app);
    upstreamUrl = baseUrl(upstream);
  });

  afterAll(() => {
    upstream.close();
  });

  beforeEach(() => {
    seenHeaders = [];
  });

  async function callThroughRequest(options: {
    auth: AuthService;
    requestHeaders?: Record<string, string>;
    handler: (
      internalFetch: ReturnType<typeof createInternalFetch>,
    ) => Promise<unknown>;
  }): Promise<void> {
    const internalFetch = createInternalFetch({ auth: options.auth });
    const app = express();
    app.use(internalRequestContextMiddleware());
    app.get('/go', async (_req, res) => {
      try {
        await options.handler(internalFetch);
        res.json({ ok: true });
      } catch (e: unknown) {
        res.status(500).json({ error: String(e) });
      }
    });
    const server = await listen(app);
    try {
      const response = await fetch(`${baseUrl(server)}/go`, {
        headers: options.requestHeaders,
      });
      expect(response.status).toBe(200);
    } finally {
      server.close();
    }
  }

  it('forwards caller authorization and isolation headers onto internal calls', async () => {
    await callThroughRequest({
      auth: makeAuth('should-not-be-minted'),
      requestHeaders: {
        authorization: 'Bearer caller-token',
        'x-scope-id': 'tenant-42',
        'x-openroadie-workspace-id': 'workspace-42',
      },
      handler: internalFetch =>
        internalFetch.fetch(`${upstreamUrl}/api/catalog-workflow/workflows`),
    });

    expect(seenHeaders).toEqual([
      {
        authorization: 'Bearer caller-token',
        'x-scope-id': 'tenant-42',
        'x-openroadie-workspace-id': 'workspace-42',
      },
    ]);
  });

  it('lets an explicit per-call header win over the ambient one', async () => {
    await callThroughRequest({
      auth: makeAuth(''),
      requestHeaders: { authorization: 'Bearer caller-token' },
      handler: internalFetch =>
        internalFetch.fetch(`${upstreamUrl}/api/catalog-workflow/workflows`, {
          headers: { authorization: 'Bearer explicit-token' },
        }),
    });

    expect(seenHeaders[0]?.authorization).toBe('Bearer explicit-token');
  });

  it('exposes the caller credentials for hand-rolled clients', async () => {
    let credentials: Awaited<
      ReturnType<ReturnType<typeof createInternalFetch>['credentials']>
    > | null = null;
    await callThroughRequest({
      auth: makeAuth(''),
      requestHeaders: {
        authorization: 'Bearer caller-token',
        'x-scope-id': 'tenant-42',
        'x-openroadie-workspace-id': 'workspace-42',
      },
      handler: async internalFetch => {
        credentials = await internalFetch.credentials();
      },
    });

    expect(credentials).toEqual({
      token: 'caller-token',
      headers: {
        authorization: 'Bearer caller-token',
        'x-scope-id': 'tenant-42',
        'x-openroadie-workspace-id': 'workspace-42',
      },
    });
  });

  it('mints a service token for the target plugin outside any request', async () => {
    const auth = makeAuth('minted-token');
    const internalFetch = createInternalFetch({ auth });

    await internalFetch.fetch(`${upstreamUrl}/api/catalog-workflow/workflows`);

    expect(seenHeaders).toEqual([
      {
        authorization: 'Bearer minted-token',
        'x-scope-id': undefined,
        'x-openroadie-workspace-id': undefined,
      },
    ]);
    expect(auth.getPluginRequestToken).toHaveBeenCalledWith(
      expect.objectContaining({ targetPluginId: 'catalog-workflow' }),
    );
  });

  it('sends no header when the minted service token is blank (OSS)', async () => {
    const internalFetch = createInternalFetch({ auth: makeAuth('') });

    await internalFetch.fetch(`${upstreamUrl}/api/catalog-workflow/workflows`);

    expect(seenHeaders).toEqual([
      {
        authorization: undefined,
        'x-scope-id': undefined,
        'x-openroadie-workspace-id': undefined,
      },
    ]);
  });

  it('asService() ignores the ambient caller and uses the minted service token', async () => {
    await callThroughRequest({
      auth: makeAuth('minted-token'),
      requestHeaders: {
        authorization: 'Bearer caller-token',
        'x-scope-id': 'tenant-42',
      },
      handler: internalFetch =>
        internalFetch
          .asService()
          .fetch(`${upstreamUrl}/api/catalog-workflow/workflows`),
    });

    expect(seenHeaders).toEqual([
      {
        authorization: 'Bearer minted-token',
        'x-scope-id': undefined,
        'x-openroadie-workspace-id': undefined,
      },
    ]);
  });

  it('asService() stays anonymous when the minted token is blank (OSS)', async () => {
    // The historically-anonymous hops (workflow runs, seed applies) must not
    // inherit a narrowed caller's grants: in OSS no header at all means the
    // scope guard grants everything, matching their pre-migration behavior.
    await callThroughRequest({
      auth: makeAuth(''),
      requestHeaders: { authorization: 'Bearer caller-token' },
      handler: internalFetch =>
        internalFetch
          .asService()
          .fetch(`${upstreamUrl}/api/catalog-workflow/workflows`),
    });

    expect(seenHeaders).toEqual([
      {
        authorization: undefined,
        'x-scope-id': undefined,
        'x-openroadie-workspace-id': undefined,
      },
    ]);
  });

  it('credentials({ asService: true }) skips the ambient caller for hand-rolled clients', async () => {
    let credentials: Awaited<
      ReturnType<ReturnType<typeof createInternalFetch>['credentials']>
    > | null = null;
    await callThroughRequest({
      auth: makeAuth(''),
      requestHeaders: { authorization: 'Bearer caller-token' },
      handler: async internalFetch => {
        credentials = await internalFetch.credentials({
          targetPluginId: 'catalog-workflow',
          asService: true,
        });
      },
    });

    expect(credentials).toEqual({ headers: {} });
  });

  it('runWithoutRequestContext escapes the ambient caller credentials', async () => {
    await callThroughRequest({
      auth: makeAuth(''),
      requestHeaders: { authorization: 'Bearer caller-token' },
      handler: internalFetch =>
        runWithoutRequestContext(() =>
          internalFetch.fetch(`${upstreamUrl}/api/catalog-workflow/workflows`),
        ),
    });

    expect(seenHeaders[0]?.authorization).toBeUndefined();
  });

  it('ambient context propagates into timers scheduled during a request', async () => {
    // This is why background machinery must use runWithoutRequestContext:
    // a setTimeout created inside a request inherits its async context.
    await callThroughRequest({
      auth: makeAuth(''),
      requestHeaders: { authorization: 'Bearer caller-token' },
      handler: internalFetch =>
        new Promise((resolve, reject) => {
          setTimeout(() => {
            internalFetch
              .fetch(`${upstreamUrl}/api/catalog-workflow/workflows`)
              .then(resolve, reject);
          }, 0);
        }),
    });

    expect(seenHeaders[0]?.authorization).toBe('Bearer caller-token');
  });
});
