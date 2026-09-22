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
import express from 'express';
import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { createScopeGuard, createScopeFamilyGuard } from './createScopeGuard';
import { ALL_SCOPES, type GrantedScopes } from './checker';
import type { ScopeRetriever } from './service';

const retrieverFor = (granted: GrantedScopes): ScopeRetriever => ({
  getGrantedScopes: () => granted,
});

const appWith = (retriever: ScopeRetriever, ...required: string[]) => {
  const requireScopes = createScopeGuard(retriever);
  const app = express();
  app.get('/', requireScopes(...required), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
};

const familyAppWith = (retriever: ScopeRetriever, baseScope: string) => {
  const requireScopeFamily = createScopeFamilyGuard(retriever);
  const app = express();
  app.get('/', requireScopeFamily(baseScope), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
};

describe('createScopeGuard', () => {
  it('allows the request when the retriever grants the required scope', async () => {
    const app = appWith(
      retrieverFor(new Set(['catalog-datastore:query'])),
      'catalog-datastore:query',
    );

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
  });

  it('responds 403 with the missing scopes when a required scope is absent', async () => {
    const app = appWith(
      retrieverFor(new Set(['catalog-datastore:query'])),
      'catalog-datastore:create',
    );

    const res = await request(app).get('/');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'insufficient scope',
      missing: ['catalog-datastore:create'],
    });
  });

  it('allows everything when the retriever grants ALL_SCOPES', async () => {
    const app = appWith(retrieverFor(ALL_SCOPES), 'catalog-datastore:create');

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
  });

  it('treats a grant of the un-narrowed scope as covering a narrowed target', async () => {
    const app = appWith(
      retrieverFor(new Set(['action:execute'])),
      'action:execute:deploy',
    );

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
  });
});

describe('createScopeFamilyGuard', () => {
  it('admits a caller holding the un-narrowed scope', async () => {
    const app = familyAppWith(
      retrieverFor(new Set(['action:query'])),
      'action:query',
    );

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
  });

  it('admits a caller holding only a narrowed target in the family', async () => {
    const app = familyAppWith(
      retrieverFor(new Set(['action:query:create-shortcut-ticket'])),
      'action:query',
    );

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
  });

  it('responds 403 when nothing in the family is granted', async () => {
    const app = familyAppWith(
      retrieverFor(new Set(['action:execute:deploy'])),
      'action:query',
    );

    const res = await request(app).get('/');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'insufficient scope',
      missing: ['action:query'],
    });
  });

  it('admits everything under ALL_SCOPES', async () => {
    const app = familyAppWith(retrieverFor(ALL_SCOPES), 'action:query');

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
  });
});
