import { TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { applyMigrations } from './applyMigrations';
import { randomUUID } from 'crypto';
import { SchemaDao } from './SchemaDao';

const databases = TestDatabases.create();

describe('SchemaDao', () => {
  let testDb: Knex;
  let schemaDao: SchemaDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    schemaDao = new SchemaDao({ knex: testDb });
  }, 120_000);

  beforeEach(async () => {
    await testDb('datastore_schema').del();
  });

  afterAll(async () => {
    await testDb.destroy();
  });

  describe('upsertSchemaFromItems', () => {
    it('should reuse existing schema version when shape is unchanged', async () => {
      const datasourceId = randomUUID();

      await testDb.transaction(async trx => {
        await schemaDao.upsertSchemaFromItems(
          datasourceId,
          [{ object: { name: 'alpha', count: 1 } }],
          datasourceId,
          trx as Knex,
        );
      });

      await testDb.transaction(async trx => {
        await schemaDao.upsertSchemaFromItems(
          datasourceId,
          [{ object: { name: 'beta', count: 2 } }],
          datasourceId,
          trx as Knex,
        );
      });

      const schemas = await testDb('datastore_schema')
        .where('datasource_id', datasourceId)
        .orderBy('version', 'asc');

      expect(schemas).toHaveLength(1);
      expect(schemas[0].version).toBe(1);
    });

    it('should create a new schema version when shape changes', async () => {
      const datasourceId = randomUUID();

      await testDb.transaction(async trx => {
        await schemaDao.upsertSchemaFromItems(
          datasourceId,
          [{ object: { name: 'alpha' } }],
          datasourceId,
          trx as Knex,
        );
      });

      await testDb.transaction(async trx => {
        await schemaDao.upsertSchemaFromItems(
          datasourceId,
          [{ object: { name: 'beta', active: true } }],
          datasourceId,
          trx as Knex,
        );
      });

      const schemas = await testDb('datastore_schema')
        .where('datasource_id', datasourceId)
        .orderBy('version', 'asc');

      expect(schemas).toHaveLength(2);
      expect(schemas[0].version).toBe(1);
      expect(schemas[1].version).toBe(2);

      const latest = await schemaDao.getLatestSchema(datasourceId);
      expect(latest?.version).toBe(2);
    });

    it('should create a new latest version when schema shape reverts', async () => {
      const datasourceId = randomUUID();

      await testDb.transaction(async trx => {
        await schemaDao.upsertSchemaFromItems(
          datasourceId,
          [{ object: { name: 'alpha' } }],
          datasourceId,
          trx as Knex,
        );
      });

      await testDb.transaction(async trx => {
        await schemaDao.upsertSchemaFromItems(
          datasourceId,
          [{ object: { name: 'beta', active: true } }],
          datasourceId,
          trx as Knex,
        );
      });

      await testDb.transaction(async trx => {
        await schemaDao.upsertSchemaFromItems(
          datasourceId,
          [{ object: { name: 'gamma' } }],
          datasourceId,
          trx as Knex,
        );
      });

      const schemas = await testDb('datastore_schema')
        .where('datasource_id', datasourceId)
        .orderBy('version', 'asc');

      expect(schemas).toHaveLength(3);
      expect(
        schemas.map((schema: { version: number }) => schema.version),
      ).toEqual([1, 2, 3]);
      expect(schemas[0].content_hash).toBe(schemas[2].content_hash);

      const latest = await schemaDao.getLatestSchema(datasourceId);
      expect(latest?.version).toBe(3);
      expect(latest?.contentHash).toBe(schemas[0].content_hash);
    });
  });

  it('lists only the latest schema per datasource and removes every version on delete', async () => {
    const datasourceId = randomUUID();
    const otherDatasourceId = randomUUID();

    await testDb.transaction(async trx => {
      await schemaDao.upsertSchemaFromItems(
        datasourceId,
        [{ object: { name: 'alpha' } }],
        'Primary',
        trx as Knex,
      );
      await schemaDao.upsertSchemaFromItems(
        datasourceId,
        [{ object: { name: 'alpha', active: true } }],
        'Primary',
        trx as Knex,
      );
      await schemaDao.upsertSchemaFromItems(
        otherDatasourceId,
        [{ object: { name: 'other' } }],
        'Other',
        trx as Knex,
      );
    });

    const beforeDelete = await schemaDao.listDatasourceSchemas();
    expect(beforeDelete.total).toBe(2);
    expect(
      beforeDelete.items.find(item => item.datasourceId === datasourceId)
        ?.version,
    ).toBe(2);

    await schemaDao.deleteDatasourceSchemas(datasourceId);

    const afterDelete = await schemaDao.listDatasourceSchemas();
    expect(afterDelete.total).toBe(1);
    expect(afterDelete.items[0].datasourceId).toBe(otherDatasourceId);
  });
});
