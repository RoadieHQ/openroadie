import { describe, expect, it, vi } from 'vitest';
import { ConfigReader } from '@roadiehq/config';
import { Integration } from '@roadiehq/integrations-node';
import type { SecretStoreService } from '@roadiehq/secrets-node';
import { IntegrationDao } from './IntegrationDao';
import type { GithubAppDao, GithubApp } from './GithubAppDao';
import type {
  GithubAppInstallation,
  GithubAppInstallationDao,
} from './GithubAppInstallationDao';
import type { Knex } from 'knex';

const voidLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => voidLogger,
};

const baseIntegration: Integration = {
  id: 'integration-1',
  name: 'Integration',
  slug: 'integration',
  type: 'scm',
  host: 'https://api.example.com',
  authType: 'none',
  authConfig: null,
  requestsPerHour: 5000,
  backendType: 'http',
  config: {},
  createdBy: 'system',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const githubApp: GithubApp = {
  id: 'app-row-1',
  appId: '12345',
  host: 'github.com',
  purposes: ['data-source'],
  kmsKeyId: 'alias/github-app-signing',
  integrationId: 'integration-1',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const githubAppInstallation: GithubAppInstallation = {
  id: 'installation-row-1',
  appId: '12345',
  host: 'github.com',
  installationId: 67890,
  orgLogin: 'roadie',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function createDao(options?: {
  app?: GithubApp;
  installations?: GithubAppInstallation[];
  secretStore?: SecretStoreService;
}) {
  const githubAppDao = {
    getByIntegrationIdAndPurpose: async () => options?.app,
  } as unknown as GithubAppDao;
  const githubAppInstallationDao = {
    listAll: async (_appId: string, host: string) =>
      (options?.installations ?? []).filter(
        installation => installation.host === host,
      ),
  } as unknown as GithubAppInstallationDao;

  return new IntegrationDao({
    knex: {} as Knex,
    logger: voidLogger,
    config: new ConfigReader({ secretsSettings: { secrets: [] } }),
    secretStore: options?.secretStore,
    githubAppDao,
    githubAppInstallationDao,
  });
}

function githubAppIntegration(): Integration {
  return {
    ...baseIntegration,
    authType: 'github-app',
    extensions: {
      githubApps: [
        {
          appId: githubApp.appId,
          host: githubApp.host,
          purposes: githubApp.purposes,
          kmsKeyId: githubApp.kmsKeyId,
        },
      ],
    },
  };
}

describe('IntegrationDao readiness', () => {
  it('marks a GitHub App integration without an installed app as not ready', async () => {
    const dao = createDao({ app: githubApp });

    await expect(
      dao.isReadyForCurrentScope(githubAppIntegration(), new Set()),
    ).resolves.toBe(false);
  });

  it('marks a GitHub App integration with an installed app as ready', async () => {
    const dao = createDao({
      app: githubApp,
      installations: [githubAppInstallation],
    });

    await expect(
      dao.isReadyForCurrentScope(githubAppIntegration(), new Set()),
    ).resolves.toBe(true);
  });

  it('does not use an installation from another host with the same app id', async () => {
    const dao = createDao({
      app: { ...githubApp, host: 'github.enterprise.test' },
      installations: [githubAppInstallation],
    });

    await expect(
      dao.isReadyForCurrentScope(githubAppIntegration(), new Set()),
    ).resolves.toBe(false);
  });

  it('keeps a genuine no-auth HTTP integration ready', async () => {
    const dao = createDao();

    await expect(
      dao.isReadyForCurrentScope(baseIntegration, new Set()),
    ).resolves.toBe(true);
  });

  it('resolves batched readiness in each integration workspace', async () => {
    const firstWorkspaceId = '11111111-1111-4111-8111-111111111111';
    const secondWorkspaceId = '22222222-2222-4222-8222-222222222222';
    const resolver = vi.fn((scope?: { workspaceId?: string }) => ({
      async resolve(refs: string[]): Promise<Record<string, string>> {
        if (
          scope?.workspaceId === firstWorkspaceId &&
          refs.includes('SHARED_TOKEN')
        ) {
          return { SHARED_TOKEN: 'first-workspace-value' };
        }
        return {};
      },
    }));
    const secretStore: SecretStoreService = {
      resolver,
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
        async exists() {
          return false;
        },
      }),
      info: () => ({ mode: 'scoped', readOnly: true }),
    };
    const dao = createDao({ secretStore });
    const integrations: Integration[] = [
      {
        ...baseIntegration,
        workspaceId: firstWorkspaceId,
        authType: 'bearer-token',
        authConfig: { token: '${SHARED_TOKEN}' },
      },
      {
        ...baseIntegration,
        id: 'integration-2',
        slug: 'integration-2',
        workspaceId: secondWorkspaceId,
        authType: 'bearer-token',
        authConfig: { token: '${SHARED_TOKEN}' },
      },
    ];

    await Reflect.apply(Reflect.get(dao, 'withReadyForCurrentScope'), dao, [
      integrations,
      new Set(['SHARED_TOKEN']),
    ]);

    expect(integrations.map(item => item.readyForCurrentScope)).toEqual([
      true,
      false,
    ]);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(resolver).toHaveBeenNthCalledWith(1, {
      workspaceId: firstWorkspaceId,
    });
    expect(resolver).toHaveBeenNthCalledWith(2, {
      workspaceId: secondWorkspaceId,
    });
  });
});
