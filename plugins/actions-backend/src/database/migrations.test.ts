import { TestDatabases } from '@roadiehq/backend-test-utils';
import { resolvePackagePath } from '@roadiehq/extensions-api';
import { Knex } from 'knex';

const databases = TestDatabases.create();

const migrationsDir = resolvePackagePath(
  '@roadiehq/actions-backend',
  'migrations',
);

describe('multi-step migration', () => {
  let testDb: Knex;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
  }, 120_000);

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  it('backfills existing single-request actions into one-step arrays', async () => {
    // Apply only the initial schema, insert a legacy row, then migrate up.
    await testDb.migrate.up({ directory: migrationsDir });

    const request = {
      method: 'POST',
      path: '/orgs/{{org}}/repos',
      headers: [],
      body: '{"name":{{name}}}',
    };
    const [action] = await testDb('actions')
      .insert({
        name: 'Legacy',
        slug: 'legacy',
        integration_id: '11111111-1111-1111-1111-111111111111',
        parameters: JSON.stringify([]),
        request: JSON.stringify(request),
      })
      .returning('*');
    await testDb('actions_version').insert({
      action_id: action.id,
      version: 1,
      name: 'Legacy',
      slug: 'legacy',
      integration_id: '11111111-1111-1111-1111-111111111111',
      parameters: JSON.stringify([]),
      request: JSON.stringify(request),
    });

    await testDb.migrate.latest({ directory: migrationsDir });

    const migrated = await testDb('actions').where('slug', 'legacy').first();
    expect(migrated.integration_id).toBeUndefined();
    expect(migrated.request).toBeUndefined();
    expect(migrated.steps).toEqual([
      {
        id: 'step1',
        integrationId: '11111111-1111-1111-1111-111111111111',
        request,
      },
    ]);

    const migratedVersion = await testDb('actions_version')
      .where('action_id', action.id)
      .first();
    expect(migratedVersion.steps).toEqual([
      {
        id: 'step1',
        integrationId: '11111111-1111-1111-1111-111111111111',
        request,
      },
    ]);
  });
});
