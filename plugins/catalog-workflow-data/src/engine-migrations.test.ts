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
import { resolvePackagePath } from '@roadiehq/extensions-api';
import { applySubstrateTestMigrations } from './test-migrations';

const databases = TestDatabases.create();

/**
 * The workflow chain the way shared-schema deployments run it (roadie-next
 * applies every plugin chain to one per-tenant schema, each with its own
 * ledger table).
 */
async function applyWorkflowChain(db: Knex): Promise<void> {
  await db.migrate.latest({
    directory: resolvePackagePath(
      '@roadiehq/catalog-workflow-data',
      'migrations',
    ),
    tableName: 'knex_migrations_catalog_workflow',
  });
}

describe('bounded-memory engine migration', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applySubstrateTestMigrations(knex);
  }, 120_000);

  afterAll(async () => {
    if (knex) {
      await knex.destroy();
    }
  });

  async function isUnlogged(table: string): Promise<boolean> {
    // relpersistence: 'u' = unlogged, 'p' = permanent (logged).
    const result = await knex.raw(
      `SELECT relpersistence FROM pg_class WHERE relname = ?`,
      [table],
    );
    return result.rows[0]?.relpersistence === 'u';
  }

  it('creates workflow_staging as an unlogged table with the expected PK', async () => {
    expect(await isUnlogged('workflow_staging')).toBe(true);

    const executionId = randomUUID();
    const attemptId = randomUUID();
    await knex('workflow_staging').insert({
      execution_id: executionId,
      attempt_id: attemptId,
      node_id: 'source',
      seq: 1,
      order_key: [0],
      object_id: 'obj-1',
      object_hash: 'deadbeef',
      object: JSON.stringify({ a: 1 }),
    });

    const [row] = await knex('workflow_staging')
      .where({ execution_id: executionId })
      .select();
    expect(row.node_id).toBe('source');
    expect(row.is_final).toBe(false);
    // pg returns bigint[] elements as strings to avoid precision loss.
    expect(row.order_key).toEqual(['0']);

    await expect(
      knex('workflow_staging').insert({
        execution_id: executionId,
        attempt_id: attemptId,
        node_id: 'source',
        seq: 1,
        order_key: [1],
        object_hash: 'x',
        object: '{}',
      }),
    ).rejects.toThrow();
  });

  it('creates workflow_staging_index as an unlogged table', async () => {
    expect(await isUnlogged('workflow_staging_index')).toBe(true);

    const executionId = randomUUID();
    const attemptId = randomUUID();
    await knex('workflow_staging_index').insert({
      execution_id: executionId,
      attempt_id: attemptId,
      node_id: 'sink',
      seq: 1,
      config_key: 'id',
      expression_hash: 'h1',
      value: 'v1',
    });
    const rows = await knex('workflow_staging_index')
      .where({ execution_id: executionId })
      .select();
    expect(rows).toHaveLength(1);
  });

  it('creates workflow_execution_attempt as a logged table enforcing one active attempt', async () => {
    expect(await isUnlogged('workflow_execution_attempt')).toBe(false);

    const executionId = randomUUID();
    await knex('workflow_execution_attempt').insert({
      execution_id: executionId,
      attempt_id: randomUUID(),
      state: 'active',
      publish_snapshot: JSON.stringify({ indexes: [] }),
    });

    await expect(
      knex('workflow_execution_attempt').insert({
        execution_id: executionId,
        attempt_id: randomUUID(),
        state: 'active',
        publish_snapshot: JSON.stringify({ indexes: [] }),
      }),
    ).rejects.toThrow();

    // A non-active second attempt is allowed for the same execution.
    await knex('workflow_execution_attempt').insert({
      execution_id: executionId,
      attempt_id: randomUUID(),
      state: 'superseded',
      publish_snapshot: JSON.stringify({ indexes: [] }),
    });
  });

  it('creates execution_event as a logged table with a composite PK', async () => {
    expect(await isUnlogged('execution_event')).toBe(false);

    const executionId = randomUUID();
    const attemptId = randomUUID();
    await knex('execution_event').insert({
      execution_id: executionId,
      attempt_id: attemptId,
      seq: 1,
      event: JSON.stringify({ type: 'node-progress' }),
    });
    await expect(
      knex('execution_event').insert({
        execution_id: executionId,
        attempt_id: attemptId,
        seq: 1,
        event: JSON.stringify({ type: 'node-progress' }),
      }),
    ).rejects.toThrow();
  });
});

describe('shared-schema deployments (both chains on one schema)', () => {
  async function expectHealthySubstrate(db: Knex): Promise<void> {
    expect(await db.schema.hasTable('workflow_staging')).toBe(true);
    expect(await db.schema.hasTable('workflow_staging_index')).toBe(true);
    expect(await db.schema.hasTable('execution_event')).toBe(true);
    expect(
      await db.schema.hasColumn(
        'workflow_execution_attempt',
        'staging_reaped_at',
      ),
    ).toBe(true);
    expect(await db.schema.hasTable('datastore')).toBe(true);
    // The workflow chain's own tables must still be there.
    expect(await db.schema.hasTable('catalog_workflows')).toBe(true);
  }

  it('fresh schema, datastore chain first (roadie-next order)', async () => {
    const db = await databases.init('POSTGRES_16');
    try {
      await applySubstrateTestMigrations(db);
      await applyWorkflowChain(db);
      await expectHealthySubstrate(db);
    } finally {
      await db.destroy();
    }
  }, 120_000);

  it('fresh schema, workflow chain first', async () => {
    const db = await databases.init('POSTGRES_16');
    try {
      await applyWorkflowChain(db);
      await applySubstrateTestMigrations(db);
      await expectHealthySubstrate(db);
    } finally {
      await db.destroy();
    }
  }, 120_000);

  it('heals a schema where retired chains already created the substrate tables', async () => {
    const db = await databases.init('POSTGRES_16');
    try {
      // The pre-fix tenant state: the old workflow-chain migration created
      // the tables (old shape, no staging_reaped_at), and a short-lived
      // substrate chain left its ledger behind.
      await db.raw(`
        CREATE UNLOGGED TABLE workflow_staging (
          execution_id uuid NOT NULL,
          attempt_id   uuid NOT NULL,
          node_id      text NOT NULL,
          seq          bigint NOT NULL,
          PRIMARY KEY (execution_id, attempt_id, node_id, seq)
        )
      `);
      await db.raw(`
        CREATE TABLE workflow_execution_attempt (
          execution_id uuid NOT NULL,
          attempt_id   uuid NOT NULL,
          state        text NOT NULL,
          PRIMARY KEY (execution_id, attempt_id)
        )
      `);
      await db.raw(
        `CREATE TABLE knex_migrations_workflow_substrate (id serial PRIMARY KEY)`,
      );

      await applySubstrateTestMigrations(db);
      await applyWorkflowChain(db);

      await expectHealthySubstrate(db);
      expect(
        await db.schema.hasTable('knex_migrations_workflow_substrate'),
      ).toBe(false);
    } finally {
      await db.destroy();
    }
  }, 120_000);
});
