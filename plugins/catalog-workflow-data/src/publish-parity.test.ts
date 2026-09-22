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

/**
 * sc-34102 acceptance: "API PUT and workflow publish produce identical
 * datastore/index end state for identical input." Both feeders run the shared
 * diff-merge (§5); this exercises the whole real stack on both sides — the
 * StagedPublisher over staged rows vs DatastoreRepository over request items —
 * and compares the normalized end state.
 */

import { TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import type { JsonObject } from '@roadiehq/types';
import { canonicalJsonHash } from '@roadiehq/catalog-datastore-node';
import {
  DatasourceActivityDao,
  DatasourceEvents,
  DatastoreRepository,
  IndexDao,
  ObjectDao,
  RelationshipDao,
  RelationshipRuleDao,
  SchemaDao,
  WorkflowSyncSubscriber,
} from '@roadiehq/catalog-datastore-backend';
import { WORKFLOW_DATASTORE_SYNC_TOPIC } from '@roadiehq/catalog-workflow-common';
import { applySubstrateTestMigrations } from './test-migrations';
import { WorkflowAttemptDao } from './WorkflowAttemptDao';
import { WorkflowStagingDao } from './WorkflowStagingDao';
import {
  StagedPublisher,
  capturePublishSnapshot,
  type PublishSnapshot,
} from './StagedPublisher';
import { createTestLogger } from './test-logger';

const databases = TestDatabases.create();

const NODE_ID = 'sink';
const DATASOURCE_NAME = 'parity-source';

interface InputItem {
  objectId: string;
  object: JsonObject;
}

describe('publish parity: staged publish vs direct-write API', () => {
  let knex: Knex;
  let attemptDao: WorkflowAttemptDao;
  let stagingDao: WorkflowStagingDao;
  let publisher: StagedPublisher;
  let repository: DatastoreRepository;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applySubstrateTestMigrations(knex);
    const logger = createTestLogger();
    attemptDao = new WorkflowAttemptDao({ knex, logger });
    stagingDao = new WorkflowStagingDao({ knex, logger });
    publisher = new StagedPublisher({ knex, logger });
    repository = new DatastoreRepository({
      knex,
      logger,
      objectDao: new ObjectDao({ knex }),
      schemaDao: new SchemaDao({ knex }),
      indexDao: new IndexDao({ knex, logger }),
      relationshipDao: new RelationshipDao({ knex }),
      relationshipRuleDao: new RelationshipRuleDao({ knex }),
    });
  }, 180_000);

  afterAll(async () => {
    if (knex) {
      await knex.destroy();
    }
  });

  async function createIndexConfig(datasourceId: string): Promise<void> {
    await knex('datastore_index_configuration').insert({
      id: randomUUID(),
      datasource_id: datasourceId,
      key: 'name',
      value_expression: 'name',
      purpose: 'column',
    });
  }

  async function publishStaged(datasourceId: string, items: InputItem[]) {
    const snapshot: PublishSnapshot = await capturePublishSnapshot(
      knex,
      datasourceId,
    );
    const executionId = randomUUID();
    const { attemptId } = await attemptDao.startAttempt(
      executionId,
      snapshot as unknown as JsonObject,
    );
    const range = { executionId, attemptId, nodeId: NODE_ID };

    if (items.length > 0) {
      await stagingDao.appendPage(
        range,
        items.map((item, i) => ({
          orderKey: [i],
          objectId: item.objectId,
          objectHash: canonicalJsonHash(item.object),
          object: JSON.stringify(item.object),
        })),
      );
    }

    // Derive staging-index rows the way the sink does at spill time.
    let indexRows = 0;
    const staged: Array<{ seq: string; object: string }> = await knex(
      'workflow_staging',
    )
      .where({
        execution_id: executionId,
        attempt_id: attemptId,
        node_id: NODE_ID,
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
    await attemptDao.recordManifest(executionId, attemptId, {
      [`${NODE_ID}`]: { rows: items.length, indexRows },
    });

    return publisher.publish({
      executionId,
      attemptId,
      nodeId: NODE_ID,
      datasourceId,
      strategy: 'fail',
      datasourceName: DATASOURCE_NAME,
    });
  }

  async function publishApi(
    datasourceId: string,
    items: InputItem[],
  ): Promise<void> {
    await repository.replaceDatasourceItems(
      datasourceId,
      items.map(item => ({ ...item, datasourceId })),
      { datasourceName: DATASOURCE_NAME },
    );
  }

  /** Normalized end state, independent of generated ids and timestamps. */
  async function endState(datasourceId: string) {
    const rows = await knex('datastore')
      .where('datasource_id', datasourceId)
      .orderBy('object_id');
    const indexes = await knex('datastore_index')
      .join('datastore', 'datastore.id', 'datastore_index.datastore_id')
      .where('datastore.datasource_id', datasourceId)
      .orderBy(['datastore.object_id', 'datastore_index.key'])
      .select(
        'datastore.object_id',
        'datastore_index.key',
        'datastore_index.value',
      );
    const schemas = await knex('datastore_schema')
      .where('datasource_id', datasourceId)
      .orderBy('version')
      .select('version', 'description', 'content_hash', 'schema');
    const schemaIdToVersion = new Map<string, number>(
      (
        await knex('datastore_schema')
          .where('datasource_id', datasourceId)
          .select('id', 'version')
      ).map((row: { id: string; version: number }) => [row.id, row.version]),
    );
    return {
      rows: rows.map(
        (row: {
          object_id: string;
          object: string;
          object_hash: string;
          schema_id: string;
        }) => ({
          objectId: row.object_id,
          object: JSON.parse(row.object) as JsonObject,
          objectHash: row.object_hash,
          schemaVersion: schemaIdToVersion.get(row.schema_id),
        }),
      ),
      indexes,
      schemas,
    };
  }

  it('identical input produces identical datastore, index, and schema end state', async () => {
    const stagedDs = randomUUID();
    const apiDs = randomUUID();
    await createIndexConfig(stagedDs);
    await createIndexConfig(apiDs);

    const initial: InputItem[] = [
      { objectId: 'a', object: { name: 'alpha', tags: ['x', 'y'] } },
      { objectId: 'b', object: { nested: { deep: true }, name: 'beta' } },
      { objectId: 'c', object: { name: 42 } }, // non-string index value: not indexed
    ];
    await publishStaged(stagedDs, initial);
    await publishApi(apiDs, initial);

    const stagedState1 = await endState(stagedDs);
    const apiState1 = await endState(apiDs);
    expect(stagedState1).toEqual(apiState1);
    expect(stagedState1.rows).toHaveLength(3);
    expect(stagedState1.indexes).toHaveLength(2);

    // Update / delete / insert / no-op mix — including a key-order change
    // that must stay a no-op through canonical hashing on both paths.
    const next: InputItem[] = [
      { objectId: 'a', object: { tags: ['x', 'y'], name: 'alpha' } }, // no-op
      { objectId: 'b', object: { nested: { deep: false }, name: 'BETA' } }, // update
      { objectId: 'd', object: { name: 'delta', extra: 1 } }, // insert (+schema drift)
      // c vanishes
    ];
    await publishStaged(stagedDs, next);
    await publishApi(apiDs, next);

    const stagedState2 = await endState(stagedDs);
    const apiState2 = await endState(apiDs);
    expect(stagedState2).toEqual(apiState2);
    expect(stagedState2.rows.map(r => r.objectId)).toEqual(['a', 'b', 'd']);
    expect(stagedState2.schemas).toHaveLength(2);
    expect(stagedState2.rows.every(r => r.schemaVersion === 2)).toBe(true);
  });

  // sc-34243: identical END STATE is not enough — a publish must also end in
  // identical delta-gated SIDE EFFECTS (activity marker, datasource-changed,
  // relationship auto-apply), whichever feeder wrote it. The API feeder runs
  // them inline in replaceDatasourceItems; the staged feeder reaches the same
  // choke point (applyPublishSideEffects) through the workflow sync event and
  // WorkflowSyncSubscriber. The regression this guards: the paged engine went
  // live with the staged feeder carrying none of these, so relations, context
  // groups, and webhooks silently froze after every data source run.
  describe('side-effect parity between the two feeders', () => {
    let activityDao: DatasourceActivityDao;
    let effectRepo: DatastoreRepository;
    let changedIds: string[];
    let applySpy: ReturnType<typeof vi.spyOn>;
    let deliverSyncEvent: (eventPayload: JsonObject) => Promise<void>;

    beforeAll(async () => {
      const logger = createTestLogger();
      activityDao = new DatasourceActivityDao({ knex });
      const datasourceEvents = new DatasourceEvents();
      changedIds = [];
      datasourceEvents.onChanged(id => changedIds.push(id));
      effectRepo = new DatastoreRepository({
        knex,
        logger,
        objectDao: new ObjectDao({ knex }),
        schemaDao: new SchemaDao({ knex }),
        indexDao: new IndexDao({ knex, logger }),
        relationshipDao: new RelationshipDao({ knex }),
        relationshipRuleDao: new RelationshipRuleDao({ knex }),
        activityDao,
        events: datasourceEvents,
      });
      applySpy = vi
        .spyOn(effectRepo, 'applyRelationshipRulesForDatasources')
        .mockResolvedValue(undefined as never);

      // The real subscriber over a captured onEvent, so the staged feeder's
      // leg exercises the production payload parsing, not a shortcut call.
      let onEvent:
        | ((event: { topic: string; eventPayload: unknown }) => Promise<void>)
        | undefined;
      const captureEvents = {
        subscribe: async (options: { onEvent: typeof onEvent }) => {
          onEvent = options.onEvent;
        },
        publish: async () => {},
      };
      const subscriber = new WorkflowSyncSubscriber({
        events: captureEvents as unknown as ConstructorParameters<
          typeof WorkflowSyncSubscriber
        >[0]['events'],
        logger,
        onSync: (datasourceId, delta) =>
          effectRepo.applyPublishSideEffects(datasourceId, delta),
      });
      await subscriber.subscribe();
      deliverSyncEvent = eventPayload =>
        onEvent!({ topic: WORKFLOW_DATASTORE_SYNC_TOPIC, eventPayload });
    });

    interface ObservedSideEffects {
      changedEmitted: boolean;
      applyScheduled: boolean;
      activity: 'created' | 'advanced' | 'unchanged';
    }

    async function observe(
      datasourceId: string,
      run: () => Promise<void>,
    ): Promise<ObservedSideEffects> {
      const before = await activityDao.get(datasourceId);
      changedIds.length = 0;
      applySpy.mockClear();
      // Activity timestamps have finite resolution; keep consecutive
      // publishes from landing on the same instant.
      await new Promise(resolve => setTimeout(resolve, 5));
      await run();
      await effectRepo.flushAutoApplyForTesting();
      const after = await activityDao.get(datasourceId);
      let activity: ObservedSideEffects['activity'];
      if (!before) {
        activity = after ? 'created' : 'unchanged';
      } else {
        activity =
          after?.updatedAt === before.updatedAt ? 'unchanged' : 'advanced';
      }
      return {
        changedEmitted: changedIds.includes(datasourceId),
        applyScheduled: applySpy.mock.calls.some((call: unknown[]) =>
          (call[0] as string[]).includes(datasourceId),
        ),
        activity,
      };
    }

    // The staged feeder's production tail: publish, then the sync event the
    // datastore sink emits, carrying the delta.
    async function runStaged(datasourceId: string, items: InputItem[]) {
      const result = await publishStaged(datasourceId, items);
      await deliverSyncEvent({
        datasourceId,
        workflowId: datasourceId,
        workflowName: DATASOURCE_NAME,
        itemCount: result.finalRows,
        deleted: result.deleted,
        updated: result.updated,
        inserted: result.inserted,
      });
    }

    async function runApi(datasourceId: string, items: InputItem[]) {
      await effectRepo.replaceDatasourceItems(
        datasourceId,
        items.map(item => ({ ...item, datasourceId })),
        { datasourceName: DATASOURCE_NAME },
      );
    }

    it('both feeders fire identical side effects across insert, no-op, update, and delete publishes', async () => {
      const stagedDs = randomUUID();
      const apiDs = randomUUID();

      const transitions: Array<{
        items: InputItem[];
        expected: ObservedSideEffects;
      }> = [
        {
          // First publish: insert.
          items: [{ objectId: 'a', object: { name: 'alpha' } }],
          expected: {
            changedEmitted: true,
            applyScheduled: true,
            activity: 'created',
          },
        },
        {
          // Identical payload: a no-op stays silent, but the datasource
          // still reads as synced.
          items: [{ objectId: 'a', object: { name: 'alpha' } }],
          expected: {
            changedEmitted: false,
            applyScheduled: false,
            activity: 'unchanged',
          },
        },
        {
          // Hash change: update.
          items: [{ objectId: 'a', object: { name: 'ALPHA' } }],
          expected: {
            changedEmitted: true,
            applyScheduled: true,
            activity: 'advanced',
          },
        },
        {
          // Everything vanishes: a delete-only publish is still a change.
          items: [],
          expected: {
            changedEmitted: true,
            applyScheduled: true,
            activity: 'advanced',
          },
        },
      ];

      for (const [i, transition] of transitions.entries()) {
        const staged = await observe(stagedDs, () =>
          runStaged(stagedDs, transition.items),
        );
        const api = await observe(apiDs, () => runApi(apiDs, transition.items));
        expect({ transition: i, ...staged }).toEqual({
          transition: i,
          ...api,
        });
        expect({ transition: i, ...staged }).toEqual({
          transition: i,
          ...transition.expected,
        });
      }
    });
  });
});
