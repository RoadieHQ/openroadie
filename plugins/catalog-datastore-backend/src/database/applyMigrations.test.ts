/*
 * Copyright 2025 Larder Software Limited
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
import { applyMigrations } from './applyMigrations';
import { randomUUID } from 'crypto';

const databases = TestDatabases.create();

describe('applyMigrations', () => {
  let testDb: Knex;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
  }, 120_000);

  beforeEach(async () => {
    await testDb('datastore_index').del();
    await testDb('datastore').del();
    await testDb('datastore_index_configuration').del();
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  describe('datastore table', () => {
    it('should insert and query data', async () => {
      const id = randomUUID();
      const datasourceId = randomUUID();

      await testDb('datastore').insert({
        id,
        datasource_id: datasourceId,
        object_id: 'test-object-1',
        object: JSON.stringify({ name: 'Test Object', type: 'service' }),
      });

      const [result] = await testDb('datastore').where({ id }).select();

      expect(result.id).toBe(id);
      expect(result.datasource_id).toBe(datasourceId);
      expect(result.object_id).toBe('test-object-1');
      expect(JSON.parse(result.object)).toEqual({
        name: 'Test Object',
        type: 'service',
      });
      expect(result.created_at).toBeTruthy();
      expect(result.updated_at).toBeTruthy();
    });

    it('should enforce unique constraint on datasource_id and object_id', async () => {
      const datasourceId = randomUUID();

      await testDb('datastore').insert({
        id: randomUUID(),
        datasource_id: datasourceId,
        object_id: 'duplicate-object',
        object: JSON.stringify({ name: 'First' }),
      });

      await expect(
        testDb('datastore').insert({
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: 'duplicate-object',
          object: JSON.stringify({ name: 'Second' }),
        }),
      ).rejects.toThrow();
    });
  });

  describe('datastore_index table', () => {
    it('should insert and query index entries', async () => {
      const datastoreId = randomUUID();
      const configId = randomUUID();
      const datasourceId = randomUUID();

      await testDb('datastore').insert({
        id: datastoreId,
        datasource_id: datasourceId,
        object_id: 'test-object',
        object: JSON.stringify({ name: 'Test' }),
      });

      await testDb('datastore_index_configuration').insert({
        id: configId,
        datasource_id: datasourceId,
        key: 'name',
        value_expression: 'name',
      });

      const indexId = randomUUID();
      await testDb('datastore_index').insert({
        id: indexId,
        datastore_id: datastoreId,
        datastore_index_configuration_id: configId,
        key: 'name',
        value: 'Test',
      });

      const [result] = await testDb('datastore_index')
        .where({ id: indexId })
        .select();

      expect(result.id).toBe(indexId);
      expect(result.datastore_id).toBe(datastoreId);
      expect(result.datastore_index_configuration_id).toBe(configId);
      expect(result.key).toBe('name');
      expect(result.value).toBe('Test');
      expect(result.created_at).toBeTruthy();
    });

    it('should query index entries by key and value', async () => {
      const datasourceId = randomUUID();
      const configId = randomUUID();

      await testDb('datastore_index_configuration').insert({
        id: configId,
        datasource_id: datasourceId,
        key: 'type',
        value_expression: 'type',
      });

      const datastoreIds = [randomUUID(), randomUUID(), randomUUID()];
      for (let i = 0; i < 3; i++) {
        await testDb('datastore').insert({
          id: datastoreIds[i],
          datasource_id: datasourceId,
          object_id: `object-${i}`,
          object: JSON.stringify({ type: i < 2 ? 'service' : 'component' }),
        });

        await testDb('datastore_index').insert({
          id: randomUUID(),
          datastore_id: datastoreIds[i],
          datastore_index_configuration_id: configId,
          key: 'type',
          value: i < 2 ? 'service' : 'component',
        });
      }

      const services = await testDb('datastore_index')
        .where({ key: 'type', value: 'service' })
        .select();

      expect(services).toHaveLength(2);

      const components = await testDb('datastore_index')
        .where({ key: 'type', value: 'component' })
        .select();

      expect(components).toHaveLength(1);
    });
  });

  describe('datastore.object_hash', () => {
    it('accepts a null object_hash and lets a value be set', async () => {
      const id = randomUUID();
      const datasourceId = randomUUID();

      await testDb('datastore').insert({
        id,
        datasource_id: datasourceId,
        object_id: 'hash-object',
        object: JSON.stringify({ a: 1 }),
      });

      const [before] = await testDb('datastore').where({ id }).select();
      expect(before.object_hash).toBeNull();

      await testDb('datastore')
        .where({ id })
        .update({ object_hash: 'a'.repeat(64) });
      const [after] = await testDb('datastore').where({ id }).select();
      expect(after.object_hash).toBe('a'.repeat(64));
    });
  });

  describe('relationship apply tables', () => {
    async function isUnlogged(table: string): Promise<boolean> {
      const result = await testDb.raw(
        `SELECT relpersistence FROM pg_class WHERE relname = ?`,
        [table],
      );
      return result.rows[0]?.relpersistence === 'u';
    }

    it('creates relationship_apply_run as a logged table', async () => {
      expect(await isUnlogged('relationship_apply_run')).toBe(false);
      const runId = randomUUID();
      await testDb('relationship_apply_run').insert({
        run_id: runId,
        rule_id: randomUUID(),
        state: 'extracting',
        failed_source_object_ids: JSON.stringify(['a', 'b']),
      });
      const [row] = await testDb('relationship_apply_run')
        .where({ run_id: runId })
        .select();
      expect(row.state).toBe('extracting');
    });

    it('creates the unlogged scratch key and candidate tables', async () => {
      expect(await isUnlogged('relationship_apply_key')).toBe(true);
      expect(await isUnlogged('relationship_apply_candidate')).toBe(true);

      const runId = randomUUID();
      await testDb('relationship_apply_key').insert({
        run_id: runId,
        side: 'source',
        row_id: randomUUID(),
        value: 'v',
      });
      await testDb('relationship_apply_candidate').insert({
        run_id: runId,
        source_datasource_id: randomUUID(),
        source_object_id: 's',
        relation_type: 'ownedBy',
        destination_datasource_id: randomUUID(),
        destination_object_id: 'd',
      });

      expect(
        await testDb('relationship_apply_key').where({ run_id: runId }),
      ).toHaveLength(1);
      expect(
        await testDb('relationship_apply_candidate').where({ run_id: runId }),
      ).toHaveLength(1);
    });
  });

  describe('cascade deletes', () => {
    it('should delete datastore_index entries when datastore row is deleted', async () => {
      const datastoreId = randomUUID();
      const configId = randomUUID();
      const datasourceId = randomUUID();

      await testDb('datastore').insert({
        id: datastoreId,
        datasource_id: datasourceId,
        object_id: 'test-object',
        object: JSON.stringify({ name: 'Test' }),
      });

      await testDb('datastore_index_configuration').insert({
        id: configId,
        datasource_id: datasourceId,
        key: 'name',
        value_expression: 'name',
      });

      await testDb('datastore_index').insert({
        id: randomUUID(),
        datastore_id: datastoreId,
        datastore_index_configuration_id: configId,
        key: 'name',
        value: 'Test',
      });

      const beforeDelete = await testDb('datastore_index')
        .where({ datastore_id: datastoreId })
        .select();
      expect(beforeDelete).toHaveLength(1);

      await testDb('datastore').where({ id: datastoreId }).del();

      const afterDelete = await testDb('datastore_index')
        .where({ datastore_id: datastoreId })
        .select();
      expect(afterDelete).toHaveLength(0);
    });

    it('should delete datastore_index entries when datastore_index_configuration row is deleted', async () => {
      const datastoreId = randomUUID();
      const configId = randomUUID();
      const datasourceId = randomUUID();

      await testDb('datastore').insert({
        id: datastoreId,
        datasource_id: datasourceId,
        object_id: 'test-object',
        object: JSON.stringify({ name: 'Test' }),
      });

      await testDb('datastore_index_configuration').insert({
        id: configId,
        datasource_id: datasourceId,
        key: 'name',
        value_expression: 'name',
      });

      await testDb('datastore_index').insert({
        id: randomUUID(),
        datastore_id: datastoreId,
        datastore_index_configuration_id: configId,
        key: 'name',
        value: 'Test',
      });

      const beforeDelete = await testDb('datastore_index')
        .where({ datastore_index_configuration_id: configId })
        .select();
      expect(beforeDelete).toHaveLength(1);

      await testDb('datastore_index_configuration')
        .where({ id: configId })
        .del();

      const afterDelete = await testDb('datastore_index')
        .where({ datastore_index_configuration_id: configId })
        .select();
      expect(afterDelete).toHaveLength(0);
    });
  });
});
