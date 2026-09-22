import { TestDatabases, mockServices } from '@roadiehq/backend-test-utils';
import { resolvePackagePath } from '@roadiehq/extensions-api';
import { ConfigReader } from '@roadiehq/config';
import type { Knex } from 'knex';
import { IntegrationDao } from './IntegrationDao';
import { GithubAppDao } from './GithubAppDao';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';

const databases = TestDatabases.create();
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';

describe('IntegrationDao workspace isolation', () => {
  let testDb: Knex;
  let dao: IntegrationDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await testDb.migrate.latest({
      directory: resolvePackagePath(
        '@roadiehq/integrations-backend',
        'migrations',
      ),
    });
    dao = new IntegrationDao({
      knex: testDb,
      logger: mockServices.logger.mock(),
      config: new ConfigReader({ secretsSettings: { secrets: [] } }),
    });
  }, 120_000);

  afterAll(async () => {
    await testDb?.destroy();
  });

  it('keeps configured integrations within their workspace', async () => {
    const input = {
      name: 'Workspace isolation integration',
      slug: 'workspace-isolation-integration',
      type: 'other' as const,
      host: 'https://example.com',
      createdBy: 'user:default/test',
    };

    const organizationIntegration = await dao.create(input);
    const workspaceIntegration = await dao.create(
      { ...input, name: 'Personal workspace integration' },
      otherWorkspaceId,
    );

    expect(organizationIntegration.workspaceId).not.toBe(otherWorkspaceId);
    expect(organizationIntegration.ownership).toBe('org');
    expect(workspaceIntegration.workspaceId).toBe(otherWorkspaceId);
    expect(workspaceIntegration.ownership).toBe('workspace');
    await expect(
      dao.list({ workspaceId: otherWorkspaceId }),
    ).resolves.toMatchObject({
      total: 1,
      integrations: [{ id: workspaceIntegration.id }],
    });
    await expect(
      dao.getBySlug(input.slug, otherWorkspaceId),
    ).resolves.toMatchObject({ id: workspaceIntegration.id });
    await expect(
      dao.getById(organizationIntegration.id, otherWorkspaceId),
    ).rejects.toThrow('Integration not found');
    await expect(
      dao.update(
        organizationIntegration.id,
        { name: 'Wrong workspace' },
        otherWorkspaceId,
      ),
    ).rejects.toThrow('Integration not found');
    await expect(
      dao.delete(organizationIntegration.id, otherWorkspaceId),
    ).rejects.toThrow('Integration not found');
    await expect(
      dao.getById(organizationIntegration.id),
    ).resolves.toMatchObject({ name: organizationIntegration.name });
  });

  it('does not move an existing GitHub App into another workspace', async () => {
    const integrationInput = {
      name: 'GitHub App integration',
      slug: 'github-app-integration',
      type: 'scm' as const,
      host: 'https://github.com',
      authType: 'github-app' as const,
      createdBy: 'user:default/test',
    };
    const organizationIntegration = await dao.create(integrationInput);
    const workspaceIntegration = await dao.create(
      {
        ...integrationInput,
        name: 'Personal GitHub App integration',
      },
      otherWorkspaceId,
    );
    const githubAppDao = new GithubAppDao({
      knex: testDb,
      logger: mockServices.logger.mock(),
    });
    const app = await githubAppDao.upsertApp({
      workspaceId: DEFAULT_WORKSPACE_ID,
      appId: '12345',
      integrationId: organizationIntegration.id,
      privateKeyRef: 'organization-private-key',
    });

    await expect(
      githubAppDao.upsertApp({
        workspaceId: otherWorkspaceId,
        appId: '12345',
        integrationId: workspaceIntegration.id,
        privateKeyRef: 'personal-private-key',
      }),
    ).rejects.toThrow('belongs to another workspace');

    await expect(githubAppDao.getById(app.id)).resolves.toMatchObject({
      integrationId: organizationIntegration.id,
      privateKeyRef: 'organization-private-key',
    });
  });

  it('keeps an unlinked legacy GitHub App in the default workspace', async () => {
    const integrationInput = {
      name: 'Legacy GitHub App integration',
      slug: 'legacy-github-app-integration',
      type: 'scm' as const,
      host: 'https://github.com',
      authType: 'github-app' as const,
      createdBy: 'user:default/test',
    };
    const organizationIntegration = await dao.create(integrationInput);
    const workspaceIntegration = await dao.create(
      {
        ...integrationInput,
        name: 'Personal legacy GitHub App integration',
      },
      otherWorkspaceId,
    );
    const githubAppDao = new GithubAppDao({
      knex: testDb,
      logger: mockServices.logger.mock(),
    });
    const legacyApp = await githubAppDao.upsertApp({
      workspaceId: DEFAULT_WORKSPACE_ID,
      appId: 'legacy-12345',
      privateKeyRef: 'legacy-private-key',
    });

    await expect(
      githubAppDao.upsertApp({
        workspaceId: otherWorkspaceId,
        appId: 'legacy-12345',
        integrationId: workspaceIntegration.id,
        privateKeyRef: 'personal-private-key',
      }),
    ).rejects.toThrow('belongs to another workspace');

    await expect(
      githubAppDao.upsertApp({
        workspaceId: DEFAULT_WORKSPACE_ID,
        appId: 'legacy-12345',
        integrationId: organizationIntegration.id,
      }),
    ).resolves.toMatchObject({
      id: legacyApp.id,
      integrationId: organizationIntegration.id,
      privateKeyRef: 'legacy-private-key',
    });
  });
});
