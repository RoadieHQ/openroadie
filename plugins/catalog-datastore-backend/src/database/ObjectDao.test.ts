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
import { applyMigrations } from './applyMigrations';
import { ObjectDao } from './ObjectDao';
import { SuggestionCorpusCache } from '../api/schemas/suggestionCorpus';

const databases = TestDatabases.create();
const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

describe('ObjectDao', () => {
  let testDb: Knex;
  let objectDao: ObjectDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    objectDao = new ObjectDao({ knex: testDb });
  }, 120_000);

  beforeEach(async () => {
    await testDb('datastore_relation').del();
    await testDb('datastore').del();
  });

  afterAll(async () => {
    await testDb.destroy();
  });

  async function insertDatastoreObject(options: {
    datasourceId: string;
    objectId: string;
    object: Record<string, unknown>;
    workspaceId?: string;
  }): Promise<string> {
    const id = randomUUID();
    await testDb('datastore').insert({
      id,
      workspace_id: options.workspaceId ?? DEFAULT_WORKSPACE_ID,
      datasource_id: options.datasourceId,
      object_id: options.objectId,
      object: JSON.stringify(options.object),
      ...(options.workspaceId ? { workspace_id: options.workspaceId } : {}),
    });
    return id;
  }

  async function insertRelationship(options: {
    workspaceId: string;
    sourceDatasourceId: string;
    sourceObjectId: string;
    destinationDatasourceId: string;
    destinationObjectId: string;
    relationshipType: string;
  }) {
    await testDb('datastore_relation').insert({
      id: randomUUID(),
      workspace_id: options.workspaceId,
      source_datasource_id: options.sourceDatasourceId,
      source_object_id: options.sourceObjectId,
      destination_datasource_id: options.destinationDatasourceId,
      destination_object_id: options.destinationObjectId,
      relation_type: options.relationshipType,
      reciprocal_relation_type: null,
      origin: 'manual',
    });
  }

  describe('relationship counts', () => {
    it('keeps counts and relationshipCount sorting inside the requested workspace', async () => {
      const workspaceA = randomUUID();
      const workspaceB = randomUUID();
      const datasourceId = randomUUID();
      const destinationDatasourceId = randomUUID();

      for (const workspaceId of [workspaceA, workspaceB]) {
        await insertDatastoreObject({
          workspaceId,
          datasourceId,
          objectId: 'alpha',
          object: { name: 'Alpha' },
        });
        await insertDatastoreObject({
          workspaceId,
          datasourceId,
          objectId: 'beta',
          object: { name: 'Beta' },
        });
      }

      await insertRelationship({
        workspaceId: workspaceA,
        sourceDatasourceId: datasourceId,
        sourceObjectId: 'alpha',
        destinationDatasourceId,
        destinationObjectId: 'a-target',
        relationshipType: 'ownedBy',
      });
      await insertRelationship({
        workspaceId: workspaceB,
        sourceDatasourceId: datasourceId,
        sourceObjectId: 'beta',
        destinationDatasourceId,
        destinationObjectId: 'b-target-1',
        relationshipType: 'ownedBy',
      });
      await insertRelationship({
        workspaceId: workspaceB,
        sourceDatasourceId: datasourceId,
        sourceObjectId: 'beta',
        destinationDatasourceId,
        destinationObjectId: 'b-target-2',
        relationshipType: 'ownedBy',
      });

      const datasourcePage = await objectDao.query(datasourceId, {
        workspaceId: workspaceA,
        orderBy: 'relationshipCount',
        sortOrder: 'desc',
      });
      const allPage = await objectDao.queryAll({
        workspaceId: workspaceA,
        orderBy: 'relationshipCount',
        sortOrder: 'desc',
      });

      expect(datasourcePage.total).toBe(2);
      expect(allPage.total).toBe(2);
      expect(datasourcePage.items[0]).toMatchObject({
        workspaceId: workspaceA,
        ownership: 'workspace',
      });
      expect(
        datasourcePage.items.map(item => [
          item.objectId,
          item.relationshipCount,
        ]),
      ).toEqual([
        ['alpha', 1],
        ['beta', 0],
      ]);
      expect(
        allPage.items.map(item => [item.objectId, item.relationshipCount]),
      ).toEqual([
        ['alpha', 1],
        ['beta', 0],
      ]);
    });
  });

  describe('sampleForSuggestions', () => {
    it('builds a suggestion corpus from only the selected workspace', async () => {
      const datasourceId = randomUUID();
      const workspaceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'default-object',
        object: { name: 'default-only' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'workspace-object',
        object: { name: 'workspace-only' },
        workspaceId,
      });

      const corpus = await new SuggestionCorpusCache(
        objectDao,
        workspaceId,
      ).get(datasourceId);

      expect(corpus.items.map(item => item.objectId)).toEqual([
        'workspace-object',
      ]);
      expect(corpus.total).toBe(1);
    });

    it('returns the same sample on every call regardless of insertion order', async () => {
      // Insert > limit rows in one order, sample, then compare against a
      // second call — hash ordering must be stable run-to-run.
      const datasourceId = randomUUID();

      // Seed >= 15 objects
      for (let i = 0; i < 20; i++) {
        await insertDatastoreObject({
          datasourceId,
          objectId: `object-${i}`,
          object: { name: `Object ${i}` },
        });
      }

      const first = await objectDao.sampleForSuggestions(datasourceId, 10);
      const second = await objectDao.sampleForSuggestions(datasourceId, 10);

      expect(first.items.map(i => i.objectId)).toEqual(
        second.items.map(i => i.objectId),
      );
      expect(first.total).toBeGreaterThan(10);
      expect(first.items).toHaveLength(10);
    });
  });

  describe('findValuesPresent', () => {
    it('verifies values only in the selected workspace', async () => {
      const datasourceId = randomUUID();
      const workspaceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'default-object',
        object: { name: 'default-only' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'workspace-object',
        object: { name: 'workspace-only' },
        workspaceId,
      });

      const present = await objectDao.findValuesPresent(
        datasourceId,
        '$.name',
        ['default-only', 'workspace-only'],
        workspaceId,
      );

      expect(present).toEqual(new Set(['workspace-only']));
    });

    it('returns exactly the values present in the named field', async () => {
      const datasourceId = randomUUID();

      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj1',
        object: { name: 'alpha-1', value: 'test' },
      });
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj2',
        object: { name: 'beta-2', value: 'test' },
      });

      const present = await objectDao.findValuesPresent(
        datasourceId,
        '$.name',
        ['alpha-1', 'beta-2', 'gamma-3'],
      );
      expect(present).toEqual(new Set(['alpha-1', 'beta-2']));
    });

    it('returns an empty set for an empty input', async () => {
      const datasourceId = randomUUID();
      expect(
        await objectDao.findValuesPresent(datasourceId, '$.name', []),
      ).toEqual(new Set());
    });

    it('does not leak matches from other datasources', async () => {
      const datasourceId = randomUUID();
      const otherDatasourceId = randomUUID();

      await insertDatastoreObject({
        datasourceId: otherDatasourceId,
        objectId: 'obj1',
        object: { name: 'alpha-1', value: 'test' },
      });

      const present = await objectDao.findValuesPresent(
        datasourceId,
        '$.name',
        ['alpha-1'],
      );
      expect(present).toEqual(new Set());
    });

    it('does not count a value that appears only in a different field', async () => {
      const datasourceId = randomUUID();
      // The value lives in `description`, not the queried `name` field — the
      // whole-object substring behaviour would have wrongly counted it.
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj1',
        object: { name: 'unrelated', description: 'alpha-1 is mentioned here' },
      });

      const present = await objectDao.findValuesPresent(
        datasourceId,
        '$.name',
        ['alpha-1'],
      );
      expect(present).toEqual(new Set());
    });

    it('does not count a value that is only a substring of the field value', async () => {
      const datasourceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj1',
        object: { name: 'smart-service' },
      });

      const present = await objectDao.findValuesPresent(
        datasourceId,
        '$.name',
        ['art'],
      );
      expect(present).toEqual(new Set());
    });

    it('matches an element of an array field', async () => {
      const datasourceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj1',
        object: { tags: ['backend', 'kubernetes', 'team-a'] },
      });

      const present = await objectDao.findValuesPresent(
        datasourceId,
        '$.tags',
        ['kubernetes', 'frontend'],
      );
      expect(present).toEqual(new Set(['kubernetes']));
    });

    it('resolves a nested field path', async () => {
      const datasourceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj1',
        object: { spec: { owner: 'team-platform' } },
      });

      const present = await objectDao.findValuesPresent(
        datasourceId,
        '$.spec.owner',
        ['team-platform', 'team-other'],
      );
      expect(present).toEqual(new Set(['team-platform']));
    });

    it('verifies nothing for an array-of-object qualifier path', async () => {
      const datasourceId = randomUUID();
      await insertDatastoreObject({
        datasourceId,
        objectId: 'obj1',
        object: { containers: [{ name: 'app', image: 'nginx' }] },
      });

      // A qualifier path can't map to a plain JSON path; verifying nothing is
      // the conservative fallback (the candidate keeps its sample containment).
      const present = await objectDao.findValuesPresent(
        datasourceId,
        '$.containers[name="app"].image',
        ['nginx'],
      );
      expect(present).toEqual(new Set());
    });
  });
});
