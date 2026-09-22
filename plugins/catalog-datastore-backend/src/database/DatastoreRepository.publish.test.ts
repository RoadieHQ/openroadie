import { mockServices, TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import type { JsonObject } from '@roadiehq/types';
import { randomUUID } from 'crypto';
import { applyMigrations } from './applyMigrations';
import { ObjectDao } from './ObjectDao';
import { SchemaDao } from './SchemaDao';
import { IndexDao } from './IndexDao';
import { RelationshipDao } from './RelationshipDao';
import { RelationshipRuleDao } from './RelationshipRuleDao';
import { DatasourceActivityDao } from './DatasourceActivityDao';
import { DatastoreRepository } from './DatastoreRepository';
import type { DatasourceEvents } from '../webhooks/DatasourceEvents';

const databases = TestDatabases.create();
const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

describe('DatastoreRepository publish side effects)', () => {
  let testDb: Knex;
  let repository: DatastoreRepository;
  let activityDao: DatasourceActivityDao;
  let emitChanged: ReturnType<typeof vi.fn>;
  let autoApplySpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    const logger = mockServices.logger.mock();
    activityDao = new DatasourceActivityDao({ knex: testDb });
    emitChanged = vi.fn();
    repository = new DatastoreRepository({
      knex: testDb,
      logger,
      objectDao: new ObjectDao({ knex: testDb }),
      schemaDao: new SchemaDao({ knex: testDb }),
      indexDao: new IndexDao({ knex: testDb, logger }),
      relationshipDao: new RelationshipDao({ knex: testDb }),
      relationshipRuleDao: new RelationshipRuleDao({ knex: testDb }),
      activityDao,
      events: { emitChanged } as unknown as DatasourceEvents,
    });
    autoApplySpy = vi
      .spyOn(repository, 'applyRelationshipRulesForDatasources')
      .mockResolvedValue(undefined as never);
  }, 120_000);

  beforeEach(async () => {
    await testDb('datastore_index').del();
    await testDb('datastore').del();
    await testDb('datastore_index_configuration').del();
    await testDb('datastore_schema').del();
    await testDb('datasource_activity').del();
    emitChanged.mockClear();
    autoApplySpy.mockClear();
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  const item = (objectId: string, object: JsonObject) => ({
    datasourceId: 'ignored',
    objectId,
    object,
  });

  async function rowsOf(datasourceId: string) {
    return testDb('datastore')
      .where('datasource_id', datasourceId)
      .orderBy('object_id');
  }

  it('returns the real delta and itemCount', async () => {
    const ds = randomUUID();
    const first = await repository.replaceDatasourceItems(ds, [
      item('a', { name: 'alpha' }),
      item('b', { name: 'beta' }),
    ]);
    expect(first).toEqual({
      deleted: 0,
      updated: 0,
      inserted: 2,
      itemCount: 2,
    });

    const second = await repository.replaceDatasourceItems(ds, [
      item('a', { name: 'alpha' }),
      item('b', { name: 'BETA' }),
      item('c', { name: 'gamma' }),
    ]);
    expect(second).toEqual({
      deleted: 0,
      updated: 1,
      inserted: 1,
      itemCount: 3,
    });

    const third = await repository.replaceDatasourceItems(ds, []);
    expect(third).toEqual({
      deleted: 3,
      updated: 0,
      inserted: 0,
      itemCount: 0,
    });
  });

  it('unchanged rows keep row identity, created_at, and updated_at', async () => {
    const ds = randomUUID();
    await repository.replaceDatasourceItems(ds, [
      item('stable', { name: 'same' }),
    ]);
    const [before] = await rowsOf(ds);

    await repository.replaceDatasourceItems(ds, [
      item('stable', { name: 'same' }),
      item('fresh', { name: 'new' }),
    ]);
    const after = await rowsOf(ds);
    const stableAfter = after.find(r => r.object_id === 'stable')!;
    expect(stableAfter.id).toBe(before.id);
    expect(stableAfter.created_at.getTime()).toBe(before.created_at.getTime());
    expect(stableAfter.updated_at.getTime()).toBe(before.updated_at.getTime());
  });

  it('a semantically identical payload is a no-op regardless of key order', async () => {
    const ds = randomUUID();
    await repository.replaceDatasourceItems(ds, [
      item('a', { name: 'x', size: 1 }),
    ]);
    const delta = await repository.replaceDatasourceItems(ds, [
      item('a', { size: 1, name: 'x' }),
    ]);
    expect(delta).toEqual({
      deleted: 0,
      updated: 0,
      inserted: 0,
      itemCount: 1,
    });
  });

  it('publishes the same datasource and object independently in two workspaces', async () => {
    const datasourceId = randomUUID();
    const workspaceA = randomUUID();
    const workspaceB = randomUUID();

    await repository.replaceDatasourceItems(
      datasourceId,
      [item('shared', { name: 'workspace A' })],
      { workspaceId: workspaceA },
    );
    await repository.replaceDatasourceItems(
      datasourceId,
      [item('shared', { name: 'workspace B' })],
      { workspaceId: workspaceB },
    );

    await expect(
      repository.getDatasourceItems(datasourceId, {
        workspaceId: workspaceA,
      }),
    ).resolves.toMatchObject({ items: [{ name: 'workspace A' }], total: 1 });
    await expect(
      repository.getDatasourceItems(datasourceId, {
        workspaceId: workspaceB,
      }),
    ).resolves.toMatchObject({ items: [{ name: 'workspace B' }], total: 1 });
    await expect(
      activityDao.get(datasourceId, workspaceA),
    ).resolves.toBeDefined();
    await expect(
      activityDao.get(datasourceId, workspaceB),
    ).resolves.toBeDefined();
  });

  describe('delta-gated side effects', () => {
    it('a no-op replace fires no activity touch, no changed event, no auto-apply', async () => {
      const ds = randomUUID();
      await repository.replaceDatasourceItems(ds, [item('a', { name: 'x' })]);
      const activityAfterFirst = await activityDao.get(ds);
      expect(activityAfterFirst).toBeDefined();

      await repository.flushAutoApplyForTesting();
      emitChanged.mockClear();
      autoApplySpy.mockClear();

      await repository.replaceDatasourceItems(ds, [item('a', { name: 'x' })]);
      await repository.flushAutoApplyForTesting();

      expect(emitChanged).not.toHaveBeenCalled();
      expect(autoApplySpy).not.toHaveBeenCalled();
      const activityAfterNoop = await activityDao.get(ds);
      expect(activityAfterNoop?.updatedAt).toBe(activityAfterFirst?.updatedAt);
    });

    it('a real change touches activity, emits datasource-changed, and schedules auto-apply', async () => {
      const ds = randomUUID();
      await repository.replaceDatasourceItems(ds, [item('a', { name: 'x' })]);
      const activityBefore = await activityDao.get(ds);
      await repository.flushAutoApplyForTesting();
      emitChanged.mockClear();
      autoApplySpy.mockClear();

      await repository.replaceDatasourceItems(ds, [item('a', { name: 'y' })]);
      await repository.flushAutoApplyForTesting();

      expect(emitChanged).toHaveBeenCalledWith(ds, DEFAULT_WORKSPACE_ID);
      expect(autoApplySpy).toHaveBeenCalledWith([ds], DEFAULT_WORKSPACE_ID);
      const activityAfter = await activityDao.get(ds);
      expect(activityAfter?.updatedAt).not.toBe(activityBefore?.updatedAt);
    });

    it('an empty first publish marks the datasource as seen without a change event', async () => {
      const ds = randomUUID();
      const delta = await repository.replaceDatasourceItems(ds, []);
      expect(delta).toEqual({
        deleted: 0,
        updated: 0,
        inserted: 0,
        itemCount: 0,
      });
      expect(emitChanged).not.toHaveBeenCalled();

      // "Synced but empty" must read as an empty list, not "not found".
      await expect(repository.getDatasourceItems(ds)).resolves.toEqual({
        items: [],
        total: 0,
      });

      const activityAfterFirst = await activityDao.get(ds);
      expect(activityAfterFirst).toBeDefined();

      // Later no-op publishes keep the row but never advance the timestamp.
      await repository.replaceDatasourceItems(ds, []);
      const activityAfterSecond = await activityDao.get(ds);
      expect(activityAfterSecond?.updatedAt).toBe(
        activityAfterFirst?.updatedAt,
      );
    });

    it('a delete-only change (empty replace) still counts as a change', async () => {
      const ds = randomUUID();
      await repository.replaceDatasourceItems(ds, [item('a', { name: 'x' })]);
      emitChanged.mockClear();

      await repository.replaceDatasourceItems(ds, []);
      expect(emitChanged).toHaveBeenCalledWith(ds, DEFAULT_WORKSPACE_ID);

      emitChanged.mockClear();

      await repository.replaceDatasourceItems(ds, []);
      expect(emitChanged).not.toHaveBeenCalled();
    });
  });

  // The paged engine's StagedPublisher bypasses replaceDatasourceItems, so
  // its side effects arrive through applyPublishSideEffects (driven by the
  // workflow sync event, sc-34243). It must gate exactly like the inline path.
  describe('staged publish side effects (applyPublishSideEffects)', () => {
    it('a changed delta touches activity, emits datasource-changed, and schedules auto-apply', async () => {
      const ds = randomUUID();
      // Drain ids scheduled (but not flushed) by earlier tests, so the
      // coalesced batch below contains only this test's datasource.
      await repository.flushAutoApplyForTesting();
      autoApplySpy.mockClear();

      await repository.applyPublishSideEffects(ds, {
        deleted: 0,
        updated: 1,
        inserted: 2,
      });
      await repository.flushAutoApplyForTesting();

      expect(emitChanged).toHaveBeenCalledWith(ds, DEFAULT_WORKSPACE_ID);
      expect(autoApplySpy).toHaveBeenCalledWith([ds], DEFAULT_WORKSPACE_ID);
      expect(await activityDao.get(ds)).toBeDefined();
    });

    it('keeps changed events and auto-apply in the published workspace', async () => {
      const ds = randomUUID();
      const workspaceId = randomUUID();
      await repository.flushAutoApplyForTesting();
      emitChanged.mockClear();
      autoApplySpy.mockClear();

      await repository.applyPublishSideEffects(
        ds,
        {
          deleted: 0,
          updated: 1,
          inserted: 0,
        },
        workspaceId,
      );
      await repository.flushAutoApplyForTesting();

      expect(emitChanged).toHaveBeenCalledWith(ds, workspaceId);
      expect(autoApplySpy).toHaveBeenCalledWith([ds], workspaceId);
      expect(await activityDao.get(ds, workspaceId)).toBeDefined();
    });

    it('a no-op delta records the activity marker and fires nothing else', async () => {
      const ds = randomUUID();
      await repository.applyPublishSideEffects(ds, {
        deleted: 0,
        updated: 0,
        inserted: 0,
      });
      await repository.flushAutoApplyForTesting();

      expect(emitChanged).not.toHaveBeenCalled();
      expect(autoApplySpy).not.toHaveBeenCalled();
      // "Synced but empty" must still be distinguishable from "never synced".
      expect(await activityDao.get(ds)).toBeDefined();
    });

    it('a later no-op does not advance the activity timestamp', async () => {
      const ds = randomUUID();
      await repository.applyPublishSideEffects(ds, {
        deleted: 0,
        updated: 0,
        inserted: 1,
      });
      const first = await activityDao.get(ds);

      await repository.applyPublishSideEffects(ds, {
        deleted: 0,
        updated: 0,
        inserted: 0,
      });
      const second = await activityDao.get(ds);
      expect(second?.updatedAt).toBe(first?.updatedAt);
    });
  });

  describe('schema stamping', () => {
    it('restamps unchanged rows on version drift without touching updated_at', async () => {
      const ds = randomUUID();
      await repository.replaceDatasourceItems(ds, [
        item('stable', { name: 'same' }),
        item('drifting', { name: 'old' }),
      ]);
      const [v1] = await testDb('datastore_schema').where('datasource_id', ds);
      const stableBefore = (await rowsOf(ds)).find(
        r => r.object_id === 'stable',
      )!;
      expect(stableBefore.schema_id).toBe(v1.id);

      await repository.replaceDatasourceItems(ds, [
        item('stable', { name: 'same' }),
        item('drifting', { name: 'old', extra: true }),
      ]);
      const versions = await testDb('datastore_schema')
        .where('datasource_id', ds)
        .orderBy('version');
      expect(versions).toHaveLength(2);

      const stableAfter = (await rowsOf(ds)).find(
        r => r.object_id === 'stable',
      )!;
      expect(stableAfter.schema_id).toBe(versions[1].id);
      expect(stableAfter.updated_at.getTime()).toBe(
        stableBefore.updated_at.getTime(),
      );
    });
  });

  describe('delta-scoped index reconcile', () => {
    it('unchanged rows keep their index rows; updated and inserted rows are (re)indexed', async () => {
      const ds = randomUUID();
      await testDb('datastore_index_configuration').insert({
        id: randomUUID(),
        datasource_id: ds,
        key: 'name',
        value_expression: 'name',
        purpose: 'column',
      });

      await repository.replaceDatasourceItems(ds, [
        item('stable', { name: 'same' }),
        item('changing', { name: 'old' }),
      ]);
      const rows = await rowsOf(ds);
      const stableRow = rows.find(r => r.object_id === 'stable')!;
      const [stableIndexBefore] = await testDb('datastore_index').where(
        'datastore_id',
        stableRow.id,
      );

      await repository.replaceDatasourceItems(ds, [
        item('stable', { name: 'same' }),
        item('changing', { name: 'new' }),
        item('fresh', { name: 'hi' }),
      ]);

      const stableIndexAfter = await testDb('datastore_index').where(
        'datastore_id',
        stableRow.id,
      );
      expect(stableIndexAfter).toHaveLength(1);
      expect(stableIndexAfter[0].id).toBe(stableIndexBefore.id);

      const after = await rowsOf(ds);
      const changingRow = after.find(r => r.object_id === 'changing')!;
      const freshRow = after.find(r => r.object_id === 'fresh')!;
      const changingIndexes = await testDb('datastore_index').where(
        'datastore_id',
        changingRow.id,
      );
      expect(changingIndexes.map(index => index.value)).toEqual(['new']);
      const freshIndexes = await testDb('datastore_index').where(
        'datastore_id',
        freshRow.id,
      );
      expect(freshIndexes.map(index => index.value)).toEqual(['hi']);
    });
  });
});
