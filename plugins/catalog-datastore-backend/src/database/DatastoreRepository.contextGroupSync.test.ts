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
 * Context groups materialize merges from `datastore_relation` edges, so any
 * write that changes those edges must re-materialize the groups that consume
 * them. The reported bug: a second relationship rule reusing an existing
 * relation type (e.g. a second `samePerson` rule matching on name instead of
 * email) leaves the context group untouched, because the context-group rule
 * itself never changes — only its edges do. These tests wire the repository,
 * events, and scheduler together exactly as plugin.ts does and assert the
 * groups converge after every edge-changing path.
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
import { ContextGroupDao } from './ContextGroupDao';
import { DatastoreRepository } from './DatastoreRepository';
import { DatasourceEvents } from '../webhooks/DatasourceEvents';
import { ContextGroupSyncScheduler } from '../modules/router/ContextGroupSyncScheduler';

const databases = TestDatabases.create();

describe('DatastoreRepository — context groups follow relationship edges', () => {
  let testDb: Knex;
  let repository: DatastoreRepository;
  let relationshipRuleDao: RelationshipRuleDao;
  let contextGroupDao: ContextGroupDao;
  let events: DatasourceEvents;
  let scheduler: ContextGroupSyncScheduler;

  const shortcutDs = randomUUID();
  const githubDs = randomUUID();

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
  }, 120_000);

  beforeEach(async () => {
    await testDb('relationship_apply_candidate').del();
    await testDb('relationship_apply_key').del();
    await testDb('relationship_apply_run').del();
    await testDb('context_group_member').del();
    await testDb('context_group').del();
    await testDb('context_group_rule').del();
    await testDb('datastore_relation').del();
    await testDb('datastore_relationship_rule').del();
    await testDb('datastore').del();

    const logger = mockServices.logger.mock();
    relationshipRuleDao = new RelationshipRuleDao({ knex: testDb });
    contextGroupDao = new ContextGroupDao({ knex: testDb });
    events = new DatasourceEvents();
    scheduler = new ContextGroupSyncScheduler({
      logger,
      materializeForDatasource: datasourceId =>
        contextGroupDao.materializeForDatasource(datasourceId),
    });
    // Mirrors plugin.ts: both ingestion changes and relationship-edge changes
    // schedule a context-group sync.
    events.onChanged(id => scheduler.schedule(id));
    events.onRelationshipsChanged(id => scheduler.schedule(id));
    repository = new DatastoreRepository({
      knex: testDb,
      logger,
      objectDao: new ObjectDao({ knex: testDb }),
      schemaDao: new SchemaDao({ knex: testDb }),
      indexDao: new IndexDao({ knex: testDb, logger }),
      relationshipDao: new RelationshipDao({ knex: testDb }),
      relationshipRuleDao,
      events,
    });
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  async function insertPeopleFixtures() {
    // Alice matches across datasources by email only; Bob by name only.
    await testDb('datastore').insert([
      {
        id: randomUUID(),
        datasource_id: shortcutDs,
        object_id: 'sc-alice',
        object: JSON.stringify({ name: 'Alice Smith', email: 'alice@x.io' }),
      },
      {
        id: randomUUID(),
        datasource_id: shortcutDs,
        object_id: 'sc-bob',
        object: JSON.stringify({ name: 'Bob Jones', email: 'bob@shortcut.io' }),
      },
      {
        id: randomUUID(),
        datasource_id: githubDs,
        object_id: 'gh-alice',
        object: JSON.stringify({ name: 'A. Smith', email: 'alice@x.io' }),
      },
      {
        id: randomUUID(),
        datasource_id: githubDs,
        object_id: 'gh-bob',
        object: JSON.stringify({ name: 'Bob Jones', email: 'bob@github.io' }),
      },
    ]);
  }

  function createSamePersonRule(field: 'email' | 'name') {
    return relationshipRuleDao.createRelationshipRule(
      {
        name: `samePerson on ${field} ${randomUUID()}`,
        sourceDatasourceId: shortcutDs,
        targetDatasourceId: githubDs,
        sourceFieldExpression: field,
        targetFieldExpression: field,
        relationshipType: 'samePerson',
        matchStrategy: 'exact',
      },
      { origin: 'test', state: 'active' },
    );
  }

  async function createPeopleContextGroup() {
    return contextGroupDao.createRule({
      name: `People ${randomUUID()}`,
      datasources: [{ datasourceId: shortcutDs }, { datasourceId: githubDs }],
      mergeRelationshipTypes: ['samePerson'],
    });
  }

  async function memberSetsOf(ruleId: string): Promise<string[][]> {
    const groups = await contextGroupDao.listGroups({ ruleId });
    const sets: string[][] = [];
    for (const group of groups.items) {
      const members = await contextGroupDao.listGroupMembers(group.id);
      sets.push(members.items.map(m => m.objectId).sort());
    }
    return sets.sort((a, b) => a[0].localeCompare(b[0]));
  }

  it('re-materializes groups when a new rule reuses an existing merge relation type', async () => {
    await insertPeopleFixtures();

    const emailRule = await createSamePersonRule('email');
    await repository.applyRelationshipRule(emailRule.id);

    const contextRule = await createPeopleContextGroup();
    await contextGroupDao.materializeRule(contextRule.id);
    await scheduler.flushNow();

    // Baseline: the email rule merges the Alices; the Bobs stay separate.
    expect(await memberSetsOf(contextRule.id)).toEqual([
      ['gh-alice', 'sc-alice'],
      ['gh-bob'],
      ['sc-bob'],
    ]);

    // The user's scenario: a second rule with the same relation type
    // ("samePerson"), matching on a different field. The context-group rule
    // itself is untouched — only the edges change.
    const nameRule = await createSamePersonRule('name');
    await repository.applyRelationshipRule(nameRule.id);
    await scheduler.flushNow();

    expect(await memberSetsOf(contextRule.id)).toEqual([
      ['gh-alice', 'sc-alice'],
      ['gh-bob', 'sc-bob'],
    ]);
  });

  it('re-materializes groups when a rule is deactivated and its edges removed', async () => {
    await insertPeopleFixtures();

    const emailRule = await createSamePersonRule('email');
    await repository.applyRelationshipRule(emailRule.id);

    const contextRule = await createPeopleContextGroup();
    await contextGroupDao.materializeRule(contextRule.id);
    await scheduler.flushNow();
    expect(await memberSetsOf(contextRule.id)).toHaveLength(3);

    // The deactivation path (active → inactive) deletes the rule's edges.
    await repository.deleteRelationshipsByRuleId(
      emailRule.id,
      '00000000-0000-4000-8000-000000000001',
    );
    await scheduler.flushNow();

    expect(await memberSetsOf(contextRule.id)).toEqual([
      ['gh-alice'],
      ['gh-bob'],
      ['sc-alice'],
      ['sc-bob'],
    ]);
  });

  it('re-materializes groups when a relationship rule is deleted', async () => {
    await insertPeopleFixtures();

    const emailRule = await createSamePersonRule('email');
    await repository.applyRelationshipRule(emailRule.id);

    const contextRule = await createPeopleContextGroup();
    await contextGroupDao.materializeRule(contextRule.id);
    await scheduler.flushNow();
    expect(await memberSetsOf(contextRule.id)).toHaveLength(3);

    await repository.deleteRelationshipRule(
      emailRule.id,
      '00000000-0000-4000-8000-000000000001',
    );
    await scheduler.flushNow();

    expect(await memberSetsOf(contextRule.id)).toEqual([
      ['gh-alice'],
      ['gh-bob'],
      ['sc-alice'],
      ['sc-bob'],
    ]);
  });

  it('does not schedule a sync for a dry-run apply', async () => {
    await insertPeopleFixtures();
    const emailRule = await createSamePersonRule('email');

    const emitted: string[] = [];
    events.onRelationshipsChanged(id => emitted.push(id));

    await repository.applyRelationshipRule(emailRule.id, { dryRun: true });

    expect(emitted).toEqual([]);
  });

  it('does not schedule a sync when an apply changes no edges', async () => {
    await insertPeopleFixtures();
    // No object carries this field, so extraction matches nothing and there
    // are no prior edges to delete.
    const rule = await relationshipRuleDao.createRelationshipRule(
      {
        name: `no-op rule ${randomUUID()}`,
        sourceDatasourceId: shortcutDs,
        targetDatasourceId: githubDs,
        sourceFieldExpression: 'missingField',
        targetFieldExpression: 'missingField',
        relationshipType: 'samePerson',
        matchStrategy: 'exact',
      },
      { origin: 'test', state: 'active' },
    );

    const emitted: string[] = [];
    events.onRelationshipsChanged(id => emitted.push(id));

    await repository.applyRelationshipRule(rule.id);

    expect(emitted).toEqual([]);
  });

  it('emits for both endpoint datasources exactly once per apply', async () => {
    await insertPeopleFixtures();
    const emailRule = await createSamePersonRule('email');

    const emitted: string[] = [];
    events.onRelationshipsChanged(id => emitted.push(id));

    await repository.applyRelationshipRule(emailRule.id);

    expect(emitted.sort()).toEqual([shortcutDs, githubDs].sort());
  });

  it('materializes against post-apply edges after an ingest', async () => {
    // An ingest schedules both the context-group sync and the relationship
    // auto-apply on the same debounce, so the sync can run against edges the
    // apply has not written yet. The apply completing must schedule another
    // sync, or the groups settle on the pre-apply edges.
    const contextRule = await createPeopleContextGroup();
    const emailRule = await createSamePersonRule('email');
    void emailRule;

    await repository.replaceDatasourceItems(shortcutDs, [
      {
        datasourceId: shortcutDs,
        objectId: 'sc-alice',
        object: { name: 'Alice Smith', email: 'alice@x.io' },
      },
    ]);
    await repository.replaceDatasourceItems(githubDs, [
      {
        datasourceId: githubDs,
        objectId: 'gh-alice',
        object: { name: 'A. Smith', email: 'alice@x.io' },
      },
    ]);

    // Simulate the race: the context-group sync fires before the auto-apply
    // pass has written any edges.
    await scheduler.flushNow();
    expect(await memberSetsOf(contextRule.id)).toEqual([
      ['gh-alice'],
      ['sc-alice'],
    ]);

    // The auto-apply pass now writes the samePerson edge; that must schedule
    // a follow-up sync that converges the groups.
    await repository.flushAutoApplyForTesting();
    await scheduler.flushNow();

    expect(await memberSetsOf(contextRule.id)).toEqual([
      ['gh-alice', 'sc-alice'],
    ]);
  });

  it('auto-applies relationship rules in a non-default workspace', async () => {
    const workspaceId = randomUUID();
    await testDb('datastore').insert([
      {
        id: randomUUID(),
        workspace_id: workspaceId,
        datasource_id: shortcutDs,
        object_id: 'sc-alice',
        object: JSON.stringify({ email: 'alice@x.io' }),
      },
      {
        id: randomUUID(),
        workspace_id: workspaceId,
        datasource_id: githubDs,
        object_id: 'gh-alice',
        object: JSON.stringify({ email: 'alice@x.io' }),
      },
    ]);
    await relationshipRuleDao.createRelationshipRule(
      {
        name: `samePerson ${randomUUID()}`,
        sourceDatasourceId: shortcutDs,
        targetDatasourceId: githubDs,
        sourceFieldExpression: 'email',
        targetFieldExpression: 'email',
        relationshipType: 'samePerson',
        matchStrategy: 'exact',
      },
      { origin: 'test', state: 'active', workspaceId },
    );

    await repository.applyRelationshipRulesForDatasources(
      [shortcutDs],
      workspaceId,
    );

    const relations = await testDb('datastore_relation').where({
      workspace_id: workspaceId,
    });
    expect(relations).toHaveLength(1);
  });
});
