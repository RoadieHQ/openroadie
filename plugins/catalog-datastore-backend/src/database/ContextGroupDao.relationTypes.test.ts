import { TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { applyMigrations } from './applyMigrations';
import { ContextGroupDao } from './ContextGroupDao';

const databases = TestDatabases.create();

/**
 * `listGroupRelationTypes` joins `datastore_relation` (datasource ids stored as
 * `uuid`) to `context_group_member` (stored as `text`). Postgres has no
 * implicit comparison between the two, so this runs against a real database —
 * a mocked DAO cannot catch the type mismatch.
 */
describe('ContextGroupDao.listGroupRelationTypes', () => {
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
    await testDb('context_group_view').del();
    await testDb('context_group_rule').del();
    await testDb('datastore_relation').del();
    await testDb('datastore').del();
  });

  afterAll(async () => {
    await testDb.destroy();
  });

  async function seedGroup(
    members: Array<{ datasourceId: string; objectId: string }>,
  ) {
    const rule = await dao.createRule({
      name: `Rule ${randomUUID()}`,
      datasources: members.map(m => ({ datasourceId: m.datasourceId })),
    });
    const groupId = randomUUID();
    await testDb('context_group').insert({ id: groupId, rule_id: rule.id });
    await testDb('context_group_member').insert(
      members.map(m => ({
        context_group_id: groupId,
        datasource_id: m.datasourceId,
        object_id: m.objectId,
      })),
    );
    return groupId;
  }

  const relation = (params: {
    from: string;
    fromObject: string;
    to: string;
    toObject: string;
    type: string;
  }) => ({
    id: randomUUID(),
    source_datasource_id: params.from,
    source_object_id: params.fromObject,
    destination_datasource_id: params.to,
    destination_object_id: params.toObject,
    relation_type: params.type,
    origin: 'manual',
  });

  it('counts outgoing types per source data source and target', async () => {
    const users = randomUUID();
    const repos = randomUUID();
    const groupId = await seedGroup([
      { datasourceId: users, objectId: 'user-1' },
    ]);
    await testDb('datastore_relation').insert([
      relation({
        from: users,
        fromObject: 'user-1',
        to: repos,
        toObject: 'repo-1',
        type: 'owns',
      }),
      relation({
        from: users,
        fromObject: 'user-1',
        to: repos,
        toObject: 'repo-2',
        type: 'owns',
      }),
    ]);

    const result = await dao.listGroupRelationTypes(groupId);

    expect(result).toEqual([
      {
        datasourceId: users,
        relationshipType: 'owns',
        targetDatasourceId: repos,
        count: 2,
      },
    ]);
  });

  it('splits one type across the data sources it points at', async () => {
    const users = randomUUID();
    const repos = randomUUID();
    const teams = randomUUID();
    const groupId = await seedGroup([
      { datasourceId: users, objectId: 'user-1' },
    ]);
    await testDb('datastore_relation').insert([
      relation({
        from: users,
        fromObject: 'user-1',
        to: repos,
        toObject: 'repo-1',
        type: 'owns',
      }),
      relation({
        from: users,
        fromObject: 'user-1',
        to: teams,
        toObject: 'team-1',
        type: 'owns',
      }),
    ]);

    const result = await dao.listGroupRelationTypes(groupId);

    expect(result).toHaveLength(2);
    expect(result.map(r => r.targetDatasourceId).sort()).toEqual(
      [repos, teams].sort(),
    );
    expect(result.every(r => r.relationshipType === 'owns')).toBe(true);
  });

  it('ignores relationships whose source is not a member of the group', async () => {
    const users = randomUUID();
    const repos = randomUUID();
    const groupId = await seedGroup([
      { datasourceId: users, objectId: 'user-1' },
    ]);
    await testDb('datastore_relation').insert([
      // Same data source, an object that isn't in this group.
      relation({
        from: users,
        fromObject: 'user-99',
        to: repos,
        toObject: 'repo-1',
        type: 'owns',
      }),
      // Incoming rather than outgoing — the member is the destination.
      relation({
        from: repos,
        fromObject: 'repo-1',
        to: users,
        toObject: 'user-1',
        type: 'ownedBy',
      }),
    ]);

    expect(await dao.listGroupRelationTypes(groupId)).toEqual([]);
  });

  it('returns nothing for a group with no relationships', async () => {
    const groupId = await seedGroup([
      { datasourceId: randomUUID(), objectId: 'user-1' },
    ]);
    expect(await dao.listGroupRelationTypes(groupId)).toEqual([]);
  });
});
