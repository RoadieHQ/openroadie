import { TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { applyMigrations } from './applyMigrations';
import { RelationshipDao } from './RelationshipDao';
import { RelationshipRuleDao } from './RelationshipRuleDao';

const databases = TestDatabases.create();

describe('RelationshipDao', () => {
  let testDb: Knex;
  let relationshipDao: RelationshipDao;
  let relationshipRuleDao: RelationshipRuleDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    relationshipDao = new RelationshipDao({ knex: testDb });
    relationshipRuleDao = new RelationshipRuleDao({ knex: testDb });
  }, 120_000);

  beforeEach(async () => {
    await testDb('datastore_relation').del();
    await testDb('datastore_relationship_rule').del();
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  async function insertRuleEdge(options?: { origin?: string }) {
    const rule = await relationshipRuleDao.createRelationshipRule(
      {
        name: `rule-${randomUUID()}`,
        sourceDatasourceId: randomUUID(),
        targetDatasourceId: randomUUID(),
        sourceFieldExpression: 'owner',
        targetFieldExpression: 'name',
        relationshipType: 'depends-on',
        matchStrategy: 'exact',
      },
      { origin: options?.origin ?? 'manual' },
    );
    const edge = await relationshipDao.upsertRelationship({
      sourceDatasourceId: rule.sourceDatasourceId,
      sourceObjectId: `src-${randomUUID()}`,
      destinationDatasourceId: rule.targetDatasourceId,
      destinationObjectId: `dst-${randomUUID()}`,
      relationshipType: 'depends-on',
      ruleId: rule.id,
      origin: options?.origin ?? 'manual',
    });
    return { rule, edge };
  }

  async function insertDirectEdge(options?: {
    sourceDatasourceId?: string;
    sourceObjectId?: string;
  }) {
    return relationshipDao.upsertRelationship({
      sourceDatasourceId: options?.sourceDatasourceId ?? randomUUID(),
      sourceObjectId: options?.sourceObjectId ?? `src-${randomUUID()}`,
      destinationDatasourceId: randomUUID(),
      destinationObjectId: `dst-${randomUUID()}`,
      relationshipType: 'depends-on',
      origin: 'manual',
    });
  }

  describe('queryAll with direct filter', () => {
    it('returns only edges without a ruleId when direct is true', async () => {
      const direct = await insertDirectEdge();
      // A rule-materialized edge whose rule has origin 'manual' — the case
      // where filtering by origin alone gives the wrong answer.
      await insertRuleEdge({ origin: 'manual' });

      const result = await relationshipDao.queryAll({ direct: true });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(direct.id);
      expect(result.items[0].ruleId).toBeNull();
    });

    it('returns all edges when direct is not set', async () => {
      await insertDirectEdge();
      await insertRuleEdge();

      const result = await relationshipDao.queryAll({});

      expect(result.total).toBe(2);
    });
  });

  describe('queryRelationshipsBySource with direct filter', () => {
    it('returns only direct edges for the source object', async () => {
      const { edge: ruleEdge } = await insertRuleEdge({ origin: 'manual' });
      const direct = await insertDirectEdge({
        sourceDatasourceId: ruleEdge.sourceDatasourceId,
        sourceObjectId: ruleEdge.sourceObjectId,
      });

      const result = await relationshipDao.queryRelationshipsBySource(
        ruleEdge.sourceDatasourceId,
        ruleEdge.sourceObjectId,
        { direct: true },
      );

      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe(direct.id);
    });
  });
});
