import { TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { applyMigrations } from './applyMigrations';
import { ContextGroupDao } from './ContextGroupDao';

const databases = TestDatabases.create();

describe('ContextGroupDao.materializeRule concurrency', () => {
  let testDb: Knex;
  let dao: ContextGroupDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    dao = new ContextGroupDao({ knex: testDb });
  }, 120_000);

  beforeEach(async () => {
    await testDb('context_group_member').del();
    await testDb('context_group').del();
    await testDb('context_group_rule').del();
    await testDb('datastore_relation').del();
    await testDb('datastore').del();
  });

  afterAll(async () => {
    await testDb.destroy();
  });

  // A rebuild is delete-then-insert of the rule's whole group set in one
  // transaction, and callers race: the frontend fires one materialize per
  // endpoint datasource of a written edge, in parallel. Under read committed
  // the second rebuild's DELETE cannot see the first's uncommitted inserts,
  // so without the per-rule advisory lock both sets commit and every object
  // is a member of two groups.
  it('concurrent rebuilds of one rule leave a single group set', async () => {
    const datasourceId = randomUUID();
    const objectCount = 200;
    await testDb('datastore').insert(
      Array.from({ length: objectCount }, (_, i) => ({
        id: randomUUID(),
        datasource_id: datasourceId,
        object_id: `obj-${i}`,
        object: JSON.stringify({ name: `Object ${i}` }),
      })),
    );
    const rule = await dao.createRule({
      name: 'Race Test',
      datasources: [{ datasourceId }],
    });

    for (let round = 0; round < 5; round++) {
      await Promise.all([
        dao.materializeRule(rule.id),
        dao.materializeRule(rule.id),
      ]);

      const groups = await dao.listGroups({ ruleId: rule.id });
      expect(groups.total).toBe(objectCount);
      const members = await testDb('context_group_member')
        .count({ n: '*' })
        .first();
      expect(Number(members?.n)).toBe(objectCount);
    }
  });
});
