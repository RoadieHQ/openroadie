import { describe, expect, it, vi, type Mock } from 'vitest';

import { IntegrationClient } from './IntegrationClient';
import { Integration, IntegrationDao } from '../database';
import { GithubAppDao } from '../database/GithubAppDao';
import { GithubAppInstallationDao } from '../database/GithubAppInstallationDao';
import { LocalGitHubAppTokenProvider } from '../github/LocalGitHubAppTokenProvider';
import { KmsGitHubAppTokenProvider } from '../github/KmsGitHubAppTokenProvider';
import { ConfigReader } from '@roadiehq/config';
import { Knex } from 'knex';
import {
  HttpRequestOptions,
  RequestOptions,
} from '@roadiehq/integrations-node';
import type { SecretStoreService } from '@roadiehq/secrets-node';
import type { SecretsMetadataService } from '@roadiehq/secrets-settings-backend';

// These tests cover how the client resolves credentials and validates options,
// not what the remote API returns — each one only needs the outbound request to
// fail. Without these mocks the HTTP backend made real calls to api.github.com
// and the AWS backend picked up ambient credentials (or probed IMDS) and called
// Cloud Control, so the suite's runtime — and whether it hit the 5s test
// timeout — depended on the network and the machine it ran on.
vi.mock('@aws-sdk/credential-providers', () => {
  const noAmbientCredentials = () => async () => {
    throw new Error('No AWS credentials in unit tests');
  };
  return {
    fromNodeProviderChain: noAmbientCredentials,
    fromTemporaryCredentials: noAmbientCredentials,
  };
});
vi.mock('undici', async importOriginal => {
  const actual = await importOriginal<typeof import('undici')>();
  return {
    ...actual,
    fetch: vi.fn(
      async () => new actual.Response('Bad credentials', { status: 401 }),
    ),
  };
});

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

function createMockIntegrationDao(
  ...integrations: Integration[]
): IntegrationDao {
  const byId = new Map(integrations.map(i => [i.id, i]));
  return {
    getById: vi.fn().mockImplementation(async (id: string) => {
      const match = byId.get(id);
      if (!match) {
        throw new Error(`Integration not found: ${id}`);
      }
      return match;
    }),
  } as unknown as IntegrationDao;
}

const voidLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  child: () => voidLogger,
} as any;

describe('IntegrationClient', () => {
  const mockConfig = new ConfigReader({
    secretsSettings: {
      secrets: [
        {
          name: 'TEST_API_TOKEN',
          internalName: 'TEST_API_TOKEN',
          description: 'Test',
        },
      ],
    },
  });

  const createMockTrx = () => {
    const createQueryBuilder = () => ({
      where: vi.fn().mockReturnThis(),
      forUpdate: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockResolvedValue([1]),
      update: vi.fn().mockResolvedValue(1),
      raw: vi.fn().mockResolvedValue({ rows: [{ id: 'test' }] }),
    });

    const mockTrx = vi
      .fn()
      .mockImplementation(() => createQueryBuilder()) as Mock & {
      raw: Mock;
    };
    mockTrx.raw = vi.fn().mockResolvedValue({ rows: [{ id: 'test' }] });

    return mockTrx;
  };

  const createKnexQueryBuilder = () => ({
    where: vi.fn().mockReturnThis(),
    delete: vi.fn().mockResolvedValue(1),
  });

  const mockKnex = Object.assign(
    vi.fn().mockImplementation(() => createKnexQueryBuilder()),
    {
      transaction: vi
        .fn()
        .mockImplementation(async (callback: (trx: any) => Promise<any>) => {
          return callback(createMockTrx());
        }),
    },
  ) as unknown as Knex;

  it('resolves integrations within the requested workspace', async () => {
    const workspaceId = '22222222-2222-4222-8222-222222222222';
    const integration: Integration = {
      id: 'workspace-integration',
      name: 'Workspace integration',
      slug: 'workspace-integration',
      type: 'other',
      host: 'https://example.com',
      authType: 'none',
      authConfig: null,
      requestsPerHour: 1000,
      backendType: 'http',
      config: {},
      createdBy: 'test-user',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    const integrationDao = createMockIntegrationDao(integration);
    const client = new IntegrationClient({
      logger: voidLogger,
      config: mockConfig,
      knex: mockKnex,
      integrationDao,
      secretStore: envBackedSecretStore,
    });

    await expect(
      client.getIntegration(integration.id, workspaceId),
    ).resolves.toMatchObject({ id: integration.id });
    expect(integrationDao.getById).toHaveBeenCalledWith(
      integration.id,
      workspaceId,
    );
  });

  describe('requestPages', () => {
    it('should throw for unknown integration in requestPages', async () => {
      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(),
        secretStore: envBackedSecretStore,
      });

      await expect(async () => {
        for await (const page of client.requestPages('unknown-id', {
          backendType: 'http',
          path: '/test',
        } as HttpRequestOptions)) {
          expect(page).toBeDefined();
        }
      }).rejects.toThrow('Integration not found: unknown-id');
    });

    it('should surface a missing secret error for unready integrations', async () => {
      const integration: Integration = {
        id: 'http-test',
        name: 'http-integration',
        slug: 'http-integration',
        type: 'scm',
        host: 'https://example.com',
        authType: 'header',
        authConfig: { headers: { Authorization: 'Bearer ${TEST_API_TOKEN}' } },
        requestsPerHour: 1000,
        backendType: 'http',
        config: {},
        readyForCurrentScope: false,
        createdBy: 'test-user',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(integration),
        secretStore: envBackedSecretStore,
      });

      await expect(async () => {
        for await (const page of client.requestPages('http-test', {
          backendType: 'http',
          path: '/test',
        } as HttpRequestOptions)) {
          expect(page).toBeDefined();
        }
      }).rejects.toThrow(
        'Integration is missing required secret: TEST_API_TOKEN',
      );
    });
  });

  describe('request', () => {
    it('should add default accountConfig when integration has no profiles', async () => {
      const awsIntegration: Integration = {
        id: 'aws-test',
        name: 'aws-integration',
        slug: 'aws-integration',
        type: 'infrastructure',
        host: '',
        authType: 'none',
        authConfig: null,
        requestsPerHour: 36000,
        backendType: 'aws',
        config: {},
        readyForCurrentScope: true,
        createdBy: 'test-user',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(awsIntegration),
        secretStore: envBackedSecretStore,
      });

      const options = {
        backendType: 'aws',
        resourceType: 'AWS::RDS::DBInstance',
        accountId: '123456789012',
        region: 'eu-west-1',
        operation: 'get',
        identifier: 'my-db-instance',
      } as RequestOptions;

      await expect(client.request('aws-test', options)).rejects.not.toThrow(
        'Invalid AWS request options',
      );
    });
  });

  describe('secret allow list', () => {
    it('reads db-backed secret names per call without accumulating across scopes', async () => {
      let currentMetadataNames = ['TENANT_A_SECRET'];

      const secretsMetadataService: SecretsMetadataService = {
        getSecretInternalNames: vi
          .fn()
          .mockImplementation(async () => currentMetadataNames),
      };

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(),
        secretStore: envBackedSecretStore,
        secretsMetadataService,
      });

      await expect((client as any).getEnvVarAllowList()).resolves.toEqual(
        new Set(['TEST_API_TOKEN', 'TENANT_A_SECRET']),
      );

      currentMetadataNames = ['TENANT_B_SECRET'];

      await expect((client as any).getEnvVarAllowList()).resolves.toEqual(
        new Set(['TEST_API_TOKEN', 'TENANT_B_SECRET']),
      );

      expect(
        secretsMetadataService.getSecretInternalNames,
      ).toHaveBeenCalledTimes(2);
    });
  });

  describe('github app token resolution via purpose-based lookup', () => {
    const baseGithubIntegration: Integration = {
      id: 'gh-test',
      name: 'GitHub',
      slug: 'github',
      type: 'scm',
      host: 'https://api.github.com',
      authType: 'header',
      authConfig: { headers: { Authorization: 'token ${GITHUB_TOKEN}' } },
      requestsPerHour: 5000,
      backendType: 'http',
      config: {},
      readyForCurrentScope: true,
      createdBy: 'system',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      extensions: {
        githubApps: [
          {
            appId: '12345',
            host: 'github.com',
            purposes: ['data-source'],
            slug: 'my-app',
            privateKeyRef: 'TEST_GH_PK',
          },
        ],
      },
    };

    const defaultAppRow = {
      appId: '12345',
      host: 'github.com',
      purpose: 'data-source',
      slug: 'my-app',
      privateKeyRef: 'TEST_GH_PK',
      kmsKeyId: undefined as string | undefined,
      status: 'active',
    };

    const createMockGithubAppDao = (returnApp = true) =>
      ({
        getByIntegrationIdAndPurpose: vi
          .fn()
          .mockResolvedValue(returnApp ? defaultAppRow : undefined),
      }) as unknown as GithubAppDao;

    it('should not query GitHub app DAO when integration has no githubApps metadata', async () => {
      const mockGithubAppDao = createMockGithubAppDao();
      const mockInstallationDao = {
        getByOrg: vi.fn(),
      } as unknown as GithubAppInstallationDao;

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao({
          ...baseGithubIntegration,
          extensions: undefined,
        }),
        secretStore: envBackedSecretStore,
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
      });

      await expect(
        client.request('gh-test', {
          backendType: 'http',
          path: '/repos/acme/repo',
          method: 'GET',
          scopeId: 'acme',
        } as RequestOptions),
      ).rejects.toThrow();

      expect(
        mockGithubAppDao.getByIntegrationIdAndPurpose,
      ).not.toHaveBeenCalled();
      expect(mockInstallationDao.getByOrg).not.toHaveBeenCalled();
    });

    it('should fall back when no default-purpose app exists', async () => {
      const mockGithubAppDao = createMockGithubAppDao(false);
      const mockInstallationDao = {
        getByOrg: vi.fn(),
      } as unknown as GithubAppInstallationDao;

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        secretStore: envBackedSecretStore,
      });

      await expect(
        client.request('gh-test', {
          backendType: 'http',
          path: '/repos/acme/repo',
          method: 'GET',
          scopeId: 'acme',
        } as RequestOptions),
      ).rejects.toThrow();

      expect(mockInstallationDao.getByOrg).not.toHaveBeenCalled();
    });

    it('should extract org from search query parameter', async () => {
      const mockGithubAppDao = createMockGithubAppDao();
      const mockInstallationDao = {
        getByOrg: vi.fn().mockResolvedValue({
          installationId: 100,
          scopeId: 'acme',
          appId: '12345',
        }),
      } as unknown as GithubAppInstallationDao;

      const mockLocalMinter = {
        getInstallationToken: vi.fn().mockResolvedValue('ghs_search_token'),
        clearCache: vi.fn(),
      } as unknown as LocalGitHubAppTokenProvider;

      process.env.TEST_GH_PK = 'fake-private-key';

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        localTokenMinter: mockLocalMinter,
        secretStore: envBackedSecretStore,
      });

      await expect(
        client.request('gh-test', {
          backendType: 'http',
          path: '/search/repositories?q=org:acme-corp+language:typescript',
          method: 'GET',
          scopeId: 'acme',
        } as RequestOptions),
      ).rejects.toThrow();

      expect(mockInstallationDao.getByOrg).toHaveBeenCalledWith(
        '12345',
        'github.com',
        'acme-corp',
      );
      expect(mockLocalMinter.getInstallationToken).toHaveBeenCalledWith(
        '12345',
        100,
        'fake-private-key',
        'https://api.github.com',
      );

      delete process.env.TEST_GH_PK;
    });

    it('should extract org from repo: qualifier in code search query', async () => {
      const mockGithubAppDao = createMockGithubAppDao();
      const mockInstallationDao = {
        getByOrg: vi.fn().mockResolvedValue({
          installationId: 100,
          scopeId: 'acme',
          appId: '12345',
        }),
      } as unknown as GithubAppInstallationDao;

      const mockLocalMinter = {
        getInstallationToken: vi
          .fn()
          .mockResolvedValue('ghs_code_search_token'),
        clearCache: vi.fn(),
      } as unknown as LocalGitHubAppTokenProvider;

      process.env.TEST_GH_PK = 'fake-private-key';

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        localTokenMinter: mockLocalMinter,
        secretStore: envBackedSecretStore,
      });

      await expect(
        client.request('gh-test', {
          backendType: 'http',
          path: '/search/code?q=extension:md+repo:acme-corp/my-repo',
          method: 'GET',
          scopeId: 'acme',
        } as RequestOptions),
      ).rejects.toThrow();

      expect(mockInstallationDao.getByOrg).toHaveBeenCalledWith(
        '12345',
        'github.com',
        'acme-corp',
      );
      expect(mockLocalMinter.getInstallationToken).toHaveBeenCalledWith(
        '12345',
        100,
        'fake-private-key',
        'https://api.github.com',
      );

      delete process.env.TEST_GH_PK;
    });

    it('should extract org from user: qualifier in search query', async () => {
      const mockGithubAppDao = createMockGithubAppDao();
      const mockInstallationDao = {
        getByOrg: vi.fn().mockResolvedValue({
          installationId: 200,
          scopeId: 'acme',
          appId: '12345',
        }),
      } as unknown as GithubAppInstallationDao;

      const mockLocalMinter = {
        getInstallationToken: vi.fn().mockResolvedValue('ghs_user_token'),
        clearCache: vi.fn(),
      } as unknown as LocalGitHubAppTokenProvider;

      process.env.TEST_GH_PK = 'fake-private-key';

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        localTokenMinter: mockLocalMinter,
        secretStore: envBackedSecretStore,
      });

      await expect(
        client.request('gh-test', {
          backendType: 'http',
          path: '/search/code?q=user:my-user+extension:ts',
          method: 'GET',
          scopeId: 'acme',
        } as RequestOptions),
      ).rejects.toThrow();

      expect(mockInstallationDao.getByOrg).toHaveBeenCalledWith(
        '12345',
        'github.com',
        'my-user',
      );

      delete process.env.TEST_GH_PK;
    });

    it('should prefer path-based org over search query parameter', async () => {
      const mockGithubAppDao = createMockGithubAppDao();
      const mockInstallationDao = {
        getByOrg: vi.fn().mockResolvedValue(undefined),
      } as unknown as GithubAppInstallationDao;

      const mockLocalMinter = {
        getInstallationToken: vi.fn(),
        clearCache: vi.fn(),
      } as unknown as LocalGitHubAppTokenProvider;

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        localTokenMinter: mockLocalMinter,
        secretStore: envBackedSecretStore,
      });

      await expect(
        client.request('gh-test', {
          backendType: 'http',
          path: '/repos/path-org/repo?q=org:query-org',
          method: 'GET',
          scopeId: 'acme',
        } as RequestOptions),
      ).rejects.toThrow();

      expect(mockInstallationDao.getByOrg).toHaveBeenCalledWith(
        '12345',
        'github.com',
        'path-org',
      );
    });

    it('should extract org from GraphQL variables', async () => {
      const mockGithubAppDao = createMockGithubAppDao();
      const mockInstallationDao = {
        getByOrg: vi.fn().mockResolvedValue({
          installationId: 300,
          scopeId: 'acme',
          appId: '12345',
        }),
      } as unknown as GithubAppInstallationDao;

      const mockLocalMinter = {
        getInstallationToken: vi.fn().mockResolvedValue('ghs_graphql_token'),
        clearCache: vi.fn(),
      } as unknown as LocalGitHubAppTokenProvider;

      process.env.TEST_GH_PK = 'fake-private-key';

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        localTokenMinter: mockLocalMinter,
        secretStore: envBackedSecretStore,
      });

      await expect(
        client.request('gh-test', {
          backendType: 'http',
          path: '/graphql',
          method: 'POST',
          isGraphQL: true,
          body: {
            query:
              'query($login: String!) { organization(login: $login) { name } }',
            variables: { login: 'roadiehq' },
          },
          scopeId: 'acme',
        } as RequestOptions),
      ).rejects.toThrow();

      expect(mockInstallationDao.getByOrg).toHaveBeenCalledWith(
        '12345',
        'github.com',
        'roadiehq',
      );

      delete process.env.TEST_GH_PK;
    });

    it('should extract org from inline GraphQL query when variables are absent', async () => {
      const mockGithubAppDao = createMockGithubAppDao();
      const mockInstallationDao = {
        getByOrg: vi.fn().mockResolvedValue({
          installationId: 301,
          scopeId: 'acme',
          appId: '12345',
        }),
      } as unknown as GithubAppInstallationDao;

      const mockLocalMinter = {
        getInstallationToken: vi.fn().mockResolvedValue('ghs_inline_token'),
        clearCache: vi.fn(),
      } as unknown as LocalGitHubAppTokenProvider;

      process.env.TEST_GH_PK = 'fake-private-key';

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        localTokenMinter: mockLocalMinter,
        secretStore: envBackedSecretStore,
      });

      await expect(
        client.request('gh-test', {
          backendType: 'http',
          path: '/graphql',
          method: 'POST',
          isGraphQL: true,
          body: {
            query: 'query { organization(login: "roadiehq") { name } }',
          },
          scopeId: 'acme',
        } as RequestOptions),
      ).rejects.toThrow();

      expect(mockInstallationDao.getByOrg).toHaveBeenCalledWith(
        '12345',
        'github.com',
        'roadiehq',
      );

      delete process.env.TEST_GH_PK;
    });

    it('should fall back to header token when no installation matches the org', async () => {
      const mockGithubAppDao = createMockGithubAppDao();
      const mockInstallationDao = {
        getByOrg: vi.fn().mockResolvedValue(undefined),
      } as unknown as GithubAppInstallationDao;

      const mockLocalMinter = {
        getInstallationToken: vi.fn(),
        clearCache: vi.fn(),
      } as unknown as LocalGitHubAppTokenProvider;

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        localTokenMinter: mockLocalMinter,
        secretStore: envBackedSecretStore,
      });

      await expect(
        client.request('gh-test', {
          backendType: 'http',
          path: '/repos/acme/repo',
          method: 'GET',
          scopeId: 'acme',
        } as RequestOptions),
      ).rejects.toThrow();

      expect(mockInstallationDao.getByOrg).toHaveBeenCalledWith(
        '12345',
        'github.com',
        'acme',
      );
      expect(mockLocalMinter.getInstallationToken).not.toHaveBeenCalled();
    });

    it('should throw when private key env var is not set', async () => {
      const mockGithubAppDao = {
        getByIntegrationIdAndPurpose: vi.fn().mockResolvedValue({
          ...defaultAppRow,
          privateKeyRef: 'NONEXISTENT_PK_VAR',
        }),
      } as unknown as GithubAppDao;

      const mockInstallationDao = {
        getByOrg: vi.fn().mockResolvedValue({
          installationId: 100,
          scopeId: 'acme',
          appId: '12345',
        }),
      } as unknown as GithubAppInstallationDao;

      const mockLocalMinter = {
        getInstallationToken: vi.fn(),
        clearCache: vi.fn(),
      } as unknown as LocalGitHubAppTokenProvider;

      delete process.env.NONEXISTENT_PK_VAR;

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        localTokenMinter: mockLocalMinter,
        secretStore: envBackedSecretStore,
      });

      await expect(
        client.request('gh-test', {
          backendType: 'http',
          path: '/repos/acme/repo',
          method: 'GET',
          scopeId: 'acme',
        } as RequestOptions),
      ).rejects.toThrow(
        'GitHub App private key secret not set: NONEXISTENT_PK_VAR',
      );
    });

    it('should resolve token via local minter for matching org installation', async () => {
      const mockGithubAppDao = createMockGithubAppDao();
      const mockInstallationDao = {
        getByOrg: vi.fn().mockResolvedValue({
          installationId: 100,
          scopeId: 'acme',
          appId: '12345',
        }),
      } as unknown as GithubAppInstallationDao;

      const mockLocalMinter = {
        getInstallationToken: vi.fn().mockResolvedValue('ghs_resolved_token'),
        clearCache: vi.fn(),
      } as unknown as LocalGitHubAppTokenProvider;

      process.env.TEST_GH_PK = 'fake-private-key';

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        localTokenMinter: mockLocalMinter,
        secretStore: envBackedSecretStore,
      });

      await expect(
        client.request('gh-test', {
          backendType: 'http',
          path: '/repos/acme/repo',
          method: 'GET',
          scopeId: 'acme',
        } as RequestOptions),
      ).rejects.toThrow();

      expect(mockLocalMinter.getInstallationToken).toHaveBeenCalledWith(
        '12345',
        100,
        'fake-private-key',
        'https://api.github.com',
      );

      delete process.env.TEST_GH_PK;
    });

    it('should use kms token minter when app has kmsKeyId set', async () => {
      const mockGithubAppDao = {
        getByIntegrationIdAndPurpose: vi.fn().mockResolvedValue({
          ...defaultAppRow,
          kmsKeyId: 'alias/dev0-github-app-signing',
        }),
      } as unknown as GithubAppDao;

      const mockInstallationDao = {
        getByOrg: vi.fn().mockResolvedValue({
          installationId: 100,
          scopeId: 'acme',
          appId: '12345',
        }),
      } as unknown as GithubAppInstallationDao;

      const mockKmsMinter = {
        getInstallationToken: vi.fn().mockResolvedValue('ghs_kms_token'),
        clearCache: vi.fn(),
      } as unknown as KmsGitHubAppTokenProvider;

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        kmsTokenMinter: mockKmsMinter,
        secretStore: envBackedSecretStore,
      });

      await expect(
        client.request('gh-test', {
          backendType: 'http',
          path: '/repos/acme/repo',
          method: 'GET',
          scopeId: 'acme',
        } as RequestOptions),
      ).rejects.toThrow();

      expect(mockKmsMinter.getInstallationToken).toHaveBeenCalledWith(
        '12345',
        100,
        'alias/dev0-github-app-signing',
        'https://api.github.com',
      );
    });

    it('should fall back to local minter when app has no kmsKeyId even if kmsTokenMinter exists', async () => {
      const mockGithubAppDao = createMockGithubAppDao();

      const mockInstallationDao = {
        getByOrg: vi.fn().mockResolvedValue({
          installationId: 100,
          scopeId: 'acme',
          appId: '12345',
        }),
      } as unknown as GithubAppInstallationDao;

      const mockKmsMinter = {
        getInstallationToken: vi.fn().mockResolvedValue('ghs_kms_token'),
        clearCache: vi.fn(),
      } as unknown as KmsGitHubAppTokenProvider;

      const mockLocalMinter = {
        getInstallationToken: vi.fn().mockResolvedValue('ghs_local_token'),
        clearCache: vi.fn(),
      } as unknown as LocalGitHubAppTokenProvider;

      process.env.TEST_GH_PK = 'fake-private-key';

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        kmsTokenMinter: mockKmsMinter,
        localTokenMinter: mockLocalMinter,
        secretStore: envBackedSecretStore,
      });

      await expect(
        client.request('gh-test', {
          backendType: 'http',
          path: '/repos/acme/repo',
          method: 'GET',
          scopeId: 'acme',
        } as RequestOptions),
      ).rejects.toThrow();

      expect(mockKmsMinter.getInstallationToken).not.toHaveBeenCalled();
      expect(mockLocalMinter.getInstallationToken).toHaveBeenCalledWith(
        '12345',
        100,
        'fake-private-key',
        'https://api.github.com',
      );

      delete process.env.TEST_GH_PK;
    });

    it('should mint an installation token for /installation paths when exactly one installation exists', async () => {
      const mockGithubAppDao = createMockGithubAppDao();
      const mockInstallationDao = {
        getByOrg: vi.fn(),
        listAll: vi.fn().mockResolvedValue([
          {
            installationId: 100,
            orgLogin: 'acme',
            appId: '12345',
          },
        ]),
      } as unknown as GithubAppInstallationDao;

      const mockLocalMinter = {
        getInstallationToken: vi.fn().mockResolvedValue('ghs_sole_token'),
        clearCache: vi.fn(),
      } as unknown as LocalGitHubAppTokenProvider;

      process.env.TEST_GH_PK = 'fake-private-key';

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        localTokenMinter: mockLocalMinter,
        secretStore: envBackedSecretStore,
      });

      await expect(
        client.request('gh-test', {
          backendType: 'http',
          path: '/installation/repositories',
          method: 'GET',
          scopeId: 'acme',
        } as RequestOptions),
      ).rejects.toThrow();

      expect(mockInstallationDao.listAll).toHaveBeenCalledWith(
        '12345',
        'github.com',
      );
      expect(mockInstallationDao.getByOrg).not.toHaveBeenCalled();
      expect(mockLocalMinter.getInstallationToken).toHaveBeenCalledWith(
        '12345',
        100,
        'fake-private-key',
        'https://api.github.com',
      );

      delete process.env.TEST_GH_PK;
    });

    it('should not mint when /installation path has multiple recorded installations', async () => {
      const mockGithubAppDao = createMockGithubAppDao();
      const mockInstallationDao = {
        getByOrg: vi.fn(),
        listAll: vi.fn().mockResolvedValue([
          { installationId: 100, orgLogin: 'acme', appId: '12345' },
          { installationId: 200, orgLogin: 'other', appId: '12345' },
        ]),
      } as unknown as GithubAppInstallationDao;

      const mockLocalMinter = {
        getInstallationToken: vi.fn(),
        clearCache: vi.fn(),
      } as unknown as LocalGitHubAppTokenProvider;

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        localTokenMinter: mockLocalMinter,
        secretStore: envBackedSecretStore,
      });

      await expect(
        client.request('gh-test', {
          backendType: 'http',
          path: '/installation/repositories',
          method: 'GET',
          scopeId: 'acme',
        } as RequestOptions),
      ).rejects.toThrow();

      expect(mockInstallationDao.listAll).toHaveBeenCalled();
      expect(mockLocalMinter.getInstallationToken).not.toHaveBeenCalled();
    });

    it('should mint using installation_id query param and strip it from the outbound path', async () => {
      const mockGithubAppDao = createMockGithubAppDao();
      const mockInstallationDao = {
        getByOrg: vi.fn(),
        listAll: vi.fn(),
      } as unknown as GithubAppInstallationDao;

      const mockLocalMinter = {
        getInstallationToken: vi.fn().mockResolvedValue('ghs_id_token'),
        clearCache: vi.fn(),
      } as unknown as LocalGitHubAppTokenProvider;

      const mockBackend = {
        request: vi.fn().mockResolvedValue({ repositories: [] }),
        requestPages: vi.fn(),
        clearCache: vi.fn(),
      };

      process.env.TEST_GH_PK = 'fake-private-key';

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDao,
        githubAppInstallationDao: mockInstallationDao,
        localTokenMinter: mockLocalMinter,
        secretStore: envBackedSecretStore,
      });
      (client as any).backends.set('http', mockBackend);

      await client.request('gh-test', {
        backendType: 'http',
        path: '/installation/repositories?installation_id=42&per_page=100',
        method: 'GET',
        scopeId: 'acme',
      } as RequestOptions);

      expect(mockLocalMinter.getInstallationToken).toHaveBeenCalledWith(
        '12345',
        42,
        'fake-private-key',
        'https://api.github.com',
      );
      expect(mockInstallationDao.getByOrg).not.toHaveBeenCalled();
      expect(mockInstallationDao.listAll).not.toHaveBeenCalled();
      expect(mockBackend.request).toHaveBeenCalledWith(
        expect.objectContaining({
          authType: 'bearer-token',
          authConfig: { token: 'ghs_id_token' },
        }),
        expect.objectContaining({
          path: '/installation/repositories?per_page=100',
        }),
      );

      delete process.env.TEST_GH_PK;
    });

    it('should mint an app JWT for /app paths', async () => {
      const mockInstallationDao = {
        getByOrg: vi.fn(),
        listAll: vi.fn(),
      } as unknown as GithubAppInstallationDao;

      const mockKmsMinter = {
        getInstallationToken: vi.fn(),
        generateAppJWT: vi.fn().mockResolvedValue('app_jwt_token'),
        clearCache: vi.fn(),
      } as unknown as KmsGitHubAppTokenProvider;

      const mockBackend = {
        request: vi.fn().mockResolvedValue([]),
        requestPages: vi.fn(),
        clearCache: vi.fn(),
      };

      const mockGithubAppDaoWithKms = {
        getByIntegrationIdAndPurpose: vi.fn().mockResolvedValue({
          ...defaultAppRow,
          kmsKeyId: 'alias/dev0-github-app-signing',
        }),
      } as unknown as GithubAppDao;

      const client = new IntegrationClient({
        logger: voidLogger,
        config: mockConfig,
        knex: mockKnex,
        integrationDao: createMockIntegrationDao(baseGithubIntegration),
        githubAppDao: mockGithubAppDaoWithKms,
        githubAppInstallationDao: mockInstallationDao,
        kmsTokenMinter: mockKmsMinter,
        secretStore: envBackedSecretStore,
      });
      (client as any).backends.set('http', mockBackend);

      await client.request('gh-test', {
        backendType: 'http',
        path: '/app/installations',
        method: 'GET',
        scopeId: 'acme',
      } as RequestOptions);

      expect(mockKmsMinter.generateAppJWT).toHaveBeenCalledWith(
        '12345',
        'alias/dev0-github-app-signing',
      );
      expect(mockKmsMinter.getInstallationToken).not.toHaveBeenCalled();
      expect(mockBackend.request).toHaveBeenCalledWith(
        expect.objectContaining({
          authType: 'bearer-token',
          authConfig: { token: 'app_jwt_token' },
        }),
        expect.objectContaining({
          path: '/app/installations',
        }),
      );
    });
  });
});
