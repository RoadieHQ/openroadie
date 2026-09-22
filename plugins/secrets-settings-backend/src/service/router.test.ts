/*
 * Copyright 2020 Larder Software Limited
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

import { createRouter, RouterOptions } from './router';
import { allowAllScopeService } from '@roadiehq/scopes';
import { ConfigReader, Config } from '@roadiehq/config';
import { JsonObject } from '@roadiehq/types';
import yaml from 'yaml';
import request from 'supertest';
import express from 'express';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockServices } from '@roadiehq/backend-test-utils';
import type { SecretStoreService } from '@roadiehq/secrets-node';
import {
  BootstrapSecretsSyncAuthorizationError,
  SecretStoreNotProvisionedError,
  SecretStoreReadOnlyError,
  toStoredSecretRef,
} from '@roadiehq/secrets-node';
import { InputError } from '@roadiehq/errors';

const mockHttpAuthService = mockServices.httpAuth.mock();
const mockEventsService = mockServices.events.mock();

const scopeService = allowAllScopeService;
const workspaceId = '00000000-0000-4000-8000-000000000001';
const personalWorkspaceId = '22222222-2222-4222-8222-222222222222';

const allowBootstrapSecretsSyncAuthorizer = {
  authorize: async () => {},
};

function createInMemoryStore(
  options: {
    mode?: 'env' | 'dotenv' | 'scoped';
    readOnly?: boolean;
    initial?: Record<string, string>;
    dotenvPath?: string;
    createdAtByRef?: Record<string, string>;
    lastModifiedByRef?: Record<string, string>;
  } = {},
): { store: SecretStoreService; values: Record<string, string> } {
  const values = { ...(options.initial ?? {}) };
  const readOnly = options.readOnly ?? false;
  const mode = options.mode ?? 'dotenv';
  const store: SecretStoreService = {
    resolver: scope => ({
      async resolve(refs) {
        const out: Record<string, string> = {};
        for (const ref of refs) {
          const storedRef = toStoredSecretRef(ref, scope);
          if (values[storedRef] !== undefined) {
            out[ref] = values[storedRef];
          }
        }
        return out;
      },
    }),
    writer: scope => ({
      readOnly,
      async put(ref, value) {
        if (readOnly) {
          throw new SecretStoreReadOnlyError();
        }
        values[toStoredSecretRef(ref, scope)] = value;
      },
      async delete(ref) {
        if (readOnly) {
          throw new SecretStoreReadOnlyError();
        }
        delete values[toStoredSecretRef(ref, scope)];
      },
      async listRefs() {
        return Object.keys(values);
      },
      async exists(ref) {
        return values[toStoredSecretRef(ref, scope)] !== undefined;
      },
    }),
    info: () => ({ mode, readOnly, dotenvPath: options.dotenvPath }),
    getCreatedAt: options.createdAtByRef
      ? async refs => {
          const out: Record<string, string> = {};
          for (const ref of refs) {
            const createdAt = options.createdAtByRef?.[ref];
            if (createdAt) {
              out[ref] = createdAt;
            }
          }
          return out;
        }
      : undefined,
    getLastModified: options.lastModifiedByRef
      ? async refs => {
          const out: Record<string, string> = {};
          for (const ref of refs) {
            const lastModified = options.lastModifiedByRef?.[ref];
            if (lastModified) {
              out[ref] = lastModified;
            }
          }
          return out;
        }
      : undefined,
  };
  return { store, values };
}

const mockDatabase: any = vi.fn().mockImplementation(() => ({
  select: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockResolvedValue(undefined),
  where: vi.fn().mockReturnThis(),
  update: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
}));

function createConfig(configYaml: string): Config {
  const config = yaml.parse(configYaml);
  return ConfigReader.fromConfigs([
    {
      context: 'test',
      data: config as JsonObject,
    },
  ]);
}

function createRouterOptions(
  configYaml: string,
  store: SecretStoreService,
  overrides: Partial<RouterOptions> = {},
): RouterOptions {
  return {
    logger: mockServices.logger.mock(),
    config: createConfig(configYaml),
    httpAuth: mockHttpAuthService,
    events: mockEventsService,
    database: mockDatabase,
    secretStore: store,
    scopeService,
    workspaceService: {
      resolveWorkspaceId: async () => workspaceId,
      workspaceExists: async () => true,
    },
    bootstrapSecretsLoader: async () => ({}),
    bootstrapSecretsSyncAuthorizer: {
      authorize: async () => {
        throw new BootstrapSecretsSyncAuthorizationError(
          'Bootstrap secret runtime sync is disabled',
        );
      },
    },
    ...overrides,
  };
}

const WRITABLE_CONFIG = `
secretsSettings:
  storage: dotenv
  secrets:
    - name: BUILTIN_SECRET
      internalName: BUILTIN_SECRET
      description: a secret
`;

const READONLY_CONFIG = `
secretsSettings:
  storage: env
  secrets:
    - name: BUILTIN_SECRET
      internalName: BUILTIN_SECRET
      description: a secret
`;

const NO_SECRETS_CONFIG = `
secretsSettings:
  storage: dotenv
`;

const SCOPED_WITH_GITHUB_SECRETS_CONFIG = `
secretsSettings:
  storage: scoped
  secrets:
    - name: BUILTIN_SECRET
      internalName: BUILTIN_SECRET
      description: a secret
    - name: GitHub App private key
      internalName: GITHUB_APP_PRIVATE_KEY
      description: github app private key
    - name: GitHub App client secret
      internalName: INTERNAL_GITHUB_APP_CLIENT_SECRET
      description: github app client secret
`;

describe('createRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('succeeds when no secrets are configured', async () => {
    const { store } = createInMemoryStore();
    const router = await createRouter(
      createRouterOptions(NO_SECRETS_CONFIG, store),
    );
    const app = express().use(router);
    const { status, body } = await request(app).get('/keys');
    expect(status).toEqual(200);
    expect(body).toEqual([]);
  });

  it('keeps secret values isolated by workspace', async () => {
    const { store } = createInMemoryStore({
      initial: { BUILTIN_SECRET: 'organization-value' },
    });
    const organizationRouter = await createRouter(
      createRouterOptions(WRITABLE_CONFIG, store),
    );
    const personalRouter = await createRouter(
      createRouterOptions(WRITABLE_CONFIG, store, {
        workspaceService: {
          resolveWorkspaceId: async () => personalWorkspaceId,
          workspaceExists: async () => true,
        },
      }),
    );
    const organizationApp = express().use(organizationRouter);
    const personalApp = express().use(personalRouter);

    await request(personalApp)
      .post('/keys')
      .send({ name: 'BUILTIN_SECRET', value: 'personal-value' })
      .expect(201);
    await request(personalApp)
      .delete('/secret-value/BUILTIN_SECRET')
      .expect(200);

    const organizationSecrets = await request(organizationApp).get('/keys');
    const personalSecrets = await request(personalApp).get('/keys');
    expect(organizationSecrets.body[0].status).toBe('Available');
    expect(personalSecrets.body[0].status).toBe('Not Set');
  });

  it('forwards workspace resolution failures to the error handler', async () => {
    const { store } = createInMemoryStore();
    const router = await createRouter(
      createRouterOptions(WRITABLE_CONFIG, store, {
        workspaceService: {
          resolveWorkspaceId: async () => {
            throw new InputError('Invalid workspace header');
          },
          workspaceExists: async () => true,
        },
      }),
    );
    const app = express()
      .use(router)
      .use(
        (
          error: unknown,
          _req: express.Request,
          res: express.Response,
          _next: express.NextFunction,
        ) => {
          res.status(error instanceof InputError ? 400 : 500).json({ error });
        },
      );

    await request(app).get('/keys').expect(400);
  });

  it('does not mount /stop-backend anywhere', async () => {
    const { store } = createInMemoryStore();
    const router = await createRouter(
      createRouterOptions(WRITABLE_CONFIG, store),
    );
    const app = express().use(router);
    const { status } = await request(app).post('/stop-backend');
    expect(status).toEqual(404);
  });

  describe('/storage-mode', () => {
    it('returns the mode and readOnly of a writable store', async () => {
      const { store } = createInMemoryStore({ mode: 'dotenv' });
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const res = await request(app).get('/storage-mode');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ mode: 'dotenv', readOnly: false });
    });

    it('returns readOnly=true for the env store', async () => {
      const { store } = createInMemoryStore({ mode: 'env', readOnly: true });
      const router = await createRouter(
        createRouterOptions(READONLY_CONFIG, store),
      );
      const app = express().use(router);
      const res = await request(app).get('/storage-mode');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ mode: 'env', readOnly: true });
    });

    it('returns hiddenSecretRefs for scoped mode', async () => {
      const { store } = createInMemoryStore({ mode: 'scoped' });
      const router = await createRouter(
        createRouterOptions(SCOPED_WITH_GITHUB_SECRETS_CONFIG, store),
      );
      const app = express().use(router);
      const res = await request(app).get('/storage-mode');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        mode: 'scoped',
        readOnly: false,
        hiddenSecretRefs: [
          'GITHUB_APP_PRIVATE_KEY',
          'INTERNAL_GITHUB_APP_CLIENT_SECRET',
        ],
      });
    });
  });

  describe('/keys GET', () => {
    it('returns builtin secrets with status from the store', async () => {
      const { store } = createInMemoryStore({
        initial: { BUILTIN_SECRET: 'v' },
      });
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const { status, body } = await request(app).get('/keys');
      expect(status).toEqual(200);
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({
        name: 'BUILTIN_SECRET',
        status: 'Available',
      });
    });

    it('returns Not Set when the value is missing', async () => {
      const { store } = createInMemoryStore();
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const { body } = await request(app).get('/keys');
      expect(body[0].status).toEqual('Not Set');
    });

    it('includes createdAt and lastModified when dotenvPath is available', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'secrets-router-'));
      const dotenvPath = join(tempDir, 'secrets.env');
      await writeFile(dotenvPath, 'BUILTIN_SECRET=v\n', 'utf8');
      try {
        const { store } = createInMemoryStore({
          initial: { BUILTIN_SECRET: 'v' },
          dotenvPath,
        });
        const router = await createRouter(
          createRouterOptions(WRITABLE_CONFIG, store),
        );
        const app = express().use(router);
        const { body } = await request(app).get('/keys');
        expect(typeof body[0].lastModified).toBe('string');
        expect(typeof body[0].createdAt).toBe('string');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('includes per-secret createdAt and lastModified from scoped stores', async () => {
      const createdAt = '2026-06-15T10:00:00.000Z';
      const lastModified = '2026-06-15T12:00:00.000Z';
      const { store } = createInMemoryStore({
        mode: 'scoped',
        initial: { BUILTIN_SECRET: 'v' },
        createdAtByRef: { BUILTIN_SECRET: createdAt },
        lastModifiedByRef: { BUILTIN_SECRET: lastModified },
      });
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const { body } = await request(app).get('/keys');
      expect(body[0].createdAt).toBe(createdAt);
      expect(body[0].lastModified).toBe(lastModified);
    });

    it('hides Roadie-managed GitHub secrets in scoped mode', async () => {
      const { store } = createInMemoryStore({
        mode: 'scoped',
        initial: {
          BUILTIN_SECRET: 'v',
          GITHUB_APP_PRIVATE_KEY: 'k',
          INTERNAL_GITHUB_APP_CLIENT_SECRET: 's',
        },
      });
      const router = await createRouter(
        createRouterOptions(SCOPED_WITH_GITHUB_SECRETS_CONFIG, store),
      );
      const app = express().use(router);
      const { status, body } = await request(app).get('/keys');
      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ name: 'BUILTIN_SECRET' });
    });
  });

  describe('/secret-value/:secret GET', () => {
    it('includes createdAt and lastModified when dotenvPath is available', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'secret-value-router-'));
      const dotenvPath = join(tempDir, 'secrets.env');
      await writeFile(dotenvPath, 'BUILTIN_SECRET=v\n', 'utf8');
      try {
        const { store } = createInMemoryStore({
          initial: { BUILTIN_SECRET: 'v' },
          dotenvPath,
        });
        const router = await createRouter(
          createRouterOptions(WRITABLE_CONFIG, store),
        );
        const app = express().use(router);
        const { body, status } = await request(app).get(
          '/secret-value/BUILTIN_SECRET',
        );
        expect(status).toBe(200);
        expect(typeof body.lastModified).toBe('string');
        expect(typeof body.createdAt).toBe('string');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('includes per-secret createdAt and lastModified from scoped stores', async () => {
      const createdAt = '2026-06-15T10:00:00.000Z';
      const lastModified = '2026-06-15T12:00:00.000Z';
      const { store } = createInMemoryStore({
        mode: 'scoped',
        initial: { BUILTIN_SECRET: 'v' },
        createdAtByRef: { BUILTIN_SECRET: createdAt },
        lastModifiedByRef: { BUILTIN_SECRET: lastModified },
      });
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const { body, status } = await request(app).get(
        '/secret-value/BUILTIN_SECRET',
      );
      expect(status).toBe(200);
      expect(body.createdAt).toBe(createdAt);
      expect(body.lastModified).toBe(lastModified);
    });

    it('returns 404 for hidden GitHub secrets in scoped mode', async () => {
      const { store } = createInMemoryStore({
        mode: 'scoped',
        initial: {
          INTERNAL_GITHUB_APP_CLIENT_SECRET: 's',
        },
      });
      const router = await createRouter(
        createRouterOptions(SCOPED_WITH_GITHUB_SECRETS_CONFIG, store),
      );
      const app = express().use(router);
      const { status } = await request(app).get(
        '/secret-value/INTERNAL_GITHUB_APP_CLIENT_SECRET',
      );
      expect(status).toBe(404);
    });
  });

  describe('/keys POST', () => {
    it('writes the value through the store and returns 201', async () => {
      const { store, values } = createInMemoryStore();
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const res = await request(app)
        .post('/keys')
        .send({ name: 'BUILTIN_SECRET', value: 'hello' });
      expect(res.status).toBe(201);
      expect(values.BUILTIN_SECRET).toBe('hello');
    });

    it('returns 405 when the store is read-only', async () => {
      const { store } = createInMemoryStore({
        mode: 'env',
        readOnly: true,
      });
      const router = await createRouter(
        createRouterOptions(READONLY_CONFIG, store),
      );
      const app = express().use(router);
      const res = await request(app)
        .post('/keys')
        .send({ name: 'BUILTIN_SECRET', value: 'hello' });
      expect(res.status).toBe(405);
    });

    it('returns 400 when the name is unknown', async () => {
      const { store } = createInMemoryStore();
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const res = await request(app)
        .post('/keys')
        .send({ name: 'UNKNOWN', value: 'x' });
      expect(res.status).toBe(400);
    });

    it('returns 403 when trying to edit hidden GitHub secrets in scoped mode', async () => {
      const { store } = createInMemoryStore({ mode: 'scoped' });
      const router = await createRouter(
        createRouterOptions(SCOPED_WITH_GITHUB_SECRETS_CONFIG, store),
      );
      const app = express().use(router);
      const res = await request(app).post('/keys').send({
        name: 'INTERNAL_GITHUB_APP_CLIENT_SECRET',
        value: 'new',
      });
      expect(res.status).toBe(403);
    });

    it('returns 503 with the user-facing message when the store is not provisioned', async () => {
      const { store } = createInMemoryStore({ mode: 'scoped' });
      const failingStore: SecretStoreService = {
        ...store,
        writer: () => ({
          ...store.writer(),
          async put() {
            throw new SecretStoreNotProvisionedError();
          },
        }),
      };
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, failingStore),
      );
      const app = express().use(router);
      const res = await request(app)
        .post('/keys')
        .send({ name: 'BUILTIN_SECRET', value: 'hello' });
      expect(res.status).toBe(503);
      expect(res.body.message).toBe(
        'Secret storage has not been set up for this account yet. Please contact support.',
      );
    });

    it('returns 503 without leaking internal error detail on unexpected failures', async () => {
      const { store } = createInMemoryStore();
      const failingStore: SecretStoreService = {
        ...store,
        writer: () => ({
          ...store.writer(),
          async put() {
            throw new Error(
              'Tenant "irma-test" has no secret-store configuration. Run the backfill CLI.',
            );
          },
        }),
      };
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, failingStore),
      );
      const app = express().use(router);
      const res = await request(app)
        .post('/keys')
        .send({ name: 'BUILTIN_SECRET', value: 'hello' });
      expect(res.status).toBe(503);
      expect(res.body.message).toBe(
        'Failed to save secret "BUILTIN_SECRET". Please try again, or contact support if the problem persists.',
      );
      expect(JSON.stringify(res.body)).not.toContain('irma-test');
      expect(JSON.stringify(res.body)).not.toContain('backfill');
    });
  });

  describe('/bootstrap-secrets/sync POST', () => {
    it('syncs bootstrap secrets into the scoped store', async () => {
      const { store, values } = createInMemoryStore({
        mode: 'scoped',
        initial: { EXISTING_SECRET: 'present' },
      });
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store, {
          bootstrapSecretsLoader: async () => ({
            EXISTING_SECRET: 'new-existing-value',
            INTERNAL_GITHUB_APP_CLIENT_SECRET: 'seeded-client-secret',
          }),
          bootstrapSecretsSyncAuthorizer: allowBootstrapSecretsSyncAuthorizer,
        }),
      );
      const app = express().use(router);
      const res = await request(app).post('/bootstrap-secrets/sync').send();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        seededRefs: ['INTERNAL_GITHUB_APP_CLIENT_SECRET'],
        skippedRefs: ['EXISTING_SECRET'],
      });
      expect(values.EXISTING_SECRET).toBe('present');
      expect(values.INTERNAL_GITHUB_APP_CLIENT_SECRET).toBe(
        'seeded-client-secret',
      );
    });

    it('overwrites existing refs when requested', async () => {
      const { store, values } = createInMemoryStore({
        mode: 'scoped',
        initial: { INTERNAL_GITHUB_APP_CLIENT_SECRET: 'old-value' },
      });
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store, {
          bootstrapSecretsLoader: async () => ({
            INTERNAL_GITHUB_APP_CLIENT_SECRET: 'new-value',
          }),
          bootstrapSecretsSyncAuthorizer: allowBootstrapSecretsSyncAuthorizer,
        }),
      );
      const app = express().use(router);
      const res = await request(app)
        .post('/bootstrap-secrets/sync')
        .send({ overwriteExisting: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        seededRefs: ['INTERNAL_GITHUB_APP_CLIENT_SECRET'],
        skippedRefs: [],
      });
      expect(values.INTERNAL_GITHUB_APP_CLIENT_SECRET).toBe('new-value');
    });

    it('returns 409 when the store is not scoped', async () => {
      const { store } = createInMemoryStore({ mode: 'dotenv' });
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store, {
          bootstrapSecretsLoader: async () => ({
            INTERNAL_GITHUB_APP_CLIENT_SECRET: 'seeded-client-secret',
          }),
          bootstrapSecretsSyncAuthorizer: allowBootstrapSecretsSyncAuthorizer,
        }),
      );
      const app = express().use(router);
      const res = await request(app).post('/bootstrap-secrets/sync').send();
      expect(res.status).toBe(409);
    });

    it('returns 400 when requested refs are unknown', async () => {
      const { store } = createInMemoryStore({ mode: 'scoped' });
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store, {
          bootstrapSecretsLoader: async () => ({
            INTERNAL_GITHUB_APP_CLIENT_SECRET: 'seeded-client-secret',
          }),
          bootstrapSecretsSyncAuthorizer: allowBootstrapSecretsSyncAuthorizer,
        }),
      );
      const app = express().use(router);
      const res = await request(app)
        .post('/bootstrap-secrets/sync')
        .send({ refs: ['UNKNOWN_SECRET'] });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('UNKNOWN_SECRET');
    });

    it('returns 503 when bootstrap secrets are unavailable', async () => {
      const { store } = createInMemoryStore({ mode: 'scoped' });
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store, {
          bootstrapSecretsLoader: async () => {
            throw new Error('missing SSM parameter');
          },
          bootstrapSecretsSyncAuthorizer: allowBootstrapSecretsSyncAuthorizer,
        }),
      );
      const app = express().use(router);
      const res = await request(app).post('/bootstrap-secrets/sync').send();
      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        message: 'Error loading bootstrap secrets',
      });
    });

    it('returns 403 when runtime sync authorizer is not overridden', async () => {
      const { store } = createInMemoryStore({ mode: 'scoped' });
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store, {
          bootstrapSecretsLoader: async () => ({
            INTERNAL_GITHUB_APP_CLIENT_SECRET: 'seeded-client-secret',
          }),
        }),
      );
      const app = express().use(router);
      const res = await request(app).post('/bootstrap-secrets/sync').send();
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        message: 'Bootstrap secret runtime sync is disabled',
      });
    });

    it('returns the authorizer status when runtime sync is denied', async () => {
      const { store } = createInMemoryStore({ mode: 'scoped' });
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store, {
          bootstrapSecretsSyncAuthorizer: {
            authorize: async () => {
              throw new BootstrapSecretsSyncAuthorizationError(
                'runtime sync disabled',
              );
            },
          },
        }),
      );
      const app = express().use(router);
      const res = await request(app).post('/bootstrap-secrets/sync').send();
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        message: 'runtime sync disabled',
      });
    });
  });

  describe('/secret-value/:secret DELETE', () => {
    it('deletes via the writer when writable', async () => {
      const { store, values } = createInMemoryStore({
        initial: { BUILTIN_SECRET: 'v' },
      });
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const res = await request(app).delete('/secret-value/BUILTIN_SECRET');
      expect(res.status).toBe(200);
      expect(values.BUILTIN_SECRET).toBeUndefined();
    });

    it('returns 405 when the store is read-only', async () => {
      const { store } = createInMemoryStore({
        mode: 'env',
        readOnly: true,
        initial: { BUILTIN_SECRET: 'v' },
      });
      const router = await createRouter(
        createRouterOptions(READONLY_CONFIG, store),
      );
      const app = express().use(router);
      const res = await request(app).delete('/secret-value/BUILTIN_SECRET');
      expect(res.status).toBe(405);
    });
  });

  describe('/secret-status/:ref', () => {
    it('reports exists=true/false via the writer.exists check', async () => {
      const { store } = createInMemoryStore({
        initial: { BUILTIN_SECRET: 'v' },
      });
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const existing = await request(app).get('/secret-status/BUILTIN_SECRET');
      expect(existing.body).toEqual({
        ref: 'BUILTIN_SECRET',
        exists: true,
      });
      const missing = await request(app).get('/secret-status/OTHER');
      expect(missing.body).toEqual({ ref: 'OTHER', exists: false });
    });
  });

  describe('metadata store integration', () => {
    it('rejects workspace storage refs in custom metadata', async () => {
      const { store } = createInMemoryStore();
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const reservedRef =
        'OPENROADIE_WORKSPACE_22222222_2222_4222_8222_222222222222__TOKEN';

      await request(app)
        .post('/secret-metadata')
        .send({ name: 'Cross workspace', internalKeyName: reservedRef })
        .expect(403);
      await request(app)
        .patch('/secret-metadata/Custom%20Secret')
        .send({ internalKeyName: reservedRef })
        .expect(403);
    });

    it('returns secrets from the metadata store (custom ones)', async () => {
      const { store } = createInMemoryStore();
      const selectRows = [
        {
          internalKeyName: 'CUSTOM_SECRET',
          name: 'Custom Secret',
          description: 'custom from db',
          helpUrl: 'https://example.com/help',
          isCustom: true,
        },
      ];
      mockDatabase.mockImplementationOnce(() => ({
        select: vi.fn().mockResolvedValue(selectRows),
        insert: vi.fn(),
        where: vi.fn().mockReturnThis(),
        update: vi.fn(),
        delete: vi.fn(),
      }));
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const { status, body } = await request(app).get('/keys');
      expect(status).toEqual(200);
      expect(body).toHaveLength(2);
      expect(
        body.some(
          (s: any) => s.name === 'Custom Secret' && s.isCustom === true,
        ),
      ).toBe(true);
      expect(
        body.some((s: any) => s.name === 'BUILTIN_SECRET' && !s.isCustom),
      ).toBe(true);
    });

    it('returns configured and db-backed metadata from /secret-metadata', async () => {
      const { store } = createInMemoryStore();
      const selectRows = [
        {
          internalKeyName: 'DEFAULT_DB_SECRET',
          name: 'Default DB Secret',
          description: 'default from db',
          isCustom: false,
        },
        {
          internalKeyName: 'CUSTOM_SECRET',
          name: 'Custom Secret',
          description: 'custom from db',
          isCustom: true,
        },
      ];
      mockDatabase.mockImplementationOnce(() => ({
        select: vi.fn().mockResolvedValue(selectRows),
        insert: vi.fn(),
        where: vi.fn().mockReturnThis(),
        update: vi.fn(),
        delete: vi.fn(),
      }));
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const { status, body } = await request(app).get('/secret-metadata');
      expect(status).toEqual(200);
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'BUILTIN_SECRET',
            isCustom: false,
          }),
          expect.objectContaining({
            name: 'Default DB Secret',
            isCustom: false,
          }),
          expect.objectContaining({
            name: 'Custom Secret',
            isCustom: true,
          }),
        ]),
      );
    });

    it('rejects editing default secret metadata', async () => {
      const { store } = createInMemoryStore();
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const res = await request(app)
        .patch('/secret-metadata/BUILTIN_SECRET')
        .send({ description: 'New description' });
      expect(res.status).toEqual(403);
      expect(res.body).toEqual({
        message: 'Default secret metadata cannot be edited',
      });
    });

    it.each([
      [
        'name',
        { name: 'BUILTIN_SECRET' },
        'A secret with name "BUILTIN_SECRET" already exists',
      ],
      [
        'internal key',
        { internalKeyName: 'BUILTIN_SECRET' },
        'A secret with internalKeyName "BUILTIN_SECRET" already exists',
      ],
    ])(
      'rejects editing a custom secret to collide by %s',
      async (_, patch, message) => {
        const { store } = createInMemoryStore();
        mockDatabase.mockImplementationOnce(() => ({
          select: vi.fn().mockResolvedValue([
            {
              internalKeyName: 'CUSTOM_SECRET',
              name: 'Custom Secret',
              isCustom: true,
            },
          ]),
          insert: vi.fn(),
          where: vi.fn().mockReturnThis(),
          update: vi.fn(),
          delete: vi.fn(),
        }));
        const router = await createRouter(
          createRouterOptions(WRITABLE_CONFIG, store),
        );
        const app = express().use(router);

        const res = await request(app)
          .patch('/secret-metadata/Custom%20Secret')
          .send(patch);

        expect(res.status).toEqual(400);
        expect(res.text).toEqual(message);
      },
    );

    it('allows editing of secret metadata', async () => {
      const { store } = createInMemoryStore();
      const where = vi.fn().mockReturnThis();
      const update = vi.fn().mockResolvedValue(undefined);
      mockDatabase.mockImplementationOnce(() => ({
        select: vi.fn().mockResolvedValue([]),
        insert: vi.fn(),
        where: vi.fn().mockReturnThis(),
        update: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
      }));
      mockDatabase.mockImplementationOnce(() => ({
        where,
        update,
        select: vi.fn().mockResolvedValue([]),
        insert: vi.fn(),
        delete: vi.fn(),
      }));
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const patch = {
        description: 'New description',
        helpUrl: 'https://new.example.com',
        name: 'Renamed Secret',
        internalKeyName: 'RENAMED_INTERNAL',
      };
      const res = await request(app)
        .patch('/secret-metadata/Custom%20Secret')
        .send(patch);
      expect(res.status).toEqual(200);
      expect(where).toHaveBeenCalledWith({
        display_name: 'Custom Secret',
        is_custom: true,
        workspace_id: workspaceId,
      });
      expect(update).toHaveBeenCalledWith({
        description: 'New description',
        helpUrl: 'https://new.example.com',
        display_name: 'Renamed Secret',
        internal_name: 'RENAMED_INTERNAL',
      });
    });

    it('rejects deleting default secret metadata', async () => {
      const { store } = createInMemoryStore();
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const res = await request(app).delete('/secret-metadata/BUILTIN_SECRET');
      expect(res.status).toEqual(403);
      expect(res.body).toEqual({
        message: 'Default secret metadata cannot be deleted',
      });
    });

    it('allows deleting of secret metadata', async () => {
      const { store } = createInMemoryStore();
      const where = vi.fn().mockReturnThis();
      const del = vi.fn().mockResolvedValue(undefined);
      mockDatabase.mockImplementationOnce(() => ({
        select: vi.fn().mockResolvedValue([]),
        insert: vi.fn(),
        where: vi.fn().mockReturnThis(),
        update: vi.fn(),
        delete: vi.fn().mockResolvedValue(undefined),
      }));
      mockDatabase.mockImplementationOnce(() => ({
        where,
        delete: del,
        select: vi.fn().mockResolvedValue([]),
        insert: vi.fn(),
        update: vi.fn(),
      }));
      const router = await createRouter(
        createRouterOptions(WRITABLE_CONFIG, store),
      );
      const app = express().use(router);
      const res = await request(app).delete('/secret-metadata/Custom%20Secret');
      expect(res.status).toEqual(200);
      expect(where).toHaveBeenCalledWith({
        display_name: 'Custom Secret',
        is_custom: true,
        workspace_id: workspaceId,
      });
      expect(del).toHaveBeenCalled();
    });
  });
});
