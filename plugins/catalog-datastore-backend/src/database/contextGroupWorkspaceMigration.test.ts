import { TestDatabases } from '@roadiehq/backend-test-utils';
import type { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { applyMigrations } from './applyMigrations';
import { ContextGroupDao } from './ContextGroupDao';

const databases = TestDatabases.create();
const migration =
  require('../../migrations/20260901200000_context_group_workspace_scope.js') as {
    down(knex: Knex): Promise<void>;
  };

describe('context group workspace migration', () => {
  let testDb: Knex;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
  }, 120_000);

  afterAll(async () => {
    await testDb.destroy();
  });

  it('rejects rollback before changing data when workspace names overlap', async () => {
    const dao = new ContextGroupDao({ knex: testDb });
    const input = {
      name: 'Services',
      slug: 'services',
      datasources: [],
      mergeRelationshipTypes: [],
    };
    await dao.createRule(input);
    await dao.createRule(input, randomUUID());

    await expect(migration.down(testDb)).rejects.toThrow(
      'Cannot remove context group workspace scope while names or slugs overlap between workspaces',
    );

    const rows = await testDb('context_group_rule')
      .select('name', 'slug', 'workspace_id')
      .orderBy('workspace_id');
    expect(new Set(rows.map(row => row.name))).toEqual(new Set(['Services']));
    expect(new Set(rows.map(row => row.slug))).toEqual(new Set(['services']));
    expect(new Set(rows.map(row => row.workspace_id)).size).toBe(2);
    expect(
      await testDb.schema.hasColumn('context_group_rule', 'workspace_id'),
    ).toBe(true);
  });
});
