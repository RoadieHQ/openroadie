import { TestDatabases, mockServices } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { applyDatabaseMigrations } from './migrations';
import { GraphLayoutDao } from './GraphLayoutDao';

const databases = TestDatabases.create();
const workspaceA = '22222222-2222-4222-8222-222222222222';
const workspaceB = '33333333-3333-4333-8333-333333333333';

describe('GraphLayoutDao workspace isolation', () => {
  let knex: Knex;
  let dao: GraphLayoutDao;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applyDatabaseMigrations(knex);
    dao = new GraphLayoutDao({ knex, logger: mockServices.logger.mock() });
  }, 120_000);

  beforeEach(async () => {
    await knex('catalog_workflow_graph_layouts').del();
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('keeps same-named layouts isolated between workspaces', async () => {
    await dao.upsert(
      'datasources',
      { nodes: [{ id: 'a', datasourceId: 'a', position: { x: 1, y: 1 } }] },
      workspaceA,
    );
    await dao.upsert(
      'datasources',
      { nodes: [{ id: 'b', datasourceId: 'b', position: { x: 2, y: 2 } }] },
      workspaceB,
    );

    await expect(dao.list(workspaceA)).resolves.toMatchObject([
      { name: 'datasources', nodes: [{ id: 'a' }] },
    ]);
    await expect(dao.list(workspaceB)).resolves.toMatchObject([
      { name: 'datasources', nodes: [{ id: 'b' }] },
    ]);

    await expect(dao.delete('datasources', workspaceA)).resolves.toBe(true);
    await expect(
      dao.getByName('datasources', workspaceA),
    ).resolves.toBeUndefined();
    await expect(
      dao.getByName('datasources', workspaceB),
    ).resolves.toMatchObject({ nodes: [{ id: 'b' }] });
  });
});
