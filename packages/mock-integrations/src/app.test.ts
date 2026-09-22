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
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import { FsStorage, fixtureKey, StoredResponse } from './storage';

const seeded = new Map<string, StoredResponse>([
  [
    fixtureKey('github', 'GET', 'user/repos', ''),
    { status: 200, body: [{ full_name: 'roadiehq/openroadie', id: 42 }] },
  ],
  [
    fixtureKey('github', 'GET', 'user/repos', 'page=2&per_page=50'),
    { status: 200, body: [{ full_name: 'roadiehq/roadie', id: 43 }] },
  ],
  [
    fixtureKey('wiz', 'POST', 'oauth/token', ''),
    { status: 200, body: { access_token: 'mock-token', expires_in: 3600 } },
  ],
  [
    fixtureKey('shortcut', 'GET', 'api/v3/members', ''),
    { status: 401, body: { message: 'Sorry, not authorized.' } },
  ],
  [
    fixtureKey('linear', 'POST', 'graphql', '', {
      query: '{ teams { nodes { id } } }',
    }),
    { status: 200, body: { data: { teams: { nodes: [{ id: 'team-1' }] } } } },
  ],
  [
    fixtureKey('linear', 'POST', 'graphql', '', {
      query: '{ users { nodes { id } } }',
    }),
    { status: 200, body: { data: { users: { nodes: [{ id: 'user-1' }] } } } },
  ],
]);

const mapStorage = {
  get: async (key: string) => seeded.get(key),
};

describe('mock integrations server', () => {
  const app = createApp(mapStorage);

  it('serves a stored response for an integration path', async () => {
    const res = await request(app).get('/github/user/repos');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ full_name: 'roadiehq/openroadie', id: 42 }]);
  });

  it('distinguishes requests by query string, key order-insensitively', async () => {
    const res = await request(app).get('/github/user/repos?per_page=50&page=2');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ full_name: 'roadiehq/roadie', id: 43 }]);
  });

  it('serves oauth token exchanges as plain stored POST responses', async () => {
    const res = await request(app)
      .post('/wiz/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: 'dummy' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ access_token: 'mock-token', expires_in: 3600 });
  });

  it('preserves stored non-2xx statuses', async () => {
    const res = await request(app).get('/shortcut/api/v3/members');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Sorry, not authorized.' });
  });

  it('returns 404 with the missing key for unknown fixtures', async () => {
    const res = await request(app).get('/github/orgs/unknown/teams');
    expect(res.status).toBe(404);
    expect(res.body.missingKey).toBe(
      fixtureKey('github', 'GET', 'orgs/unknown/teams', ''),
    );
  });

  it('disambiguates same-URL GraphQL POSTs by request body', async () => {
    const teams = await request(app)
      .post('/linear/graphql')
      .send({ query: '{ teams { nodes { id } } }' });
    expect(teams.body).toEqual({
      data: { teams: { nodes: [{ id: 'team-1' }] } },
    });

    const users = await request(app)
      .post('/linear/graphql')
      .send({ query: '{ users { nodes { id } } }' });
    expect(users.body).toEqual({
      data: { users: { nodes: [{ id: 'user-1' }] } },
    });
  });

  it('falls back to the URL-only fixture when a body hash misses', async () => {
    // Rolling-window bodies (date ranges) never re-hash to the recorded key.
    const res = await request(app)
      .post('/wiz/oauth/token')
      .send({ some_window: '2026-07-08..2026-07-15' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ access_token: 'mock-token', expires_in: 3600 });
  });

  it('ignores credential fields so oauth bodies stay URL-keyed', () => {
    // Real creds at record time vs dummy at replay must yield the same key.
    const recorded = fixtureKey('wiz', 'POST', 'oauth/token', '', {
      grant_type: 'client_credentials',
      client_id: 'real-id',
      client_secret: 'real-secret',
    });
    const replayed = fixtureKey('wiz', 'POST', 'oauth/token', '', {
      grant_type: 'client_credentials',
      client_id: 'dummy',
      client_secret: 'dummy',
    });
    expect(recorded).toBe(replayed);
    expect(recorded).toBe(fixtureKey('wiz', 'POST', 'oauth/token', ''));
  });
});

describe('FsStorage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mock-integrations-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips a stored response through disk and serves it over HTTP', async () => {
    const storage = new FsStorage(dir);
    const key = fixtureKey('gitlab', 'GET', 'api/v4/projects', 'per_page=100');
    await storage.put(key, {
      status: 200,
      body: [{ path_with_namespace: 'roadie/demo' }],
    });

    const app = createApp(storage);
    const res = await request(app).get('/gitlab/api/v4/projects?per_page=100');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ path_with_namespace: 'roadie/demo' }]);
  });

  it('refuses keys that escape the fixtures root', async () => {
    const storage = new FsStorage(dir);
    await expect(storage.get('../outside/GET/etc/passwd')).rejects.toThrow();
  });
});
