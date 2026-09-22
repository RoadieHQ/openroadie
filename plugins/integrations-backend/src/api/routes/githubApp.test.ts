import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mocked,
} from 'vitest';

import * as crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { createGithubAppRouter } from './githubApp';
import { GithubAppService } from '../../service/GithubAppService';
import { GithubAppDao } from '../../database/GithubAppDao';
import { GithubAppInstallationDao } from '../../database/GithubAppInstallationDao';
import { GithubAppInstallRequestDao } from '../../database/GithubAppInstallRequestDao';
import { GithubStateNonceDao } from '../../database/GithubStateNonceDao';
import { IntegrationDao } from '../../database/IntegrationDao';
import { ConfigReader } from '@roadiehq/config';
import type { SecretStoreService } from '@roadiehq/secrets-node';
import { allowAllScopeService } from '@roadiehq/scopes';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';

const scopeService = allowAllScopeService;

const envBackedSecretStore: SecretStoreService = {
  resolver: () => ({
    async resolve(refs) {
      const out: Record<string, string> = {};
      for (const ref of refs) {
        const v = process.env[ref];
        if (v !== undefined) {
          out[ref] = v;
        }
      }
      return out;
    },
  }),
  writer: () => ({
    readOnly: true,
    async put() {
      throw new Error('read-only');
    },
    async delete() {
      throw new Error('read-only');
    },
    async listRefs() {
      return [];
    },
    async exists(ref) {
      return process.env[ref] !== undefined;
    },
  }),
  info: () => ({ mode: 'env', readOnly: true }),
};

const { mockUndiciFetch } = vi.hoisted(() => ({
  mockUndiciFetch: vi.fn(),
}));

const voidLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  child: () => voidLogger,
} as any;

vi.mock('undici', () => ({
  fetch: mockUndiciFetch,
}));

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlEncodeBuffer(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createStateJWT(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(
    JSON.stringify({
      scopeId: 'acme',
      ...payload,
    }),
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest();
  return `${signingInput}.${base64UrlEncodeBuffer(signature)}`;
}

describe('createGithubAppRouter', () => {
  const CLIENT_SECRET = 'test-client-secret-12345';
  const PRIVATE_KEY_REF = 'GH_APP_PRIVATE_KEY';

  let app: express.Express;
  let mockGithubAppDao: Mocked<GithubAppDao>;
  let mockInstallationDao: Mocked<GithubAppInstallationDao>;
  let mockInstallRequestDao: Mocked<GithubAppInstallRequestDao>;
  let mockStateNonceDao: Mocked<GithubStateNonceDao>;
  let githubAppService: GithubAppService;

  beforeEach(() => {
    process.env.GH_APP_CLIENT_SECRET = CLIENT_SECRET;
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    process.env[PRIVATE_KEY_REF] = privateKey.export({
      type: 'pkcs1',
      format: 'pem',
    }) as string;
    mockUndiciFetch.mockReset();
    mockUndiciFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        account: {
          login: 'acme-org',
          html_url: 'https://github.com/acme-org',
          avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
        },
        permissions: { contents: 'read' },
        repository_selection: 'selected',
      }),
    } as any);

    mockGithubAppDao = {
      getByAppId: vi.fn().mockResolvedValue({
        id: 'app-uuid',
        appId: '12345',
        host: 'github.com',
        slug: 'my-test-app',
        privateKeyRef: PRIVATE_KEY_REF,
        clientSecretRef: 'GH_APP_CLIENT_SECRET',
        status: 'active',
      }),
      listApps: vi.fn().mockResolvedValue([
        {
          id: 'app-uuid',
          appId: '12345',
          host: 'github.com',
          slug: 'my-test-app',
          privateKeyRef: PRIVATE_KEY_REF,
          clientSecretRef: 'GH_APP_CLIENT_SECRET',
          status: 'active',
        },
      ]),
      getByHostAndPurpose: vi.fn().mockResolvedValue({
        id: 'app-uuid',
        appId: '12345',
        host: 'github.com',
        purpose: 'backstage',
        slug: 'my-test-app',
        privateKeyRef: PRIVATE_KEY_REF,
        clientSecretRef: 'GH_APP_CLIENT_SECRET',
        status: 'active',
      }),
    } as unknown as Mocked<GithubAppDao>;

    mockInstallationDao = {
      upsert: vi.fn().mockResolvedValue({
        id: 'inst-uuid',
        appId: '12345',
        host: 'github.com',
        installationId: 999,
      }),
      getById: vi.fn().mockResolvedValue({
        id: 'inst-1',
        appId: '12345',
        host: 'github.com',
        installationId: 100,
        orgLogin: 'acme-org',
      }),
      list: vi.fn().mockResolvedValue([]),
      listAll: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<GithubAppInstallationDao>;

    mockInstallRequestDao = {
      create: vi.fn().mockResolvedValue({
        id: 'req-uuid',
        appId: '12345',
        host: 'github.com',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
      listActive: vi.fn().mockResolvedValue([]),
      findByAppAndHost: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteExpired: vi.fn().mockResolvedValue(0),
    } as unknown as Mocked<GithubAppInstallRequestDao>;

    mockStateNonceDao = {
      create: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockResolvedValue(true),
      pruneExpired: vi.fn().mockResolvedValue(0),
    } as unknown as Mocked<GithubStateNonceDao>;

    const config = new ConfigReader({
      githubApp: {
        allowedRedirectOrigins: [
          'https://portal.example.test',
          'http://localhost:3000',
        ],
      },
    });

    githubAppService = new GithubAppService({
      logger: voidLogger,
      config,
      githubAppDao: mockGithubAppDao,
      githubAppInstallationDao: mockInstallationDao,
      githubAppInstallRequestDao: mockInstallRequestDao,
      stateNonceDao: mockStateNonceDao,
      currentScopeIdResolver: { getCurrentScopeId: () => 'acme' },
      secretStore: envBackedSecretStore,
      workspaceExists: async () => true,
    });

    const router = createGithubAppRouter({
      logger: voidLogger,
      githubAppService,
      httpAuth: { credentials: vi.fn() } as any,
      scopeService,
    });

    app = express();
    app.use(express.json());
    app.use('/github-app', router);
    app.use('/github-enterprise-app', router);
  });

  afterEach(() => {
    delete process.env.GH_APP_CLIENT_SECRET;
    delete process.env[PRIVATE_KEY_REF];
    vi.resetAllMocks();
  });

  describe('GET /github-app/install-link', () => {
    it('should return an install URL with state JWT', async () => {
      const res = await request(app).get('/github-app/install-link').query({
        appId: '12345',
        redirectUrl: 'https://portal.example.test/admin/integrations',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.installUrl).toContain(
        'https://github.com/apps/my-test-app/installations/new?state=',
      );

      const url = new URL(res.body.data.installUrl);
      const state = url.searchParams.get('state')!;
      const parts = state.split('.');
      expect(parts).toHaveLength(3);

      const payload = JSON.parse(
        Buffer.from(
          parts[1].replace(/-/g, '+').replace(/_/g, '/'),
          'base64',
        ).toString(),
      );
      expect(payload.scopeId).toBe('acme');
      expect(payload.appId).toBe('12345');
      expect(payload.host).toBe('github.com');
      expect(payload.redirectUrl).toBe(
        'https://portal.example.test/admin/integrations',
      );
    });

    it('should return 400 for missing appId', async () => {
      const res = await request(app).get('/github-app/install-link').query({
        redirectUrl: 'https://portal.example.test/admin/integrations',
      });

      expect(res.status).toBe(400);
    });

    it('should reject a disallowed redirect origin', async () => {
      const res = await request(app).get('/github-app/install-link').query({
        appId: '12345',
        redirectUrl: 'https://evil.example.com/phish',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe(
        'Redirect URL origin is not in the allowedRedirectOrigins list',
      );
    });

    it('should persist a state nonce when generating install link', async () => {
      const res = await request(app).get('/github-app/install-link').query({
        appId: '12345',
        redirectUrl: 'https://portal.example.test/admin/integrations',
      });

      expect(res.status).toBe(200);
      expect(mockStateNonceDao.create).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Date),
      );
    });

    it('should use app host for enterprise install URLs', async () => {
      mockGithubAppDao.getByAppId.mockResolvedValueOnce({
        id: 'app-uuid',
        appId: '12345',
        host: 'https://ghe.example.com',
        slug: 'my-test-app',
        clientSecretRef: 'GH_APP_CLIENT_SECRET',
        status: 'active',
      } as any);

      const res = await request(app).get('/github-app/install-link').query({
        appId: '12345',
        redirectUrl: 'https://portal.example.test/admin/integrations',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.installUrl).toContain(
        'https://ghe.example.com/apps/my-test-app/installations/new?state=',
      );
    });

    it('should use github.com for api.github.com install URLs', async () => {
      mockGithubAppDao.getByAppId.mockResolvedValueOnce({
        id: 'app-uuid',
        appId: '12345',
        host: 'api.github.com',
        slug: 'my-test-app',
        clientSecretRef: 'GH_APP_CLIENT_SECRET',
        status: 'active',
      } as any);

      const res = await request(app).get('/github-app/install-link').query({
        appId: '12345',
        redirectUrl: 'https://portal.example.test/admin/integrations',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.installUrl).toContain(
        'https://github.com/apps/my-test-app/installations/new?state=',
      );
    });

    it('should return 400 for missing client secret env var', async () => {
      delete process.env.GH_APP_CLIENT_SECRET;

      const res = await request(app).get('/github-app/install-link').query({
        appId: '12345',
        redirectUrl: 'https://portal.example.test/admin/integrations',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain(
        'GitHub App configuration error',
      );
      expect(res.body.error.message).toContain('GH_APP_CLIENT_SECRET');
    });

    it("does not resolve another workspace's app secret", async () => {
      const organizationWorkspaceId = '11111111-1111-4111-8111-111111111111';
      const personalWorkspaceId = '22222222-2222-4222-8222-222222222222';
      const resolvedWorkspaceIds: Array<string | undefined> = [];
      const workspaceSecretStore: SecretStoreService = {
        ...envBackedSecretStore,
        resolver: scope => {
          resolvedWorkspaceIds.push(scope?.workspaceId);
          return {
            async resolve(refs) {
              const values: Record<string, string> = {};
              if (
                scope?.workspaceId === organizationWorkspaceId &&
                refs.includes('GH_APP_CLIENT_SECRET')
              ) {
                values.GH_APP_CLIENT_SECRET = CLIENT_SECRET;
              }
              return values;
            },
          };
        },
      };
      mockGithubAppDao.getByAppId.mockResolvedValueOnce({
        id: 'app-uuid',
        appId: '12345',
        host: 'github.com',
        slug: 'my-test-app',
        integrationId: 'organization-integration',
        clientSecretRef: 'GH_APP_CLIENT_SECRET',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const isolatedService = new GithubAppService({
        logger: voidLogger,
        config: new ConfigReader({
          githubApp: {
            allowedRedirectOrigins: ['https://portal.example.test'],
          },
        }),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        githubAppInstallRequestDao: mockInstallRequestDao,
        stateNonceDao: mockStateNonceDao,
        currentScopeIdResolver: { getCurrentScopeId: () => 'acme' },
        secretStore: workspaceSecretStore,
        workspaceExists: async () => true,
        getWorkspaceIdForIntegration: async () => organizationWorkspaceId,
      });
      const isolatedRouter = createGithubAppRouter({
        logger: voidLogger,
        githubAppService: isolatedService,
        httpAuth: { credentials: vi.fn() } as any,
        scopeService,
        getWorkspaceId: () => personalWorkspaceId,
      });
      const isolatedApp = express().use('/github-app', isolatedRouter);

      await request(isolatedApp)
        .get('/github-app/install-link')
        .query({
          appId: '12345',
          redirectUrl: 'https://portal.example.test/admin/integrations',
        })
        .expect(404);

      expect(resolvedWorkspaceIds).toEqual([]);
    });
  });

  describe('GET /github-app/callback', () => {
    it("does not verify an app callback with another workspace's secret", async () => {
      const organizationWorkspaceId = '11111111-1111-4111-8111-111111111111';
      const personalWorkspaceId = '22222222-2222-4222-8222-222222222222';
      const workspaceSecrets: Record<string, string> = {
        [organizationWorkspaceId]: 'organization-secret',
        [personalWorkspaceId]: 'personal-secret',
      };
      const workspaceSecretStore: SecretStoreService = {
        ...envBackedSecretStore,
        resolver: scope => ({
          async resolve(refs) {
            const secret = scope?.workspaceId
              ? workspaceSecrets[scope.workspaceId]
              : undefined;
            const resolved: Record<string, string> = {};
            if (secret && refs.includes('GH_APP_CLIENT_SECRET')) {
              resolved.GH_APP_CLIENT_SECRET = secret;
            }
            return resolved;
          },
        }),
      };
      mockGithubAppDao.getByAppId.mockResolvedValueOnce({
        id: 'app-uuid',
        appId: '12345',
        host: 'github.com',
        slug: 'my-test-app',
        integrationId: 'organization-integration',
        clientSecretRef: 'GH_APP_CLIENT_SECRET',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const isolatedService = new GithubAppService({
        logger: voidLogger,
        config: new ConfigReader({
          githubApp: {
            allowedRedirectOrigins: ['https://portal.example.test'],
          },
        }),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        githubAppInstallRequestDao: mockInstallRequestDao,
        stateNonceDao: mockStateNonceDao,
        currentScopeIdResolver: { getCurrentScopeId: () => 'acme' },
        secretStore: workspaceSecretStore,
        workspaceExists: async () => true,
        getWorkspaceIdForIntegration: async () => organizationWorkspaceId,
      });
      const isolatedRouter = createGithubAppRouter({
        logger: voidLogger,
        githubAppService: isolatedService,
        httpAuth: { credentials: vi.fn() } as any,
        scopeService,
      });
      const isolatedApp = express();
      isolatedApp.use('/github-app', isolatedRouter);
      const forgedState = createStateJWT(
        {
          redirectUrl: 'https://portal.example.test/admin/integrations',
          appId: '12345',
          host: 'github.com',
          workspaceId: personalWorkspaceId,
          jti: 'forged-nonce',
          exp: Math.floor(Date.now() / 1000) + 600,
        },
        workspaceSecrets[personalWorkspaceId],
      );

      const res = await request(isolatedApp).get('/github-app/callback').query({
        installation_id: '999',
        state: forgedState,
        setup_action: 'install',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Invalid or expired state');
      expect(mockStateNonceDao.consume).not.toHaveBeenCalled();
      expect(mockInstallationDao.upsert).not.toHaveBeenCalled();
    });

    it('should validate state JWT and upsert installation', async () => {
      const statePayload = {
        redirectUrl: 'https://portal.example.test/admin/integrations',
        appId: '12345',
        host: 'github.com',
        jti: 'nonce-1',
        exp: Math.floor(Date.now() / 1000) + 600,
      };
      const state = createStateJWT(statePayload, CLIENT_SECRET);

      const res = await request(app).get('/github-app/callback').query({
        installation_id: '999',
        state,
        setup_action: 'install',
      });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(
        'https://portal.example.test/admin/integrations?github-app-installed=true',
      );
      expect(mockGithubAppDao.getByAppId).toHaveBeenCalledWith(
        '12345',
        'github.com',
      );
      expect(mockInstallationDao.upsert).toHaveBeenCalledWith({
        appId: '12345',
        host: 'github.com',
        installationId: 999,
        orgLogin: 'acme-org',
        orgUrl: 'https://github.com/acme-org',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        permissions: { contents: 'read' },
        repoSelection: 'selected',
      });
    });

    it('should fall back to the user installations API when app metadata lookup fails', async () => {
      mockGithubAppDao.getByAppId.mockResolvedValueOnce({
        id: 'app-uuid',
        appId: '12345',
        host: 'github.com',
        slug: 'my-test-app',
        privateKeyRef: PRIVATE_KEY_REF,
        clientId: 'gh-app-client-id',
        clientSecretRef: 'GH_APP_CLIENT_SECRET',
        status: 'active',
      } as any);

      mockUndiciFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: async () =>
            '{"message":"A JSON web token could not be decoded","status":"401"}',
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'ghu_test_token',
            token_type: 'bearer',
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            installations: [
              {
                id: 999,
                app_id: 12345,
                account: {
                  login: 'acme-org',
                  html_url: 'https://github.com/acme-org',
                  avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
                },
                permissions: { contents: 'read' },
                repository_selection: 'selected',
              },
            ],
          }),
        } as any);

      const statePayload = {
        redirectUrl: 'https://portal.example.test/admin/integrations',
        appId: '12345',
        host: 'github.com',
        jti: 'nonce-user-fallback',
        exp: Math.floor(Date.now() / 1000) + 600,
      };
      const state = createStateJWT(statePayload, CLIENT_SECRET);

      const res = await request(app).get('/github-app/callback').query({
        code: 'oauth-code',
        installation_id: '999',
        state,
        setup_action: 'install',
      });

      expect(res.status).toBe(302);
      expect(mockInstallationDao.upsert).toHaveBeenCalledWith({
        appId: '12345',
        host: 'github.com',
        installationId: 999,
        orgLogin: 'acme-org',
        orgUrl: 'https://github.com/acme-org',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        permissions: { contents: 'read' },
        repoSelection: 'selected',
      });
      expect(mockUndiciFetch).toHaveBeenCalledWith(
        'https://github.com/login/oauth/access_token',
        expect.objectContaining({
          method: 'POST',
        }),
      );
      expect(mockUndiciFetch).toHaveBeenCalledWith(
        'https://api.github.com/user/installations?per_page=100&page=1',
        expect.any(Object),
      );
    });

    it('should validate state JWT on github-enterprise-app callback path', async () => {
      const statePayload = {
        redirectUrl: 'https://portal.example.test/admin/integrations',
        appId: '12345',
        host: 'github.com',
        jti: 'nonce-ghe-path',
        exp: Math.floor(Date.now() / 1000) + 600,
      };
      const state = createStateJWT(statePayload, CLIENT_SECRET);

      const res = await request(app)
        .get('/github-enterprise-app/callback')
        .query({
          installation_id: '999',
          state,
          setup_action: 'install',
        });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(
        'https://portal.example.test/admin/integrations?github-app-installed=true',
      );
    });

    it('should allow enterprise installations when returned by GitHub', async () => {
      mockUndiciFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          account: {
            login: 'acme-enterprise',
            html_url: 'https://github.com/enterprises/acme-enterprise',
            avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
            type: 'Enterprise',
          },
          target_type: 'Enterprise',
          permissions: { enterprise_administration: 'write' },
          repository_selection: 'all',
        }),
      } as any);

      const statePayload = {
        redirectUrl: 'https://portal.example.test/admin/integrations',
        appId: '12345',
        host: 'github.com',
        jti: 'nonce-enterprise',
        exp: Math.floor(Date.now() / 1000) + 600,
      };
      const state = createStateJWT(statePayload, CLIENT_SECRET);

      const res = await request(app).get('/github-app/callback').query({
        installation_id: '999',
        state,
        setup_action: 'install',
      });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(
        'https://portal.example.test/admin/integrations?github-app-installed=true',
      );
      expect(mockInstallationDao.upsert).toHaveBeenCalledWith({
        appId: '12345',
        host: 'github.com',
        installationId: 999,
        orgLogin: 'acme-enterprise',
        orgUrl: 'https://github.com/enterprises/acme-enterprise',
        avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
        permissions: { enterprise_administration: 'write' },
        repoSelection: 'all',
      });
    });

    it('should fetch installation metadata via KMS when app has kmsKeyId only', async () => {
      const mockKmsMinter = {
        getInstallationToken: vi.fn(),
        clearCache: vi.fn(),
        generateAppJWT: vi.fn().mockResolvedValue('mock-kms-app-jwt'),
      };

      const kmsOnlyAppDao = {
        ...mockGithubAppDao,
        getByAppId: vi.fn().mockResolvedValue({
          id: 'app-uuid',
          appId: '12345',
          host: 'github.com',
          slug: 'my-test-app',
          kmsKeyId: 'alias/dev0-github-app-signing',
          clientSecretRef: 'GH_APP_CLIENT_SECRET',
          status: 'active',
        }),
      };

      const config = new ConfigReader({
        githubApp: {
          allowedRedirectOrigins: [
            'https://portal.example.test',
            'http://localhost:3000',
          ],
        },
      });

      const kmsService = new GithubAppService({
        logger: voidLogger,
        config,
        githubAppDao: kmsOnlyAppDao as any,
        githubAppInstallationDao: mockInstallationDao,
        stateNonceDao: mockStateNonceDao,
        kmsTokenMinter: mockKmsMinter as any,
        secretStore: envBackedSecretStore,
        workspaceExists: async () => true,
      });

      const kmsCallbackApp = express();
      kmsCallbackApp.use(
        '/github-app',
        createGithubAppRouter({
          logger: voidLogger,
          githubAppService: kmsService,
          httpAuth: { credentials: vi.fn() } as any,
          scopeService,
        }),
      );

      const statePayload = {
        redirectUrl: 'https://portal.example.test/admin/integrations',
        appId: '12345',
        host: 'github.com',
        jti: 'nonce-kms-callback',
        exp: Math.floor(Date.now() / 1000) + 600,
      };
      const state = createStateJWT(statePayload, CLIENT_SECRET);

      const res = await request(kmsCallbackApp)
        .get('/github-app/callback')
        .query({
          installation_id: '999',
          state,
          setup_action: 'install',
        });

      expect(res.status).toBe(302);
      expect(mockKmsMinter.generateAppJWT).toHaveBeenCalledWith(
        '12345',
        'alias/dev0-github-app-signing',
      );
      expect(mockInstallationDao.upsert).toHaveBeenCalledWith({
        appId: '12345',
        host: 'github.com',
        installationId: 999,
        orgLogin: 'acme-org',
        orgUrl: 'https://github.com/acme-org',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        permissions: { contents: 'read' },
        repoSelection: 'selected',
      });
    });

    it('should reject expired state JWT', async () => {
      const statePayload = {
        redirectUrl: 'https://portal.example.test/admin/integrations',
        appId: '12345',
        host: 'github.com',
        jti: 'nonce-expired',
        exp: Math.floor(Date.now() / 1000) - 100,
      };
      const state = createStateJWT(statePayload, CLIENT_SECRET);

      const res = await request(app).get('/github-app/callback').query({
        installation_id: '999',
        state,
        setup_action: 'install',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Invalid or expired state');
    });

    it('should reject invalid state signature', async () => {
      const statePayload = {
        redirectUrl: 'https://portal.example.test/admin/integrations',
        appId: '12345',
        host: 'github.com',
        jti: 'nonce-bad-sig',
        exp: Math.floor(Date.now() / 1000) + 600,
      };
      const state = createStateJWT(statePayload, 'wrong-secret');

      const res = await request(app).get('/github-app/callback').query({
        installation_id: '999',
        state,
        setup_action: 'install',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Invalid or expired state');
    });

    it('should reject malformed state signature without throwing', async () => {
      const statePayload = {
        redirectUrl: 'https://portal.example.test/admin/integrations',
        appId: '12345',
        host: 'github.com',
        jti: 'nonce-malformed',
        exp: Math.floor(Date.now() / 1000) + 600,
      };
      const validState = createStateJWT(statePayload, CLIENT_SECRET);
      const [header, payload] = validState.split('.');
      const malformedState = `${header}.${payload}.AA`;

      const res = await request(app).get('/github-app/callback').query({
        installation_id: '999',
        state: malformedState,
        setup_action: 'install',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Invalid or expired state');
    });

    it('should redirect with pending approval status for request callbacks', async () => {
      mockUndiciFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { account: { login: 'acme-org' }, requester: { login: 'dev-user' } },
        ],
      } as any);

      const statePayload = {
        redirectUrl:
          'https://portal.example.test/integrations?scope=acme&close-after=true&github-app-installed=true',
        appId: '12345',
        host: 'github.com',
        jti: 'nonce-request',
        exp: Math.floor(Date.now() / 1000) + 600,
      };
      const state = createStateJWT(statePayload, CLIENT_SECRET);

      const res = await request(app).get('/github-app/callback').query({
        state,
        setup_action: 'request',
      });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(
        'https://portal.example.test/integrations?scope=acme&close-after=true&github-app-install-requested=true',
      );
      expect(mockInstallationDao.upsert).not.toHaveBeenCalled();
      expect(mockInstallRequestDao.create).toHaveBeenCalledWith(
        '12345',
        'github.com',
        'acme-org',
      );
    });

    it('should not persist org login when installation request lookup is ambiguous', async () => {
      mockUndiciFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { account: { login: 'acme-org' }, requester: { login: 'dev-user' } },
          {
            account: { login: 'globex-org' },
            requester: { login: 'other-user' },
          },
        ],
      } as any);

      const statePayload = {
        redirectUrl:
          'https://portal.example.test/integrations?scope=acme&close-after=true&github-app-installed=true',
        appId: '12345',
        host: 'github.com',
        jti: 'nonce-request-ambiguous',
        exp: Math.floor(Date.now() / 1000) + 600,
      };
      const state = createStateJWT(statePayload, CLIENT_SECRET);

      const res = await request(app).get('/github-app/callback').query({
        state,
        setup_action: 'request',
      });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(
        'https://portal.example.test/integrations?scope=acme&close-after=true&github-app-install-requested=true',
      );
      expect(mockInstallRequestDao.create).toHaveBeenCalledWith(
        '12345',
        'github.com',
        undefined,
      );
    });

    it('should read all installation request pages when resolving org login', async () => {
      const firstPage = Array.from({ length: 100 }, () => ({
        account: {},
      }));
      mockUndiciFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => firstPage,
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ account: { login: 'acme-org' } }],
        } as any);

      const statePayload = {
        redirectUrl:
          'https://portal.example.test/integrations?scope=acme&close-after=true&github-app-installed=true',
        appId: '12345',
        host: 'github.com',
        jti: 'nonce-request-paginated',
        exp: Math.floor(Date.now() / 1000) + 600,
      };
      const state = createStateJWT(statePayload, CLIENT_SECRET);

      const res = await request(app).get('/github-app/callback').query({
        state,
        setup_action: 'request',
      });

      expect(res.status).toBe(302);
      expect(mockInstallRequestDao.create).toHaveBeenCalledWith(
        '12345',
        'github.com',
        'acme-org',
      );
      expect(mockUndiciFetch).toHaveBeenCalledWith(
        'https://api.github.com/app/installation-requests?per_page=100&page=1',
        expect.any(Object),
      );
      expect(mockUndiciFetch).toHaveBeenCalledWith(
        'https://api.github.com/app/installation-requests?per_page=100&page=2',
        expect.any(Object),
      );
    });

    it('should return 400 for missing state', async () => {
      const res = await request(app)
        .get('/github-app/callback')
        .query({ installation_id: '999' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Missing state parameter');
    });

    it('should return 400 for missing installation_id on install callbacks', async () => {
      const statePayload = {
        redirectUrl: 'https://portal.example.test/admin/integrations',
        appId: '12345',
        host: 'github.com',
        jti: 'nonce-missing-installation',
        exp: Math.floor(Date.now() / 1000) + 600,
      };
      const state = createStateJWT(statePayload, CLIENT_SECRET);

      const res = await request(app).get('/github-app/callback').query({
        state,
        setup_action: 'install',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Missing installation_id parameter');
    });

    it('should reject a replayed state nonce', async () => {
      mockStateNonceDao.consume.mockResolvedValueOnce(false);

      const statePayload = {
        redirectUrl: 'https://portal.example.test/admin/integrations',
        appId: '12345',
        host: 'github.com',
        jti: 'nonce-replayed',
        exp: Math.floor(Date.now() / 1000) + 600,
      };
      const state = createStateJWT(statePayload, CLIENT_SECRET);

      const res = await request(app).get('/github-app/callback').query({
        installation_id: '999',
        state,
        setup_action: 'install',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('State token has already been used');
      expect(mockInstallationDao.upsert).not.toHaveBeenCalled();
    });

    it('should reject a state token without jti', async () => {
      const statePayload = {
        redirectUrl: 'https://portal.example.test/admin/integrations',
        appId: '12345',
        host: 'github.com',
        exp: Math.floor(Date.now() / 1000) + 600,
      };
      const state = createStateJWT(statePayload, CLIENT_SECRET);

      const res = await request(app).get('/github-app/callback').query({
        installation_id: '999',
        state,
        setup_action: 'install',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('State token missing jti');
    });

    it('should reject redirect to a disallowed origin', async () => {
      const statePayload = {
        redirectUrl: 'https://evil.example.com/steal',
        appId: '12345',
        host: 'github.com',
        jti: 'nonce-evil',
        exp: Math.floor(Date.now() / 1000) + 600,
      };
      const state = createStateJWT(statePayload, CLIENT_SECRET);

      const res = await request(app).get('/github-app/callback').query({
        installation_id: '999',
        state,
        setup_action: 'install',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe(
        'Redirect URL origin is not in the allowedRedirectOrigins list',
      );
      expect(mockInstallationDao.upsert).not.toHaveBeenCalled();
    });
  });

  describe('GET /github-app/installations', () => {
    it('lists installations in the current schema', async () => {
      mockInstallationDao.list.mockResolvedValue([
        {
          id: 'inst-1',
          appId: '12345',
          host: 'github.com',
          installationId: 100,
          orgLogin: 'acme-org',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ] as any);

      const res = await request(app).get('/github-app/installations');

      expect(res.status).toBe(200);
      expect(res.body.data.installations).toHaveLength(1);
      expect(res.body.data.installations[0].orgLogin).toBe('acme-org');
      expect(res.body.data.warning).toBeUndefined();
    });

    it('refreshes missing org metadata before returning installations', async () => {
      mockInstallationDao.list.mockResolvedValue([
        {
          id: 'inst-1',
          appId: '12345',
          host: 'github.com',
          installationId: 100,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ] as any);
      mockInstallationDao.upsert.mockResolvedValueOnce({
        id: 'inst-1',
        appId: '12345',
        host: 'github.com',
        installationId: 100,
        orgLogin: 'acme-org',
        orgUrl: 'https://github.com/acme-org',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        permissions: { contents: 'read' },
        repoSelection: 'selected',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      } as any);

      const res = await request(app).get('/github-app/installations');

      expect(res.status).toBe(200);
      expect(res.body.data.installations).toHaveLength(1);
      expect(res.body.data.installations[0].orgLogin).toBe('acme-org');
      expect(mockInstallationDao.upsert).toHaveBeenCalledWith({
        appId: '12345',
        host: 'github.com',
        installationId: 100,
        orgLogin: 'acme-org',
        orgUrl: 'https://github.com/acme-org',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        permissions: { contents: 'read' },
        repoSelection: 'selected',
      });
    });

    it('returns a warning when app credentials look invalid', async () => {
      mockInstallationDao.listAll.mockResolvedValue([
        {
          id: 'inst-1',
          appId: '12345',
          host: 'github.com',
          installationId: 100,
          orgLogin: 'acme-org',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ] as any);
      mockUndiciFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () =>
          '{"message":"A JSON web token could not be decoded","status":"401"}',
      } as any);

      const res = await request(app).get('/github-app/installations').query({
        appId: '12345',
        host: 'github.com',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.installations).toHaveLength(1);
      expect(res.body.data.warning).toEqual({
        code: 'invalid_app_credentials',
        message:
          'GitHub App credentials look invalid. Installation details may be incomplete. Check the App ID, private key, and client secret.',
      });
    });
  });

  describe('POST /github-app/test', () => {
    it('returns app and installation test results', async () => {
      const mockLocalMinter = {
        getInstallationToken: vi.fn().mockResolvedValue('ghs_local_token'),
        clearCache: vi.fn(),
      };

      const localInstallationDao = {
        ...mockInstallationDao,
        listAll: vi.fn().mockResolvedValue([
          {
            id: 'inst-1',
            appId: '12345',
            host: 'github.com',
            installationId: 100,
            orgLogin: 'acme-org',
            repoSelection: 'selected',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ]),
      };

      const config = new ConfigReader({
        githubApp: { allowedRedirectOrigins: [] },
      });

      const localService = new GithubAppService({
        logger: voidLogger,
        config,
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: localInstallationDao as any,
        stateNonceDao: mockStateNonceDao,
        localTokenMinter: mockLocalMinter as any,
        secretStore: envBackedSecretStore,
        workspaceExists: async () => true,
      });

      const router = createGithubAppRouter({
        logger: voidLogger,
        githubAppService: localService,
        httpAuth: { credentials: vi.fn() } as any,
        scopeService,
      });

      const testApp = express();
      testApp.use(express.json());
      testApp.use('/github-app', router);

      mockUndiciFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ slug: 'my-test-app' }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            total_count: 1,
            repositories: [{ full_name: 'acme-org/my-repo' }],
          }),
        } as any);

      const res = await request(testApp).post('/github-app/test').send({
        appId: '12345',
        host: 'github.com',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.appCredentials).toEqual({
        status: 'success',
        message: 'GitHub accepted the app credentials.',
        requestPath: '/app',
      });
      expect(res.body.data.installations).toEqual([
        expect.objectContaining({
          installationId: 100,
          orgLogin: 'acme-org',
          status: 'success',
          requestPath: '/installation/repositories?per_page=1',
          repositoryCount: 1,
          sampleRepository: 'acme-org/my-repo',
        }),
      ]);
    });

    it('returns a structured app credential failure', async () => {
      const localInstallationDao = {
        ...mockInstallationDao,
        listAll: vi.fn().mockResolvedValue([
          {
            id: 'inst-1',
            appId: '12345',
            host: 'github.com',
            installationId: 100,
            orgLogin: 'acme-org',
            repoSelection: 'selected',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ]),
      };

      const config = new ConfigReader({
        githubApp: { allowedRedirectOrigins: [] },
      });

      const service = new GithubAppService({
        logger: voidLogger,
        config,
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: localInstallationDao as any,
        stateNonceDao: mockStateNonceDao,
        secretStore: envBackedSecretStore,
        workspaceExists: async () => true,
      });

      const router = createGithubAppRouter({
        logger: voidLogger,
        githubAppService: service,
        httpAuth: { credentials: vi.fn() } as any,
        scopeService,
      });

      const testApp = express();
      testApp.use(express.json());
      testApp.use('/github-app', router);

      mockUndiciFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () =>
          '{"message":"A JSON web token could not be decoded","status":"401"}',
      } as any);

      const res = await request(testApp).post('/github-app/test').send({
        appId: '12345',
        host: 'github.com',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.appCredentials.status).toBe('error');
      expect(res.body.data.appCredentials.requestPath).toBe('/app');
      expect(res.body.data.installations).toEqual([
        expect.objectContaining({
          installationId: 100,
          status: 'error',
          message:
            'Skipped installation request because the app credentials could not be validated.',
        }),
      ]);
    });

    it('returns a warning when no installations exist in the current schema', async () => {
      const localInstallationDao = {
        ...mockInstallationDao,
        listAll: vi.fn().mockResolvedValue([]),
      };

      const config = new ConfigReader({
        githubApp: { allowedRedirectOrigins: [] },
      });

      const service = new GithubAppService({
        logger: voidLogger,
        config,
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: localInstallationDao as any,
        stateNonceDao: mockStateNonceDao,
        secretStore: envBackedSecretStore,
        workspaceExists: async () => true,
      });

      const router = createGithubAppRouter({
        logger: voidLogger,
        githubAppService: service,
        httpAuth: { credentials: vi.fn() } as any,
        scopeService,
      });

      const testApp = express();
      testApp.use(express.json());
      testApp.use('/github-app', router);

      mockUndiciFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ slug: 'my-test-app' }),
      } as any);

      const res = await request(testApp).post('/github-app/test').send({
        appId: '12345',
        host: 'github.com',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.appCredentials).toEqual({
        status: 'success',
        message: 'GitHub accepted the app credentials.',
        requestPath: '/app',
      });
      expect(res.body.data.installations).toEqual([]);
      expect(res.body.data.warning).toBe(
        'GitHub App credentials are valid, but no installations exist for this tenant yet.',
      );
    });
  });

  describe('fulfillPendingInstallRequests', () => {
    it('should read all installation pages when matching pending requests', async () => {
      mockInstallRequestDao.listActive.mockResolvedValueOnce([
        {
          id: 'req-pending-1',
          appId: '12345',
          host: 'github.com',
          orgLogin: 'acme-org',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      ]);

      const firstInstallationsPage = Array.from(
        { length: 100 },
        (_, index) => ({
          id: index + 1,
          app_id: 12345,
          account: { login: `org-${index + 1}` },
        }),
      );
      mockUndiciFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => firstInstallationsPage,
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              id: 999,
              app_id: 12345,
              account: {
                login: 'acme-org',
                html_url: 'https://github.com/acme-org',
                avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
              },
              permissions: { contents: 'read' },
              repository_selection: 'selected',
              target_type: 'Organization',
            },
          ],
        } as any);

      await githubAppService.fulfillPendingInstallRequests();

      expect(mockInstallationDao.upsert).toHaveBeenCalledWith({
        appId: '12345',
        host: 'github.com',
        installationId: 999,
        orgLogin: 'acme-org',
        orgUrl: 'https://github.com/acme-org',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        permissions: { contents: 'read' },
        repoSelection: 'selected',
      });
      expect(mockInstallRequestDao.delete).toHaveBeenCalledWith(
        'req-pending-1',
      );
      expect(mockUndiciFetch).toHaveBeenCalledWith(
        'https://api.github.com/app/installations?per_page=100&page=1',
        expect.any(Object),
      );
      expect(mockUndiciFetch).toHaveBeenCalledWith(
        'https://api.github.com/app/installations?per_page=100&page=2',
        expect.any(Object),
      );
    });

    it('does not poll GitHub for a deleted workspace', async () => {
      mockInstallRequestDao.listActive.mockResolvedValueOnce([
        {
          id: 'req-pending-1',
          appId: '12345',
          host: 'github.com',
          orgLogin: 'acme-org',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      ]);
      const service = new GithubAppService({
        logger: voidLogger,
        config: new ConfigReader({ githubApp: {} }),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        githubAppInstallRequestDao: mockInstallRequestDao,
        stateNonceDao: mockStateNonceDao,
        secretStore: envBackedSecretStore,
        workspaceExists: async () => false,
      });

      await service.fulfillPendingInstallRequests();

      expect(mockUndiciFetch).not.toHaveBeenCalled();
      expect(mockInstallationDao.upsert).not.toHaveBeenCalled();
    });

    it('does not persist a result after its workspace is deleted', async () => {
      mockInstallRequestDao.listActive.mockResolvedValueOnce([
        {
          id: 'req-pending-1',
          appId: '12345',
          host: 'github.com',
          orgLogin: 'acme-org',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      ]);
      mockUndiciFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: 999,
            account: { login: 'acme-org' },
          },
        ],
      } as any);
      const workspaceExists = vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const service = new GithubAppService({
        logger: voidLogger,
        config: new ConfigReader({ githubApp: {} }),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        githubAppInstallRequestDao: mockInstallRequestDao,
        stateNonceDao: mockStateNonceDao,
        secretStore: envBackedSecretStore,
        workspaceExists,
      });

      await service.fulfillPendingInstallRequests();

      expect(workspaceExists).toHaveBeenCalledTimes(2);
      expect(mockInstallationDao.upsert).not.toHaveBeenCalled();
      expect(mockInstallRequestDao.delete).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /github-app/installations/:id', () => {
    it('should delete an installation', async () => {
      const res = await request(app).delete('/github-app/installations/inst-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockInstallationDao.delete).toHaveBeenCalledWith('inst-1');
    });

    it("does not resolve another workspace's uninstall key", async () => {
      const organizationWorkspaceId = '11111111-1111-4111-8111-111111111111';
      const personalWorkspaceId = '22222222-2222-4222-8222-222222222222';
      const resolvedWorkspaceIds: Array<string | undefined> = [];
      const workspaceSecretStore: SecretStoreService = {
        ...envBackedSecretStore,
        resolver: scope => {
          resolvedWorkspaceIds.push(scope?.workspaceId);
          return {
            async resolve(refs) {
              const values: Record<string, string> = {};
              if (
                scope?.workspaceId === organizationWorkspaceId &&
                refs.includes(PRIVATE_KEY_REF)
              ) {
                values[PRIVATE_KEY_REF] = process.env[PRIVATE_KEY_REF] ?? '';
              }
              return values;
            },
          };
        },
      };
      mockGithubAppDao.getByAppId.mockResolvedValueOnce({
        id: 'app-uuid',
        appId: '12345',
        host: 'github.com',
        integrationId: 'organization-integration',
        privateKeyRef: PRIVATE_KEY_REF,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const isolatedService = new GithubAppService({
        logger: voidLogger,
        config: new ConfigReader({ githubApp: {} }),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        githubAppInstallRequestDao: mockInstallRequestDao,
        stateNonceDao: mockStateNonceDao,
        secretStore: workspaceSecretStore,
        workspaceExists: async () => true,
        getWorkspaceIdForIntegration: async () => organizationWorkspaceId,
      });

      await expect(
        isolatedService.deleteInstallation('inst-1', personalWorkspaceId),
      ).rejects.toThrow('GitHub App not found');

      expect(resolvedWorkspaceIds).toEqual([]);
      expect(mockInstallationDao.delete).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /github-app/apps/:id', () => {
    it('should pass null to updateApp when optional string fields are cleared with null', async () => {
      const updateApp = vi.fn().mockResolvedValue({
        id: 'row-1',
        appId: '12345',
        host: 'github.com',
        status: 'active',
      });
      const patchDao = {
        ...mockGithubAppDao,
        getById: vi.fn().mockResolvedValue({
          id: 'row-1',
          integrationId: 'integration-1',
        }),
        updateApp,
      } as unknown as GithubAppDao;
      const integrationDao = {
        getById: vi.fn().mockResolvedValue({ id: 'integration-1' }),
      } as any;

      const router = createGithubAppRouter({
        logger: voidLogger,
        githubAppService,
        githubAppDao: patchDao,
        integrationDao,
        httpAuth: { credentials: vi.fn() } as any,
        scopeService,
      });

      const patchApp = express();
      patchApp.use(express.json());
      patchApp.use('/github-app', router);

      const res = await request(patchApp).patch('/github-app/apps/row-1').send({
        description: null,
        htmlUrl: null,
        webhookSecretRef: null,
      });

      expect(res.status).toBe(200);
      expect(updateApp).toHaveBeenCalledWith('row-1', {
        description: null,
        htmlUrl: null,
        webhookSecretRef: null,
      });
    });

    it('should pass null for whitespace-only optional strings so they clear', async () => {
      const updateApp = vi.fn().mockResolvedValue({
        id: 'row-1',
        appId: '12345',
        host: 'github.com',
        status: 'active',
      });
      const patchDao = {
        ...mockGithubAppDao,
        getById: vi.fn().mockResolvedValue({
          id: 'row-1',
          integrationId: 'integration-1',
        }),
        updateApp,
      } as unknown as GithubAppDao;
      const integrationDao = {
        getById: vi.fn().mockResolvedValue({ id: 'integration-1' }),
      } as any;

      const router = createGithubAppRouter({
        logger: voidLogger,
        githubAppService,
        githubAppDao: patchDao,
        integrationDao,
        httpAuth: { credentials: vi.fn() } as any,
        scopeService,
      });

      const patchApp = express();
      patchApp.use(express.json());
      patchApp.use('/github-app', router);

      const res = await request(patchApp)
        .patch('/github-app/apps/row-1')
        .send({ description: '   ' });

      expect(res.status).toBe(200);
      expect(updateApp).toHaveBeenCalledWith('row-1', {
        description: null,
      });
    });
  });

  describe('POST /github-app/token (per-app KMS key)', () => {
    it('should return 400 when URL has no org segment', async () => {
      const mockKmsMinter = {
        getInstallationToken: vi.fn(),
        clearCache: vi.fn(),
        generateAppJWT: vi.fn(),
      };
      const mockLocalMinter = {
        getInstallationToken: vi.fn(),
        clearCache: vi.fn(),
      };

      const appDao = {
        ...mockGithubAppDao,
        getByHostAndPurpose: vi.fn().mockResolvedValue({
          id: 'app-uuid',
          appId: '12345',
          host: 'github.com',
          purpose: 'backstage',
          slug: 'my-test-app',
          kmsKeyId: 'alias/dev0-github-app-signing',
          clientSecretRef: 'GH_APP_CLIENT_SECRET',
          status: 'active',
        }),
      };

      const installationDao = {
        ...mockInstallationDao,
        getByOrg: vi.fn(),
        list: vi.fn(),
      };

      const config = new ConfigReader({
        githubApp: { allowedRedirectOrigins: [] },
      });

      const service = new GithubAppService({
        logger: voidLogger,
        config,
        githubAppDao: appDao as any,
        githubAppInstallationDao: installationDao as any,
        stateNonceDao: mockStateNonceDao,
        localTokenMinter: mockLocalMinter as any,
        kmsTokenMinter: mockKmsMinter as any,
        secretStore: envBackedSecretStore,
        workspaceExists: async () => true,
      });

      const router = createGithubAppRouter({
        logger: voidLogger,
        githubAppService: service,
        httpAuth: { credentials: vi.fn() } as any,
        scopeService,
      });

      const testApp = express();
      testApp.use(express.json());
      testApp.use('/github-app', router);

      const res = await request(testApp)
        .post('/github-app/token')
        .send({ url: 'https://github.com', purpose: 'backstage' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain(
        'GitHub org/owner could not be resolved from URL',
      );
      expect(installationDao.getByOrg).not.toHaveBeenCalled();
      expect(installationDao.list).not.toHaveBeenCalled();
    });

    it('should use per-app kmsKeyId when the matched app has one', async () => {
      const mockKmsMinter = {
        getInstallationToken: vi.fn().mockResolvedValue('ghs_kms_token'),
        clearCache: vi.fn(),
        generateAppJWT: vi.fn(),
      };
      const mockLocalMinter = {
        getInstallationToken: vi.fn(),
        clearCache: vi.fn(),
      };

      const kmsAppDao = {
        ...mockGithubAppDao,
        getByHostAndPurpose: vi.fn().mockResolvedValue({
          id: 'app-uuid',
          appId: '12345',
          host: 'github.com',
          purpose: 'backstage',
          slug: 'my-test-app',
          kmsKeyId: 'alias/dev0-github-app-signing',
          clientSecretRef: 'GH_APP_CLIENT_SECRET',
          status: 'active',
        }),
      };

      const kmsInstallationDao = {
        ...mockInstallationDao,
        getByOrg: vi.fn().mockResolvedValue({
          id: 'inst-1',
          appId: '12345',
          installationId: 100,
          orgLogin: 'acme-org',
        }),
        list: vi.fn().mockResolvedValue([
          {
            id: 'inst-1',
            appId: '12345',
            installationId: 100,
            orgLogin: 'acme-org',
          },
        ]),
      };

      const config = new ConfigReader({
        githubApp: { allowedRedirectOrigins: [] },
      });

      const kmsService = new GithubAppService({
        logger: voidLogger,
        config,
        githubAppDao: kmsAppDao as any,
        githubAppInstallationDao: kmsInstallationDao as any,
        stateNonceDao: mockStateNonceDao,
        localTokenMinter: mockLocalMinter as any,
        kmsTokenMinter: mockKmsMinter as any,
        secretStore: envBackedSecretStore,
        workspaceExists: async () => true,
      });

      const router = createGithubAppRouter({
        logger: voidLogger,
        githubAppService: kmsService,
        httpAuth: { credentials: vi.fn() } as any,
        scopeService,
      });

      const kmsApp = express();
      kmsApp.use(express.json());
      kmsApp.use('/github-app', router);

      const res = await request(kmsApp).post('/github-app/token').send({
        url: 'https://github.com/acme-org/my-repo',
        purpose: 'backstage',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toBe('ghs_kms_token');
      expect(mockKmsMinter.getInstallationToken).toHaveBeenCalledWith(
        '12345',
        100,
        'alias/dev0-github-app-signing',
        'github.com',
      );
      expect(mockLocalMinter.getInstallationToken).not.toHaveBeenCalled();
    });

    it('should fall back to local minter when app has no kmsKeyId', async () => {
      const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
      process.env.TOKEN_TEST_PK = pem;

      const mockKmsMinter = {
        getInstallationToken: vi.fn(),
        clearCache: vi.fn(),
        generateAppJWT: vi.fn(),
      };
      const mockLocalMinter = {
        getInstallationToken: vi.fn().mockResolvedValue('ghs_local_token'),
        clearCache: vi.fn(),
      };

      const localAppDao = {
        ...mockGithubAppDao,
        getByHostAndPurpose: vi.fn().mockResolvedValue({
          id: 'app-uuid',
          appId: '12345',
          host: 'github.com',
          purpose: 'backstage',
          slug: 'my-test-app',
          privateKeyRef: 'TOKEN_TEST_PK',
          clientSecretRef: 'GH_APP_CLIENT_SECRET',
          status: 'active',
        }),
      };

      const localInstallationDao = {
        ...mockInstallationDao,
        getByOrg: vi.fn().mockResolvedValue({
          id: 'inst-1',
          appId: '12345',
          installationId: 100,
          orgLogin: 'acme-org',
        }),
        list: vi.fn().mockResolvedValue([
          {
            id: 'inst-1',
            appId: '12345',
            installationId: 100,
            orgLogin: 'acme-org',
          },
        ]),
      };

      const config = new ConfigReader({
        githubApp: { allowedRedirectOrigins: [] },
      });

      const localService = new GithubAppService({
        logger: voidLogger,
        config,
        githubAppDao: localAppDao as any,
        githubAppInstallationDao: localInstallationDao as any,
        stateNonceDao: mockStateNonceDao,
        localTokenMinter: mockLocalMinter as any,
        kmsTokenMinter: mockKmsMinter as any,
        secretStore: envBackedSecretStore,
        workspaceExists: async () => true,
      });

      const router = createGithubAppRouter({
        logger: voidLogger,
        githubAppService: localService,
        httpAuth: { credentials: vi.fn() } as any,
        scopeService,
      });

      const localApp = express();
      localApp.use(express.json());
      localApp.use('/github-app', router);

      const res = await request(localApp).post('/github-app/token').send({
        url: 'https://github.com/acme-org/my-repo',
        purpose: 'backstage',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toBe('ghs_local_token');
      expect(mockKmsMinter.getInstallationToken).not.toHaveBeenCalled();
      expect(mockLocalMinter.getInstallationToken).toHaveBeenCalled();

      delete process.env.TOKEN_TEST_PK;
    });

    it('should return 400 when kms token minting fails', async () => {
      const mockKmsMinter = {
        getInstallationToken: vi
          .fn()
          .mockRejectedValue(new Error('KMS access denied')),
        clearCache: vi.fn(),
        generateAppJWT: vi.fn(),
      };
      const mockLocalMinter = {
        getInstallationToken: vi.fn(),
        clearCache: vi.fn(),
      };

      const kmsAppDao = {
        ...mockGithubAppDao,
        getByHostAndPurpose: vi.fn().mockResolvedValue({
          id: 'app-uuid',
          appId: '12345',
          host: 'github.com',
          purpose: 'backstage',
          slug: 'my-test-app',
          kmsKeyId: 'alias/dev0-github-app-signing',
          clientSecretRef: 'GH_APP_CLIENT_SECRET',
          status: 'active',
        }),
      };

      const kmsInstallationDao = {
        ...mockInstallationDao,
        getByOrg: vi.fn().mockResolvedValue({
          id: 'inst-1',
          appId: '12345',
          installationId: 100,
          orgLogin: 'acme-org',
        }),
        list: vi.fn().mockResolvedValue([]),
      };

      const config = new ConfigReader({
        githubApp: { allowedRedirectOrigins: [] },
      });

      const kmsService = new GithubAppService({
        logger: voidLogger,
        config,
        githubAppDao: kmsAppDao as any,
        githubAppInstallationDao: kmsInstallationDao as any,
        stateNonceDao: mockStateNonceDao,
        localTokenMinter: mockLocalMinter as any,
        kmsTokenMinter: mockKmsMinter as any,
        secretStore: envBackedSecretStore,
        workspaceExists: async () => true,
      });

      const router = createGithubAppRouter({
        logger: voidLogger,
        githubAppService: kmsService,
        httpAuth: { credentials: vi.fn() } as any,
        scopeService,
      });

      const kmsApp = express();
      kmsApp.use(express.json());
      kmsApp.use('/github-app', router);

      const res = await request(kmsApp).post('/github-app/token').send({
        url: 'https://github.com/acme-org/my-repo',
        purpose: 'backstage',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain(
        'GitHub App configuration error',
      );
      expect(res.body.error.message).toContain('kmsKeyId');
    });

    it('should return 400 when private key env var is missing', async () => {
      const mockKmsMinter = {
        getInstallationToken: vi.fn(),
        clearCache: vi.fn(),
        generateAppJWT: vi.fn(),
      };
      const mockLocalMinter = {
        getInstallationToken: vi.fn(),
        clearCache: vi.fn(),
      };

      const localAppDao = {
        ...mockGithubAppDao,
        getByHostAndPurpose: vi.fn().mockResolvedValue({
          id: 'app-uuid',
          appId: '12345',
          host: 'github.com',
          purpose: 'backstage',
          slug: 'my-test-app',
          privateKeyRef: 'MISSING_TEST_PRIVATE_KEY',
          clientSecretRef: 'GH_APP_CLIENT_SECRET',
          status: 'active',
        }),
      };

      const localInstallationDao = {
        ...mockInstallationDao,
        getByOrg: vi.fn().mockResolvedValue({
          id: 'inst-1',
          appId: '12345',
          installationId: 100,
          orgLogin: 'acme-org',
        }),
        list: vi.fn().mockResolvedValue([]),
      };

      const config = new ConfigReader({
        githubApp: { allowedRedirectOrigins: [] },
      });

      const localService = new GithubAppService({
        logger: voidLogger,
        config,
        githubAppDao: localAppDao as any,
        githubAppInstallationDao: localInstallationDao as any,
        stateNonceDao: mockStateNonceDao,
        localTokenMinter: mockLocalMinter as any,
        kmsTokenMinter: mockKmsMinter as any,
        secretStore: envBackedSecretStore,
        workspaceExists: async () => true,
      });

      const router = createGithubAppRouter({
        logger: voidLogger,
        githubAppService: localService,
        httpAuth: { credentials: vi.fn() } as any,
        scopeService,
      });

      const localApp = express();
      localApp.use(express.json());
      localApp.use('/github-app', router);

      const res = await request(localApp).post('/github-app/token').send({
        url: 'https://github.com/acme-org/my-repo',
        purpose: 'backstage',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain(
        'GitHub App configuration error',
      );
      expect(res.body.error.message).toContain('MISSING_TEST_PRIVATE_KEY');
    });
  });

  describe('workspace isolation', () => {
    const workspaceOne = '11111111-1111-4111-8111-111111111111';
    const workspaceTwo = '22222222-2222-4222-8222-222222222222';

    function createScopedService() {
      const apps = [
        {
          id: 'app-one',
          appId: '111',
          host: 'github.com',
          integrationId: 'integration-one',
          purposes: ['backstage'],
          privateKeyRef: PRIVATE_KEY_REF,
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'app-two',
          appId: '222',
          host: 'github.com',
          integrationId: 'integration-two',
          purposes: ['backstage'],
          privateKeyRef: PRIVATE_KEY_REF,
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ];
      mockGithubAppDao.listAppsByWorkspaceId = vi
        .fn()
        .mockImplementation(async workspaceId =>
          apps.filter(app =>
            workspaceId === workspaceOne
              ? app.integrationId === 'integration-one'
              : app.integrationId === 'integration-two',
          ),
        );
      mockGithubAppDao.listAppsByHost = vi.fn().mockResolvedValue(apps);
      return new GithubAppService({
        logger: voidLogger,
        config: new ConfigReader({ githubApp: { allowedRedirectOrigins: [] } }),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        githubAppInstallRequestDao: mockInstallRequestDao,
        stateNonceDao: mockStateNonceDao,
        secretStore: envBackedSecretStore,
        workspaceExists: async () => true,
        localTokenMinter: {
          getInstallationToken: vi.fn().mockResolvedValue('workspace-token'),
          clearCache: vi.fn(),
        } as never,
        getWorkspaceIdForIntegration: async integrationId =>
          integrationId === 'integration-one' ? workspaceOne : workspaceTwo,
      });
    }

    it('passes the request workspace to every GitHub App operation', async () => {
      const scopedService = githubAppService;
      const generateInstallLink = vi
        .spyOn(scopedService, 'generateInstallLink')
        .mockResolvedValue({ installUrl: 'https://github.com/install' });
      const listInstallations = vi
        .spyOn(scopedService, 'listInstallations')
        .mockResolvedValue({ installations: [], warning: undefined });
      const listInstallRequests = vi
        .spyOn(scopedService, 'listInstallRequests')
        .mockResolvedValue([]);
      const deleteInstallation = vi
        .spyOn(scopedService, 'deleteInstallation')
        .mockResolvedValue();
      const createToken = vi
        .spyOn(scopedService, 'createToken')
        .mockResolvedValue({ token: 'token' });
      const testAppConnection = vi
        .spyOn(scopedService, 'testAppConnection')
        .mockResolvedValue({} as never);
      const router = createGithubAppRouter({
        logger: voidLogger,
        githubAppService: scopedService,
        httpAuth: { credentials: vi.fn() } as any,
        scopeService,
        getWorkspaceId: () => workspaceOne,
      });
      const scopedApp = express();
      scopedApp.use(express.json());
      scopedApp.use('/github-app', router);

      await request(scopedApp).get('/github-app/install-link').query({
        appId: '111',
        redirectUrl: 'https://portal.example.test/admin/integrations',
      });
      await request(scopedApp).get('/github-app/installations');
      await request(scopedApp).get('/github-app/install-requests');
      await request(scopedApp).delete('/github-app/installations/inst-one');
      await request(scopedApp).post('/github-app/token').send({
        url: 'https://github.com/acme/repo',
        purpose: 'backstage',
      });
      await request(scopedApp).post('/github-app/test').send({ appId: '111' });

      expect(generateInstallLink).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: workspaceOne }),
      );
      expect(listInstallations).toHaveBeenCalledWith(
        undefined,
        undefined,
        workspaceOne,
      );
      expect(listInstallRequests).toHaveBeenCalledWith(undefined, workspaceOne);
      expect(deleteInstallation).toHaveBeenCalledWith('inst-one', workspaceOne);
      expect(createToken).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: workspaceOne }),
      );
      expect(testAppConnection).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: workspaceOne }),
      );
    });

    it('filters installation data to apps in the request workspace', async () => {
      mockInstallationDao.list.mockResolvedValue([
        {
          id: 'installation-one',
          appId: '111',
          host: 'github.com',
          installationId: 1,
          orgLogin: 'one',
        },
        {
          id: 'installation-two',
          appId: '222',
          host: 'github.com',
          installationId: 2,
          orgLogin: 'two',
        },
      ] as never);
      mockInstallRequestDao.list = vi.fn().mockResolvedValue([
        { id: 'request-one', appId: '111', host: 'github.com' },
        { id: 'request-two', appId: '222', host: 'github.com' },
      ] as never);
      const service = createScopedService();

      await expect(
        service.listInstallations(undefined, undefined, workspaceOne),
      ).resolves.toMatchObject({
        installations: [{ id: 'installation-one' }],
      });
      await expect(
        service.listInstallRequests(undefined, workspaceOne),
      ).resolves.toEqual([
        { id: 'request-one', appId: '111', host: 'github.com' },
      ]);
    });

    it('rejects sensitive operations on another workspace app', async () => {
      mockGithubAppDao.getByAppId.mockResolvedValue({
        id: 'app-two',
        appId: '222',
        host: 'github.com',
        integrationId: 'integration-two',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      mockInstallationDao.getById.mockResolvedValue({
        id: 'installation-two',
        appId: '222',
        host: 'github.com',
        installationId: 2,
        orgLogin: 'two',
      } as never);
      const service = createScopedService();

      await expect(
        service.testAppConnection({
          appId: '222',
          callerIdentity: 'user:default/test',
          workspaceId: workspaceOne,
        }),
      ).rejects.toThrow('GitHub App not found');
      await expect(
        service.deleteInstallation('installation-two', workspaceOne),
      ).rejects.toThrow('GitHub App not found');
      await expect(
        service.generateInstallLink({
          appId: '222',
          redirectUrl: 'https://portal.example.test/admin/integrations',
          workspaceId: workspaceOne,
        }),
      ).rejects.toThrow('GitHub App not found');
      expect(mockInstallationDao.delete).not.toHaveBeenCalled();
    });

    it('selects the token-minting app from the request workspace', async () => {
      mockInstallationDao.getByOrg = vi.fn().mockResolvedValue({
        id: 'installation-one',
        appId: '111',
        host: 'github.com',
        installationId: 1,
        orgLogin: 'acme-org',
      } as never);
      const service = createScopedService();

      await expect(
        service.createToken({
          url: 'https://github.com/acme-org/repository',
          purpose: 'backstage',
          callerIdentity: 'user:default/test',
          workspaceId: workspaceOne,
        }),
      ).resolves.toEqual({ token: 'workspace-token' });
      expect(mockInstallationDao.getByOrg).toHaveBeenCalledWith(
        '111',
        'github.com',
        'acme-org',
      );
    });

    it('keeps the same app id separate across hosts and workspaces', async () => {
      const apps = [
        {
          id: 'app-cloud',
          appId: '111',
          host: 'github.com',
          integrationId: 'integration-one',
          purposes: ['backstage'],
          privateKeyRef: PRIVATE_KEY_REF,
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'app-enterprise',
          appId: '111',
          host: 'github.enterprise.test',
          integrationId: 'integration-two',
          purposes: ['backstage'],
          privateKeyRef: PRIVATE_KEY_REF,
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ];
      mockGithubAppDao.listAppsByWorkspaceId = vi
        .fn()
        .mockImplementation(async workspaceId =>
          apps.filter(app =>
            workspaceId === workspaceOne
              ? app.integrationId === 'integration-one'
              : app.integrationId === 'integration-two',
          ),
        );
      mockInstallationDao.getByOrg = vi
        .fn()
        .mockImplementation(async (_appId, host) =>
          host === 'github.enterprise.test'
            ? {
                id: 'installation-enterprise',
                appId: '111',
                host,
                installationId: 2,
                orgLogin: 'acme-org',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              }
            : {
                id: 'installation-cloud',
                appId: '111',
                host,
                installationId: 1,
                orgLogin: 'acme-org',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
        );
      const localTokenMinter = {
        getInstallationToken: vi.fn().mockResolvedValue('enterprise-token'),
        clearCache: vi.fn(),
      };
      const service = new GithubAppService({
        logger: voidLogger,
        config: new ConfigReader({ githubApp: { allowedRedirectOrigins: [] } }),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        githubAppInstallRequestDao: mockInstallRequestDao,
        stateNonceDao: mockStateNonceDao,
        secretStore: envBackedSecretStore,
        workspaceExists: async () => true,
        localTokenMinter: localTokenMinter as never,
        getWorkspaceIdForIntegration: async integrationId =>
          integrationId === 'integration-one' ? workspaceOne : workspaceTwo,
      });

      await expect(
        service.createToken({
          url: 'https://github.enterprise.test/acme-org/repository',
          purpose: 'backstage',
          callerIdentity: 'user:default/test',
          workspaceId: workspaceTwo,
        }),
      ).resolves.toEqual({ token: 'enterprise-token' });
      expect(mockInstallationDao.getByOrg).toHaveBeenCalledWith(
        '111',
        'github.enterprise.test',
        'acme-org',
      );
      expect(localTokenMinter.getInstallationToken).toHaveBeenCalledWith(
        '111',
        2,
        expect.any(String),
        'https://github.enterprise.test/api/v3',
      );
    });

    it('lets only the default workspace manage unlinked legacy apps', async () => {
      const updateApp = vi.fn().mockResolvedValue({
        id: 'legacy-app',
        appId: '12345',
        host: 'github.com',
        status: 'active',
      });
      const legacyDao = {
        ...mockGithubAppDao,
        getById: vi.fn().mockResolvedValue({
          id: 'legacy-app',
          appId: '12345',
          host: 'github.com',
          status: 'active',
        }),
        listApps: vi.fn().mockResolvedValue([
          {
            id: 'legacy-app',
            appId: '12345',
            host: 'github.com',
            status: 'active',
          },
        ]),
        listAppsByWorkspaceId: vi.fn().mockImplementation(async workspaceId =>
          workspaceId === DEFAULT_WORKSPACE_ID
            ? [
                {
                  id: 'legacy-app',
                  appId: '12345',
                  host: 'github.com',
                  status: 'active',
                },
              ]
            : [],
        ),
        updateApp,
        deleteApp: vi.fn().mockResolvedValue(undefined),
      } as unknown as GithubAppDao;
      const integrationDao = {
        getById: vi.fn(),
        list: vi.fn().mockResolvedValue({ integrations: [], total: 0 }),
      } as unknown as IntegrationDao;
      const createApp = (workspaceId?: string) => {
        const router = createGithubAppRouter({
          logger: voidLogger,
          githubAppService,
          githubAppDao: legacyDao,
          integrationDao,
          httpAuth: { credentials: vi.fn() } as any,
          scopeService,
          getWorkspaceId: () => workspaceId,
        });
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/github-app', router);
        return scopedApp;
      };

      const defaultList = await request(createApp()).get('/github-app/apps');
      const personalList = await request(createApp(workspaceTwo)).get(
        '/github-app/apps',
      );
      const defaultPatch = await request(createApp())
        .patch('/github-app/apps/legacy-app')
        .send({ description: 'Updated' });
      const personalPatch = await request(createApp(workspaceTwo))
        .patch('/github-app/apps/legacy-app')
        .send({ description: 'Updated' });
      const defaultDelete = await request(createApp()).delete(
        '/github-app/apps/legacy-app',
      );
      const personalDelete = await request(createApp(workspaceTwo)).delete(
        '/github-app/apps/legacy-app',
      );

      expect(defaultList.body.data).toEqual([
        expect.objectContaining({ id: 'legacy-app' }),
      ]);
      expect(personalList.body.data).toEqual([]);
      expect(defaultPatch.status).toBe(200);
      expect(personalPatch.status).toBe(404);
      expect(defaultDelete.status).toBe(200);
      expect(personalDelete.status).toBe(404);
      expect(updateApp).toHaveBeenCalledTimes(1);
      expect(legacyDao.deleteApp).toHaveBeenCalledTimes(1);
      expect(integrationDao.getById).not.toHaveBeenCalled();
    });
  });
});
