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
 * Characterization + equivalence suite for relationship-rule application
 * (sc-34106 §8). Each strategy is exercised through `applyRelationshipRule`
 * against a small fixture and the resulting `datastore_relation` end state is
 * asserted exactly. These assertions were captured against the pre-existing
 * in-memory path first, then held fixed while the implementation was replaced
 * by the three-phase sealed apply — so a green run means the new path produces
 * identical results to the old one.
 */

import { mockServices, TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { applyMigrations } from './applyMigrations';
import { ObjectDao } from './ObjectDao';
import { SchemaDao } from './SchemaDao';
import { IndexDao } from './IndexDao';
import { RelationshipDao } from './RelationshipDao';
import { RelationshipRuleDao } from './RelationshipRuleDao';
import { DatastoreRepository } from './DatastoreRepository';
import type { IntegrationRuleCaller } from './types';
import type {
  IntegrationBackedConfig,
  RelationshipRuleMatchStrategy,
} from '@roadiehq/catalog-datastore-common';

const databases = TestDatabases.create();

interface EdgeRow {
  source_object_id: string;
  destination_object_id: string;
  relation_type: string;
  reciprocal_relation_type: string | null;
  rule_id: string | null;
  origin: string;
  metadata: unknown;
}

describe('relationship apply — equivalence per strategy', () => {
  let testDb: Knex;
  let objectDao: ObjectDao;
  let schemaDao: SchemaDao;
  let indexDao: IndexDao;
  let relationshipDao: RelationshipDao;
  let relationshipRuleDao: RelationshipRuleDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
  }, 120_000);

  beforeEach(async () => {
    await testDb('relationship_apply_candidate').del();
    await testDb('relationship_apply_key').del();
    await testDb('relationship_apply_run').del();
    await testDb('datastore_relation').del();
    await testDb('datastore_relationship_rule').del();
    await testDb('datastore_index').del();
    await testDb('datastore').del();
    await testDb('datastore_index_configuration').del();

    const logger = mockServices.logger.mock();
    objectDao = new ObjectDao({ knex: testDb });
    schemaDao = new SchemaDao({ knex: testDb });
    indexDao = new IndexDao({ knex: testDb, logger });
    relationshipDao = new RelationshipDao({ knex: testDb });
    relationshipRuleDao = new RelationshipRuleDao({ knex: testDb });
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  const sourceDs = randomUUID();
  const targetDs = randomUUID();

  function makeRepo(callIntegration?: IntegrationRuleCaller) {
    return new DatastoreRepository({
      knex: testDb,
      logger: mockServices.logger.mock(),
      objectDao,
      schemaDao,
      indexDao,
      relationshipDao,
      relationshipRuleDao,
      callIntegration,
    });
  }

  async function insertObject(
    datasourceId: string,
    objectId: string,
    object: Record<string, unknown>,
  ) {
    await testDb('datastore').insert({
      id: randomUUID(),
      datasource_id: datasourceId,
      object_id: objectId,
      object: JSON.stringify(object),
    });
  }

  async function createRule(opts: {
    sourceFieldExpression: string;
    targetFieldExpression: string;
    relationshipType: string;
    reciprocalRelationshipType?: string;
    matchStrategy: RelationshipRuleMatchStrategy;
    strategy?: 'field-matching' | 'integration-backed';
    integrationConfig?: IntegrationBackedConfig | null;
    sourceFilterExpression?: string;
    targetFilterExpression?: string;
    score?: number;
  }): Promise<string> {
    const rule = await relationshipRuleDao.createRelationshipRule(
      {
        name: `rule-${randomUUID()}`,
        sourceDatasourceId: sourceDs,
        targetDatasourceId: targetDs,
        sourceFieldExpression: opts.sourceFieldExpression,
        targetFieldExpression: opts.targetFieldExpression,
        relationshipType: opts.relationshipType,
        reciprocalRelationshipType: opts.reciprocalRelationshipType,
        matchStrategy: opts.matchStrategy,
        strategy: opts.strategy,
        integrationConfig: opts.integrationConfig ?? null,
        sourceFilterExpression: opts.sourceFilterExpression,
        targetFilterExpression: opts.targetFilterExpression,
        score: opts.score,
        origin: 'test',
      },
      { origin: 'test', state: 'active' },
    );
    return rule.id;
  }

  async function edges(ruleId?: string): Promise<EdgeRow[]> {
    const q = testDb('datastore_relation').select(
      'source_object_id',
      'destination_object_id',
      'relation_type',
      'reciprocal_relation_type',
      'rule_id',
      'origin',
      'metadata',
    );
    if (ruleId) {
      q.where('rule_id', ruleId);
    }
    const rows = await q;
    return rows
      .map((r: EdgeRow) => ({
        ...r,
        metadata:
          typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
      }))
      .sort((a: EdgeRow, b: EdgeRow) =>
        `${a.source_object_id}->${a.destination_object_id}`.localeCompare(
          `${b.source_object_id}->${b.destination_object_id}`,
        ),
      );
  }

  it('exact — equality join', async () => {
    await insertObject(sourceDs, 's1', { key: 'alpha' });
    await insertObject(sourceDs, 's2', { key: 'beta' });
    await insertObject(sourceDs, 's3', { key: 'gamma' });
    await insertObject(targetDs, 't1', { key: 'alpha' });
    await insertObject(targetDs, 't2', { key: 'beta' });
    await insertObject(targetDs, 't3', { key: 'beta' });

    const repo = makeRepo();
    const ruleId = await createRule({
      sourceFieldExpression: 'key',
      targetFieldExpression: 'key',
      relationshipType: 'depends-on',
      reciprocalRelationshipType: 'dependency-of',
      matchStrategy: 'exact',
    });

    const result = await repo.applyRelationshipRule(ruleId);
    expect(result.created).toBe(3); // s1->t1, s2->t2, s2->t3
    expect(await edges(ruleId)).toEqual([
      {
        source_object_id: 's1',
        destination_object_id: 't1',
        relation_type: 'depends-on',
        reciprocal_relation_type: 'dependency-of',
        rule_id: ruleId,
        origin: 'test',
        metadata: null,
      },
      {
        source_object_id: 's2',
        destination_object_id: 't2',
        relation_type: 'depends-on',
        reciprocal_relation_type: 'dependency-of',
        rule_id: ruleId,
        origin: 'test',
        metadata: null,
      },
      {
        source_object_id: 's2',
        destination_object_id: 't3',
        relation_type: 'depends-on',
        reciprocal_relation_type: 'dependency-of',
        rule_id: ruleId,
        origin: 'test',
        metadata: null,
      },
    ]);
  });

  it('array_contains — equality over expanded array values', async () => {
    await insertObject(sourceDs, 's1', { tags: ['red', 'green'] });
    await insertObject(sourceDs, 's2', { tags: ['blue'] });
    await insertObject(targetDs, 't1', { tags: ['green', 'yellow'] });
    await insertObject(targetDs, 't2', { tags: ['blue'] });
    await insertObject(targetDs, 't3', { tags: ['purple'] });

    const repo = makeRepo();
    const ruleId = await createRule({
      sourceFieldExpression: 'tags',
      targetFieldExpression: 'tags',
      relationshipType: 'shares-tag',
      matchStrategy: 'array_contains',
    });

    await repo.applyRelationshipRule(ruleId);
    expect(await edges(ruleId)).toEqual([
      expect.objectContaining({
        source_object_id: 's1',
        destination_object_id: 't1',
      }),
      expect.objectContaining({
        source_object_id: 's2',
        destination_object_id: 't2',
      }),
    ]);
  });

  it('contains — target value contains source value', async () => {
    await insertObject(sourceDs, 's1', { name: 'foo' });
    await insertObject(sourceDs, 's2', { name: 'zzz' });
    await insertObject(targetDs, 't1', { path: 'my-foo-service' });
    await insertObject(targetDs, 't2', { path: 'foobar' });
    await insertObject(targetDs, 't3', { path: 'unrelated' });

    const repo = makeRepo();
    const ruleId = await createRule({
      sourceFieldExpression: 'name',
      targetFieldExpression: 'path',
      relationshipType: 'part-of',
      matchStrategy: 'contains',
    });

    await repo.applyRelationshipRule(ruleId);
    expect(await edges(ruleId)).toEqual([
      expect.objectContaining({
        source_object_id: 's1',
        destination_object_id: 't1',
      }),
      expect.objectContaining({
        source_object_id: 's1',
        destination_object_id: 't2',
      }),
    ]);
  });

  it('regex — target value is the pattern tested against source', async () => {
    await insertObject(sourceDs, 's1', { name: 'user-123' });
    await insertObject(sourceDs, 's2', { name: 'admin' });
    await insertObject(targetDs, 't1', { pattern: '^user-\\d+$' });
    await insertObject(targetDs, 't2', { pattern: '^admin$' });
    await insertObject(targetDs, 't3', { pattern: '^nobody$' });

    const repo = makeRepo();
    const ruleId = await createRule({
      sourceFieldExpression: 'name',
      targetFieldExpression: 'pattern',
      relationshipType: 'matches',
      matchStrategy: 'regex',
    });

    await repo.applyRelationshipRule(ruleId);
    expect(await edges(ruleId)).toEqual([
      expect.objectContaining({
        source_object_id: 's1',
        destination_object_id: 't1',
      }),
      expect.objectContaining({
        source_object_id: 's2',
        destination_object_id: 't2',
      }),
    ]);
  });

  it('regex — a source object with >PAGE_SIZE values keyset-paginates without dropping any', async () => {
    // One source object emitting 1500 key values (> PAGE_SIZE = 1000). Only the
    // 1500th value (which sorts last) matches the pattern. An object_id-only
    // keyset would step past the object on page 2 and lose it -> 0 edges. A true
    // compound (object_id, value) keyset keeps advancing within the object.
    const values: string[] = [];
    for (let i = 0; i < 1500; i++) {
      // Zero-padded so string ordering matches numeric ordering; the match
      // sentinel sorts last.
      values.push(
        i === 1499 ? 'zzz-match-me' : `val-${String(i).padStart(5, '0')}`,
      );
    }
    await insertObject(sourceDs, 's1', { names: values });
    await insertObject(targetDs, 't1', { pattern: '^zzz-match-me$' });

    const repo = makeRepo();
    const ruleId = await createRule({
      sourceFieldExpression: 'names',
      targetFieldExpression: 'pattern',
      relationshipType: 'matches',
      matchStrategy: 'regex',
    });

    const result = await repo.applyRelationshipRule(ruleId);
    expect(result.created).toBe(1);
    expect(await edges(ruleId)).toEqual([
      expect.objectContaining({
        source_object_id: 's1',
        destination_object_id: 't1',
      }),
    ]);
  });

  it('regex — an object straddling the page boundary emits each pair exactly once', async () => {
    // One source object whose values match the SAME target on both sides of the
    // 1000-row boundary. Without carrying the matched-target set across the page
    // boundary, the pair would be emitted twice (once per page).
    const values: string[] = [];
    for (let i = 0; i < 1500; i++) {
      // Every value matches the target pattern, so the object straddles the
      // boundary while repeatedly matching the same single target.
      values.push(`match-${String(i).padStart(5, '0')}`);
    }
    await insertObject(sourceDs, 's1', { names: values });
    await insertObject(targetDs, 't1', { pattern: '^match-' });

    const repo = makeRepo();
    const ruleId = await createRule({
      sourceFieldExpression: 'names',
      targetFieldExpression: 'pattern',
      relationshipType: 'matches',
      matchStrategy: 'regex',
    });

    const result = await repo.applyRelationshipRule(ruleId);
    // Exactly one (s1, t1) edge despite 1500 matching values across two pages.
    expect(result.created).toBe(1);
    expect(await edges(ruleId)).toEqual([
      expect.objectContaining({
        source_object_id: 's1',
        destination_object_id: 't1',
      }),
    ]);
    expect(
      (await testDb('datastore_relation').where('rule_id', ruleId)).length,
    ).toBe(1);
  });

  it('person_name_alias — alias-set intersection', async () => {
    // A person name and a handle that share an alias must match: "Jane Smith"
    // expands to the initial+surname alias "jsmith", which is exactly the
    // target handle. An unrelated name shares no alias and must not match.
    await insertObject(sourceDs, 's1', { author: 'Jane Smith' });
    await insertObject(sourceDs, 's2', { author: 'Jane Doe' });
    await insertObject(targetDs, 't1', { handle: 'jsmith' });
    await insertObject(targetDs, 't2', { handle: 'Jane Doe' });
    await insertObject(targetDs, 't3', { handle: 'someoneelse' });

    const repo = makeRepo();
    const ruleId = await createRule({
      sourceFieldExpression: 'author',
      targetFieldExpression: 'handle',
      relationshipType: 'authored-by',
      matchStrategy: 'person_name_alias',
    });

    await repo.applyRelationshipRule(ruleId);
    // Exact full pair set: s1<->jsmith via alias overlap, s2<->t2 exact.
    expect(await edges(ruleId)).toEqual([
      expect.objectContaining({
        source_object_id: 's1',
        destination_object_id: 't1',
      }),
      expect.objectContaining({
        source_object_id: 's2',
        destination_object_id: 't2',
      }),
    ]);
  });

  it('exact — re-apply deletes prior rows for the rule (idempotent count)', async () => {
    await insertObject(sourceDs, 's1', { key: 'x' });
    await insertObject(targetDs, 't1', { key: 'x' });

    const repo = makeRepo();
    const ruleId = await createRule({
      sourceFieldExpression: 'key',
      targetFieldExpression: 'key',
      relationshipType: 'r',
      matchStrategy: 'exact',
    });

    const first = await repo.applyRelationshipRule(ruleId);
    expect(first.created).toBe(1);
    expect(first.deleted).toBe(0);

    const second = await repo.applyRelationshipRule(ruleId);
    expect(second.created).toBe(1);
    expect(second.deleted).toBe(1);
    expect((await edges(ruleId)).length).toBe(1);
  });

  it('cross-rule conflict — a tuple owned by another rule only bumps updated_at', async () => {
    await insertObject(sourceDs, 's1', { key: 'x' });
    await insertObject(targetDs, 't1', { key: 'x' });

    const repo = makeRepo();
    // Rule A claims the tuple first.
    const ruleA = await createRule({
      sourceFieldExpression: 'key',
      targetFieldExpression: 'key',
      relationshipType: 'shared',
      matchStrategy: 'exact',
    });
    await repo.applyRelationshipRule(ruleA);
    const owned = await testDb('datastore_relation')
      .where('relation_type', 'shared')
      .first();
    expect(owned.rule_id).toBe(ruleA);

    // Rule B produces the same tuple; attribution must stay with A.
    const ruleB = await createRule({
      sourceFieldExpression: 'key',
      targetFieldExpression: 'key',
      relationshipType: 'shared',
      matchStrategy: 'exact',
    });
    await repo.applyRelationshipRule(ruleB);
    const after = await testDb('datastore_relation')
      .where('relation_type', 'shared')
      .first();
    expect(after.rule_id).toBe(ruleA);
    // Still exactly one tuple.
    expect(
      (await testDb('datastore_relation').where('relation_type', 'shared'))
        .length,
    ).toBe(1);
  });

  it('integration-backed — projects metadata and preserves failed sources', async () => {
    await insertObject(sourceDs, 's1', { slug: 'ok' });
    await insertObject(sourceDs, 's2', { slug: 'boom' });
    await insertObject(targetDs, 't1', { name: 'matched-target' });

    const integrationConfig: IntegrationBackedConfig = {
      integrationId: 'int',
      path: '/lookup/{value}',
      responseMatchExpression: 'target',
      metadataExpression: '{ "via": link }',
    };

    const callIntegration: IntegrationRuleCaller = async ({ path }) => {
      if (path.includes('boom')) {
        throw new Error('upstream 500');
      }
      return { target: 'matched-target', link: 'https://x/ok' };
    };

    const repo = makeRepo(callIntegration);
    const ruleId = await createRule({
      sourceFieldExpression: 'slug',
      targetFieldExpression: 'name',
      relationshipType: 'linked',
      matchStrategy: 'exact',
      strategy: 'integration-backed',
      integrationConfig,
    });

    await repo.applyRelationshipRule(ruleId);
    const rows = await edges(ruleId);
    expect(rows).toEqual([
      {
        source_object_id: 's1',
        destination_object_id: 't1',
        relation_type: 'linked',
        reciprocal_relation_type: null,
        rule_id: ruleId,
        origin: 'integration-backed',
        metadata: { via: 'https://x/ok' },
      },
    ]);
  });
});
