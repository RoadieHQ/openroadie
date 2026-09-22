import { mockServices, TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex, knex } from 'knex';
import { applyMigrations } from './applyMigrations';
import { randomUUID } from 'crypto';
import { ObjectDao } from './ObjectDao';
import { SchemaDao } from './SchemaDao';
import { IndexDao } from './IndexDao';
import { RelationshipDao } from './RelationshipDao';
import { RelationshipRuleDao } from './RelationshipRuleDao';
import { DatastoreRepository } from './DatastoreRepository';
import { DatastoreDao } from './DatastoreDao';

const databases = TestDatabases.create();
const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

describe('DatastoreDao', () => {
  let testDb: Knex;
  let objectDao: ObjectDao;
  let schemaDao: SchemaDao;
  let indexDao: IndexDao;
  let relationshipDao: RelationshipDao;
  let relationshipRuleDao: RelationshipRuleDao;
  let datastoreRepository: DatastoreRepository;
  let dao: DatastoreDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    const logger = mockServices.logger.mock();
    objectDao = new ObjectDao({ knex: testDb });
    schemaDao = new SchemaDao({ knex: testDb });
    indexDao = new IndexDao({ knex: testDb, logger });
    relationshipDao = new RelationshipDao({ knex: testDb });
    relationshipRuleDao = new RelationshipRuleDao({ knex: testDb });
    datastoreRepository = new DatastoreRepository({
      knex: testDb,
      logger,
      objectDao,
      schemaDao,
      indexDao,
      relationshipDao,
      relationshipRuleDao,
    });
    dao = new DatastoreDao({ knex: testDb, logger });
  }, 120_000);

  beforeEach(async () => {
    await testDb('datastore_relation').del();
    await testDb('context_group_member').del();
    await testDb('context_group').del();
    await testDb('context_group_rule').del();
    await testDb('datastore_index').del();
    await testDb('datastore').del();
    await testDb('datastore_index_configuration').del();
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  async function insertDatastoreObject(options: {
    datasourceId: string;
    objectId: string;
    object: Record<string, unknown>;
    workspaceId?: string;
  }) {
    const id = randomUUID();
    await testDb('datastore').insert({
      id,
      datasource_id: options.datasourceId,
      object_id: options.objectId,
      object: JSON.stringify(options.object),
      ...(options.workspaceId ? { workspace_id: options.workspaceId } : {}),
    });
    return id;
  }

  async function insertIndexConfiguration(options: {
    datasourceId: string;
    key: string;
    valueExpression: string;
    purpose?: 'column' | 'title' | 'subtitle' | 'image';
  }) {
    const id = randomUUID();
    await testDb('datastore_index_configuration').insert({
      id,
      datasource_id: options.datasourceId,
      key: options.key,
      value_expression: options.valueExpression,
      purpose: options.purpose ?? 'column',
    });
    return id;
  }

  async function insertIndex(options: {
    datastoreId: string;
    configId: string;
    key: string;
    value: string;
  }) {
    const id = randomUUID();
    await testDb('datastore_index').insert({
      id,
      datastore_id: options.datastoreId,
      datastore_index_configuration_id: options.configId,
      key: options.key,
      value: options.value,
    });
    return id;
  }

  async function insertRelationship(options: {
    sourceDatasourceId: string;
    sourceObjectId: string;
    destinationDatasourceId: string;
    destinationObjectId: string;
    relationshipType: string;
    reciprocalRelationshipType?: string;
  }) {
    const id = randomUUID();
    await testDb('datastore_relation').insert({
      id,
      source_datasource_id: options.sourceDatasourceId,
      source_object_id: options.sourceObjectId,
      destination_datasource_id: options.destinationDatasourceId,
      destination_object_id: options.destinationObjectId,
      relation_type: options.relationshipType,
      reciprocal_relation_type: options.reciprocalRelationshipType ?? null,
      origin: 'manual',
    });
    return id;
  }

  async function insertContextGroupRule(options: {
    name: string;
    workspaceId?: string;
  }) {
    const id = randomUUID();
    await testDb('context_group_rule').insert({
      id,
      name: options.name,
      slug: options.name.toLowerCase().replace(/\s+/g, '-'),
      description: null,
      datasources: JSON.stringify([]),
      merge_relation_types: JSON.stringify([]),
      created_at: new Date(),
      updated_at: new Date(),
      ...(options.workspaceId ? { workspace_id: options.workspaceId } : {}),
    });
    return id;
  }

  async function insertContextGroup(options: { ruleId: string }) {
    const id = randomUUID();
    await testDb('context_group').insert({
      id,
      rule_id: options.ruleId,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return id;
  }

  async function insertContextGroupMember(options: {
    groupId: string;
    datasourceId: string;
    objectId: string;
  }) {
    const id = randomUUID();
    await testDb('context_group_member').insert({
      id,
      context_group_id: options.groupId,
      datasource_id: options.datasourceId,
      object_id: options.objectId,
      created_at: new Date(),
    });
    return id;
  }

  describe('object graph summaries', () => {
    it('returns graph nodes without full object payloads and derives labels', async () => {
      const datasourceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-1',
        object: { metadata: { name: 'Service One' }, bulky: 'ignored' },
      });

      const result = await objectDao.queryGraphNodes({
        datasourceIds: [datasourceId],
      });

      expect(result.total).toBe(1);
      expect(result.items).toEqual([
        expect.objectContaining({
          datasourceId,
          objectId: 'obj-1',
          label: 'Service One',
          displayName: 'Service One',
        }),
      ]);
      expect(result.items[0]).not.toHaveProperty('object');
    });

    it('returns graph relationships only when both endpoints are in scope', async () => {
      const datasourceId = randomUUID();
      const otherDatasourceId = randomUUID();
      await insertRelationship({
        sourceDatasourceId: datasourceId,
        sourceObjectId: 'obj-1',
        destinationDatasourceId: datasourceId,
        destinationObjectId: 'obj-2',
        relationshipType: 'relates_to',
      });
      await insertRelationship({
        sourceDatasourceId: datasourceId,
        sourceObjectId: 'obj-1',
        destinationDatasourceId: otherDatasourceId,
        destinationObjectId: 'external',
        relationshipType: 'depends_on',
      });

      const result = await relationshipDao.queryGraphRelationships({
        datasourceIds: [datasourceId],
      });

      expect(result.total).toBe(1);
      expect(result.items).toEqual([
        expect.objectContaining({
          sourceDatasourceId: datasourceId,
          sourceObjectId: 'obj-1',
          destinationDatasourceId: datasourceId,
          destinationObjectId: 'obj-2',
          relationshipType: 'relates_to',
        }),
      ]);
    });
  });

  describe('query', () => {
    it('should return empty results when no data exists', async () => {
      const datasourceId = randomUUID();

      const result = await objectDao.query(datasourceId);

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return items for a datasource', async () => {
      const datasourceId = randomUUID();
      const configId = await insertIndexConfiguration({
        datasourceId,
        key: 'name',
        valueExpression: 'name',
      });
      const datastoreId = await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-1',
        object: { name: 'Test Object' },
      });
      await insertIndex({
        datastoreId,
        configId,
        key: 'name',
        value: 'Test Object',
      });

      const result = await objectDao.query(datasourceId);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].objectId).toBe('obj-1');
      expect(result.items[0].datasourceId).toBe(datasourceId);
      expect(result.total).toBe(1);
    });

    it('should return relationship counts for items in the current page', async () => {
      const datasourceId = randomUUID();
      const otherDatasourceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-1',
        object: { name: 'Object 1' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-2',
        object: { name: 'Object 2' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-3',
        object: { name: 'Object 3' },
      });

      await insertRelationship({
        sourceDatasourceId: datasourceId,
        sourceObjectId: 'obj-1',
        destinationDatasourceId: datasourceId,
        destinationObjectId: 'obj-2',
        relationshipType: 'depends_on',
      });
      await insertRelationship({
        sourceDatasourceId: datasourceId,
        sourceObjectId: 'obj-1',
        destinationDatasourceId: otherDatasourceId,
        destinationObjectId: 'external-1',
        relationshipType: 'owned_by',
      });
      await insertRelationship({
        sourceDatasourceId: datasourceId,
        sourceObjectId: 'obj-2',
        destinationDatasourceId: datasourceId,
        destinationObjectId: 'obj-1',
        relationshipType: 'provided_by',
      });
      await insertRelationship({
        sourceDatasourceId: otherDatasourceId,
        sourceObjectId: 'external-2',
        destinationDatasourceId: datasourceId,
        destinationObjectId: 'obj-1',
        relationshipType: 'uses',
      });
      await insertRelationship({
        sourceDatasourceId: otherDatasourceId,
        sourceObjectId: 'obj-1',
        destinationDatasourceId: otherDatasourceId,
        destinationObjectId: 'external-3',
        relationshipType: 'ignored',
      });

      const result = await objectDao.query(datasourceId);

      expect(result.items).toContainEqual(
        expect.objectContaining({ objectId: 'obj-1', relationshipCount: 4 }),
      );
      expect(result.items).toContainEqual(
        expect.objectContaining({ objectId: 'obj-3', relationshipCount: 0 }),
      );
    });

    it('should only return items for the specified datasource', async () => {
      const datasourceId1 = randomUUID();
      const datasourceId2 = randomUUID();

      const configId1 = await insertIndexConfiguration({
        datasourceId: datasourceId1,
        key: 'name',
        valueExpression: 'name',
      });
      const configId2 = await insertIndexConfiguration({
        datasourceId: datasourceId2,
        key: 'name',
        valueExpression: 'name',
      });

      const datastoreId1 = await insertDatastoreObject({
        datasourceId: datasourceId1,
        objectId: 'obj-1',
        object: { name: 'Object 1' },
      });
      const datastoreId2 = await insertDatastoreObject({
        datasourceId: datasourceId2,
        objectId: 'obj-2',
        object: { name: 'Object 2' },
      });

      await insertIndex({
        datastoreId: datastoreId1,
        configId: configId1,
        key: 'name',
        value: 'Object 1',
      });
      await insertIndex({
        datastoreId: datastoreId2,
        configId: configId2,
        key: 'name',
        value: 'Object 2',
      });

      const result = await objectDao.query(datasourceId1);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].objectId).toBe('obj-1');
      expect(result.total).toBe(1);
    });

    describe('pagination', () => {
      it('should respect limit parameter', async () => {
        const datasourceId = randomUUID();
        const configId = await insertIndexConfiguration({
          datasourceId,
          key: 'name',
          valueExpression: 'name',
        });

        for (let i = 0; i < 5; i++) {
          const datastoreId = await insertDatastoreObject({
            datasourceId,
            objectId: `obj-${i}`,
            object: { name: `Object ${i}` },
          });
          await insertIndex({
            datastoreId,
            configId,
            key: 'name',
            value: `Object ${i}`,
          });
        }

        const result = await objectDao.query(datasourceId, { limit: 2 });

        expect(result.items).toHaveLength(2);
        expect(result.total).toBe(5);
      });

      it('should respect offset parameter', async () => {
        const datasourceId = randomUUID();
        const configId = await insertIndexConfiguration({
          datasourceId,
          key: 'name',
          valueExpression: 'name',
        });

        for (let i = 0; i < 5; i++) {
          const datastoreId = await insertDatastoreObject({
            datasourceId,
            objectId: `obj-${i}`,
            object: { name: `Object ${i}` },
          });
          await insertIndex({
            datastoreId,
            configId,
            key: 'name',
            value: `Object ${i}`,
          });
        }

        const result = await objectDao.query(datasourceId, {
          limit: 2,
          offset: 2,
        });

        expect(result.items).toHaveLength(2);
        expect(result.total).toBe(5);
      });

      it('should use default limit of 50', async () => {
        const datasourceId = randomUUID();
        const configId = await insertIndexConfiguration({
          datasourceId,
          key: 'name',
          valueExpression: 'name',
        });

        for (let i = 0; i < 60; i++) {
          const datastoreId = await insertDatastoreObject({
            datasourceId,
            objectId: `obj-${i}`,
            object: { name: `Object ${i}` },
          });
          await insertIndex({
            datastoreId,
            configId,
            key: 'name',
            value: `Object ${i}`,
          });
        }

        const result = await objectDao.query(datasourceId);

        expect(result.items).toHaveLength(50);
        expect(result.total).toBe(60);
      });
    });

    describe('index validation', () => {
      it('should throw error when orderBy index configuration is missing', async () => {
        const datasourceId = randomUUID();

        await expect(
          objectDao.query(datasourceId, { orderBy: 'name' }),
        ).rejects.toThrow(/Index configuration not found for keys name/);
      });

      it('should throw error when filter index configuration is missing', async () => {
        const datasourceId = randomUUID();

        await expect(
          objectDao.query(datasourceId, { filter: { type: 'service' } }),
        ).rejects.toThrow(/Index configuration not found for keys type/);
      });

      it('should throw error when multiple index configurations are missing', async () => {
        const datasourceId = randomUUID();

        await expect(
          objectDao.query(datasourceId, {
            orderBy: 'name',
            filter: { type: 'service' },
          }),
        ).rejects.toThrow(/Index configuration not found for keys type, name/);
      });

      it('should succeed when all required index configurations exist', async () => {
        const datasourceId = randomUUID();

        await insertIndexConfiguration({
          datasourceId,
          key: 'type',
          valueExpression: 'type',
        });

        await expect(
          objectDao.query(datasourceId, {
            filter: { type: 'service' },
          }),
        ).resolves.toEqual({ items: [], total: 0 });
      });
    });

    describe('explain', () => {
      it('should include explain plans when explain option is true', async () => {
        const datasourceId = randomUUID();
        const configId = await insertIndexConfiguration({
          datasourceId,
          key: 'name',
          valueExpression: 'name',
        });
        const datastoreId = await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-1',
          object: { name: 'Test' },
        });
        await insertIndex({
          datastoreId,
          configId,
          key: 'name',
          value: 'Test',
        });

        const result = (await objectDao.query(datasourceId, {
          explain: true,
        })) as {
          items: unknown[];
          total: number;
          explain: { total: unknown; items: unknown };
        };

        expect(result.explain).toBeDefined();
        expect(result.explain.total).toBeDefined();
        expect(result.explain.items).toBeDefined();
      });

      it('should not include explain plans when explain option is false', async () => {
        const datasourceId = randomUUID();
        const configId = await insertIndexConfiguration({
          datasourceId,
          key: 'name',
          valueExpression: 'name',
        });
        const datastoreId = await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-1',
          object: { name: 'Test' },
        });
        await insertIndex({
          datastoreId,
          configId,
          key: 'name',
          value: 'Test',
        });

        const result = await objectDao.query(datasourceId, { explain: false });

        expect(result).not.toHaveProperty('explain');
      });
    });

    describe('query plan efficiency', () => {
      const BULK_SIZE = 500;

      // Plan assertions need enable_seqscan = off on every connection that
      // runs an EXPLAIN. ALTER SYSTEM + pg_reload_conf() is asynchronous and
      // server-wide (the database server is shared in CI), so the setting is
      // applied per connection via the pool instead.
      let planDb: Knex;
      let planObjectDao: ObjectDao;

      beforeAll(() => {
        planDb = knex({
          client: 'pg',
          connection: testDb.client.config.connection,
          pool: {
            afterCreate: (
              conn: {
                query: (sql: string, cb: (err: Error | null) => void) => void;
              },
              done: (err: Error | null, conn: unknown) => void,
            ) => {
              conn.query('SET enable_seqscan = off', err => done(err, conn));
            },
          },
        });
        planObjectDao = new ObjectDao({ knex: planDb });
      });

      afterAll(async () => {
        await planDb.destroy();
      });

      interface ExplainPlanNode {
        'Node Type': string;
        Plans?: ExplainPlanNode[];
        [key: string]: unknown;
      }

      interface ExplainResult {
        Plan: ExplainPlanNode;
      }

      function findNodeTypes(plan: ExplainPlanNode): string[] {
        const types: string[] = [plan['Node Type']];
        if (plan.Plans) {
          for (const child of plan.Plans) {
            types.push(...findNodeTypes(child));
          }
        }
        return types;
      }

      function assertNoSeqScan(explain: ExplainResult[]) {
        const nodeTypes = explain.flatMap(e => findNodeTypes(e.Plan));
        expect(nodeTypes).not.toContain('Seq Scan');
      }

      async function insertBulkData(
        datasourceId: string,
        configId: string,
        key: string,
        count: number,
      ) {
        for (let i = 0; i < count; i++) {
          const datastoreId = await insertDatastoreObject({
            datasourceId,
            objectId: `obj-${i}`,
            object: { [key]: `value-${i}` },
          });
          await insertIndex({
            datastoreId,
            configId,
            key,
            value: `value-${i}`,
          });
        }
      }

      it('should use index scan for basic datasource query', async () => {
        const datasourceId = randomUUID();
        const configId = await insertIndexConfiguration({
          datasourceId,
          key: 'name',
          valueExpression: 'name',
        });

        await insertBulkData(datasourceId, configId, 'name', BULK_SIZE);

        const result = (await planObjectDao.query(datasourceId, {
          explain: true,
        })) as {
          items: unknown[];
          total: number;
          explain: { total: ExplainResult[]; items: ExplainResult[] };
        };

        assertNoSeqScan(result.explain.items);
        assertNoSeqScan(result.explain.total);
      });

      it('should use index scan for filtered queries', async () => {
        const datasourceId = randomUUID();
        const configId = await insertIndexConfiguration({
          datasourceId,
          key: 'type',
          valueExpression: 'type',
        });

        await insertBulkData(datasourceId, configId, 'type', BULK_SIZE);

        const result = (await planObjectDao.query(datasourceId, {
          filter: { type: 'value-0' },
          explain: true,
        })) as {
          items: unknown[];
          total: number;
          explain: { total: ExplainResult[]; items: ExplainResult[] };
        };

        assertNoSeqScan(result.explain.items);
        assertNoSeqScan(result.explain.total);
      });

      it('should use index scan with pagination', async () => {
        const datasourceId = randomUUID();
        const configId = await insertIndexConfiguration({
          datasourceId,
          key: 'name',
          valueExpression: 'name',
        });

        await insertBulkData(datasourceId, configId, 'name', BULK_SIZE);

        const result = (await planObjectDao.query(datasourceId, {
          limit: 50,
          offset: 100,
          explain: true,
        })) as {
          items: unknown[];
          total: number;
          explain: { total: ExplainResult[]; items: ExplainResult[] };
        };

        assertNoSeqScan(result.explain.items);
        assertNoSeqScan(result.explain.total);
      });

      it('should use index scan for ordered queries', async () => {
        const datasourceId = randomUUID();
        const configId = await insertIndexConfiguration({
          datasourceId,
          key: 'email',
          valueExpression: 'email',
        });

        await insertBulkData(datasourceId, configId, 'email', BULK_SIZE);

        const result = (await planObjectDao.query(datasourceId, {
          orderBy: 'email',
          sortOrder: 'asc',
          explain: true,
        })) as {
          items: unknown[];
          total: number;
          explain: { total: ExplainResult[]; items: ExplainResult[] };
        };

        assertNoSeqScan(result.explain.items);
        assertNoSeqScan(result.explain.total);
      });

      it('should use index scan for filtered and ordered queries', async () => {
        const datasourceId = randomUUID();
        const emailConfigId = await insertIndexConfiguration({
          datasourceId,
          key: 'email',
          valueExpression: 'email',
        });
        const typeConfigId = await insertIndexConfiguration({
          datasourceId,
          key: 'type',
          valueExpression: 'type',
        });

        for (let i = 0; i < BULK_SIZE; i++) {
          const type = i < Math.ceil(BULK_SIZE / 10) ? 'service' : 'component';
          const datastoreId = await insertDatastoreObject({
            datasourceId,
            objectId: `obj-${i}`,
            object: { email: `user${i}@example.com`, type },
          });
          await insertIndex({
            datastoreId,
            configId: emailConfigId,
            key: 'email',
            value: `user${i}@example.com`,
          });
          await insertIndex({
            datastoreId,
            configId: typeConfigId,
            key: 'type',
            value: type,
          });
        }

        const result = (await planObjectDao.query(datasourceId, {
          filter: { type: 'service' },
          orderBy: 'email',
          sortOrder: 'desc',
          explain: true,
        })) as {
          items: unknown[];
          total: number;
          explain: { total: ExplainResult[]; items: ExplainResult[] };
        };

        assertNoSeqScan(result.explain.items);
        assertNoSeqScan(result.explain.total);
      });

      it('should use index scan for multi-key filter queries', async () => {
        const datasourceId = randomUUID();
        const statusConfigId = await insertIndexConfiguration({
          datasourceId,
          key: 'status',
          valueExpression: 'status',
        });
        const typeConfigId = await insertIndexConfiguration({
          datasourceId,
          key: 'type',
          valueExpression: 'type',
        });
        const ownerConfigId = await insertIndexConfiguration({
          datasourceId,
          key: 'owner',
          valueExpression: 'owner',
        });

        for (let i = 0; i < BULK_SIZE; i++) {
          const datastoreId = await insertDatastoreObject({
            datasourceId,
            objectId: `obj-${i}`,
            object: {
              status: i % 2 === 0 ? 'active' : 'inactive',
              type: i % 3 === 0 ? 'service' : 'component',
              owner: `team-${i % 10}`,
            },
          });
          await insertIndex({
            datastoreId,
            configId: statusConfigId,
            key: 'status',
            value: i % 2 === 0 ? 'active' : 'inactive',
          });
          await insertIndex({
            datastoreId,
            configId: typeConfigId,
            key: 'type',
            value: i % 3 === 0 ? 'service' : 'component',
          });
          await insertIndex({
            datastoreId,
            configId: ownerConfigId,
            key: 'owner',
            value: `team-${i % 10}`,
          });
        }

        const result = (await planObjectDao.query(datasourceId, {
          filter: { status: 'active', type: 'service', owner: 'team-0' },
          explain: true,
        })) as {
          items: unknown[];
          total: number;
          explain: { total: ExplainResult[]; items: ExplainResult[] };
        };

        assertNoSeqScan(result.explain.items);
        assertNoSeqScan(result.explain.total);
      });
    });

    describe('filtering', () => {
      it('should filter items by index value', async () => {
        const datasourceId = randomUUID();
        const typeConfigId = await insertIndexConfiguration({
          datasourceId,
          key: 'type',
          valueExpression: 'type',
        });

        const datastoreId1 = await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-1',
          object: { name: 'Service A', type: 'service' },
        });
        const datastoreId2 = await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-2',
          object: { name: 'Component B', type: 'component' },
        });
        const datastoreId3 = await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-3',
          object: { name: 'Service C', type: 'service' },
        });

        await insertIndex({
          datastoreId: datastoreId1,
          configId: typeConfigId,
          key: 'type',
          value: 'service',
        });
        await insertIndex({
          datastoreId: datastoreId2,
          configId: typeConfigId,
          key: 'type',
          value: 'component',
        });
        await insertIndex({
          datastoreId: datastoreId3,
          configId: typeConfigId,
          key: 'type',
          value: 'service',
        });

        const result = await objectDao.query(datasourceId, {
          filter: { type: 'service' },
        });

        expect(result.items).toHaveLength(2);
        expect(result.items.map(i => i.objectId).sort()).toEqual([
          'obj-1',
          'obj-3',
        ]);
        expect(result.total).toBe(2);
      });

      it('should return empty when filter matches nothing', async () => {
        const datasourceId = randomUUID();
        const typeConfigId = await insertIndexConfiguration({
          datasourceId,
          key: 'type',
          valueExpression: 'type',
        });

        const datastoreId = await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-1',
          object: { type: 'service' },
        });
        await insertIndex({
          datastoreId,
          configId: typeConfigId,
          key: 'type',
          value: 'service',
        });

        const result = await objectDao.query(datasourceId, {
          filter: { type: 'nonexistent' },
        });

        expect(result.items).toHaveLength(0);
        expect(result.total).toBe(0);
      });

      it('should filter by multiple index keys simultaneously', async () => {
        const datasourceId = randomUUID();
        const statusConfigId = await insertIndexConfiguration({
          datasourceId,
          key: 'status',
          valueExpression: 'status',
        });
        const typeConfigId = await insertIndexConfiguration({
          datasourceId,
          key: 'type',
          valueExpression: 'type',
        });

        const datastoreId1 = await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-1',
          object: { name: 'Active Service', status: 'active', type: 'service' },
        });
        const datastoreId2 = await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-2',
          object: {
            name: 'Inactive Service',
            status: 'inactive',
            type: 'service',
          },
        });
        const datastoreId3 = await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-3',
          object: {
            name: 'Active Component',
            status: 'active',
            type: 'component',
          },
        });
        const datastoreId4 = await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-4',
          object: {
            name: 'Another Active Service',
            status: 'active',
            type: 'service',
          },
        });

        await insertIndex({
          datastoreId: datastoreId1,
          configId: statusConfigId,
          key: 'status',
          value: 'active',
        });
        await insertIndex({
          datastoreId: datastoreId1,
          configId: typeConfigId,
          key: 'type',
          value: 'service',
        });

        await insertIndex({
          datastoreId: datastoreId2,
          configId: statusConfigId,
          key: 'status',
          value: 'inactive',
        });
        await insertIndex({
          datastoreId: datastoreId2,
          configId: typeConfigId,
          key: 'type',
          value: 'service',
        });

        await insertIndex({
          datastoreId: datastoreId3,
          configId: statusConfigId,
          key: 'status',
          value: 'active',
        });
        await insertIndex({
          datastoreId: datastoreId3,
          configId: typeConfigId,
          key: 'type',
          value: 'component',
        });

        await insertIndex({
          datastoreId: datastoreId4,
          configId: statusConfigId,
          key: 'status',
          value: 'active',
        });
        await insertIndex({
          datastoreId: datastoreId4,
          configId: typeConfigId,
          key: 'type',
          value: 'service',
        });

        const result = await objectDao.query(datasourceId, {
          filter: { status: 'active', type: 'service' },
        });

        expect(result.items).toHaveLength(2);
        expect(result.items.map(i => i.objectId).sort()).toEqual([
          'obj-1',
          'obj-4',
        ]);
        expect(result.total).toBe(2);
      });
    });

    describe('ordering', () => {
      it('should order by title using configured presentation title and fallback fields', async () => {
        const datasourceId = randomUUID();
        const titleConfigId = await insertIndexConfiguration({
          datasourceId,
          key: 'presentation.title',
          valueExpression: 'name',
          purpose: 'title',
        });

        const datastoreId1 = await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-zulu',
          object: { name: 'ignored-zulu' },
        });
        const datastoreId2 = await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-alpha',
          object: { name: 'ignored-alpha' },
        });
        await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-bravo',
          object: { display_name: 'Bravo' },
        });

        await insertIndex({
          datastoreId: datastoreId1,
          configId: titleConfigId,
          key: 'presentation.title',
          value: 'Zulu',
        });
        await insertIndex({
          datastoreId: datastoreId2,
          configId: titleConfigId,
          key: 'presentation.title',
          value: 'Alpha',
        });

        const result = await objectDao.query(datasourceId, {
          orderBy: 'title',
          sortOrder: 'asc',
        });

        expect(result.items.map(i => i.objectId)).toEqual([
          'obj-alpha',
          'obj-bravo',
          'obj-zulu',
        ]);
      });

      it('should order by index value ascending', async () => {
        const datasourceId = randomUUID();
        const nameConfigId = await insertIndexConfiguration({
          datasourceId,
          key: 'name',
          valueExpression: 'name',
        });

        const ids = ['charlie', 'alpha', 'bravo'];
        for (const name of ids) {
          const datastoreId = await insertDatastoreObject({
            datasourceId,
            objectId: `obj-${name}`,
            object: { name },
          });
          await insertIndex({
            datastoreId,
            configId: nameConfigId,
            key: 'name',
            value: name,
          });
        }

        const result = await objectDao.query(datasourceId, {
          orderBy: 'name',
          sortOrder: 'asc',
        });

        expect(result.items.map(i => i.objectId)).toEqual([
          'obj-alpha',
          'obj-bravo',
          'obj-charlie',
        ]);
      });

      it('should order by index value descending', async () => {
        const datasourceId = randomUUID();
        const nameConfigId = await insertIndexConfiguration({
          datasourceId,
          key: 'name',
          valueExpression: 'name',
        });

        const ids = ['charlie', 'alpha', 'bravo'];
        for (const name of ids) {
          const datastoreId = await insertDatastoreObject({
            datasourceId,
            objectId: `obj-${name}`,
            object: { name },
          });
          await insertIndex({
            datastoreId,
            configId: nameConfigId,
            key: 'name',
            value: name,
          });
        }

        const result = await objectDao.query(datasourceId, {
          orderBy: 'name',
          sortOrder: 'desc',
        });

        expect(result.items.map(i => i.objectId)).toEqual([
          'obj-charlie',
          'obj-bravo',
          'obj-alpha',
        ]);
      });

      it('preserves configured subtitle presentation when ordering by subtitle index', async () => {
        const datasourceId = randomUUID();
        const subtitleConfigId = await insertIndexConfiguration({
          datasourceId,
          key: 'presentation.subtitle',
          valueExpression: 'description ? description : notes',
          purpose: 'subtitle',
        });

        const datastoreId1 = await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-zulu',
          object: { name: 'Zulu', description: 'Zulu description' },
        });
        const datastoreId2 = await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-alpha',
          object: { name: 'Alpha', notes: 'Alpha notes' },
        });

        await insertIndex({
          datastoreId: datastoreId1,
          configId: subtitleConfigId,
          key: 'presentation.subtitle',
          value: 'Zulu description',
        });
        await insertIndex({
          datastoreId: datastoreId2,
          configId: subtitleConfigId,
          key: 'presentation.subtitle',
          value: 'Alpha notes',
        });

        const asc = await objectDao.query(datasourceId, {
          orderBy: 'presentation.subtitle',
          sortOrder: 'asc',
        });
        expect(asc.items.map(item => item.objectId)).toEqual([
          'obj-alpha',
          'obj-zulu',
        ]);
        expect(asc.items.map(item => item.presentation?.subtitle)).toEqual([
          'Alpha notes',
          'Zulu description',
        ]);

        const desc = await objectDao.query(datasourceId, {
          orderBy: 'presentation.subtitle',
          sortOrder: 'desc',
        });
        expect(desc.items.map(item => item.objectId)).toEqual([
          'obj-zulu',
          'obj-alpha',
        ]);
        expect(desc.items.map(item => item.presentation?.subtitle)).toEqual([
          'Zulu description',
          'Alpha notes',
        ]);
      });

      it('should order by updated_at by default', async () => {
        const datasourceId = randomUUID();
        const nameConfigId = await insertIndexConfiguration({
          datasourceId,
          key: 'name',
          valueExpression: 'name',
        });

        for (let i = 0; i < 3; i++) {
          const datastoreId = await insertDatastoreObject({
            datasourceId,
            objectId: `obj-${i}`,
            object: { name: `item-${i}` },
          });
          await insertIndex({
            datastoreId,
            configId: nameConfigId,
            key: 'name',
            value: `item-${i}`,
          });
          await new Promise(resolve => setTimeout(resolve, 10));
        }

        const result = await objectDao.query(datasourceId);

        expect(result.items[0].objectId).toBe('obj-2');
        expect(result.items[2].objectId).toBe('obj-0');
      });

      it('should order by context group count', async () => {
        const datasourceId = randomUUID();
        await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-1',
          object: { name: 'Alpha' },
        });
        await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-2',
          object: { name: 'Beta' },
        });
        await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-3',
          object: { name: 'Gamma' },
        });

        const teamsRuleId = await insertContextGroupRule({ name: 'Teams' });
        const squadsRuleId = await insertContextGroupRule({ name: 'Squads' });
        const teamGroupId = await insertContextGroup({ ruleId: teamsRuleId });
        const squadGroupId = await insertContextGroup({ ruleId: squadsRuleId });

        await insertContextGroupMember({
          groupId: teamGroupId,
          datasourceId,
          objectId: 'obj-1',
        });
        await insertContextGroupMember({
          groupId: teamGroupId,
          datasourceId,
          objectId: 'obj-2',
        });
        await insertContextGroupMember({
          groupId: squadGroupId,
          datasourceId,
          objectId: 'obj-1',
        });

        const result = await objectDao.query(datasourceId, {
          orderBy: 'contextGroupCount',
          sortOrder: 'desc',
        });

        expect(result.items.map(item => item.objectId)).toEqual([
          'obj-1',
          'obj-2',
          'obj-3',
        ]);
      });

      it('should filter by context group title', async () => {
        const datasourceId = randomUUID();
        await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-1',
          object: { name: 'Alpha' },
        });
        await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-2',
          object: { name: 'Beta' },
        });
        await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-3',
          object: { name: 'Gamma' },
        });

        const ruleId = await insertContextGroupRule({ name: 'Teams' });
        const groupId = await insertContextGroup({ ruleId });
        await insertContextGroupMember({
          groupId,
          datasourceId,
          objectId: 'obj-1',
        });
        await insertContextGroupMember({
          groupId,
          datasourceId,
          objectId: 'obj-2',
        });

        const result = await objectDao.query(datasourceId, {
          filter: { contextGroupTitle: 'Teams: Alpha' },
        });

        expect(result.items.map(item => item.objectId).sort()).toEqual([
          'obj-1',
          'obj-2',
        ]);
      });

      it('does not resolve context group titles from another workspace', async () => {
        const datasourceId = randomUUID();
        const otherWorkspaceId = randomUUID();
        await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-1',
          object: { name: 'Alpha' },
        });
        await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-2',
          object: { name: 'Beta' },
        });
        await insertDatastoreObject({
          datasourceId,
          objectId: 'obj-1',
          object: { name: 'Other root' },
          workspaceId: otherWorkspaceId,
        });

        const ruleId = await insertContextGroupRule({ name: 'Teams' });
        const groupId = await insertContextGroup({ ruleId });
        await insertContextGroupMember({
          groupId,
          datasourceId,
          objectId: 'obj-1',
        });
        await insertContextGroupMember({
          groupId,
          datasourceId,
          objectId: 'obj-2',
        });

        const result = await objectDao.query(datasourceId, {
          filter: { contextGroupTitle: 'Teams: Other root' },
        });

        expect(result.items).toEqual([]);
      });
    });
  });

  describe('queryAll', () => {
    it('should order by title across datasources', async () => {
      const datasourceId1 = randomUUID();
      const datasourceId2 = randomUUID();
      const titleConfigId1 = await insertIndexConfiguration({
        datasourceId: datasourceId1,
        key: 'presentation.title',
        valueExpression: 'name',
        purpose: 'title',
      });
      const titleConfigId2 = await insertIndexConfiguration({
        datasourceId: datasourceId2,
        key: 'presentation.title',
        valueExpression: 'name',
        purpose: 'title',
      });

      const datastoreId1 = await insertDatastoreObject({
        datasourceId: datasourceId1,
        objectId: 'obj-zulu',
        object: { name: 'ignored-zulu' },
      });
      await insertIndex({
        datastoreId: datastoreId1,
        configId: titleConfigId1,
        key: 'presentation.title',
        value: 'Zulu',
      });

      const datastoreId2 = await insertDatastoreObject({
        datasourceId: datasourceId2,
        objectId: 'obj-alpha',
        object: { name: 'ignored-alpha' },
      });
      await insertIndex({
        datastoreId: datastoreId2,
        configId: titleConfigId2,
        key: 'presentation.title',
        value: 'Alpha',
      });

      await insertDatastoreObject({
        datasourceId: datasourceId1,
        objectId: 'obj-bravo',
        object: { display_name: 'Bravo' },
      });

      const result = await objectDao.queryAll({
        orderBy: 'title',
        sortOrder: 'asc',
      });

      expect(result.items.map(i => i.objectId)).toEqual([
        'obj-alpha',
        'obj-bravo',
        'obj-zulu',
      ]);
    });

    it('should list all objects with the default updated_at ordering', async () => {
      const datasourceId1 = randomUUID();
      const datasourceId2 = randomUUID();

      await insertDatastoreObject({
        datasourceId: datasourceId1,
        objectId: 'obj-older',
        object: { name: 'Older' },
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      await insertDatastoreObject({
        datasourceId: datasourceId2,
        objectId: 'obj-newer',
        object: { name: 'Newer' },
      });

      const result = await objectDao.queryAll();

      expect(result.total).toBe(2);
      expect(result.items.map(i => i.objectId)).toEqual([
        'obj-newer',
        'obj-older',
      ]);
    });
  });

  describe('insertDatastoreItem', () => {
    it('should insert a single item', async () => {
      const datasourceId = randomUUID();
      const item = {
        id: randomUUID(),
        datasourceId,
        objectId: 'test-obj',
        object: { name: 'Test Object' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await datastoreRepository.insertDatastoreItem(item);

      const rows = await testDb('datastore').where(
        'datasource_id',
        datasourceId,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].object_id).toBe('test-obj');
    });

    it('should create indexes for configured index expressions', async () => {
      const datasourceId = randomUUID();
      await insertIndexConfiguration({
        datasourceId,
        key: 'name',
        valueExpression: 'name',
      });
      await insertIndexConfiguration({
        datasourceId,
        key: 'type',
        valueExpression: 'metadata.type',
      });

      const item = {
        id: randomUUID(),
        datasourceId,
        objectId: 'test-obj',
        object: { name: 'Test', metadata: { type: 'service' } },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await datastoreRepository.insertDatastoreItem(item);

      const indexes = await testDb('datastore_index').where(
        'datastore_id',
        item.id,
      );
      expect(indexes).toHaveLength(2);
      expect(indexes.map(i => i.key).sort()).toEqual(['name', 'type']);
      expect(indexes.find(i => i.key === 'name')?.value).toBe('Test');
      expect(indexes.find(i => i.key === 'type')?.value).toBe('service');
    });

    it('should skip indexing when expression returns non-string', async () => {
      const datasourceId = randomUUID();
      await insertIndexConfiguration({
        datasourceId,
        key: 'count',
        valueExpression: 'count',
      });

      const item = {
        id: randomUUID(),
        datasourceId,
        objectId: 'test-obj',
        object: { count: 42 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await datastoreRepository.insertDatastoreItem(item);

      const indexes = await testDb('datastore_index').where(
        'datastore_id',
        item.id,
      );
      expect(indexes).toHaveLength(0);
    });

    it('should skip indexing when expression path does not exist', async () => {
      const datasourceId = randomUUID();
      await insertIndexConfiguration({
        datasourceId,
        key: 'missing',
        valueExpression: 'does.not.exist',
      });

      const item = {
        id: randomUUID(),
        datasourceId,
        objectId: 'test-obj',
        object: { name: 'Test' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await datastoreRepository.insertDatastoreItem(item);

      const indexes = await testDb('datastore_index').where(
        'datastore_id',
        item.id,
      );
      expect(indexes).toHaveLength(0);
    });
  });

  describe('deleteDatastoreItem', () => {
    it('should delete an item by datasource and object id', async () => {
      const datasourceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-to-delete',
        object: { name: 'Delete Me' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-to-keep',
        object: { name: 'Keep Me' },
      });

      await objectDao.deleteDatastoreItem(datasourceId, 'obj-to-delete');

      const rows = await testDb('datastore').where(
        'datasource_id',
        datasourceId,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].object_id).toBe('obj-to-keep');
    });

    it('should not delete items from other datasources', async () => {
      const datasourceId1 = randomUUID();
      const datasourceId2 = randomUUID();

      await insertDatastoreObject({
        datasourceId: datasourceId1,
        objectId: 'shared-obj-id',
        object: { name: 'DS1 Object' },
      });
      await insertDatastoreObject({
        datasourceId: datasourceId2,
        objectId: 'shared-obj-id',
        object: { name: 'DS2 Object' },
      });

      await objectDao.deleteDatastoreItem(datasourceId1, 'shared-obj-id');

      const rows1 = await testDb('datastore').where(
        'datasource_id',
        datasourceId1,
      );
      const rows2 = await testDb('datastore').where(
        'datasource_id',
        datasourceId2,
      );
      expect(rows1).toHaveLength(0);
      expect(rows2).toHaveLength(1);
    });

    it('should handle deletion of non-existent item gracefully', async () => {
      const datasourceId = randomUUID();

      await expect(
        objectDao.deleteDatastoreItem(datasourceId, 'non-existent'),
      ).resolves.not.toThrow();
    });
  });

  describe('replaceDatastoreItems', () => {
    it('should replace all items for a datasource', async () => {
      const datasourceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'old-obj-1',
        object: { name: 'Old 1' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'old-obj-2',
        object: { name: 'Old 2' },
      });

      const newItems = [
        {
          id: randomUUID(),
          datasourceId,
          objectId: 'new-obj-1',
          object: { name: 'New 1' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: randomUUID(),
          datasourceId,
          objectId: 'new-obj-2',
          object: { name: 'New 2' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      await datastoreRepository.replaceDatasourceItems(datasourceId, newItems);

      const rows = await testDb('datastore').where(
        'datasource_id',
        datasourceId,
      );
      expect(rows).toHaveLength(2);
      expect(rows.map(r => r.object_id).sort()).toEqual([
        'new-obj-1',
        'new-obj-2',
      ]);
    });

    it('should deduplicate duplicate objectIds, keeping the last occurrence', async () => {
      const datasourceId = randomUUID();

      const newItems = [
        {
          id: randomUUID(),
          datasourceId,
          objectId: 'same-id',
          object: { name: 'First' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: randomUUID(),
          datasourceId,
          objectId: 'other-id',
          object: { name: 'Other' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: randomUUID(),
          datasourceId,
          objectId: 'same-id',
          object: { name: 'Last wins' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      await datastoreRepository.replaceDatasourceItems(datasourceId, newItems, {
        duplicateObjectIdStrategy: 'keep_last',
      });

      const rows = await testDb('datastore').where(
        'datasource_id',
        datasourceId,
      );
      expect(rows).toHaveLength(2);
      const sameRow = rows.find(r => r.object_id === 'same-id');
      expect(sameRow).toBeDefined();
      const body =
        typeof sameRow!.object === 'string'
          ? JSON.parse(sameRow!.object)
          : sameRow!.object;
      expect(body).toMatchObject({ name: 'Last wins' });
    });

    it('should reject duplicate objectIds when strategy is fail', async () => {
      const datasourceId = randomUUID();
      const newItems = [
        {
          id: randomUUID(),
          datasourceId,
          objectId: 'dup',
          object: { name: 'A' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: randomUUID(),
          datasourceId,
          objectId: 'dup',
          object: { name: 'B' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      await expect(
        datastoreRepository.replaceDatasourceItems(datasourceId, newItems, {
          duplicateObjectIdStrategy: 'fail',
        }),
      ).rejects.toThrow(/Duplicate objectId values/);
    });

    it('should not affect items from other datasources', async () => {
      const datasourceId1 = randomUUID();
      const datasourceId2 = randomUUID();

      await insertDatastoreObject({
        datasourceId: datasourceId1,
        objectId: 'ds1-obj',
        object: { name: 'DS1 Object' },
      });
      await insertDatastoreObject({
        datasourceId: datasourceId2,
        objectId: 'ds2-obj',
        object: { name: 'DS2 Object' },
      });

      await datastoreRepository.replaceDatasourceItems(datasourceId1, [
        {
          id: randomUUID(),
          datasourceId: datasourceId1,
          objectId: 'ds1-new-obj',
          object: { name: 'DS1 New' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const rows2 = await testDb('datastore').where(
        'datasource_id',
        datasourceId2,
      );
      expect(rows2).toHaveLength(1);
      expect(rows2[0].object_id).toBe('ds2-obj');
    });

    it('should create indexes for new items', async () => {
      const datasourceId = randomUUID();
      await insertIndexConfiguration({
        datasourceId,
        key: 'name',
        valueExpression: 'name',
      });

      await datastoreRepository.replaceDatasourceItems(datasourceId, [
        {
          datasourceId,
          objectId: 'new-obj',
          object: { name: 'Indexed Name' },
        },
      ]);

      const [row] = await testDb('datastore').where({
        datasource_id: datasourceId,
        object_id: 'new-obj',
      });
      const indexes = await testDb('datastore_index').where(
        'datastore_id',
        row.id,
      );
      expect(indexes).toHaveLength(1);
      expect(indexes[0].key).toBe('name');
      expect(indexes[0].value).toBe('Indexed Name');
    });

    it('should handle empty replacement list', async () => {
      const datasourceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'old-obj',
        object: { name: 'Old' },
      });

      await datastoreRepository.replaceDatasourceItems(datasourceId, []);

      const rows = await testDb('datastore').where(
        'datasource_id',
        datasourceId,
      );
      expect(rows).toHaveLength(0);
    });

    it('should remove old indexes and create new ones when replacing items', async () => {
      const datasourceId = randomUUID();
      const configId = await insertIndexConfiguration({
        datasourceId,
        key: 'name',
        valueExpression: 'name',
      });

      const oldItemId = await insertDatastoreObject({
        datasourceId,
        objectId: 'old-obj',
        object: { name: 'Old Name' },
      });
      await insertIndex({
        datastoreId: oldItemId,
        configId,
        key: 'name',
        value: 'Old Name',
      });
      const indexesBefore = await testDb('datastore_index').where(
        'datastore_id',
        oldItemId,
      );
      expect(indexesBefore).toHaveLength(1);
      expect(indexesBefore[0].value).toBe('Old Name');

      await datastoreRepository.replaceDatasourceItems(datasourceId, [
        {
          datasourceId,
          objectId: 'new-obj',
          object: { name: 'New Name' },
        },
      ]);

      const oldIndexes = await testDb('datastore_index').where(
        'datastore_id',
        oldItemId,
      );
      expect(oldIndexes).toHaveLength(0);

      const [newRow] = await testDb('datastore').where({
        datasource_id: datasourceId,
        object_id: 'new-obj',
      });
      const newIndexes = await testDb('datastore_index').where(
        'datastore_id',
        newRow.id,
      );
      expect(newIndexes).toHaveLength(1);
      expect(newIndexes[0].key).toBe('name');
      expect(newIndexes[0].value).toBe('New Name');
    });

    it('re-applies context-aware integration-backed rules after rebuilding prerequisite edges', async () => {
      const logger = mockServices.logger.mock();
      const repo = new DatastoreRepository({
        knex: testDb,
        logger,
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async ({ path }) => {
          if (path !== '/repos/acme/widget-service/commits/abc1234/pulls') {
            throw new Error(`unexpected path ${path}`);
          }
          return [
            {
              merge_commit_sha: 'abc1234000000000000000000000000000000000',
            },
          ];
        },
      });

      const podDs = randomUUID();
      const ecrDs = randomUUID();
      const githubRepoDs = randomUUID();
      const prDs = randomUUID();
      const podObjectId = 'team-a/widget-service-6cbf9d7c4-x2n8p';

      await insertDatastoreObject({
        datasourceId: podDs,
        objectId: podObjectId,
        object: {
          id: podObjectId,
          image_repo: 'widget-service',
          git_sha: 'abc1234',
        },
      });
      await insertDatastoreObject({
        datasourceId: ecrDs,
        objectId: 'widget-service',
        object: {
          repository_name: 'widget-service',
        },
      });
      await insertDatastoreObject({
        datasourceId: githubRepoDs,
        objectId: '123456789',
        object: {
          name: 'widget-service',
          full_name: 'acme/widget-service',
        },
      });
      await insertDatastoreObject({
        datasourceId: prDs,
        objectId: 'acme/widget-service#42',
        object: {
          merge_commit_sha: 'abc1234000000000000000000000000000000000',
          base: { repo: { full_name: 'acme/widget-service' } },
        },
      });

      const contextAwareRule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'pod-to-pr-via-graph',
          sourceDatasourceId: podDs,
          targetDatasourceId: prDs,
          sourceFieldExpression: '$.git_sha',
          targetFieldExpression: '$.merge_commit_sha',
          relationshipType: 'deployedFromPullRequestViaGraph',
          reciprocalRelationshipType: 'deployedInPodsViaGraph',
          strategy: 'integration-backed',
          integrationConfig: {
            integrationId: 'github',
            method: 'GET',
            path: '/unused/{value}',
            pathExpression:
              '"/repos/" & related[relationshipType="builtFromGithubRepository"].object.full_name[0] & "/commits/" & sourceValue & "/pulls"',
            sourceContext: {
              maxDepth: 2,
              relationshipTypes: [
                'runsImageFromRepository',
                'builtFromGithubRepository',
              ],
            },
            responseMatchExpression: '$distinct(merge_commit_sha)',
          },
        },
        { origin: 'test', state: 'active' },
      );

      const podToRepoRule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'pod-to-ecr-repo',
          sourceDatasourceId: podDs,
          targetDatasourceId: ecrDs,
          sourceFieldExpression: '$.image_repo',
          targetFieldExpression: '$.repository_name',
          relationshipType: 'runsImageFromRepository',
          reciprocalRelationshipType: 'hasRunningPod',
          matchStrategy: 'exact',
        },
        { origin: 'test', state: 'active' },
      );

      const repoToGithubRule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'ecr-to-github-repo',
          sourceDatasourceId: ecrDs,
          targetDatasourceId: githubRepoDs,
          sourceFieldExpression: '$.repository_name',
          targetFieldExpression: '$.name',
          relationshipType: 'builtFromGithubRepository',
          reciprocalRelationshipType: 'hasEcrRepository',
          matchStrategy: 'exact',
        },
        { origin: 'test', state: 'active' },
      );

      await repo.applyRelationshipRule(podToRepoRule.id);
      await repo.applyRelationshipRule(repoToGithubRule.id);
      await repo.applyRelationshipRule(contextAwareRule.id);

      let currentRelationships =
        await relationshipDao.queryRelationshipsBySource(podDs, podObjectId, {
          relationshipType: 'deployedFromPullRequestViaGraph',
        });
      expect(currentRelationships.total).toBe(1);

      await repo.replaceDatasourceItems(podDs, [
        {
          datasourceId: podDs,
          objectId: podObjectId,
          object: {
            id: podObjectId,
            image_repo: 'widget-service',
            git_sha: 'abc1234',
          },
        },
      ]);
      await repo.flushAutoApplyForTesting();

      currentRelationships = await relationshipDao.queryRelationshipsBySource(
        podDs,
        podObjectId,
        { relationshipType: 'deployedFromPullRequestViaGraph' },
      );
      expect(currentRelationships.total).toBe(1);
      expect(currentRelationships.items[0].destinationObjectId).toBe(
        'acme/widget-service#42',
      );

      const podObject = await objectDao.getDatastoreItem(podDs, podObjectId);
      expect(currentRelationships.items[0].sourceDatastoreId).toBe(
        podObject?.id,
      );
    });

    it('re-applies context-aware integration-backed rules when sourceContext omits relationshipTypes', async () => {
      const logger = mockServices.logger.mock();
      const repo = new DatastoreRepository({
        knex: testDb,
        logger,
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async ({ path }) => {
          if (path !== '/repos/acme/widget-service/commits/abc1234/pulls') {
            throw new Error(`unexpected path ${path}`);
          }
          return [
            {
              merge_commit_sha: 'abc1234000000000000000000000000000000000',
            },
          ];
        },
      });

      const podDs = randomUUID();
      const ecrDs = randomUUID();
      const githubRepoDs = randomUUID();
      const prDs = randomUUID();
      const podObjectId = 'team-a/widget-service-6cbf9d7c4-x2n8p';

      await insertDatastoreObject({
        datasourceId: podDs,
        objectId: podObjectId,
        object: {
          id: podObjectId,
          image_repo: 'widget-service',
          git_sha: 'abc1234',
        },
      });
      await insertDatastoreObject({
        datasourceId: ecrDs,
        objectId: 'widget-service',
        object: {
          repository_name: 'widget-service',
        },
      });
      await insertDatastoreObject({
        datasourceId: githubRepoDs,
        objectId: '123456789',
        object: {
          name: 'widget-service',
          full_name: 'acme/widget-service',
        },
      });
      await insertDatastoreObject({
        datasourceId: prDs,
        objectId: 'acme/widget-service#42',
        object: {
          merge_commit_sha: 'abc1234000000000000000000000000000000000',
          base: { repo: { full_name: 'acme/widget-service' } },
        },
      });

      const contextAwareRule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'pod-to-pr-via-graph-no-type-filter',
          sourceDatasourceId: podDs,
          targetDatasourceId: prDs,
          sourceFieldExpression: '$.git_sha',
          targetFieldExpression: '$.merge_commit_sha',
          relationshipType: 'deployedFromPullRequestViaGraph',
          reciprocalRelationshipType: 'deployedInPodsViaGraph',
          strategy: 'integration-backed',
          integrationConfig: {
            integrationId: 'github',
            method: 'GET',
            path: '/unused/{value}',
            pathExpression:
              '"/repos/" & related[relationshipType="builtFromGithubRepository"].object.full_name[0] & "/commits/" & sourceValue & "/pulls"',
            sourceContext: {
              maxDepth: 2,
            },
            responseMatchExpression: '$distinct(merge_commit_sha)',
          },
        },
        { origin: 'test', state: 'active' },
      );

      const podToRepoRule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'pod-to-ecr-repo',
          sourceDatasourceId: podDs,
          targetDatasourceId: ecrDs,
          sourceFieldExpression: '$.image_repo',
          targetFieldExpression: '$.repository_name',
          relationshipType: 'runsImageFromRepository',
          reciprocalRelationshipType: 'hasRunningPod',
          matchStrategy: 'exact',
        },
        { origin: 'test', state: 'active' },
      );

      const repoToGithubRule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'ecr-to-github-repo',
          sourceDatasourceId: ecrDs,
          targetDatasourceId: githubRepoDs,
          sourceFieldExpression: '$.repository_name',
          targetFieldExpression: '$.name',
          relationshipType: 'builtFromGithubRepository',
          reciprocalRelationshipType: 'hasEcrRepository',
          matchStrategy: 'exact',
        },
        { origin: 'test', state: 'active' },
      );

      await repo.applyRelationshipRule(podToRepoRule.id);
      await repo.applyRelationshipRule(repoToGithubRule.id);
      await repo.applyRelationshipRule(contextAwareRule.id);

      let currentRelationships =
        await relationshipDao.queryRelationshipsBySource(podDs, podObjectId, {
          relationshipType: 'deployedFromPullRequestViaGraph',
        });
      expect(currentRelationships.total).toBe(1);

      await repo.replaceDatasourceItems(podDs, [
        {
          datasourceId: podDs,
          objectId: podObjectId,
          object: {
            id: podObjectId,
            image_repo: 'widget-service',
            git_sha: 'abc1234',
          },
        },
      ]);
      await repo.flushAutoApplyForTesting();

      currentRelationships = await relationshipDao.queryRelationshipsBySource(
        podDs,
        podObjectId,
        { relationshipType: 'deployedFromPullRequestViaGraph' },
      );
      expect(currentRelationships.total).toBe(1);
      expect(currentRelationships.items[0].destinationObjectId).toBe(
        'acme/widget-service#42',
      );
    });

    it('re-applies context-aware integration-backed rules when sourceContext.relationshipTypes is empty', async () => {
      const logger = mockServices.logger.mock();
      const repo = new DatastoreRepository({
        knex: testDb,
        logger,
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async ({ path }) => {
          if (path !== '/repos/acme/widget-service/commits/abc1234/pulls') {
            throw new Error(`unexpected path ${path}`);
          }
          return [
            {
              merge_commit_sha: 'abc1234000000000000000000000000000000000',
            },
          ];
        },
      });

      const podDs = randomUUID();
      const ecrDs = randomUUID();
      const githubRepoDs = randomUUID();
      const prDs = randomUUID();
      const podObjectId = 'team-a/widget-service-6cbf9d7c4-x2n8p';

      await insertDatastoreObject({
        datasourceId: podDs,
        objectId: podObjectId,
        object: {
          id: podObjectId,
          image_repo: 'widget-service',
          git_sha: 'abc1234',
        },
      });
      await insertDatastoreObject({
        datasourceId: ecrDs,
        objectId: 'widget-service',
        object: {
          repository_name: 'widget-service',
        },
      });
      await insertDatastoreObject({
        datasourceId: githubRepoDs,
        objectId: '123456789',
        object: {
          name: 'widget-service',
          full_name: 'acme/widget-service',
        },
      });
      await insertDatastoreObject({
        datasourceId: prDs,
        objectId: 'acme/widget-service#42',
        object: {
          merge_commit_sha: 'abc1234000000000000000000000000000000000',
          base: { repo: { full_name: 'acme/widget-service' } },
        },
      });

      const contextAwareRule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'pod-to-pr-via-graph-empty-type-filter',
          sourceDatasourceId: podDs,
          targetDatasourceId: prDs,
          sourceFieldExpression: '$.git_sha',
          targetFieldExpression: '$.merge_commit_sha',
          relationshipType: 'deployedFromPullRequestViaGraph',
          reciprocalRelationshipType: 'deployedInPodsViaGraph',
          strategy: 'integration-backed',
          integrationConfig: {
            integrationId: 'github',
            method: 'GET',
            path: '/unused/{value}',
            pathExpression:
              '"/repos/" & related[relationshipType="builtFromGithubRepository"].object.full_name[0] & "/commits/" & sourceValue & "/pulls"',
            sourceContext: {
              maxDepth: 2,
              relationshipTypes: [],
            },
            responseMatchExpression: '$distinct(merge_commit_sha)',
          },
        },
        { origin: 'test', state: 'active' },
      );

      const podToRepoRule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'pod-to-ecr-repo',
          sourceDatasourceId: podDs,
          targetDatasourceId: ecrDs,
          sourceFieldExpression: '$.image_repo',
          targetFieldExpression: '$.repository_name',
          relationshipType: 'runsImageFromRepository',
          reciprocalRelationshipType: 'hasRunningPod',
          matchStrategy: 'exact',
        },
        { origin: 'test', state: 'active' },
      );

      const repoToGithubRule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'ecr-to-github-repo',
          sourceDatasourceId: ecrDs,
          targetDatasourceId: githubRepoDs,
          sourceFieldExpression: '$.repository_name',
          targetFieldExpression: '$.name',
          relationshipType: 'builtFromGithubRepository',
          reciprocalRelationshipType: 'hasEcrRepository',
          matchStrategy: 'exact',
        },
        { origin: 'test', state: 'active' },
      );

      await repo.applyRelationshipRule(podToRepoRule.id);
      await repo.applyRelationshipRule(repoToGithubRule.id);
      await repo.applyRelationshipRule(contextAwareRule.id);

      const currentRelationships =
        await relationshipDao.queryRelationshipsBySource(podDs, podObjectId, {
          relationshipType: 'deployedFromPullRequestViaGraph',
        });
      expect(currentRelationships.total).toBe(1);
      expect(currentRelationships.items[0].destinationObjectId).toBe(
        'acme/widget-service#42',
      );
    });

    it('traverses sourceContext edges filtered by their reciprocal relationship type', async () => {
      const logger = mockServices.logger.mock();
      const repo = new DatastoreRepository({
        knex: testDb,
        logger,
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async ({ path }) => {
          if (path !== '/pods/pod-1') {
            throw new Error(`unexpected path ${path}`);
          }
          return { pod_name: 'pod-x' };
        },
      });

      const ecrDs = randomUUID();
      const podDs = randomUUID();
      const podInfoDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: ecrDs,
        objectId: 'widget-service',
        object: { repository_name: 'widget-service' },
      });
      await insertDatastoreObject({
        datasourceId: podDs,
        objectId: 'pod-1',
        object: { id: 'pod-1', name: 'pod-x' },
      });
      await insertDatastoreObject({
        datasourceId: podInfoDs,
        objectId: 'pod-info-1',
        object: { pod_name: 'pod-x' },
      });

      // Stored edge is pod → ecr with the forward name; from the ECR repo's
      // perspective (the rule's source) the same edge reads 'hasRunningPod'.
      await insertRelationship({
        sourceDatasourceId: podDs,
        sourceObjectId: 'pod-1',
        destinationDatasourceId: ecrDs,
        destinationObjectId: 'widget-service',
        relationshipType: 'runsImageFromRepository',
        reciprocalRelationshipType: 'hasRunningPod',
      });

      const rule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'ecr-to-pod-info-via-reciprocal',
          sourceDatasourceId: ecrDs,
          targetDatasourceId: podInfoDs,
          sourceFieldExpression: '$.repository_name',
          targetFieldExpression: '$.pod_name',
          relationshipType: 'monitoredByPodInfo',
          strategy: 'integration-backed',
          integrationConfig: {
            integrationId: 'k8s',
            method: 'GET',
            path: '/unused/{value}',
            pathExpression: '"/pods/" & related[0].object.id',
            sourceContext: {
              maxDepth: 1,
              relationshipTypes: ['hasRunningPod'],
            },
            responseMatchExpression: 'pod_name',
          },
        },
        { origin: 'test', state: 'active' },
      );

      await repo.applyRelationshipRule(rule.id);

      const relationships = await relationshipDao.queryRelationshipsBySource(
        ecrDs,
        'widget-service',
        { relationshipType: 'monitoredByPodInfo' },
      );
      expect(relationships.total).toBe(1);
      expect(relationships.items[0].destinationObjectId).toBe('pod-info-1');
    });
  });

  describe('rebuildIndexes', () => {
    it('should build index entries for all items in the datasource', async () => {
      const datasourceId = randomUUID();
      const configId = await insertIndexConfiguration({
        datasourceId,
        key: 'name',
        valueExpression: 'name',
      });

      const item1Id = await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-1',
        object: { name: 'Alpha' },
      });
      const item2Id = await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-2',
        object: { name: 'Beta' },
      });

      await dao.rebuildIndexes(datasourceId, 'name');

      const indexes = await testDb('datastore_index').where(
        'datastore_index_configuration_id',
        configId,
      );
      expect(indexes).toHaveLength(2);
      expect(indexes.find(i => i.datastore_id === item1Id)?.value).toBe(
        'Alpha',
      );
      expect(indexes.find(i => i.datastore_id === item2Id)?.value).toBe('Beta');
    });

    it('should clear stale indexes before rebuilding', async () => {
      const datasourceId = randomUUID();
      const configId = await insertIndexConfiguration({
        datasourceId,
        key: 'name',
        valueExpression: 'name',
      });

      const oldItemId = await insertDatastoreObject({
        datasourceId,
        objectId: 'old-obj',
        object: { name: 'Old' },
      });
      await insertIndex({
        datastoreId: oldItemId,
        configId,
        key: 'name',
        value: 'Old',
      });

      await testDb('datastore').where('id', oldItemId).del();

      const newItemId = await insertDatastoreObject({
        datasourceId,
        objectId: 'new-obj',
        object: { name: 'New' },
      });

      await dao.rebuildIndexes(datasourceId, 'name');

      const indexes = await testDb('datastore_index').where(
        'datastore_index_configuration_id',
        configId,
      );
      expect(indexes).toHaveLength(1);
      expect(indexes[0].datastore_id).toBe(newItemId);
      expect(indexes[0].value).toBe('New');
    });

    it('should throw when index configuration does not exist', async () => {
      const datasourceId = randomUUID();
      await expect(
        dao.rebuildIndexes(datasourceId, 'nonexistent'),
      ).rejects.toThrow(`Index configuration not found for key 'nonexistent'`);
    });
  });

  describe('search', () => {
    it('should return empty results when no data exists', async () => {
      const result = await objectDao.search({ q: 'nonexistent' });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return matching results', async () => {
      const datasourceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-1',
        object: { name: 'PostgreSQL Database', type: 'service' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-2',
        object: { name: 'MySQL Database', type: 'service' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-3',
        object: { name: 'Redis Cache', type: 'cache' },
      });

      const result = await objectDao.search({ q: 'database' });

      expect(result.items).toHaveLength(2);
      expect(result.items.map(i => i.objectId).sort()).toEqual([
        'obj-1',
        'obj-2',
      ]);
      expect(result.total).toBe(2);
    });

    it('should search across datasources by default', async () => {
      const datasourceId1 = randomUUID();
      const datasourceId2 = randomUUID();

      await insertDatastoreObject({
        datasourceId: datasourceId1,
        objectId: 'obj-1',
        object: { name: 'Service Alpha' },
      });
      await insertDatastoreObject({
        datasourceId: datasourceId2,
        objectId: 'obj-2',
        object: { name: 'Service Beta' },
      });

      const result = await objectDao.search({ q: 'service' });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should filter by datasourceIds when provided', async () => {
      const datasourceId1 = randomUUID();
      const datasourceId2 = randomUUID();

      await insertDatastoreObject({
        datasourceId: datasourceId1,
        objectId: 'obj-1',
        object: { name: 'Service Alpha' },
      });
      await insertDatastoreObject({
        datasourceId: datasourceId2,
        objectId: 'obj-2',
        object: { name: 'Service Beta' },
      });

      const result = await objectDao.search({
        q: 'service',
        datasourceIds: [datasourceId1],
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].objectId).toBe('obj-1');
      expect(result.total).toBe(1);
    });

    it('should support phrase search with quotes', async () => {
      const datasourceId = randomUUID();

      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-1',
        object: { description: 'The quick brown fox jumps' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-2',
        object: { description: 'Quick service for brown operations' },
      });

      const result = await objectDao.search({ q: '"quick brown"' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].objectId).toBe('obj-1');
    });

    it('should support negation with minus sign', async () => {
      const datasourceId = randomUUID();

      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-1',
        object: { name: 'Production Service' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-2',
        object: { name: 'Staging Service' },
      });

      const result = await objectDao.search({ q: 'service -staging' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].objectId).toBe('obj-1');
    });

    it('should match prefixes of words for partial typing', async () => {
      const datasourceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-1',
        object: { name: 'PostgreSQL Database' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-2',
        object: { name: 'Redis Cache' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-3',
        object: { email: 'alice@example.com' },
      });

      // Partial word prefix matches the longer token.
      const byPrefix = await objectDao.search({ q: 'Postg' });
      expect(byPrefix.items.map(i => i.objectId)).toEqual(['obj-1']);

      // Tokens inside an email address (tsvector splits on punctuation).
      const byEmailPrefix = await objectDao.search({ q: 'ali' });
      expect(byEmailPrefix.items.map(i => i.objectId)).toEqual(['obj-3']);
    });

    it('should match mid-word substrings (trigram index)', async () => {
      const datasourceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-balmont',
        object: { city: 'Balmont' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-charles-legall',
        object: { username: 'charles.legall' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-other',
        object: { name: 'Unrelated' },
      });

      const midWord = await objectDao.search({ q: 'almont' });
      expect(midWord.items.map(i => i.objectId)).toEqual(['obj-balmont']);

      const insideEmailLike = await objectDao.search({ q: 'legall' });
      expect(insideEmailLike.items.map(i => i.objectId)).toEqual([
        'obj-charles-legall',
      ]);
    });

    it('should not bleed across unrelated words via English stemming', async () => {
      // Under the `english` text-search config, `charles` stems to `charl`
      // and `charlotte` stems to `charlott`, so `charles:*` would (wrongly)
      // match the Charlotte document. The `simple` config we use leaves
      // words intact, so this test pins that behaviour.
      const datasourceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-charlotte',
        object: {
          name: { first: 'Charlotte', last: 'Fields' },
          email: 'charlotte.fields@example.com',
        },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-charles',
        object: { name: { first: 'Charles', last: 'Davies' } },
      });

      const result = await objectDao.search({ q: 'charles' });

      expect(result.items.map(i => i.objectId)).toEqual(['obj-charles']);
    });

    it('should respect limit parameter', async () => {
      const datasourceId = randomUUID();

      for (let i = 0; i < 10; i++) {
        await insertDatastoreObject({
          datasourceId,
          objectId: `obj-${i}`,
          object: { name: `Service ${i}` },
        });
      }

      const result = await objectDao.search({ q: 'service', limit: 3 });

      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(10);
    });

    it('should respect offset parameter', async () => {
      const datasourceId = randomUUID();

      for (let i = 0; i < 10; i++) {
        await insertDatastoreObject({
          datasourceId,
          objectId: `obj-${i}`,
          object: { name: `Service ${i}` },
        });
      }

      const result = await objectDao.search({
        q: 'service',
        limit: 3,
        offset: 5,
      });

      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(10);
    });

    it('should use default limit of 50', async () => {
      const datasourceId = randomUUID();

      for (let i = 0; i < 60; i++) {
        await insertDatastoreObject({
          datasourceId,
          objectId: `obj-${i}`,
          object: { name: `Service ${i}` },
        });
      }

      const result = await objectDao.search({ q: 'service' });

      expect(result.items).toHaveLength(50);
      expect(result.total).toBe(60);
    });

    it('should include explain plans when explain option is true', async () => {
      const datasourceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-1',
        object: { name: 'Test Service' },
      });

      const result = (await objectDao.search({
        q: 'service',
        explain: true,
      })) as {
        items: unknown[];
        total: number;
        explain: { items: unknown };
      };

      expect(result.explain).toBeDefined();
      expect(result.explain.items).toBeDefined();
    });

    it('should search nested JSON fields', async () => {
      const datasourceId = randomUUID();

      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-1',
        object: {
          metadata: {
            labels: { environment: 'production' },
            owner: 'platform-team',
          },
        },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-2',
        object: {
          metadata: {
            labels: { environment: 'staging' },
            owner: 'dev-team',
          },
        },
      });

      const result = await objectDao.search({ q: 'platform-team' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].objectId).toBe('obj-1');
    });

    it('should search numeric values converted to strings', async () => {
      const datasourceId = randomUUID();

      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-1',
        object: { port: 8080, name: 'Web Server' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj-2',
        object: { port: 3000, name: 'API Server' },
      });

      const result = await objectDao.search({ q: '8080' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].objectId).toBe('obj-1');
    });

    it('should filter by multiple datasourceIds', async () => {
      const datasourceId1 = randomUUID();
      const datasourceId2 = randomUUID();
      const datasourceId3 = randomUUID();

      await insertDatastoreObject({
        datasourceId: datasourceId1,
        objectId: 'obj-1',
        object: { name: 'Service One' },
      });
      await insertDatastoreObject({
        datasourceId: datasourceId2,
        objectId: 'obj-2',
        object: { name: 'Service Two' },
      });
      await insertDatastoreObject({
        datasourceId: datasourceId3,
        objectId: 'obj-3',
        object: { name: 'Service Three' },
      });

      const result = await objectDao.search({
        q: 'service',
        datasourceIds: [datasourceId1, datasourceId2],
      });

      expect(result.items).toHaveLength(2);
      expect(result.items.map(i => i.objectId).sort()).toEqual([
        'obj-1',
        'obj-2',
      ]);
    });
  });

  describe('applyRelationshipRule', () => {
    beforeEach(async () => {
      await testDb('datastore_relation').del();
      await testDb('datastore_relationship_rule').del();
      await testDb('datastore_index').del();
      await testDb('datastore').del();
    });

    async function createRule(
      input: Omit<
        Parameters<typeof relationshipRuleDao.createRelationshipRule>[0],
        'name'
      > & {
        name?: string;
      },
    ) {
      return relationshipRuleDao.createRelationshipRule(
        {
          name: 'test-rule',
          ...input,
        },
        { origin: 'test' },
      );
    }

    it('exact: matches objects where field values are identical', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { owner: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-x',
        object: { name: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-y',
        object: { name: 'team-y' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'owner',
        targetFieldExpression: 'name',
        relationshipType: 'ownedBy',
        matchStrategy: 'exact',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 1, deleted: 0 });

      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(1);
      expect(relationships[0].source_object_id).toBe('svc-a');
      expect(relationships[0].destination_object_id).toBe('team-x');
    });

    it('dry-run: field-matching computes candidates without writing', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { owner: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-x',
        object: { name: 'team-x' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'owner',
        targetFieldExpression: 'name',
        relationshipType: 'ownedBy',
        matchStrategy: 'exact',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id, {
        dryRun: true,
      });

      expect(result.created).toBe(1);
      expect(result.deleted).toBe(0);
      expect(result.truncated).toBe(false);
      expect(result.candidates).toEqual([
        {
          sourceObjectId: 'svc-a',
          destinationObjectId: 'team-x',
          relationshipType: 'ownedBy',
          metadata: null,
        },
      ]);

      // Nothing was written.
      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(0);
    });

    it('dry-run: field-matching processes every source when sampleLimit is omitted', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      for (let i = 0; i < 26; i += 1) {
        await insertDatastoreObject({
          datasourceId: srcDs,
          objectId: `svc-${i}`,
          object: { owner: 'team-x' },
        });
      }
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-x',
        object: { name: 'team-x' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'owner',
        targetFieldExpression: 'name',
        relationshipType: 'ownedBy',
        matchStrategy: 'exact',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id, {
        dryRun: true,
      });

      expect(result.created).toBe(26);
      expect(result.truncated).toBe(false);
      expect(result.sampled).toBe(26);
      expect(result.candidates).toHaveLength(26);
    });

    it('dry-run: integration-backed returns candidates and skipped sources without writing', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async args => {
          if (args.path !== '/users/alice') {
            throw new Error(`unexpected path ${args.path}`);
          }
          return { profile: { name: 'Alice Smith' } };
        },
      });

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { login: 'alice' },
      });
      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-c',
        object: { login: 'carol' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-alice',
        object: { profile: { name: 'Alice Smith' } },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'login',
        targetFieldExpression: 'profile.name',
        relationshipType: 'resolvedTo',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/unused/{value}',
          // 'carol' produces an empty path → that source is skipped.
          pathExpression:
            "sourceValue = 'carol' ? '' : '/users/' & sourceValue",
          responseMatchExpression: 'profile.name',
        },
      });

      const result = await repository.applyRelationshipRule(rule.id, {
        dryRun: true,
      });

      expect(result.created).toBe(1);
      expect(result.deleted).toBe(0);
      expect(result.candidates).toEqual([
        {
          sourceObjectId: 'svc-a',
          destinationObjectId: 'user-alice',
          relationshipType: 'resolvedTo',
          metadata: null,
          matchValue: 'Alice Smith',
          matchSourceValue: 'alice',
        },
      ]);
      expect(result.skippedSources).toEqual(['svc-c']);

      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(0);
    });

    it('dry-run: sampleLimit bounds the source rows processed and sets truncated', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async () => ({ name: 'match' }),
      });

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { login: 'a' },
      });
      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-b',
        object: { login: 'b' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'target',
        object: { name: 'match' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'login',
        targetFieldExpression: 'name',
        relationshipType: 'resolvedTo',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/lookup/{value}',
          responseMatchExpression: 'name',
        },
      });

      const result = await repository.applyRelationshipRule(rule.id, {
        dryRun: true,
        sampleLimit: 1,
      });

      expect(result.sampled).toBe(1);
      expect(result.truncated).toBe(true);
      expect(result.candidates).toHaveLength(1);

      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(0);
    });

    it('dry-run: defaults sampleLimit to 25 when omitted', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      let integrationCalls = 0;
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async () => {
          integrationCalls += 1;
          return { name: 'match' };
        },
      });

      for (let i = 0; i < 26; i += 1) {
        await insertDatastoreObject({
          datasourceId: srcDs,
          objectId: `svc-${i}`,
          object: { login: `user-${i}` },
        });
      }
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'target',
        object: { name: 'match' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'login',
        targetFieldExpression: 'name',
        relationshipType: 'resolvedTo',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/lookup/{value}',
          responseMatchExpression: 'name',
        },
      });

      const result = await repository.applyRelationshipRule(rule.id, {
        dryRun: true,
      });

      expect(result.sampled).toBe(25);
      expect(result.truncated).toBe(true);
      expect(integrationCalls).toBe(25);
    });

    it('dry-run: bounds outbound calls from an array-valued source expression', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      let integrationCalls = 0;
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async () => {
          integrationCalls += 1;
          return { name: 'match' };
        },
      });

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-many',
        object: {
          logins: Array.from({ length: 51 }, (_, index) => `user-${index}`),
        },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'target',
        object: { name: 'match' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'logins',
        targetFieldExpression: 'name',
        relationshipType: 'resolvedTo',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/lookup/{value}',
          responseMatchExpression: 'name',
        },
      });

      const result = await repository.applyRelationshipRule(rule.id, {
        dryRun: true,
      });

      expect(integrationCalls).toBe(50);
      expect(result.callLimitReached).toBe(true);
      expect(result.truncated).toBe(true);
      // The budget is hit on the 51st value, but this source's earlier
      // successful lookups already resolved an edge — it's retained (finalized
      // before stopping) rather than discarded, so the preview still reflects
      // what was actually fetched.
      expect(result.sampled).toBe(1);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates?.[0]).toMatchObject({
        sourceObjectId: 'svc-many',
        destinationObjectId: 'target',
        relationshipType: 'resolvedTo',
      });
    });

    it("integration-backed: keeps all of a source's existing edges when one of its values fails on re-apply", async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      let failBob = false;
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async ({ path }) => {
          if (path === '/users/alice') {
            return { name: 'Alice' };
          }
          if (path === '/users/bob') {
            if (failBob) {
              throw new Error('bob lookup unavailable');
            }
            return { name: 'Bob' };
          }
          throw new Error(`unexpected path ${path}`);
        },
      });

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { logins: ['alice', 'bob'] },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-alice',
        object: { name: 'Alice' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-bob',
        object: { name: 'Bob' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'logins',
        targetFieldExpression: 'name',
        relationshipType: 'resolvedTo',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/users/{value}',
          responseMatchExpression: 'name',
        },
      });

      await repository.applyRelationshipRule(rule.id);

      let relationships = await testDb('datastore_relation')
        .where('rule_id', rule.id)
        .orderBy('destination_object_id');
      expect(relationships.map(r => r.destination_object_id)).toEqual([
        'user-alice',
        'user-bob',
      ]);

      // One of the source's values now fails — the run's view of the source is
      // incomplete, so its previously materialized edges must all survive.
      failBob = true;
      await repository.applyRelationshipRule(rule.id);

      relationships = await testDb('datastore_relation')
        .where('rule_id', rule.id)
        .orderBy('destination_object_id');
      expect(relationships.map(r => r.destination_object_id)).toEqual([
        'user-alice',
        'user-bob',
      ]);
    });

    it('dry-run: integration-backed skips a source whose values only partially resolve', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async ({ path }) => {
          if (path === '/users/alice') {
            return { name: 'Alice' };
          }
          throw new Error(`unexpected path ${path}`);
        },
      });

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { logins: ['alice', 'bob'] },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-alice',
        object: { name: 'Alice' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'logins',
        targetFieldExpression: 'name',
        relationshipType: 'resolvedTo',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/users/{value}',
          responseMatchExpression: 'name',
        },
      });

      const result = await repository.applyRelationshipRule(rule.id, {
        dryRun: true,
      });

      expect(result.candidates).toEqual([]);
      expect(result.skippedSources).toEqual(['svc-a']);
    });

    it('integration-backed preview honors limit and offset', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      const integrationCalls: string[] = [];
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async args => {
          integrationCalls.push(args.path);
          return { name: 'match' };
        },
      });

      for (const [objectId, login] of [
        ['svc-a', 'a'],
        ['svc-b', 'b'],
        ['svc-c', 'c'],
      ] as const) {
        await insertDatastoreObject({
          datasourceId: srcDs,
          objectId,
          object: { login },
        });
      }
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'target',
        object: { name: 'match' },
      });

      const result = await repository.previewRelationshipRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'login',
        targetFieldExpression: 'name',
        relationshipType: 'resolvedTo',
        matchStrategy: 'exact',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/lookup/{value}',
          responseMatchExpression: 'name',
        },
        limit: 1,
        offset: 1,
      });

      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].sourceObjectId).toBe('svc-b');
      expect(integrationCalls).toEqual(['/lookup/b']);
      expect(result.truncated).toBe(true);
      // The preview surfaces the matched value and a human target label so the
      // UI shows the match, not raw object ids.
      expect(result.items[0].targetObjectIds).toEqual(['target']);
      expect(result.items[0].matchTargetValues).toEqual(['match']);
      expect(result.items[0].targetValue).toBe('match');
      expect(result.items[0].targetLabels).toEqual(['match']);
      expect(result.items[0].sourceLabel).toBe('svc-b');
      expect(result.items[0].sourceValue).toBe('b');
      expect(result.items[0].matchSourceValues).toEqual(['b']);
      expect(result.responseSample).toEqual({
        sourceObjectId: 'svc-b',
        sourceValue: 'b',
        path: '/lookup/b',
        data: { name: 'match' },
      });
    });

    it('integration-backed preview evaluates an exact source object outside the current page', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      const integrationCalls: string[] = [];
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async args => {
          integrationCalls.push(args.path);
          return { name: 'match' };
        },
      });

      for (const [objectId, login] of [
        ['svc-a', 'a'],
        ['svc-b', 'b'],
        ['svc-c', 'c'],
      ] as const) {
        await insertDatastoreObject({
          datasourceId: srcDs,
          objectId,
          object: { login },
        });
      }
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'target',
        object: { name: 'match' },
      });

      const result = await repository.previewRelationshipRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'login',
        targetFieldExpression: 'name',
        relationshipType: 'resolvedTo',
        matchStrategy: 'exact',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/lookup/{value}',
          responseMatchExpression: 'name',
        },
        sourceObjectId: 'svc-c',
        limit: 1,
        offset: 0,
      });

      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].sourceObjectId).toBe('svc-c');
      expect(integrationCalls).toEqual(['/lookup/c']);
      expect(result.truncated).toBe(false);
    });

    it('field-matching preview evaluates an exact source object outside the current page', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      for (const [objectId, owner] of [
        ['svc-a', 'team-a'],
        ['svc-b', 'team-b'],
        ['svc-c', 'team-c'],
      ] as const) {
        await insertDatastoreObject({
          datasourceId: srcDs,
          objectId,
          object: { owner },
        });
      }
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-c',
        object: { name: 'team-c' },
      });

      const result = await datastoreRepository.previewRelationshipRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'owner',
        targetFieldExpression: 'name',
        relationshipType: 'ownedBy',
        matchStrategy: 'exact',
        sourceObjectId: 'svc-c',
        limit: 1,
        offset: 0,
      });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].sourceObjectId).toBe('svc-c');
      expect(result.items[0].targetObjectIds).toEqual(['team-c']);
    });

    it('integration-backed preview falls back to the matched value when the target has no label', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        // The response-match value ('octocat') is the target's login, which is
        // also the target field being matched on.
        callIntegration: async () => ({ author: { login: 'octocat' } }),
      });

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'RoadieHQ/roadie',
        object: { full_name: 'RoadieHQ/roadie' },
      });
      // Target has no name/title/metadata.name — readObjectLabel would fall back
      // to the object id, so the preview should use the matched login instead.
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: '553697',
        object: { login: 'octocat' },
      });

      const result = await repository.previewRelationshipRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'full_name',
        targetFieldExpression: 'login',
        relationshipType: 'lastCommittedBy',
        matchStrategy: 'exact',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/repos/{value}/commits',
          responseMatchExpression: 'author.login',
        },
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].targetObjectIds).toEqual(['553697']);
      expect(result.items[0].matchTargetValues).toEqual(['octocat']);
      // Not the bare object id '553697' — the matched login.
      expect(result.items[0].targetLabels).toEqual(['octocat']);
    });

    it('integration-backed preview returns truncated and skippedSources', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async args => {
          if (args.path === '/users/carol') {
            throw new Error('integration unavailable');
          }
          return { profile: { name: 'Alice Smith' } };
        },
      });

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { login: 'alice' },
      });
      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-c',
        object: { login: 'carol' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-alice',
        object: { profile: { name: 'Alice Smith' } },
      });

      const result = await repository.previewRelationshipRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'login',
        targetFieldExpression: 'profile.name',
        relationshipType: 'resolvedTo',
        matchStrategy: 'exact',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/users/{value}',
          responseMatchExpression: 'profile.name',
        },
        sampleLimit: 2,
      });

      expect(result.skippedSources).toEqual(['svc-c']);
      expect(result.truncated).toBe(false);
      expect(result.items).toEqual([
        {
          sourceObjectId: 'svc-a',
          relationshipType: 'resolvedTo',
          targetObjectIds: ['user-alice'],
          sourceValue: 'alice',
          matchSourceValues: ['alice'],
          targetValue: 'Alice Smith',
          matchTargetValues: ['Alice Smith'],
          sourceLabel: 'svc-a',
          targetLabels: ['Alice Smith'],
        },
      ]);
    });

    it('apply (not dry-run) ignores sampleLimit and processes every source', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { owner: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-b',
        object: { owner: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-x',
        object: { name: 'team-x' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'owner',
        targetFieldExpression: 'name',
        relationshipType: 'ownedBy',
        matchStrategy: 'exact',
      });

      // sampleLimit must be ignored on a real apply — otherwise the
      // delete-then-reinsert write would wipe the unsampled sources' edges.
      const result = await datastoreRepository.applyRelationshipRule(rule.id, {
        sampleLimit: 1,
      });

      expect(result).toEqual({ created: 2, deleted: 0 });
      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(2);
    });

    it('integration-backed: calls integrations, stores metadata, and rematerializes', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      const calls: Array<{
        integrationId: string;
        method: string;
        path: string;
        workspaceId: string;
      }> = [];
      let aliceVersion = 1;
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async args => {
          calls.push(args);
          if (args.path === '/users/bob') {
            throw new Error('integration unavailable (503)');
          }
          return {
            profile: { name: 'Alice Smith' },
            resolved: {
              login: 'alice',
              externalId: `alice-${aliceVersion}`,
            },
          };
        },
      });

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { login: 'alice' },
      });
      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-b',
        object: { login: 'bob' },
      });
      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-c',
        object: { login: 'alice' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-alice',
        object: { profile: { name: 'Alice Smith' } },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-bob',
        object: { profile: { name: 'Bob Smith' } },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'login',
        targetFieldExpression: 'profile.name',
        relationshipType: 'resolvedTo',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/users/{value}',
          responseMatchExpression: 'profile.name',
          metadataExpression: 'resolved',
        },
      });

      const first = await repository.applyRelationshipRule(rule.id);

      expect(first).toEqual({ created: 2, deleted: 0 });
      // The sealed engine streams sources ordered by datastore.id, so the
      // order distinct integration calls fire is deterministic-by-id rather
      // than by insertion; the SET of calls is what matters (memoized by path).
      expect([...calls].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
        {
          integrationId: 'integration-1',
          method: 'GET',
          path: '/users/alice',
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
        {
          integrationId: 'integration-1',
          method: 'GET',
          path: '/users/bob',
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      ]);

      const firstRelationships =
        await relationshipDao.listRelationshipsByRuleId(rule.id);
      expect(firstRelationships.items).toHaveLength(2);
      expect(firstRelationships.items.map(r => r.origin)).toEqual([
        'integration-backed',
        'integration-backed',
      ]);
      expect(firstRelationships.items.map(r => r.metadata)).toEqual([
        { login: 'alice', externalId: 'alice-1' },
        { login: 'alice', externalId: 'alice-1' },
      ]);

      calls.length = 0;
      aliceVersion = 2;
      const second = await repository.applyRelationshipRule(rule.id);

      expect(second).toEqual({ created: 2, deleted: 2 });
      expect([...calls].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
        {
          integrationId: 'integration-1',
          method: 'GET',
          path: '/users/alice',
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
        {
          integrationId: 'integration-1',
          method: 'GET',
          path: '/users/bob',
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      ]);
      const secondRelationships =
        await relationshipDao.listRelationshipsByRuleId(rule.id);
      expect(secondRelationships.items.map(r => r.metadata)).toEqual([
        { login: 'alice', externalId: 'alice-2' },
        { login: 'alice', externalId: 'alice-2' },
      ]);
    });

    it('integration-backed: skips a source value when pathExpression fails', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async args => {
          const name =
            args.path === '/users/alice' ? 'Alice Smith' : 'Carol Jones';
          return { profile: { name } };
        },
      });

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { login: 'alice' },
      });
      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-c',
        object: { login: 'carol' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-alice',
        object: { profile: { name: 'Alice Smith' } },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-carol',
        object: { profile: { name: 'Carol Jones' } },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'login',
        targetFieldExpression: 'profile.name',
        relationshipType: 'resolvedTo',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/unused/{value}',
          pathExpression:
            "sourceValue = 'carol' ? '' : '/users/' & sourceValue",
          responseMatchExpression: 'profile.name',
        },
      });

      const result = await repository.applyRelationshipRule(rule.id);
      expect(result).toEqual({ created: 1, deleted: 0 });

      const relationships = await relationshipDao.listRelationshipsByRuleId(
        rule.id,
      );
      expect(relationships.items).toHaveLength(1);
      expect(relationships.items[0]?.sourceObjectId).toBe('svc-a');
    });

    it('integration-backed: re-apply keeps edges when pathExpression fails for a source', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async args => {
          const name =
            args.path === '/users/alice' ? 'Alice Smith' : 'Carol Jones';
          return { profile: { name } };
        },
      });

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { login: 'alice' },
      });
      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-c',
        object: { login: 'carol' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-alice',
        object: { profile: { name: 'Alice Smith' } },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-carol',
        object: { profile: { name: 'Carol Jones' } },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'login',
        targetFieldExpression: 'profile.name',
        relationshipType: 'resolvedTo',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/unused/{value}',
          pathExpression: "'/users/' & sourceValue",
          responseMatchExpression: 'profile.name',
        },
      });

      const first = await repository.applyRelationshipRule(rule.id);
      expect(first).toEqual({ created: 2, deleted: 0 });

      await relationshipRuleDao.updateRelationshipRule(rule.id, {
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/unused/{value}',
          pathExpression:
            "sourceValue = 'carol' ? '' : '/users/' & sourceValue",
          responseMatchExpression: 'profile.name',
        },
      });

      const second = await repository.applyRelationshipRule(rule.id);
      expect(second).toEqual({ created: 1, deleted: 1 });

      const relationships = await relationshipDao.listRelationshipsByRuleId(
        rule.id,
      );
      expect(relationships.items).toHaveLength(2);
      expect(relationships.items.map(r => r.sourceObjectId).sort()).toEqual([
        'svc-a',
        'svc-c',
      ]);
    });

    it('integration-backed: re-apply keeps edges whose source call now fails', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      let failCarol = false;
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async args => {
          if (args.path === '/users/carol' && failCarol) {
            throw new Error('integration unavailable (503)');
          }
          const name =
            args.path === '/users/alice' ? 'Alice Smith' : 'Carol Jones';
          return { profile: { name } };
        },
      });

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { login: 'alice' },
      });
      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-c',
        object: { login: 'carol' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-alice',
        object: { profile: { name: 'Alice Smith' } },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-carol',
        object: { profile: { name: 'Carol Jones' } },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'login',
        targetFieldExpression: 'profile.name',
        relationshipType: 'resolvedTo',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/users/{value}',
          responseMatchExpression: 'profile.name',
        },
      });

      const first = await repository.applyRelationshipRule(rule.id);
      expect(first).toEqual({ created: 2, deleted: 0 });

      // carol's call now fails; her existing edge must survive the re-apply.
      failCarol = true;
      const second = await repository.applyRelationshipRule(rule.id);
      expect(second).toEqual({ created: 1, deleted: 1 });

      const relationships = await relationshipDao.listRelationshipsByRuleId(
        rule.id,
      );
      expect(relationships.items).toHaveLength(2);
      expect(relationships.items.map(r => r.sourceObjectId).sort()).toEqual([
        'svc-a',
        'svc-c',
      ]);
    });

    it('integration-backed: re-apply removes edges whose source is out of scope', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async args => {
          const name =
            args.path === '/users/alice' ? 'Alice Smith' : 'Carol Jones';
          return { profile: { name } };
        },
      });

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { login: 'alice', kind: 'Component' },
      });
      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-c',
        object: { login: 'carol', kind: 'Component' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-alice',
        object: { profile: { name: 'Alice Smith' } },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-carol',
        object: { profile: { name: 'Carol Jones' } },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'login',
        targetFieldExpression: 'profile.name',
        sourceFilterExpression: "kind = 'Component'",
        relationshipType: 'resolvedTo',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/users/{value}',
          responseMatchExpression: 'profile.name',
        },
      });

      const first = await repository.applyRelationshipRule(rule.id);
      expect(first).toEqual({ created: 2, deleted: 0 });

      await testDb('datastore')
        .where('datasource_id', srcDs)
        .andWhere('object_id', 'svc-c')
        .update({
          object: JSON.stringify({ login: 'carol', kind: 'Resource' }),
        });

      const second = await repository.applyRelationshipRule(rule.id);
      expect(second).toEqual({ created: 1, deleted: 2 });

      const relationships = await relationshipDao.listRelationshipsByRuleId(
        rule.id,
      );
      expect(relationships.items.map(r => r.sourceObjectId)).toEqual(['svc-a']);
    });

    it('integration-backed: resolves every source field value', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      const calls: string[] = [];
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async args => {
          calls.push(args.path);
          const name =
            args.path === '/users/alice' ? 'Alice Smith' : 'Carol Jones';
          return { profile: { name } };
        },
      });

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { logins: ['alice', 'carol'] },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-alice',
        object: { profile: { name: 'Alice Smith' } },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-carol',
        object: { profile: { name: 'Carol Jones' } },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'logins',
        targetFieldExpression: 'profile.name',
        relationshipType: 'resolvedTo',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/users/{value}',
          responseMatchExpression: 'profile.name',
        },
      });

      const result = await repository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 2, deleted: 0 });
      expect(calls).toEqual(['/users/alice', '/users/carol']);
      const relationships = await relationshipDao.listRelationshipsByRuleId(
        rule.id,
      );
      expect(
        relationships.items.map(r => r.destinationObjectId).sort(),
      ).toEqual(['user-alice', 'user-carol']);
    });

    it('integration-backed: a duplicate match value does not skip later match values', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async args => {
          // first source value resolves to Alice; second resolves to Alice
          // (already linked) then Bob — Bob must still be linked.
          const names =
            args.path === '/users/x'
              ? ['Alice Smith']
              : ['Alice Smith', 'Bob Lee'];
          return { names };
        },
      });

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { logins: ['x', 'y'] },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-alice',
        object: { profile: { name: 'Alice Smith' } },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-bob',
        object: { profile: { name: 'Bob Lee' } },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'logins',
        targetFieldExpression: 'profile.name',
        relationshipType: 'resolvedTo',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/users/{value}',
          responseMatchExpression: 'names',
        },
      });

      const result = await repository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 2, deleted: 0 });
      const relationships = await relationshipDao.listRelationshipsByRuleId(
        rule.id,
      );
      expect(
        relationships.items.map(r => r.destinationObjectId).sort(),
      ).toEqual(['user-alice', 'user-bob']);
    });

    it('integration-backed: a single source value can fan out to multiple target edges', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();
      const sourceIdentifier = 'org/example-repo';
      const relatedIds = [
        'org/example-repo#3',
        'org/example-repo#2',
        'org/example-repo#1',
      ];
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async () => ({
          relatedIds,
        }),
      });

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'source-1',
        object: { full_name: sourceIdentifier },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'org/example-repo#1',
        object: { id: 'org/example-repo#1' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'org/example-repo#2',
        object: { id: 'org/example-repo#2' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'org/example-repo#3',
        object: { id: 'org/example-repo#3' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'full_name',
        targetFieldExpression: 'id',
        relationshipType: 'relatesTo',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'integration-1',
          path: '/resolve/{value}',
          responseMatchExpression: 'relatedIds',
          metadataExpression: '{"evidence":"search","matches":relatedIds}',
        },
      });

      const result = await repository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 3, deleted: 0 });
      const relationships = await relationshipDao.listRelationshipsByRuleId(
        rule.id,
      );
      expect(
        relationships.items.map(r => r.destinationObjectId).sort(),
      ).toEqual([
        'org/example-repo#1',
        'org/example-repo#2',
        'org/example-repo#3',
      ]);
      expect(relationships.items[0]?.metadata).toEqual({
        evidence: 'search',
        matches: relatedIds,
      });
    });

    it('integration-backed: can build request paths from related object context', async () => {
      const podDs = randomUUID();
      const ecrDs = randomUUID();
      const repoDs = randomUUID();
      const prDs = randomUUID();
      const calls: string[] = [];
      const repository = new DatastoreRepository({
        knex: testDb,
        logger: mockServices.logger.mock(),
        objectDao,
        schemaDao,
        indexDao,
        relationshipDao,
        relationshipRuleDao,
        callIntegration: async args => {
          calls.push(args.path);
          return {
            relatedIds: ['org/example-repo#42'],
          };
        },
      });

      await insertDatastoreObject({
        datasourceId: podDs,
        objectId: 'pod-1',
        object: { git_sha: 'abc1234' },
      });
      await insertDatastoreObject({
        datasourceId: ecrDs,
        objectId: 'repo-1',
        object: { repository_name: 'example-image' },
      });
      await insertDatastoreObject({
        datasourceId: repoDs,
        objectId: 'org/example-repo',
        object: { full_name: 'org/example-repo' },
      });
      await insertDatastoreObject({
        datasourceId: prDs,
        objectId: 'org/example-repo#42',
        object: { id: 'org/example-repo#42' },
      });

      await relationshipDao.upsertRelationship({
        sourceDatasourceId: podDs,
        sourceObjectId: 'pod-1',
        destinationDatasourceId: ecrDs,
        destinationObjectId: 'repo-1',
        relationshipType: 'runsImageFromRepository',
      });
      await relationshipDao.upsertRelationship({
        sourceDatasourceId: ecrDs,
        sourceObjectId: 'repo-1',
        destinationDatasourceId: repoDs,
        destinationObjectId: 'org/example-repo',
        relationshipType: 'builtFromGithubRepository',
      });

      const rule = await createRule({
        sourceDatasourceId: podDs,
        targetDatasourceId: prDs,
        sourceFieldExpression: 'git_sha',
        targetFieldExpression: 'id',
        relationshipType: 'deployedFromPullRequest',
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'github',
          path: '/unused/{value}',
          pathExpression:
            '"/repos/" & related[relationshipType="builtFromGithubRepository"].object.full_name[0] & "/commits/" & sourceValue & "/pulls"',
          sourceContext: {
            maxDepth: 2,
          },
          responseMatchExpression: 'relatedIds',
        },
      });

      const result = await repository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 1, deleted: 0 });
      expect(calls).toEqual(['/repos/org/example-repo/commits/abc1234/pulls']);
      const relationships = await relationshipDao.listRelationshipsByRuleId(
        rule.id,
      );
      expect(relationships.items).toHaveLength(1);
      expect(relationships.items[0]?.destinationObjectId).toBe(
        'org/example-repo#42',
      );
    });

    it('exact: does not match objects where field values differ', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { owner: 'team-z' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-x',
        object: { name: 'team-x' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'owner',
        targetFieldExpression: 'name',
        relationshipType: 'ownedBy',
        matchStrategy: 'exact',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 0, deleted: 0 });
    });

    it('contains: matches when target field value contains source field value', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { slug: 'platform' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-platform',
        object: { tags: 'platform-team-owned' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-backend',
        object: { tags: 'backend-team-owned' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'slug',
        targetFieldExpression: 'tags',
        relationshipType: 'taggedWith',
        matchStrategy: 'contains',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 1, deleted: 0 });

      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(1);
      expect(relationships[0].destination_object_id).toBe('team-platform');
    });

    it('contains: matches generated rules where target field value contains source field value', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'deployment-api',
        object: { name: 'backstage-api' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'pod-api',
        object: { name: 'backstage-api-7d8f4c9f6b-r2xkz' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'pod-web',
        object: { name: 'backstage-web-55f4d7c8cc-mx9pq' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'name',
        targetFieldExpression: 'name',
        relationshipType: 'hasPod',
        matchStrategy: 'contains',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 1, deleted: 0 });

      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(1);
      expect(relationships[0].source_object_id).toBe('deployment-api');
      expect(relationships[0].destination_object_id).toBe('pod-api');
    });

    it('contains: previews generated rules where target field value contains source field value', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'deployment-api',
        object: { name: 'backstage-api' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'pod-api',
        object: { name: 'backstage-api-7d8f4c9f6b-r2xkz' },
      });

      const result = await datastoreRepository.previewRelationshipRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'name',
        targetFieldExpression: 'name',
        relationshipType: 'hasPod',
        matchStrategy: 'contains',
      });

      expect(result).toEqual({
        total: 1,
        items: [
          {
            sourceObjectId: 'deployment-api',
            relationshipType: 'hasPod',
            targetObjectIds: ['pod-api'],
            sourceValue: 'backstage-api',
            targetValue: 'backstage-api-7d8f4c9f6b-r2xkz',
            matchSourceValues: ['backstage-api'],
            matchTargetValues: ['backstage-api-7d8f4c9f6b-r2xkz'],
            sourceLabel: 'backstage-api',
            targetLabels: ['backstage-api-7d8f4c9f6b-r2xkz'],
          },
        ],
      });
    });

    it('preview surfaces a sparse match on the first page instead of paging past it', async () => {
      // A small target that is a subset of a large source (the GitHub-repos
      // shape): 50 non-matching source rows plus a single matching one, previewed
      // one page (limit 5) at a time. Paginating sources in scan order and
      // matching only within the page would almost never include the lone match,
      // so the preview would read as "no matches". Ordering matching sources
      // first puts the match on page one.
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      for (let i = 0; i < 50; i++) {
        await insertDatastoreObject({
          datasourceId: srcDs,
          objectId: `nomatch-${i}`,
          object: { name: `nomatch-${i}` },
        });
      }
      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'the-match',
        object: { name: 'shared-repo' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'target-repo',
        object: { name: 'shared-repo' },
      });

      const result = await datastoreRepository.previewRelationshipRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'name',
        targetFieldExpression: 'name',
        relationshipType: 'relatedTo',
        matchStrategy: 'exact',
        limit: 5,
      });

      // total is every source that produced a field value, unchanged by ordering.
      expect(result.total).toBe(51);
      // The lone match is the first item on the first page…
      expect(result.items[0].sourceObjectId).toBe('the-match');
      expect(result.items[0].targetObjectIds).toEqual(['target-repo']);
      // …and it is the only matched source anywhere on the page.
      const matchedOnPage = result.items.filter(
        item => item.targetObjectIds.length > 0,
      );
      expect(matchedOnPage).toHaveLength(1);
      expect(matchedOnPage[0].sourceObjectId).toBe('the-match');
    });

    it('preview includes display labels with fallback order', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { owner: 'team-x', title: 'Service A' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-title',
        object: { key: 'team-x', title: 'Team Title' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-metadata',
        object: { key: 'team-x', metadata: { name: 'Team Metadata' } },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-id-fallback',
        object: { key: 'team-x' },
      });

      const result = await datastoreRepository.previewRelationshipRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'owner',
        targetFieldExpression: 'key',
        relationshipType: 'ownedBy',
        matchStrategy: 'exact',
      });

      const preview = result.items[0];
      expect(preview).toMatchObject({
        sourceObjectId: 'svc-a',
        sourceLabel: 'Service A',
        matchSourceValues: ['team-x', 'team-x', 'team-x'],
        matchTargetValues: ['team-x', 'team-x', 'team-x'],
      });
      const targetLabels = preview.targetLabels;
      if (!targetLabels) {
        throw new Error('Expected target labels in relationship preview');
      }
      expect(
        preview.targetObjectIds.map((id, index) => ({
          id,
          label: targetLabels[index],
        })),
      ).toEqual(
        expect.arrayContaining([
          { id: 'team-title', label: 'Team Title' },
          { id: 'team-metadata', label: 'Team Metadata' },
          { id: 'team-id-fallback', label: 'team-id-fallback' },
        ]),
      );
    });

    it('preview records per-target match keys when one source matches several targets', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      const bogusTeamOid = 'obj_foobarbaz_aa0001';
      const bogusLoginFoo = 'lorem_ipsum_hdl_foo';
      const bogusLoginBar = 'sit_amet_hdl_bar';
      const bogusUserOidFoo = 'obj_quxbaz_aa0002';
      const bogusUserOidBar = 'obj_quxbaz_aa0003';

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: bogusTeamOid,
        object: {
          title: 'foobarbaz aggregate label',
          _additionalData: {
            members: [{ login: bogusLoginFoo }, { login: bogusLoginBar }],
          },
        },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: bogusUserOidFoo,
        object: {
          login: bogusLoginFoo,
          name: `lbl_${bogusLoginFoo}`,
        },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: bogusUserOidBar,
        object: {
          login: bogusLoginBar,
          name: `lbl_${bogusLoginBar}`,
        },
      });

      const result = await datastoreRepository.previewRelationshipRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: '$._additionalData.members[*].login',
        targetFieldExpression: 'login',
        relationshipType: 'dependsOn',
        matchStrategy: 'exact',
      });

      expect(result.items[0]).toMatchObject({
        sourceObjectId: bogusTeamOid,
        targetObjectIds: [bogusUserOidFoo, bogusUserOidBar],
        sourceValue: bogusLoginFoo,
        targetValue: bogusLoginFoo,
        matchSourceValues: [bogusLoginFoo, bogusLoginBar],
        matchTargetValues: [bogusLoginFoo, bogusLoginBar],
        targetLabels: [`lbl_${bogusLoginFoo}`, `lbl_${bogusLoginBar}`],
      });
    });

    it('contains: does not match when target does not contain source', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { slug: 'frontend' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-platform',
        object: { tags: 'platform-team-owned' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'slug',
        targetFieldExpression: 'tags',
        relationshipType: 'taggedWith',
        matchStrategy: 'contains',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 0, deleted: 0 });
    });

    it('regex: matches when source field value matches target as regex pattern', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { version: 'v2.3.1' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'semver-rule',
        object: { pattern: '^v\\d+\\.\\d+\\.\\d+$' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'major-v1-rule',
        object: { pattern: '^v1\\.' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'version',
        targetFieldExpression: 'pattern',
        relationshipType: 'matchesPattern',
        matchStrategy: 'regex',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 1, deleted: 0 });

      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(1);
      expect(relationships[0].destination_object_id).toBe('semver-rule');
    });

    it('regex: does not match when source does not satisfy the regex', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { version: 'latest' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'semver-rule',
        object: { pattern: '^v\\d+\\.\\d+\\.\\d+$' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'version',
        targetFieldExpression: 'pattern',
        relationshipType: 'matchesPattern',
        matchStrategy: 'regex',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 0, deleted: 0 });
    });

    it('regex: invalid regex pattern is treated as no-match, not an error', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { name: 'my-service' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'bad-pattern',
        object: { pattern: '[invalid(' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'name',
        targetFieldExpression: 'pattern',
        relationshipType: 'matchesPattern',
        matchStrategy: 'regex',
      });

      await expect(
        datastoreRepository.applyRelationshipRule(rule.id),
      ).resolves.toEqual({
        created: 0,
        deleted: 0,
      });
    });

    it('refreshes relationships on re-apply', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { owner: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-x',
        object: { name: 'team-x' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'owner',
        targetFieldExpression: 'name',
        relationshipType: 'ownedBy',
        matchStrategy: 'exact',
      });

      await datastoreRepository.applyRelationshipRule(rule.id);
      const second = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(second).toEqual({ created: 1, deleted: 1 });

      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(1);
    });

    it('purges stale relationships when source data changes', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { owner: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-b',
        object: { owner: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-x',
        object: { name: 'team-x' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'owner',
        targetFieldExpression: 'name',
        relationshipType: 'ownedBy',
        matchStrategy: 'exact',
      });

      const first = await datastoreRepository.applyRelationshipRule(rule.id);
      expect(first).toEqual({ created: 2, deleted: 0 });

      await testDb('datastore')
        .where('datasource_id', srcDs)
        .andWhere('object_id', 'svc-b')
        .delete();

      const second = await datastoreRepository.applyRelationshipRule(rule.id);
      expect(second).toEqual({ created: 1, deleted: 1 });

      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(1);
      expect(relationships[0].source_object_id).toBe('svc-a');
    });

    it('handles concurrent apply calls without errors', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { owner: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-x',
        object: { name: 'team-x' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'owner',
        targetFieldExpression: 'name',
        relationshipType: 'ownedBy',
        matchStrategy: 'exact',
      });

      const results = await Promise.allSettled([
        datastoreRepository.applyRelationshipRule(rule.id),
        datastoreRepository.applyRelationshipRule(rule.id),
        datastoreRepository.applyRelationshipRule(rule.id),
        datastoreRepository.applyRelationshipRule(rule.id),
        datastoreRepository.applyRelationshipRule(rule.id),
      ]);

      expect(results.every(r => r.status === 'fulfilled')).toBe(true);

      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(1);
    });

    it('respects source and target filter expressions', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { kind: 'Component', owner: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-b',
        object: { kind: 'Resource', owner: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-x',
        object: { kind: 'Group', name: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-y',
        object: { kind: 'User', name: 'team-x' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'owner',
        targetFieldExpression: 'name',
        sourceFilterExpression: "kind = 'Component'",
        targetFilterExpression: "kind = 'Group'",
        relationshipType: 'ownedBy',
        matchStrategy: 'exact',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 1, deleted: 0 });

      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(1);
      expect(relationships[0].source_object_id).toBe('svc-a');
      expect(relationships[0].destination_object_id).toBe('team-x');
    });

    it('throws when rule does not exist', async () => {
      await expect(
        datastoreRepository.applyRelationshipRule(randomUUID()),
      ).rejects.toThrow('not found');
    });

    it('matches array field values on source side', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'epic-1',
        object: { follower_ids: ['user-a', 'user-b'] },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-a',
        object: { id: 'user-a' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-b',
        object: { id: 'user-b' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-c',
        object: { id: 'user-c' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'follower_ids',
        targetFieldExpression: 'id',
        relationshipType: 'followedBy',
        matchStrategy: 'exact',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 2, deleted: 0 });

      const relationships = await testDb('datastore_relation')
        .where('rule_id', rule.id)
        .orderBy('destination_object_id');
      expect(relationships).toHaveLength(2);
      expect(relationships[0].destination_object_id).toBe('user-a');
      expect(relationships[1].destination_object_id).toBe('user-b');
    });

    it('matches array field values on target side', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'user-a',
        object: { id: 'user-a' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'epic-1',
        object: { follower_ids: ['user-a', 'user-b'] },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'id',
        targetFieldExpression: 'follower_ids',
        relationshipType: 'follows',
        matchStrategy: 'exact',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 1, deleted: 0 });

      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(1);
      expect(relationships[0].source_object_id).toBe('user-a');
      expect(relationships[0].destination_object_id).toBe('epic-1');
    });

    it('array_contains: matches when source field value is an array element on target side', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'user-a',
        object: { id: 'user-a' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'epic-1',
        object: { follower_ids: ['user-a', 'user-b'] },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'id',
        targetFieldExpression: 'follower_ids',
        relationshipType: 'follows',
        matchStrategy: 'array_contains',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 1, deleted: 0 });

      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(1);
      expect(relationships[0].source_object_id).toBe('user-a');
      expect(relationships[0].destination_object_id).toBe('epic-1');
    });

    it('array_contains: matches when source is an array and target is scalar', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'epic-1',
        object: { follower_ids: ['user-a', 'user-b'] },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-a',
        object: { id: 'user-a' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-b',
        object: { id: 'user-b' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'user-c',
        object: { id: 'user-c' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'follower_ids',
        targetFieldExpression: 'id',
        relationshipType: 'followedBy',
        matchStrategy: 'array_contains',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 2, deleted: 0 });

      const relationships = await testDb('datastore_relation')
        .where('rule_id', rule.id)
        .orderBy('destination_object_id');
      expect(relationships).toHaveLength(2);
      expect(
        relationships.map(
          (r: { destination_object_id: string }) => r.destination_object_id,
        ),
      ).toEqual(['user-a', 'user-b']);
    });

    it('does not double-count when both sides have arrays sharing multiple values', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      // Source and target both list the same two tags. There's one logical
      // relationship between item-1 and bucket-1, even though equality holds
      // for two array elements ('a' and 'b'). The relationship table's unique
      // constraint will reject the duplicate insert, so we just need the
      // result to report it as a single created relationship, not one created +
      // one duplicate.
      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'item-1',
        object: { tags: ['a', 'b'] },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'bucket-1',
        object: { tags: ['a', 'b'] },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'tags',
        targetFieldExpression: 'tags',
        relationshipType: 'sharesTagWith',
        matchStrategy: 'exact',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 1, deleted: 0 });

      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(1);
    });

    it('filters null and empty-string elements from array field values', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'item-1',
        object: { tags: ['valid', null, '', 'also-valid'] },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'tag-valid',
        object: { name: 'valid' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'tag-also-valid',
        object: { name: 'also-valid' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'tags',
        targetFieldExpression: 'name',
        relationshipType: 'taggedWith',
        matchStrategy: 'exact',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 2, deleted: 0 });
    });

    it('coerces numeric field values to strings for matching', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'epic-1',
        object: { project_ids: [14, 15] },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'proj-14',
        object: { id: '14' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'proj-15',
        object: { id: '15' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'proj-99',
        object: { id: '99' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'project_ids',
        targetFieldExpression: 'id',
        relationshipType: 'inProject',
        matchStrategy: 'exact',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 2, deleted: 0 });

      const relationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(relationships).toHaveLength(2);
      const destIds = relationships.map(
        (r: { destination_object_id: string }) => r.destination_object_id,
      );
      expect(destIds.sort()).toEqual(['proj-14', 'proj-15']);
    });

    it('creates no relationships when array is empty', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'item-1',
        object: { tags: [] },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'tag-a',
        object: { name: 'a' },
      });

      const rule = await createRule({
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'tags',
        targetFieldExpression: 'name',
        relationshipType: 'taggedWith',
        matchStrategy: 'exact',
      });

      const result = await datastoreRepository.applyRelationshipRule(rule.id);

      expect(result).toEqual({ created: 0, deleted: 0 });
    });

    it('overlapping rules keep their own attribution across re-applies', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'src-1',
        object: { email: 'a@example.com', name: 'Alice' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'tgt-1',
        object: { email: 'a@example.com', name: 'Alice' },
      });

      const ruleEmail = await createRule({
        name: 'email-rule',
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'email',
        targetFieldExpression: 'email',
        relationshipType: 'relatedTo',
        matchStrategy: 'exact',
      });
      const ruleName = await createRule({
        name: 'name-rule',
        sourceDatasourceId: srcDs,
        targetDatasourceId: tgtDs,
        sourceFieldExpression: 'name',
        targetFieldExpression: 'name',
        relationshipType: 'relatedTo',
        matchStrategy: 'exact',
      });

      // Email rule claims first.
      await datastoreRepository.applyRelationshipRule(ruleEmail.id);
      // Name rule re-applies over the same (src-1 -> tgt-1, relatedTo) tuple.
      await datastoreRepository.applyRelationshipRule(ruleName.id);

      // Single materialized relationship, still attributed to the email rule.
      const allRelationships = await testDb('datastore_relation').where({
        source_datasource_id: srcDs,
        destination_datasource_id: tgtDs,
      });
      expect(allRelationships).toHaveLength(1);
      expect(allRelationships[0].rule_id).toBe(ruleEmail.id);

      // And the count remains stable when the email rule re-applies again.
      await datastoreRepository.applyRelationshipRule(ruleEmail.id);
      const afterReapply = await testDb('datastore_relation').where({
        source_datasource_id: srcDs,
        destination_datasource_id: tgtDs,
      });
      expect(afterReapply).toHaveLength(1);
      expect(afterReapply[0].rule_id).toBe(ruleEmail.id);
    });
  });

  describe('deleteRelationshipRule', () => {
    beforeEach(async () => {
      await testDb('datastore_relation').del();
      await testDb('datastore_relationship_rule').del();
      await testDb('datastore_index').del();
      await testDb('datastore').del();
    });

    it('deletes the rule row and its rule-owned relationships', async () => {
      const srcDs = randomUUID();
      const tgtDs = randomUUID();

      await insertDatastoreObject({
        datasourceId: srcDs,
        objectId: 'svc-a',
        object: { owner: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: tgtDs,
        objectId: 'team-x',
        object: { name: 'team-x' },
      });

      const rule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'delete-test-rule',
          sourceDatasourceId: srcDs,
          targetDatasourceId: tgtDs,
          sourceFieldExpression: 'owner',
          targetFieldExpression: 'name',
          relationshipType: 'depends-on',
          reciprocalRelationshipType: 'dependency-of',
          matchStrategy: 'exact',
        },
        { origin: 'test' },
      );

      await datastoreRepository.applyRelationshipRule(rule.id);

      expect(
        await testDb('datastore_relationship_rule').where('id', rule.id),
      ).toHaveLength(1);
      expect(
        await testDb('datastore_relation').where('rule_id', rule.id),
      ).toHaveLength(1);

      await datastoreRepository.deleteRelationshipRule(
        rule.id,
        DEFAULT_WORKSPACE_ID,
      );

      expect(
        await testDb('datastore_relationship_rule').where('id', rule.id),
      ).toHaveLength(0);
      expect(
        await testDb('datastore_relation').where('rule_id', rule.id),
      ).toHaveLength(0);
    });

    it('deletes only the selected workspace rule and relationships', async () => {
      const workspaceId = randomUUID();
      const defaultDatasourceIds = {
        source: randomUUID(),
        target: randomUUID(),
      };
      const selectedDatasourceIds = {
        source: randomUUID(),
        target: randomUUID(),
      };
      for (const [selectedWorkspaceId, datasourceIds] of [
        [DEFAULT_WORKSPACE_ID, defaultDatasourceIds],
        [workspaceId, selectedDatasourceIds],
      ] as const) {
        await insertDatastoreObject({
          datasourceId: datasourceIds.source,
          objectId: 'svc-a',
          object: { owner: 'team-x' },
          workspaceId: selectedWorkspaceId,
        });
        await insertDatastoreObject({
          datasourceId: datasourceIds.target,
          objectId: 'team-x',
          object: { name: 'team-x' },
          workspaceId: selectedWorkspaceId,
        });
      }

      const defaultRule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'workspace-delete-rule',
          sourceDatasourceId: defaultDatasourceIds.source,
          targetDatasourceId: defaultDatasourceIds.target,
          sourceFieldExpression: 'owner',
          targetFieldExpression: 'name',
          relationshipType: 'depends-on',
          matchStrategy: 'exact',
        },
        { origin: 'test', workspaceId: DEFAULT_WORKSPACE_ID },
      );
      const selectedRule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'workspace-delete-rule',
          sourceDatasourceId: selectedDatasourceIds.source,
          targetDatasourceId: selectedDatasourceIds.target,
          sourceFieldExpression: 'owner',
          targetFieldExpression: 'name',
          relationshipType: 'depends-on',
          matchStrategy: 'exact',
        },
        { origin: 'test', workspaceId },
      );
      await datastoreRepository.applyRelationshipRule(defaultRule.id, {
        workspaceId: DEFAULT_WORKSPACE_ID,
      });
      await datastoreRepository.applyRelationshipRule(selectedRule.id, {
        workspaceId,
      });

      await datastoreRepository.deleteRelationshipRule(
        selectedRule.id,
        workspaceId,
      );

      await expect(
        relationshipRuleDao.getRelationshipRule(
          defaultRule.id,
          DEFAULT_WORKSPACE_ID,
        ),
      ).resolves.toBeDefined();
      await expect(
        relationshipRuleDao.getRelationshipRule(selectedRule.id, workspaceId),
      ).resolves.toBeUndefined();
      expect(
        await testDb('datastore_relation').where({
          workspace_id: DEFAULT_WORKSPACE_ID,
          rule_id: defaultRule.id,
        }),
      ).toHaveLength(1);
      expect(
        await testDb('datastore_relation').where({
          workspace_id: workspaceId,
          rule_id: selectedRule.id,
        }),
      ).toHaveLength(0);
    });
  });

  describe('listRelationshipRulesByDatasourceId', () => {
    beforeEach(async () => {
      await testDb('datastore_relation').del();
      await testDb('datastore_relationship_rule').del();
    });

    it('returns empty array when no rules match', async () => {
      const rules =
        await relationshipRuleDao.listRelationshipRulesByDatasourceId(
          randomUUID(),
        );

      expect(rules).toEqual([]);
    });

    it('returns rules matching either source or target', async () => {
      const dsA = randomUUID();
      const dsB = randomUUID();
      const dsC = randomUUID();

      await relationshipRuleDao.createRelationshipRule({
        name: 'rule-src',
        sourceDatasourceId: dsA,
        targetDatasourceId: dsB,
        sourceFieldExpression: 'owner',
        targetFieldExpression: 'name',
        relationshipType: 'ownedBy',
      });
      await relationshipRuleDao.createRelationshipRule({
        name: 'rule-tgt',
        sourceDatasourceId: dsC,
        targetDatasourceId: dsA,
        sourceFieldExpression: 'ref',
        targetFieldExpression: 'id',
        relationshipType: 'references',
      });

      const rules =
        await relationshipRuleDao.listRelationshipRulesByDatasourceId(dsA);

      expect(rules).toHaveLength(2);
      expect(rules.map(r => r.name).sort()).toEqual(['rule-src', 'rule-tgt']);
    });
  });

  describe('getRelationshipsForObject', () => {
    beforeEach(async () => {
      await testDb('datastore_relation').del();
      await testDb('datastore_relationship_rule').del();
      await testDb('datastore_index').del();
      await testDb('datastore').del();
    });

    it('adds direction field to outgoing and incoming relationships', async () => {
      const dsA = randomUUID();
      const dsB = randomUUID();

      await insertDatastoreObject({
        datasourceId: dsA,
        objectId: 'obj-a',
        object: { name: 'A' },
      });
      await insertDatastoreObject({
        datasourceId: dsB,
        objectId: 'obj-b',
        object: { name: 'B' },
      });

      await relationshipDao.upsertRelationship({
        sourceDatasourceId: dsA,
        sourceObjectId: 'obj-a',
        destinationDatasourceId: dsB,
        destinationObjectId: 'obj-b',
        relationshipType: 'depends-on',
      });

      await relationshipDao.upsertRelationship({
        sourceDatasourceId: dsB,
        sourceObjectId: 'obj-b',
        destinationDatasourceId: dsA,
        destinationObjectId: 'obj-a',
        relationshipType: 'used-by',
      });

      const relationships = await relationshipDao.getRelationshipsForObject(
        dsA,
        'obj-a',
      );

      const outgoing = relationships.filter(r => r.direction === 'outgoing');
      const incoming = relationships.filter(r => r.direction === 'incoming');

      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].relationshipType).toBe('depends-on');
      expect(incoming).toHaveLength(1);
      expect(incoming[0].relationshipType).toBe('used-by');
    });

    it('stores reciprocal relationship type on a single row', async () => {
      const dsA = randomUUID();
      const dsB = randomUUID();

      await insertDatastoreObject({
        datasourceId: dsA,
        objectId: 'svc-a',
        object: { owner: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: dsB,
        objectId: 'team-x',
        object: { name: 'team-x' },
      });

      const rule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'reciprocal-test-rule',
          sourceDatasourceId: dsA,
          targetDatasourceId: dsB,
          sourceFieldExpression: 'owner',
          targetFieldExpression: 'name',
          relationshipType: 'depends-on',
          reciprocalRelationshipType: 'dependency-of',
          matchStrategy: 'exact',
        },
        { origin: 'test' },
      );

      await datastoreRepository.applyRelationshipRule(rule.id);

      const dbRelationships = await testDb('datastore_relation').where(
        'rule_id',
        rule.id,
      );
      expect(dbRelationships).toHaveLength(1);
      expect(dbRelationships[0].reciprocal_relation_type).toBe('dependency-of');

      const relationships = await relationshipDao.getRelationshipsForObject(
        dsA,
        'svc-a',
      );

      expect(relationships).toHaveLength(1);
      expect(relationships[0].direction).toBe('outgoing');
      expect(relationships[0].relationshipType).toBe('depends-on');
      expect(relationships[0].reciprocalRelationshipType).toBe('dependency-of');
    });

    it('persists integration-backed bridging data as relationship metadata', async () => {
      const dsA = randomUUID();
      const dsB = randomUUID();

      await insertDatastoreObject({
        datasourceId: dsA,
        objectId: 'pod-1',
        object: { name: 'pod-1' },
      });
      await insertDatastoreObject({
        datasourceId: dsB,
        objectId: 'acme/widget-service',
        object: { full_name: 'acme/widget-service' },
      });

      const bridge = {
        commitSha: 'deadbee',
        author: 'octocat',
        resolvedVia: 'github:search/commits',
      };
      const created = await relationshipDao.upsertRelationship({
        sourceDatasourceId: dsA,
        sourceObjectId: 'pod-1',
        destinationDatasourceId: dsB,
        destinationObjectId: 'acme/widget-service',
        relationshipType: 'deployedFrom',
        origin: 'integration-backed',
        metadata: bridge,
      });

      expect(created.origin).toBe('integration-backed');
      expect(created.metadata).toEqual(bridge);

      // Round-trips through the jsonb column on a fresh read.
      const reread = await relationshipDao.getRelationship(created.id);
      expect(reread?.metadata).toEqual(bridge);

      // Re-evaluation refreshes the bridging data on conflict.
      const refreshed = await relationshipDao.upsertRelationship({
        sourceDatasourceId: dsA,
        sourceObjectId: 'pod-1',
        destinationDatasourceId: dsB,
        destinationObjectId: 'acme/widget-service',
        relationshipType: 'deployedFrom',
        origin: 'integration-backed',
        metadata: { ...bridge, commitSha: 'abc1234' },
      });
      expect(refreshed.metadata).toMatchObject({ commitSha: 'abc1234' });

      const preserved = await relationshipDao.upsertRelationship({
        sourceDatasourceId: dsA,
        sourceObjectId: 'pod-1',
        destinationDatasourceId: dsB,
        destinationObjectId: 'acme/widget-service',
        relationshipType: 'deployedFrom',
        origin: 'integration-backed',
      });
      expect(preserved.metadata).toEqual({
        ...bridge,
        commitSha: 'abc1234',
      });
    });

    it('returns both directions for manually created relationships', async () => {
      const dsA = randomUUID();
      const dsB = randomUUID();

      await insertDatastoreObject({
        datasourceId: dsA,
        objectId: 'obj-a',
        object: { name: 'A' },
      });
      await insertDatastoreObject({
        datasourceId: dsB,
        objectId: 'obj-b',
        object: { name: 'B' },
      });

      await relationshipDao.upsertRelationship({
        sourceDatasourceId: dsA,
        sourceObjectId: 'obj-a',
        destinationDatasourceId: dsB,
        destinationObjectId: 'obj-b',
        relationshipType: 'depends-on',
      });

      await relationshipDao.upsertRelationship({
        sourceDatasourceId: dsB,
        sourceObjectId: 'obj-b',
        destinationDatasourceId: dsA,
        destinationObjectId: 'obj-a',
        relationshipType: 'dependency-of',
      });

      const relationships = await relationshipDao.getRelationshipsForObject(
        dsA,
        'obj-a',
      );

      expect(relationships).toHaveLength(2);
      expect(
        relationships.filter(r => r.direction === 'outgoing'),
      ).toHaveLength(1);
      expect(
        relationships.filter(r => r.direction === 'incoming'),
      ).toHaveLength(1);
    });

    it('returns incoming relationships from rules targeting this object', async () => {
      const dsA = randomUUID();
      const dsB = randomUUID();

      await insertDatastoreObject({
        datasourceId: dsA,
        objectId: 'team-x',
        object: { name: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: dsB,
        objectId: 'svc-a',
        object: { owner: 'team-x' },
      });

      const rule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'incoming-only-test',
          sourceDatasourceId: dsB,
          targetDatasourceId: dsA,
          sourceFieldExpression: 'owner',
          targetFieldExpression: 'name',
          relationshipType: 'ownedBy',
          matchStrategy: 'exact',
        },
        { origin: 'test' },
      );

      await datastoreRepository.applyRelationshipRule(rule.id);

      const relationships = await relationshipDao.getRelationshipsForObject(
        dsA,
        'team-x',
      );

      expect(relationships).toHaveLength(1);
      expect(relationships[0].direction).toBe('incoming');
      expect(relationships[0].relationshipType).toBe('ownedBy');
      expect(relationships[0].sourceObjectId).toBe('svc-a');
    });

    it('exposes reciprocalRelationshipType on incoming relationships', async () => {
      const dsA = randomUUID();
      const dsB = randomUUID();

      await insertDatastoreObject({
        datasourceId: dsA,
        objectId: 'team-x',
        object: { name: 'team-x' },
      });
      await insertDatastoreObject({
        datasourceId: dsB,
        objectId: 'svc-a',
        object: { owner: 'team-x' },
      });

      const rule = await relationshipRuleDao.createRelationshipRule(
        {
          name: 'reciprocal-incoming-test',
          sourceDatasourceId: dsB,
          targetDatasourceId: dsA,
          sourceFieldExpression: 'owner',
          targetFieldExpression: 'name',
          relationshipType: 'depends-on',
          reciprocalRelationshipType: 'dependency-of',
          matchStrategy: 'exact',
        },
        { origin: 'test' },
      );

      await datastoreRepository.applyRelationshipRule(rule.id);

      const relationships = await relationshipDao.getRelationshipsForObject(
        dsA,
        'team-x',
      );

      expect(relationships).toHaveLength(1);
      expect(relationships[0].direction).toBe('incoming');
      expect(relationships[0].relationshipType).toBe('depends-on');
      expect(relationships[0].reciprocalRelationshipType).toBe('dependency-of');
    });
  });

  describe('queryWithJoin', () => {
    it('keeps every left item, including those without a matching or indexed key', async () => {
      const leftDs = randomUUID();
      const rightDs = randomUUID();

      const leftConfigId = await insertIndexConfiguration({
        datasourceId: leftDs,
        key: 'email',
        valueExpression: '$.email',
      });
      const rightConfigId = await insertIndexConfiguration({
        datasourceId: rightDs,
        key: 'user.email',
        valueExpression: '$.user.email',
      });

      const matchedLeftId = await insertDatastoreObject({
        datasourceId: leftDs,
        objectId: 'left-matched',
        object: { name: 'Matched', email: 'alice@example.com' },
      });
      const unmatchedLeftId = await insertDatastoreObject({
        datasourceId: leftDs,
        objectId: 'left-unmatched',
        object: { name: 'NoMatch', email: 'bob@example.com' },
      });
      await insertDatastoreObject({
        datasourceId: leftDs,
        objectId: 'left-no-index',
        object: { name: 'NoEmail' },
      });

      await insertIndex({
        datastoreId: matchedLeftId,
        configId: leftConfigId,
        key: 'email',
        value: 'alice@example.com',
      });
      await insertIndex({
        datastoreId: unmatchedLeftId,
        configId: leftConfigId,
        key: 'email',
        value: 'bob@example.com',
      });

      const rightMatchedId = await insertDatastoreObject({
        datasourceId: rightDs,
        objectId: 'right-matched',
        object: { user: { email: 'alice@example.com' } },
      });
      await insertIndex({
        datastoreId: rightMatchedId,
        configId: rightConfigId,
        key: 'user.email',
        value: 'alice@example.com',
      });

      const { items, total } = await dao.queryWithJoin({
        leftDatasourceId: leftDs,
        rightDatasourceId: rightDs,
        leftIndexKey: 'email',
        rightIndexKey: 'user.email',
      });

      expect(total).toBe(3);
      expect(items).toHaveLength(3);

      const byObjectId = new Map(items.map(item => [item.objectId, item]));

      const matched = byObjectId.get('left-matched');
      expect(matched?.rightMatches).toHaveLength(1);
      expect(matched?.rightMatches[0].object).toEqual({
        user: { email: 'alice@example.com' },
      });

      expect(byObjectId.get('left-unmatched')?.rightMatches).toEqual([]);
      expect(byObjectId.get('left-no-index')?.rightMatches).toEqual([]);
    });
  });

  describe('IndexDao.listValues', () => {
    async function seedEmailIndex(datasourceId: string, values: string[]) {
      const configId = await insertIndexConfiguration({
        datasourceId,
        key: 'email',
        valueExpression: 'email',
      });
      // Use a unique objectId per row so the `(datasource_id, object_id)`
      // constraint never trips when seeding duplicate index values.
      for (const [i, value] of values.entries()) {
        const dsObjectId = await insertDatastoreObject({
          datasourceId,
          objectId: `obj-${i}`,
          object: { email: value },
        });
        await insertIndex({
          datastoreId: dsObjectId,
          configId,
          key: 'email',
          value,
        });
      }
    }

    it('returns distinct values for an indexed field, alphabetically', async () => {
      const datasourceId = randomUUID();
      await seedEmailIndex(datasourceId, [
        'bob@example.com',
        'alice@example.com',
        'bob@example.com',
      ]);

      const result = await indexDao.listValues(datasourceId, 'email');
      expect(result).toEqual(['alice@example.com', 'bob@example.com']);
    });

    it('narrows results by a case-insensitive substring `q`', async () => {
      const datasourceId = randomUUID();
      await seedEmailIndex(datasourceId, [
        'alice@example.com',
        'bob@example.com',
        'charles@example.com',
        'alicia@example.com',
      ]);

      // Substring matches anywhere in the value, not just prefix.
      const result = await indexDao.listValues(datasourceId, 'email', {
        q: 'ALI',
      });
      expect(result).toEqual(['alice@example.com', 'alicia@example.com']);
    });

    it('treats ILIKE wildcards in `q` as literal characters', async () => {
      const datasourceId = randomUUID();
      await seedEmailIndex(datasourceId, [
        'alice@example.com',
        'a%admin@example.com',
      ]);

      const result = await indexDao.listValues(datasourceId, 'email', {
        q: 'a%',
      });
      expect(result).toEqual(['a%admin@example.com']);
    });

    it('returns an empty array when the index configuration is missing', async () => {
      const result = await indexDao.listValues(randomUUID(), 'email');
      expect(result).toEqual([]);
    });

    it('respects the `limit` option', async () => {
      const datasourceId = randomUUID();
      await seedEmailIndex(
        datasourceId,
        Array.from(
          { length: 25 },
          (_, i) => `user${String(i).padStart(2, '0')}@example.com`,
        ),
      );

      const result = await indexDao.listValues(datasourceId, 'email', {
        limit: 5,
      });
      expect(result).toHaveLength(5);
      expect(result[0]).toBe('user00@example.com');
    });
  });
});
