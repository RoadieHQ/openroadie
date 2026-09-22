/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import type { JsonObject, JsonValue } from '@roadiehq/types';
import { canonicalJsonHash } from '@roadiehq/catalog-datastore-node';
import {
  APPEND_KEEP,
  DUPLICATE_OBJECT_ID_EXPAND_SEP,
  type DuplicateObjectIdStrategy,
} from '@roadiehq/catalog-datastore-common';
import { applySubstrateTestMigrations } from './test-migrations';
import { WorkflowAttemptDao } from './WorkflowAttemptDao';
import { WorkflowStagingDao, StagingRange } from './WorkflowStagingDao';
import {
  StagedPublisher,
  capturePublishSnapshot,
  indexExpressionHash,
  type PublishSnapshot,
} from './StagedPublisher';
import { PublishAbortedError } from './engine-errors';
import { createTestLogger } from './test-logger';

const databases = TestDatabases.create();

const NODE_ID = 'sink';

describe('StagedPublisher', () => {
  let knex: Knex;
  let attemptDao: WorkflowAttemptDao;
  let stagingDao: WorkflowStagingDao;
  let publisher: StagedPublisher;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applySubstrateTestMigrations(knex);
    const logger = createTestLogger();
    attemptDao = new WorkflowAttemptDao({ knex, logger });
    stagingDao = new WorkflowStagingDao({ knex, logger });
    publisher = new StagedPublisher({ knex, logger });
  }, 180_000);

  afterAll(async () => {
    if (knex) {
      await knex.destroy();
    }
  });

  beforeEach(async () => {
    await knex('workflow_staging_index').del();
    await knex('workflow_staging').del();
    await knex('workflow_execution_attempt').del();
    await knex('datastore_index').del();
    await knex('datastore_index_configuration').del();
    await knex('datastore').del();
    await knex('datastore_schema').del();
  });

  interface StagedInput {
    objectId: string;
    object: JsonObject;
  }

  /**
   * Stage rows for an active attempt, write staging-index rows for each
   * snapshot entry (value = the named field of the object, mirroring what the
   * sink derives at spill time), and record the manifest.
   */
  async function stageAndSeal(
    range: StagingRange,
    items: StagedInput[],
    snapshot: PublishSnapshot,
  ): Promise<void> {
    for (let i = 0; i < items.length; i += 5000) {
      const batch = items.slice(i, i + 5000);
      await stagingDao.appendPage(
        range,
        batch.map((item, j) => ({
          orderKey: [i + j],
          objectId: item.objectId,
          objectHash: canonicalJsonHash(item.object),
          object: JSON.stringify(item.object),
        })),
      );
    }

    let indexRows = 0;
    if (snapshot.indexes.length > 0) {
      const staged: Array<{ seq: string; object: string }> = await knex(
        'workflow_staging',
      )
        .where({
          execution_id: range.executionId,
          attempt_id: range.attemptId,
          node_id: range.nodeId,
        })
        .orderBy('seq')
        .select('seq', 'object');
      const indexItems = [];
      for (const row of staged) {
        const parsed = JSON.parse(row.object) as JsonObject;
        for (const entry of snapshot.indexes) {
          const value = parsed[`${entry.expression}`];
          if (typeof value === 'string') {
            indexItems.push({
              seq: row.seq,
              configKey: entry.key,
              expressionHash: entry.expressionHash,
              value,
            });
          }
        }
      }
      if (indexItems.length > 0) {
        await stagingDao.appendIndexRows(range, indexItems);
        indexRows = indexItems.length;
      }
    }

    await attemptDao.recordManifest(range.executionId, range.attemptId, {
      [`${range.nodeId}`]: { rows: items.length, indexRows },
    });
  }

  async function startAttemptFor(
    snapshot: PublishSnapshot,
  ): Promise<{ executionId: string; attemptId: string; range: StagingRange }> {
    const executionId = randomUUID();
    const { attemptId } = await attemptDao.startAttempt(
      executionId,
      snapshot as unknown as JsonObject,
    );
    return {
      executionId,
      attemptId,
      range: { executionId, attemptId, nodeId: NODE_ID },
    };
  }

  async function publishItems(
    datasourceId: string,
    items: StagedInput[],
    options?: {
      snapshot?: PublishSnapshot;
      strategy?: DuplicateObjectIdStrategy;
      schema?: JsonValue;
      datasourceName?: string;
      workspaceId?: string;
    },
  ) {
    const snapshot =
      options?.snapshot ??
      (await capturePublishSnapshot(knex, datasourceId, {
        workspaceId: options?.workspaceId,
      }));
    const { executionId, attemptId, range } = await startAttemptFor(snapshot);
    await stageAndSeal(range, items, snapshot);
    return publisher.publish({
      executionId,
      attemptId,
      nodeId: NODE_ID,
      datasourceId,
      strategy: options?.strategy ?? 'fail',
      schema: options?.schema,
      datasourceName: options?.datasourceName,
      workspaceId: options?.workspaceId,
    });
  }

  async function datastoreRows(datasourceId: string) {
    const rows = await knex('datastore')
      .where('datasource_id', datasourceId)
      .orderBy('object_id')
      .select('id', 'object_id', 'object', 'object_hash', 'updated_at');
    return rows.map(
      (row: {
        id: string;
        object_id: string;
        object: string;
        object_hash: string;
        updated_at: Date;
      }) => ({ ...row, parsed: JSON.parse(row.object) as JsonObject }),
    );
  }

  it('publishes a staged range into an empty datasource', async () => {
    const ds = randomUUID();
    const result = await publishItems(ds, [
      { objectId: 'a', object: { name: 'alpha' } },
      { objectId: 'b', object: { name: 'beta' } },
    ]);

    expect(result).toMatchObject({
      inserted: 2,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      finalRows: 2,
    });
    const rows = await datastoreRows(ds);
    expect(rows.map(r => r.object_id)).toEqual(['a', 'b']);
    expect(rows[0].parsed).toEqual({ name: 'alpha' });
    expect(rows[0].object_hash).toBe(canonicalJsonHash({ name: 'alpha' }));
  });

  it('diff-merges: unchanged rows keep their updated_at, changed/new/vanished rows are updated/inserted/deleted', async () => {
    const ds = randomUUID();
    await publishItems(ds, [
      { objectId: 'stable', object: { name: 'same' } },
      { objectId: 'changing', object: { name: 'old' } },
      { objectId: 'vanishing', object: { name: 'bye' } },
    ]);
    const before = await datastoreRows(ds);
    const stableBefore = before.find(r => r.object_id === 'stable')!;
    const changingBefore = before.find(r => r.object_id === 'changing')!;

    const result = await publishItems(ds, [
      { objectId: 'stable', object: { name: 'same' } },
      { objectId: 'changing', object: { name: 'new' } },
      { objectId: 'fresh', object: { name: 'hi' } },
    ]);

    expect(result).toMatchObject({
      inserted: 1,
      updated: 1,
      deleted: 1,
      unchanged: 1,
      finalRows: 3,
    });
    const after = await datastoreRows(ds);
    expect(after.map(r => r.object_id)).toEqual([
      'changing',
      'fresh',
      'stable',
    ]);

    const stableAfter = after.find(r => r.object_id === 'stable')!;
    expect(stableAfter.updated_at).toEqual(stableBefore.updated_at);
    // The row identity survives untouched — not deleted and reinserted.
    expect(stableAfter.id).toBe(stableBefore.id);

    const changingAfter = after.find(r => r.object_id === 'changing')!;
    expect(changingAfter.parsed).toEqual({ name: 'new' });
    expect(changingAfter.id).toBe(changingBefore.id);
    expect(changingAfter.updated_at.getTime()).toBeGreaterThan(
      changingBefore.updated_at.getTime(),
    );
  });

  it('a semantically identical object is a no-op regardless of key order', async () => {
    const ds = randomUUID();
    await publishItems(ds, [
      { objectId: 'a', object: { x: 1, y: 'z' } as JsonObject },
    ]);
    const result = await publishItems(ds, [
      { objectId: 'a', object: { y: 'z', x: 1 } as JsonObject },
    ]);
    expect(result).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });
  });

  it('publishing an empty final set deletes everything (legitimate empty dataset)', async () => {
    const ds = randomUUID();
    await publishItems(ds, [{ objectId: 'a', object: { n: 1 } }]);
    const result = await publishItems(ds, []);
    expect(result).toMatchObject({ deleted: 1, inserted: 0, finalRows: 0 });
    expect(await datastoreRows(ds)).toHaveLength(0);
  });

  it('reconciles datastore_index rows for the delta and leaves unchanged rows alone', async () => {
    const ds = randomUUID();
    const configId = randomUUID();
    await knex('datastore_index_configuration').insert({
      id: configId,
      datasource_id: ds,
      key: 'name',
      value_expression: 'name',
    });
    const snapshot = await capturePublishSnapshot(knex, ds);

    await publishItems(ds, [
      { objectId: 'stable', object: { name: 'same' } },
      { objectId: 'changing', object: { name: 'old' } },
    ]);

    const indexBefore = await knex('datastore_index')
      .join('datastore', 'datastore.id', 'datastore_index.datastore_id')
      .where('datastore.datasource_id', ds)
      .select(
        'datastore_index.id',
        'datastore_index.value',
        'datastore.object_id',
      );
    expect(indexBefore).toHaveLength(2);
    const stableIndexBefore = indexBefore.find(
      (r: { object_id: string }) => r.object_id === 'stable',
    )!;

    await publishItems(ds, [
      { objectId: 'stable', object: { name: 'same' } },
      { objectId: 'changing', object: { name: 'new' } },
    ]);

    const indexAfter = await knex('datastore_index')
      .join('datastore', 'datastore.id', 'datastore_index.datastore_id')
      .where('datastore.datasource_id', ds)
      .select(
        'datastore_index.id',
        'datastore_index.value',
        'datastore.object_id',
      );
    expect(indexAfter).toHaveLength(2);
    // Unchanged row's index row untouched (same id); changed row re-derived.
    expect(
      indexAfter.find((r: { object_id: string }) => r.object_id === 'stable')!
        .id,
    ).toBe(stableIndexBefore.id);
    expect(
      indexAfter.find((r: { object_id: string }) => r.object_id === 'changing')!
        .value,
    ).toBe('new');
    expect(snapshot.indexes).toHaveLength(1);
  });

  it('reconciles indexes only for datastore rows in the publishing workspace', async () => {
    const ds = randomUUID();
    const otherWorkspaceId = randomUUID();
    const otherConfigId = randomUUID();
    await knex('datastore_index_configuration').insert({
      id: otherConfigId,
      datasource_id: ds,
      workspace_id: otherWorkspaceId,
      key: 'name',
      value_expression: 'name',
    });
    await publishItems(
      ds,
      [{ objectId: 'shared', object: { name: 'other workspace' } }],
      { workspaceId: otherWorkspaceId },
    );

    const configId = randomUUID();
    await knex('datastore_index_configuration').insert({
      id: configId,
      datasource_id: ds,
      key: 'name',
      value_expression: 'name',
    });
    await publishItems(ds, [
      { objectId: 'shared', object: { name: 'default workspace' } },
    ]);

    const indexedWorkspaces = await knex('datastore_index')
      .join('datastore', 'datastore.id', 'datastore_index.datastore_id')
      .where('datastore_index.datastore_index_configuration_id', configId)
      .pluck('datastore.workspace_id');
    expect(indexedWorkspaces).toEqual(['00000000-0000-4000-8000-000000000001']);
  });

  it('creates the virtual id configuration in-tx and indexes ALL final rows', async () => {
    const ds = randomUUID();
    const snapshot = await capturePublishSnapshot(knex, ds, {
      idSelectorExpression: 'name',
    });
    expect(snapshot.indexes).toEqual([
      expect.objectContaining({ key: 'id', virtual: true }),
    ]);

    await publishItems(
      ds,
      [
        { objectId: 'a', object: { name: 'alpha' } },
        { objectId: 'b', object: { name: 'beta' } },
      ],
      { snapshot },
    );

    const configs = await knex('datastore_index_configuration').where(
      'datasource_id',
      ds,
    );
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ key: 'id', value_expression: 'name' });

    const indexRows = await knex('datastore_index')
      .where('datastore_index_configuration_id', configs[0].id)
      .orderBy('value')
      .select('value');
    expect(indexRows.map((r: { value: string }) => r.value)).toEqual([
      'alpha',
      'beta',
    ]);
  });

  it('a superseded (zombie) attempt cannot publish', async () => {
    const ds = randomUUID();
    await publishItems(ds, [{ objectId: 'live', object: { n: 1 } }]);

    const snapshot = await capturePublishSnapshot(knex, ds);
    const { executionId, attemptId, range } = await startAttemptFor(snapshot);
    await stageAndSeal(range, [{ objectId: 'zombie', object: {} }], snapshot);
    // A re-dispatch supersedes the first attempt.
    await attemptDao.startAttempt(
      executionId,
      snapshot as unknown as JsonObject,
    );

    await expect(
      publisher.publish({
        executionId,
        attemptId,
        nodeId: NODE_ID,
        datasourceId: ds,
        strategy: 'fail',
      }),
    ).rejects.toThrow(PublishAbortedError);

    const rows = await datastoreRows(ds);
    expect(rows.map(r => r.object_id)).toEqual(['live']);
  });

  it('a manifest mismatch (UNLOGGED truncation) aborts before any delete', async () => {
    const ds = randomUUID();
    await publishItems(ds, [{ objectId: 'survivor', object: { n: 1 } }]);

    const snapshot = await capturePublishSnapshot(knex, ds);
    const { executionId, attemptId, range } = await startAttemptFor(snapshot);
    await stageAndSeal(
      range,
      [
        { objectId: 'x', object: { n: 2 } },
        { objectId: 'y', object: { n: 3 } },
      ],
      snapshot,
    );
    // Simulate the PG crash/failover truncation of the UNLOGGED table.
    await knex('workflow_staging')
      .where({ execution_id: executionId, attempt_id: attemptId })
      .del();

    await expect(
      publisher.publish({
        executionId,
        attemptId,
        nodeId: NODE_ID,
        datasourceId: ds,
        strategy: 'fail',
      }),
    ).rejects.toThrow(/manifest mismatch/);

    const rows = await datastoreRows(ds);
    expect(rows.map(r => r.object_id)).toEqual(['survivor']);
  });

  it('an index configuration added mid-run aborts the publish', async () => {
    const ds = randomUUID();
    const snapshot = await capturePublishSnapshot(knex, ds);
    const { executionId, attemptId, range } = await startAttemptFor(snapshot);
    await stageAndSeal(range, [{ objectId: 'a', object: {} }], snapshot);

    await knex('datastore_index_configuration').insert({
      id: randomUUID(),
      datasource_id: ds,
      key: 'sneaky',
      value_expression: 'name',
    });

    await expect(
      publisher.publish({
        executionId,
        attemptId,
        nodeId: NODE_ID,
        datasourceId: ds,
        strategy: 'fail',
      }),
    ).rejects.toThrow(/added during the run/);
    expect(await datastoreRows(ds)).toHaveLength(0);
  });

  it('an index configuration changed mid-run aborts the publish', async () => {
    const ds = randomUUID();
    const configId = randomUUID();
    await knex('datastore_index_configuration').insert({
      id: configId,
      datasource_id: ds,
      key: 'name',
      value_expression: 'name',
    });
    const snapshot = await capturePublishSnapshot(knex, ds);
    const { executionId, attemptId, range } = await startAttemptFor(snapshot);
    await stageAndSeal(range, [{ objectId: 'a', object: {} }], snapshot);

    await knex('datastore_index_configuration')
      .where('id', configId)
      .update({ value_expression: 'other' });

    await expect(
      publisher.publish({
        executionId,
        attemptId,
        nodeId: NODE_ID,
        datasourceId: ds,
        strategy: 'fail',
      }),
    ).rejects.toThrow(/changed during the run/);
  });

  it('fail strategy aborts on duplicate object ids', async () => {
    const ds = randomUUID();
    await expect(
      publishItems(
        ds,
        [
          { objectId: 'dup', object: { n: 1 } },
          { objectId: 'dup', object: { n: 2 } },
        ],
        { strategy: 'fail' },
      ),
    ).rejects.toThrow(/Duplicate objectId values: dup/);
    expect(await datastoreRows(ds)).toHaveLength(0);
  });

  it('keep_last keeps the last occurrence by order', async () => {
    const ds = randomUUID();
    const result = await publishItems(
      ds,
      [
        { objectId: 'dup', object: { v: 'first' } },
        { objectId: 'dup', object: { v: 'last' } },
        { objectId: 'other', object: { v: 'solo' } },
      ],
      { strategy: 'keep_last' },
    );
    expect(result).toMatchObject({
      inserted: 2,
      finalRows: 2,
      duplicatesResolved: 1,
    });
    const rows = await datastoreRows(ds);
    expect(rows.find(r => r.object_id === 'dup')!.parsed).toEqual({
      v: 'last',
    });
  });

  it('expand rewrites duplicates to compound ids with the existing separator', async () => {
    const ds = randomUUID();
    const result = await publishItems(
      ds,
      [
        { objectId: 'dup', object: { v: 1 } },
        { objectId: 'dup', object: { v: 2 } },
        { objectId: 'dup', object: { v: 3 } },
      ],
      { strategy: 'expand' },
    );
    expect(result).toMatchObject({ inserted: 3, finalRows: 3 });
    const rows = await datastoreRows(ds);
    expect(rows.map(r => r.object_id).sort()).toEqual([
      'dup',
      `dup${DUPLICATE_OBJECT_ID_EXPAND_SEP}1`,
      `dup${DUPLICATE_OBJECT_ID_EXPAND_SEP}2`,
    ]);
    // First occurrence keeps the base id and its own object.
    expect(rows.find(r => r.object_id === 'dup')!.parsed).toEqual({ v: 1 });
  });

  it('append folds duplicates into the winner and re-indexes the merged object', async () => {
    const ds = randomUUID();
    await knex('datastore_index_configuration').insert({
      id: randomUUID(),
      datasource_id: ds,
      key: 'name',
      value_expression: 'name',
    });
    const snapshot = await capturePublishSnapshot(knex, ds);

    const result = await publishItems(
      ds,
      [
        { objectId: 'dup', object: { name: 'winner' } },
        { objectId: 'dup', object: { name: 'extra' } },
      ],
      { snapshot, strategy: 'append' },
    );
    expect(result).toMatchObject({
      inserted: 1,
      finalRows: 1,
      duplicatesResolved: 1,
    });

    const [row] = await datastoreRows(ds);
    expect(row.parsed).toEqual({
      name: 'winner',
      additionalResults: [{ name: 'extra' }],
      duplicateCount: 1,
    });
    expect(row.object_hash).toBe(canonicalJsonHash(row.parsed));

    // The merged object was re-indexed as merged.
    const indexRows = await knex('datastore_index')
      .where('datastore_id', row.id)
      .select('key', 'value');
    expect(indexRows).toEqual([{ key: 'name', value: 'winner' }]);
  });

  it('append on a hot id (50k duplicates) stays bounded at APPEND_KEEP embedded results', async () => {
    const ds = randomUUID();
    const items: StagedInput[] = [];
    for (let i = 0; i < 50_000; i++) {
      items.push({ objectId: 'hot', object: { n: i } });
    }
    const result = await publishItems(ds, items, { strategy: 'append' });
    expect(result).toMatchObject({
      inserted: 1,
      finalRows: 1,
      duplicatesResolved: 49_999,
    });

    const [row] = await datastoreRows(ds);
    expect(row.parsed.n).toBe(0);
    expect(row.parsed.additionalResults).toHaveLength(APPEND_KEEP);
    expect(row.parsed.duplicateCount).toBe(49_999);
  }, 120_000);

  it('rejects staged rows without an object_id', async () => {
    const ds = randomUUID();
    const snapshot = await capturePublishSnapshot(knex, ds);
    const { executionId, attemptId, range } = await startAttemptFor(snapshot);
    await stagingDao.appendPage(range, [
      { orderKey: [0], objectId: null, objectHash: 'h', object: '{}' },
    ]);
    await attemptDao.recordManifest(executionId, attemptId, {
      [`${NODE_ID}`]: { rows: 1, indexRows: 0 },
    });

    await expect(
      publisher.publish({
        executionId,
        attemptId,
        nodeId: NODE_ID,
        datasourceId: ds,
        strategy: 'fail',
      }),
    ).rejects.toThrow(/no object_id/);
  });

  it('expressionHash mismatches keep stale staging-index rows out of the reconcile', async () => {
    const ds = randomUUID();
    const configId = randomUUID();
    await knex('datastore_index_configuration').insert({
      id: configId,
      datasource_id: ds,
      key: 'name',
      value_expression: 'name',
    });
    const snapshot = await capturePublishSnapshot(knex, ds);
    const { executionId, attemptId, range } = await startAttemptFor(snapshot);

    await stagingDao.appendPage(range, [
      {
        orderKey: [0],
        objectId: 'a',
        objectHash: canonicalJsonHash({ name: 'x' }),
        object: JSON.stringify({ name: 'x' }),
      },
    ]);
    const [staged] = await knex('workflow_staging')
      .where({ execution_id: executionId })
      .select('seq');
    // A row derived from a DIFFERENT expression than the snapshot's.
    await stagingDao.appendIndexRows(range, [
      {
        seq: staged.seq,
        configKey: 'name',
        expressionHash: indexExpressionHash('some-other-expression'),
        value: 'stale',
      },
    ]);
    await attemptDao.recordManifest(executionId, attemptId, {
      [`${NODE_ID}`]: { rows: 1, indexRows: 1 },
    });

    await publisher.publish({
      executionId,
      attemptId,
      nodeId: NODE_ID,
      datasourceId: ds,
      strategy: 'fail',
    });

    const indexRows = await knex('datastore_index').where(
      'datastore_index_configuration_id',
      configId,
    );
    expect(indexRows).toHaveLength(0);
  });

  describe('schema persistence (§5c)', () => {
    async function schemaVersions(datasourceId: string) {
      return knex('datastore_schema')
        .where('datasource_id', datasourceId)
        .orderBy('version')
        .select('id', 'version', 'content_hash', 'schema');
    }

    it('creates a schema version in the publish tx and stamps every row', async () => {
      const ds = randomUUID();
      const result = await publishItems(ds, [
        { objectId: 'a', object: { name: 'alpha' } },
        { objectId: 'b', object: { name: 'beta' } },
      ]);

      const versions = await schemaVersions(ds);
      expect(versions).toHaveLength(1);
      expect(versions[0].version).toBe(1);
      expect(result.schemaId).toBe(versions[0].id);
      const rows = await knex('datastore')
        .where('datasource_id', ds)
        .select('schema_id');
      expect(rows).toHaveLength(2);
      expect(rows.every(r => r.schema_id === result.schemaId)).toBe(true);
    });

    it('reuses the version while the shape holds and creates the next one on drift', async () => {
      const ds = randomUUID();
      const first = await publishItems(ds, [
        { objectId: 'a', object: { name: 'alpha' } },
      ]);
      // Different value, same shape: still version 1.
      const second = await publishItems(ds, [
        { objectId: 'a', object: { name: 'omega' } },
      ]);
      expect(second.schemaId).toBe(first.schemaId);

      // New field: shape drifts, version 2.
      const third = await publishItems(ds, [
        { objectId: 'a', object: { name: 'omega', count: 3 } },
      ]);
      expect(third.schemaId).not.toBe(first.schemaId);
      const versions = await schemaVersions(ds);
      expect(versions.map(v => v.version)).toEqual([1, 2]);
    });

    it('restamps unchanged rows to the new version without touching object or updated_at', async () => {
      const ds = randomUUID();
      await publishItems(ds, [
        { objectId: 'stable', object: { name: 'same' } },
        { objectId: 'drifting', object: { name: 'old' } },
      ]);
      const stableBefore = await knex('datastore')
        .where({ datasource_id: ds, object_id: 'stable' })
        .first();

      const result = await publishItems(ds, [
        { objectId: 'stable', object: { name: 'same' } },
        { objectId: 'drifting', object: { name: 'old', extra: true } },
      ]);
      expect(result.unchanged).toBe(1);

      const stableAfter = await knex('datastore')
        .where({ datasource_id: ds, object_id: 'stable' })
        .first();
      expect(stableAfter.schema_id).toBe(result.schemaId);
      expect(stableAfter.schema_id).not.toBe(stableBefore.schema_id);
      expect(stableAfter.object).toBe(stableBefore.object);
      expect(stableAfter.updated_at.getTime()).toBe(
        stableBefore.updated_at.getTime(),
      );
    });

    it('uses an explicit schema instead of inference', async () => {
      const ds = randomUUID();
      const explicit = {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      };
      await publishItems(ds, [{ objectId: 'a', object: { name: 'x' } }], {
        schema: explicit,
      });

      const [version] = await schemaVersions(ds);
      expect(version.schema).toEqual(explicit);
    });

    it('an empty publish deletes the dataset without minting a schema version', async () => {
      const ds = randomUUID();
      const first = await publishItems(ds, [
        { objectId: 'a', object: { name: 'x' } },
      ]);
      expect(first.schemaId).not.toBeNull();

      const result = await publishItems(ds, []);
      expect(result.schemaId).toBeNull();
      expect(result.deleted).toBe(1);
      expect(await knex('datastore').where('datasource_id', ds)).toHaveLength(
        0,
      );
      expect(await schemaVersions(ds)).toHaveLength(1);
    });
  });
});
