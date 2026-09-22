import { TestDatabases, mockServices } from '@roadiehq/backend-test-utils';
import { resolvePackagePath } from '@roadiehq/extensions-api';
import { ConfigReader } from '@roadiehq/config';
import type { Knex } from 'knex';
import { IntegrationDao } from './IntegrationDao';
import { IntegrationSchemaDao } from './IntegrationSchemaDao';

const databases = TestDatabases.create();
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';

describe('IntegrationSchemaDao workspace isolation', () => {
  let testDb: Knex;
  let integrationDao: IntegrationDao;
  let schemaDao: IntegrationSchemaDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await testDb.migrate.latest({
      directory: resolvePackagePath(
        '@roadiehq/integrations-backend',
        'migrations',
      ),
    });
    const logger = mockServices.logger.mock();
    integrationDao = new IntegrationDao({
      knex: testDb,
      logger,
      config: new ConfigReader({ secretsSettings: { secrets: [] } }),
    });
    schemaDao = new IntegrationSchemaDao({ knex: testDb, logger });
  }, 120_000);

  afterAll(async () => {
    await testDb?.destroy();
  });

  it('keeps schemas and spec URLs within their integration workspace', async () => {
    const input = {
      name: 'Schema workspace integration',
      slug: 'schema-workspace-integration',
      type: 'other' as const,
      host: 'https://example.com',
      createdBy: 'user:default/test',
    };
    const organizationIntegration = await integrationDao.create(input);
    const workspaceIntegration = await integrationDao.create(
      { ...input, name: 'Personal schema workspace integration' },
      otherWorkspaceId,
    );

    const organizationSchema = await schemaDao.createSchema({
      integrationId: organizationIntegration.id,
      pathPattern: '/organization',
      method: 'GET',
      jsonSchema: { type: 'object' },
      sourceType: 'spec',
    });
    const workspaceSchema = await schemaDao.createSchema(
      {
        integrationId: workspaceIntegration.id,
        pathPattern: '/workspace',
        method: 'GET',
        jsonSchema: { type: 'object' },
        sourceType: 'spec',
      },
      otherWorkspaceId,
    );
    const organizationSpecUrl = await schemaDao.createSpecUrl({
      integrationId: organizationIntegration.id,
      specUrl: 'https://example.com/organization.json',
      specFormat: 'openapi',
    });
    const workspaceSpecUrl = await schemaDao.createSpecUrl(
      {
        integrationId: workspaceIntegration.id,
        specUrl: 'https://example.com/workspace.json',
        specFormat: 'openapi',
      },
      otherWorkspaceId,
    );

    await expect(
      schemaDao.listSchemas({ workspaceId: otherWorkspaceId }),
    ).resolves.toMatchObject({
      total: 1,
      schemas: [{ id: workspaceSchema.id }],
    });
    await expect(
      schemaDao.listSpecUrls({ workspaceId: otherWorkspaceId }),
    ).resolves.toMatchObject({
      total: 1,
      specUrls: [{ id: workspaceSpecUrl.id }],
    });
    await expect(
      schemaDao.getSchemaById(organizationSchema.id, otherWorkspaceId),
    ).rejects.toThrow('Integration schema not found');
    await expect(
      schemaDao.getSpecUrlById(organizationSpecUrl.id, otherWorkspaceId),
    ).rejects.toThrow('Integration spec URL not found');
    await expect(
      schemaDao.createSchema(
        {
          integrationId: organizationIntegration.id,
          pathPattern: '/wrong-workspace',
          method: 'GET',
          jsonSchema: { type: 'object' },
          sourceType: 'spec',
        },
        otherWorkspaceId,
      ),
    ).rejects.toThrow('Integration not found');

    await expect(
      schemaDao.updateSchema(
        organizationSchema.id,
        { description: 'Cross-workspace update' },
        otherWorkspaceId,
      ),
    ).rejects.toThrow('Integration schema not found');
    await expect(
      schemaDao.deleteSchema(organizationSchema.id, otherWorkspaceId),
    ).rejects.toThrow('Integration schema not found');
    await expect(
      schemaDao.getSchemaById(organizationSchema.id),
    ).resolves.toMatchObject({
      id: organizationSchema.id,
      description: undefined,
    });
  });
});
