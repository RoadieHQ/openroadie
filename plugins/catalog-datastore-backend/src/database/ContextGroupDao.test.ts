import { TestDatabases } from '@roadiehq/backend-test-utils';
import knex, { Knex } from 'knex';
import { vi } from 'vitest';
import { applyMigrations } from './applyMigrations';
import { randomUUID } from 'crypto';
import { CONTEXT_GROUP_MATERIALIZE_LOCK_NS } from '@roadiehq/catalog-datastore-common';
import { ContextGroupDao } from './ContextGroupDao';

const databases = TestDatabases.create();

describe('ContextGroupDao', () => {
  let testDb: Knex;
  let dao: ContextGroupDao;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    dao = new ContextGroupDao({ knex: testDb });
  }, 120_000);

  beforeEach(async () => {
    await testDb('context_group_member').del();
    await testDb('context_group').del();
    await testDb('context_group_rule').del();
    await testDb('datastore_relation').del();
    await testDb('datastore').del();
  });

  afterAll(async () => {
    await testDb.destroy();
  });

  describe('createRule', () => {
    it('creates a rule with required fields', async () => {
      const rule = await dao.createRule({
        name: 'Test Rule',
        datasources: [{ datasourceId: randomUUID() }],
      });

      expect(rule.id).toBeDefined();
      expect(rule.name).toBe('Test Rule');
      expect(rule).toMatchObject({
        workspaceId: '00000000-0000-4000-8000-000000000001',
        ownership: 'org',
      });
      expect(rule.datasources).toHaveLength(1);
      expect(rule.mergeRelationshipTypes).toEqual([]);
    });

    it('creates a rule with description', async () => {
      const rule = await dao.createRule({
        name: 'Described Rule',
        description: 'A test description',
        datasources: [{ datasourceId: randomUUID() }],
      });

      expect(rule.description).toBe('A test description');
    });

    it('rejects duplicate rule names', async () => {
      await dao.createRule({
        name: 'Unique Name',
        datasources: [{ datasourceId: randomUUID() }],
      });

      await expect(
        dao.createRule({
          name: 'Unique Name',
          datasources: [{ datasourceId: randomUUID() }],
        }),
      ).rejects.toThrow();
    });

    it('derives a slug from the name when none is given', async () => {
      const rule = await dao.createRule({
        name: 'Payments Team',
        datasources: [{ datasourceId: randomUUID() }],
      });

      expect(rule.slug).toBe('payments-team');
    });

    it('honours an explicit slug', async () => {
      const rule = await dao.createRule({
        name: 'Payments Team',
        slug: 'payments',
        datasources: [{ datasourceId: randomUUID() }],
      });

      expect(rule.slug).toBe('payments');
    });

    it('rejects duplicate slugs', async () => {
      await dao.createRule({
        name: 'First',
        slug: 'shared-slug',
        datasources: [{ datasourceId: randomUUID() }],
      });

      await expect(
        dao.createRule({
          name: 'Second',
          slug: 'shared-slug',
          datasources: [{ datasourceId: randomUUID() }],
        }),
      ).rejects.toThrow();
    });
  });

  describe('getRuleBySlug', () => {
    it('returns a rule by slug', async () => {
      await dao.createRule({
        name: 'By Slug',
        slug: 'by-slug',
        datasources: [{ datasourceId: randomUUID() }],
      });

      const fetched = await dao.getRuleBySlug('by-slug');
      expect(fetched?.name).toBe('By Slug');
    });

    it('returns undefined for an unknown slug', async () => {
      expect(await dao.getRuleBySlug('does-not-exist')).toBeUndefined();
    });
  });

  describe('getRule', () => {
    it('returns a rule by id', async () => {
      const created = await dao.createRule({
        name: 'Fetchable Rule',
        datasources: [{ datasourceId: randomUUID() }],
      });

      const fetched = await dao.getRule(created.id);
      expect(fetched).toBeDefined();
      expect(fetched?.name).toBe('Fetchable Rule');
    });

    it('returns undefined for non-existent id', async () => {
      const result = await dao.getRule(randomUUID());
      expect(result).toBeUndefined();
    });
  });

  describe('getRuleByName', () => {
    it('returns a rule by name', async () => {
      await dao.createRule({
        name: 'Named Rule',
        datasources: [{ datasourceId: randomUUID() }],
      });

      const fetched = await dao.getRuleByName('Named Rule');
      expect(fetched).toBeDefined();
      expect(fetched?.name).toBe('Named Rule');
    });

    it('returns undefined for non-existent name', async () => {
      const result = await dao.getRuleByName('Does Not Exist');
      expect(result).toBeUndefined();
    });
  });

  describe('listRules', () => {
    it('returns paginated rules', async () => {
      for (let i = 0; i < 5; i++) {
        await dao.createRule({
          name: `Rule ${i}`,
          datasources: [{ datasourceId: randomUUID() }],
        });
      }

      const result = await dao.listRules({ limit: 3, offset: 0 });
      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(5);
    });

    it('returns empty list when no rules exist', async () => {
      const result = await dao.listRules();
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('restricts to allowedIdentifiers by slug', async () => {
      for (const slug of ['alpha', 'beta', 'gamma']) {
        await dao.createRule({
          name: slug,
          slug,
          datasources: [{ datasourceId: randomUUID() }],
        });
      }

      const result = await dao.listRules({
        allowedIdentifiers: ['alpha', 'gamma'],
      });

      expect(result.total).toBe(2);
      expect(result.items.map(i => i.slug).sort()).toEqual(['alpha', 'gamma']);
    });

    it('restricts to allowedIdentifiers by id', async () => {
      const alpha = await dao.createRule({
        name: 'alpha',
        slug: 'alpha',
        datasources: [{ datasourceId: randomUUID() }],
      });
      await dao.createRule({
        name: 'beta',
        slug: 'beta',
        datasources: [{ datasourceId: randomUUID() }],
      });

      const result = await dao.listRules({ allowedIdentifiers: [alpha.id] });

      expect(result.total).toBe(1);
      expect(result.items[0].slug).toBe('alpha');
    });

    it('returns nothing for an empty allowedIdentifiers list', async () => {
      await dao.createRule({
        name: 'alpha',
        slug: 'alpha',
        datasources: [{ datasourceId: randomUUID() }],
      });

      const result = await dao.listRules({ allowedIdentifiers: [] });

      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
    });
  });

  describe('updateRule', () => {
    it('updates rule name', async () => {
      const rule = await dao.createRule({
        name: 'Original Name',
        datasources: [{ datasourceId: randomUUID() }],
      });

      const updated = await dao.updateRule(rule.id, { name: 'Updated Name' });
      expect(updated?.name).toBe('Updated Name');
    });

    it('persists and updates merge relationship types', async () => {
      const rule = await dao.createRule({
        name: 'Rule with Merging',
        datasources: [{ datasourceId: randomUUID() }],
        mergeRelationshipTypes: ['sameApplication'],
      });

      expect(rule.mergeRelationshipTypes).toEqual(['sameApplication']);

      const updated = await dao.updateRule(rule.id, {
        mergeRelationshipTypes: ['owns'],
      });
      expect(updated?.mergeRelationshipTypes).toEqual(['owns']);
    });

    it('clears seed ownership when a rule is edited manually', async () => {
      const rule = await dao.createRule({
        name: 'Seeded Rule',
        datasources: [{ datasourceId: randomUUID() }],
        seedVersion: 1,
      });

      const updated = await dao.updateRule(rule.id, { name: 'Edited Rule' });

      expect(updated?.seedVersion).toBeNull();
    });

    it('returns undefined for non-existent rule', async () => {
      const result = await dao.updateRule(randomUUID(), { name: 'New' });
      expect(result).toBeUndefined();
    });
  });

  describe('deleteRule', () => {
    it('deletes a rule and its groups', async () => {
      const rule = await dao.createRule({
        name: 'Deletable Rule',
        datasources: [{ datasourceId: randomUUID() }],
      });

      await dao.deleteRule(rule.id);

      const fetched = await dao.getRule(rule.id);
      expect(fetched).toBeUndefined();
    });
  });

  describe('materializeRule', () => {
    it('materializes the latest rule after concurrent edits', async () => {
      const firstDatasourceId = randomUUID();
      const secondDatasourceId = randomUUID();
      await testDb('datastore').insert([
        {
          id: randomUUID(),
          datasource_id: firstDatasourceId,
          object_id: 'first',
          object: JSON.stringify({ name: 'First' }),
        },
        {
          id: randomUUID(),
          datasource_id: secondDatasourceId,
          object_id: 'second',
          object: JSON.stringify({ name: 'Second' }),
        },
      ]);
      const rule = await dao.createRule({
        name: 'Concurrent Rule',
        datasources: [{ datasourceId: firstDatasourceId }],
      });
      const lockKey = `${CONTEXT_GROUP_MATERIALIZE_LOCK_NS}${rule.id}`;
      const blocker = knex({
        client: 'pg',
        connection: testDb.client.config.connection,
      });
      await blocker.raw(`SELECT pg_advisory_lock(hashtext(?))`, [lockKey]);
      const materialization = dao.materializeRule(rule.id);
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
          const result = await blocker.raw<{
            rows: Array<{ waiting: boolean }>;
          }>(
            `SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE datname = current_database()
                AND wait_event_type = 'Lock'
                AND wait_event = 'advisory'
                AND query LIKE '%pg_advisory_xact_lock%'
            ) AS waiting`,
          );
          waiting = result.rows[0]?.waiting ?? false;
          if (!waiting) {
            await new Promise(resolve => setTimeout(resolve, 5));
          }
        }
        expect(waiting).toBe(true);
        await blocker('context_group_rule')
          .where('id', rule.id)
          .update({
            datasources: JSON.stringify([{ datasourceId: secondDatasourceId }]),
          });
      } finally {
        await blocker.raw(`SELECT pg_advisory_unlock(hashtext(?))`, [lockKey]);
        await blocker.destroy();
      }
      await materialization;

      const groups = await dao.listGroups({ ruleId: rule.id });
      expect(groups.items).toHaveLength(1);
      const members = await dao.listGroupMembers(groups.items[0].id);
      expect(members.items).toEqual([
        expect.objectContaining({
          datasourceId: secondDatasourceId,
          objectId: 'second',
        }),
      ]);
    });

    it('creates one group per datasource object', async () => {
      const datasourceId = randomUUID();

      await testDb('datastore').insert([
        {
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: 'obj-1',
          object: JSON.stringify({ name: 'Object 1' }),
        },
        {
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: 'obj-2',
          object: JSON.stringify({ name: 'Object 2' }),
        },
      ]);

      const rule = await dao.createRule({
        name: 'Materialize Test',
        datasources: [{ datasourceId }],
      });

      await dao.materializeRule(rule.id);

      const groups = await dao.listGroups({ ruleId: rule.id });
      expect(groups.items).toHaveLength(2);
      expect(groups.items[0]).toMatchObject({
        workspaceId: '00000000-0000-4000-8000-000000000001',
        ownership: 'org',
      });
    });

    it('materializes more members than fit in a single bound insert', async () => {
      // Regression: member rows have several columns, so >13107 of them exceed
      // PostgreSQL's 65535 bind-parameter limit in one INSERT.
      const datasourceId = randomUUID();
      const objectCount = 14_000;
      const rows = Array.from({ length: objectCount }, (_, index) => ({
        id: randomUUID(),
        datasource_id: datasourceId,
        object_id: `obj-${index}`,
        object: JSON.stringify({ name: `Object ${index}` }),
      }));
      for (let i = 0; i < rows.length; i += 2000) {
        await testDb('datastore').insert(rows.slice(i, i + 2000));
      }

      const rule = await dao.createRule({
        name: 'Large Materialize Test',
        datasources: [{ datasourceId }],
      });

      await dao.materializeRule(rule.id);

      const [members] = await testDb('context_group_member').count<
        Array<{ count: string }>
      >('* as count');
      expect(Number(members.count)).toBe(objectCount);

      const [groups] = await testDb('context_group')
        .where('rule_id', rule.id)
        .count<Array<{ count: string }>>('* as count');
      expect(Number(groups.count)).toBe(objectCount);
    }, 120_000);

    it('merges groups when objects are linked by a merge relationship type', async () => {
      const datasourceId = randomUUID();

      await testDb('datastore').insert([
        {
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: 'user-1',
          object: JSON.stringify({ name: 'User 1' }),
        },
        {
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: 'user-2',
          object: JSON.stringify({ name: 'User 2' }),
        },
      ]);

      await testDb('datastore_relation').insert({
        id: randomUUID(),
        source_datasource_id: datasourceId,
        source_object_id: 'user-1',
        destination_datasource_id: datasourceId,
        destination_object_id: 'user-2',
        relation_type: 'shares_email',
        origin: 'manual',
      });

      const rule = await dao.createRule({
        name: 'Merge Test',
        datasources: [{ datasourceId }],
        mergeRelationshipTypes: ['shares_email'],
      });

      await dao.materializeRule(rule.id);

      const groups = await dao.listGroups({ ruleId: rule.id });
      expect(groups.items).toHaveLength(1);

      const members = await dao.listGroupMembers(groups.items[0].id);
      expect(members.items).toHaveLength(2);
    });

    it('merges when only the reciprocal name matches a merge type', async () => {
      // The reciprocal is the same edge read from the other side, and the
      // merge is direction-agnostic — an edge stored as user-1 owns user-2
      // with reciprocal owned_by IS an owned_by relationship.
      const datasourceId = randomUUID();

      await testDb('datastore').insert(
        ['user-1', 'user-2'].map(objectId => ({
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: objectId,
          object: JSON.stringify({ id: objectId }),
        })),
      );
      await testDb('datastore_relation').insert({
        id: randomUUID(),
        source_datasource_id: datasourceId,
        source_object_id: 'user-1',
        destination_datasource_id: datasourceId,
        destination_object_id: 'user-2',
        relation_type: 'owns',
        reciprocal_relation_type: 'owned_by',
        origin: 'manual',
      });

      const rule = await dao.createRule({
        name: 'Reciprocal Merge Test',
        datasources: [{ datasourceId }],
        mergeRelationshipTypes: ['owned_by'],
      });

      await dao.materializeRule(rule.id);

      const groups = await dao.listGroups({ ruleId: rule.id });
      expect(groups.items).toHaveLength(1);

      const members = await dao.listGroupMembers(groups.items[0].id);
      expect(members.items).toHaveLength(2);
    });

    it('keeps related objects separate when the relation type is not a merge type', async () => {
      const datasourceId = randomUUID();
      await testDb('datastore').insert(
        ['channel-1', 'channel-2'].map(objectId => ({
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: objectId,
          object: JSON.stringify({ id: objectId }),
        })),
      );
      await testDb('datastore_relation').insert({
        id: randomUUID(),
        source_datasource_id: datasourceId,
        source_object_id: 'channel-1',
        destination_datasource_id: datasourceId,
        destination_object_id: 'channel-2',
        relation_type: 'hasMember',
        origin: 'manual',
      });
      const rule = await dao.createRule({
        name: 'Non-Merge Test',
        datasources: [{ datasourceId }],
        mergeRelationshipTypes: ['sameApplication'],
      });

      await dao.materializeRule(rule.id);

      const groups = await dao.listGroups({ ruleId: rule.id });
      expect(groups.items).toHaveLength(2);
    });

    it('merges transitively across two datasources', async () => {
      const teamsDatasourceId = randomUUID();
      const reposDatasourceId = randomUUID();

      await testDb('datastore').insert([
        {
          id: randomUUID(),
          datasource_id: teamsDatasourceId,
          object_id: 'team-1',
          object: JSON.stringify({ name: 'Team 1' }),
        },
        {
          id: randomUUID(),
          datasource_id: reposDatasourceId,
          object_id: 'repo-1',
          object: JSON.stringify({ name: 'Repo 1' }),
        },
        {
          id: randomUUID(),
          datasource_id: reposDatasourceId,
          object_id: 'repo-2',
          object: JSON.stringify({ name: 'Repo 2' }),
        },
        {
          id: randomUUID(),
          datasource_id: reposDatasourceId,
          object_id: 'repo-unrelated',
          object: JSON.stringify({ name: 'Repo Unrelated' }),
        },
      ]);

      await testDb('datastore_relation').insert([
        {
          id: randomUUID(),
          source_datasource_id: teamsDatasourceId,
          source_object_id: 'team-1',
          destination_datasource_id: reposDatasourceId,
          destination_object_id: 'repo-1',
          relation_type: 'owns',
          origin: 'manual',
        },
        {
          id: randomUUID(),
          source_datasource_id: reposDatasourceId,
          source_object_id: 'repo-2',
          destination_datasource_id: teamsDatasourceId,
          destination_object_id: 'team-1',
          relation_type: 'owns',
          origin: 'manual',
        },
      ]);

      const rule = await dao.createRule({
        name: 'Cross Datasource Merge Test',
        datasources: [
          { datasourceId: teamsDatasourceId },
          { datasourceId: reposDatasourceId },
        ],
        mergeRelationshipTypes: ['owns'],
      });

      await dao.materializeRule(rule.id);

      const groups = await dao.listGroups({ ruleId: rule.id });
      expect(groups.items).toHaveLength(2);

      const memberships = await Promise.all(
        groups.items.map(group => dao.listGroupMembers(group.id)),
      );
      const objectIdsByGroup = memberships.map(members =>
        members.items.map(member => member.objectId).sort(),
      );
      expect(objectIdsByGroup).toContainEqual(['repo-1', 'repo-2', 'team-1']);
      expect(objectIdsByGroup).toContainEqual(['repo-unrelated']);
    });

    it('handles object ids that contain colons (e.g. MS Graph channel ids)', async () => {
      const datasourceId = randomUUID();
      const channelId = '19:abc123@thread.tacv2';

      await testDb('datastore').insert([
        {
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: channelId,
          object: JSON.stringify({ name: 'Channel' }),
        },
        {
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: 'team-1',
          object: JSON.stringify({ name: 'Team 1' }),
        },
      ]);

      await testDb('datastore_relation').insert({
        id: randomUUID(),
        source_datasource_id: datasourceId,
        source_object_id: 'team-1',
        destination_datasource_id: datasourceId,
        destination_object_id: channelId,
        relation_type: 'hasChannel',
        origin: 'manual',
      });

      const rule = await dao.createRule({
        name: 'Colon Id Test',
        datasources: [{ datasourceId }],
        mergeRelationshipTypes: ['hasChannel'],
      });

      await dao.materializeRule(rule.id);

      const groups = await dao.listGroups({ ruleId: rule.id });
      expect(groups.items).toHaveLength(1);

      const group = await dao.getGroupWithMembers(groups.items[0].id);
      const allObjects = (group?.datasources ?? []).flatMap(ds => ds.objects);
      const channelObject = allObjects.find(o => o.objectId === channelId);
      expect(channelObject).toBeDefined();
      expect(channelObject?.data).toEqual({ name: 'Channel' });
    });

    it('ignores inactive candidates when materializing but matches referenced datasources', async () => {
      const liveDatasourceId = randomUUID();
      const inactiveDatasourceId = randomUUID();
      const workflowDao = new ContextGroupDao({
        knex: testDb,
        catalogWorkflowClient: {
          list: vi.fn(async () => ({
            data: [
              {
                id: liveDatasourceId,
                name: 'Live source',
                slug: 'live-source',
                description: '',
                version: 1,
                workflowType: 'data-ingestion',
                nodes: [
                  {
                    id: 'source',
                    type: 'source-datastore',
                    position: { x: 0, y: 0 },
                    data: {
                      label: 'Source',
                      config: { datasourceId: liveDatasourceId },
                    },
                  },
                ],
                edges: [],
                enabled: true,
                createdBy: 'test',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              {
                id: inactiveDatasourceId,
                name: 'Inactive source',
                slug: 'inactive-source',
                description: '',
                version: 1,
                workflowType: 'data-ingestion',
                nodes: [
                  {
                    id: 'source',
                    type: 'source-datastore',
                    position: { x: 0, y: 0 },
                    data: {
                      label: 'Source',
                      config: { datasourceId: inactiveDatasourceId },
                    },
                  },
                ],
                edges: [],
                enabled: false,
                createdBy: 'test',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
            total: 2,
          })),
        } as never,
      });

      await testDb('datastore').insert([
        {
          id: randomUUID(),
          datasource_id: liveDatasourceId,
          object_id: 'live-1',
          object: JSON.stringify({ name: 'Live' }),
        },
        {
          id: randomUUID(),
          datasource_id: inactiveDatasourceId,
          object_id: 'inactive-1',
          object: JSON.stringify({ name: 'Inactive' }),
        },
      ]);

      const rule = await workflowDao.createRule({
        name: 'Inactive Candidate Test',
        datasources: [
          { datasourceId: liveDatasourceId },
          { datasourceId: inactiveDatasourceId },
        ],
      });

      await workflowDao.materializeRule(rule.id);

      const groups = await workflowDao.listGroups({ ruleId: rule.id });
      expect(groups.items).toHaveLength(1);
      const members = await workflowDao.listGroupMembers(groups.items[0].id);
      expect(members.items).toHaveLength(1);
      expect(members.items[0].datasourceId).toBe(liveDatasourceId);

      await expect(
        workflowDao.getRulesForDatasource(inactiveDatasourceId),
      ).resolves.toEqual([
        expect.objectContaining({
          id: rule.id,
        }),
      ]);
    });

    it('removes stale groups when a referenced datasource is disabled', async () => {
      const datasourceId = randomUUID();
      let enabled = true;
      const workflowDao = new ContextGroupDao({
        knex: testDb,
        catalogWorkflowClient: {
          list: vi.fn(async () => ({
            data: [
              {
                id: datasourceId,
                name: 'Toggled source',
                slug: 'toggled-source',
                description: '',
                version: 1,
                workflowType: 'data-ingestion',
                nodes: [
                  {
                    id: 'source',
                    type: 'source-datastore',
                    position: { x: 0, y: 0 },
                    data: {
                      label: 'Source',
                      config: { datasourceId },
                    },
                  },
                ],
                edges: [],
                enabled,
                createdBy: 'test',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
            total: 1,
          })),
        } as never,
      });

      await testDb('datastore').insert({
        id: randomUUID(),
        datasource_id: datasourceId,
        object_id: 'obj-1',
        object: JSON.stringify({ name: 'Object' }),
      });

      const rule = await workflowDao.createRule({
        name: 'Disable Cleanup Test',
        datasources: [{ datasourceId }],
      });

      await workflowDao.materializeRule(rule.id);
      expect(
        (await workflowDao.listGroups({ ruleId: rule.id })).items,
      ).toHaveLength(1);

      enabled = false;
      await workflowDao.materializeForDatasource(datasourceId);

      await expect(
        workflowDao.listGroups({ ruleId: rule.id }),
      ).resolves.toMatchObject({
        items: [],
      });
    });
  });

  describe('getGroupWithMembers bundle', () => {
    const mainDs = randomUUID();
    const externalDs = randomUUID();

    beforeEach(async () => {
      await testDb('datastore').insert([
        {
          id: randomUUID(),
          datasource_id: mainDs,
          object_id: 'user-1',
          object: JSON.stringify({
            name: 'Ada',
            metadata: { role: 'admin' },
            secret: 'do-not-leak',
          }),
        },
        {
          id: randomUUID(),
          datasource_id: externalDs,
          object_id: 'org-1',
          object: JSON.stringify({ name: 'Acme' }),
        },
      ]);
      await testDb('datastore_relation').insert({
        id: randomUUID(),
        source_datasource_id: mainDs,
        source_object_id: 'user-1',
        destination_datasource_id: externalDs,
        destination_object_id: 'org-1',
        relation_type: 'works_at',
        origin: 'manual',
      });
    });

    const materializeAndGet = async (
      ruleInput: Parameters<ContextGroupDao['createRule']>[0],
      opts?: { datasourceIds?: string[] },
    ) => {
      const rule = await dao.createRule(ruleInput);
      await dao.materializeRule(rule.id);
      const groups = await dao.listGroups({ ruleId: rule.id });
      expect(groups.items).toHaveLength(1);
      return dao.getGroupWithMembers(groups.items[0].id, opts);
    };

    it('projects fields, groups by datasource, and returns annotations', async () => {
      const bundle = await materializeAndGet({
        name: 'People',
        datasources: [
          {
            datasourceId: mainDs,
            projection: [
              { source: 'metadata.role', label: 'role' },
              { source: 'name', label: 'name' },
            ],
            annotation: { title: 'Person', text: 'Use role for access level' },
          },
        ],
        annotations: [{ title: 'Overview', text: 'A people bundle' }],
      });

      expect(bundle?.annotations).toEqual([
        { title: 'Overview', text: 'A people bundle' },
      ]);
      expect(bundle?.datasources).toHaveLength(1);
      const [group] = bundle!.datasources;
      expect(group).toMatchObject({
        datasourceId: mainDs,
        annotation: { title: 'Person', text: 'Use role for access level' },
      });
      // Projected data only — the `secret` field is dropped.
      expect(group.objects).toEqual([
        { objectId: 'user-1', data: { role: 'admin', name: 'Ada' } },
      ]);
    });

    it('returns the full object when no projection is defined', async () => {
      const bundle = await materializeAndGet({
        name: 'People Full',
        datasources: [{ datasourceId: mainDs }],
      });

      expect(bundle?.datasources[0].objects[0].data).toEqual({
        name: 'Ada',
        metadata: { role: 'admin' },
        secret: 'do-not-leak',
      });
    });

    it('emits external relations as identifiers only when enabled (default)', async () => {
      const bundle = await materializeAndGet({
        name: 'People Ext',
        datasources: [{ datasourceId: mainDs }],
      });

      expect(bundle?.externalRelations).toEqual([
        {
          fromDatasourceId: mainDs,
          fromObjectId: 'user-1',
          toDatasourceId: externalDs,
          toObjectId: 'org-1',
          relationshipType: 'works_at',
        },
      ]);
    });

    it('omits external relations when includeExternalRelations is false', async () => {
      const bundle = await materializeAndGet({
        name: 'People No Ext',
        datasources: [{ datasourceId: mainDs }],
        includeExternalRelations: false,
      });

      expect(bundle?.externalRelations).toBeUndefined();
    });

    it('slices the bundle to the requested datasource ids', async () => {
      const otherDs = randomUUID();
      await testDb('datastore').insert({
        id: randomUUID(),
        datasource_id: otherDs,
        object_id: 'team-1',
        object: JSON.stringify({ name: 'Platform' }),
      });
      await testDb('datastore_relation').insert({
        id: randomUUID(),
        source_datasource_id: mainDs,
        source_object_id: 'user-1',
        destination_datasource_id: otherDs,
        destination_object_id: 'team-1',
        relation_type: 'member_of',
        origin: 'manual',
      });

      const bundle = await materializeAndGet(
        {
          name: 'People Sliced',
          datasources: [{ datasourceId: mainDs }, { datasourceId: otherDs }],
          mergeRelationshipTypes: ['member_of'],
        },
        { datasourceIds: [mainDs] },
      );

      expect(bundle?.datasources.map(d => d.datasourceId)).toEqual([mainDs]);
      // The external relation sourced from the sliced-in datasource is kept.
      expect(
        bundle?.externalRelations?.some(r => r.toObjectId === 'org-1'),
      ).toBe(true);
    });
  });

  describe('getGroupsWithMembers displayName', () => {
    it('derives a human label per member and falls back to objectId', async () => {
      const datasourceId = randomUUID();

      await testDb('datastore').insert([
        {
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: 'obj-named',
          object: JSON.stringify({ name: 'Repo Alpha' }),
        },
        {
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: 'obj-unlabeled',
          object: JSON.stringify({ foo: 'bar' }),
        },
      ]);

      const rule = await dao.createRule({
        name: 'Label Test',
        datasources: [{ datasourceId }],
      });
      await dao.materializeRule(rule.id);

      const { groups } = await dao.getGroupsWithMembers(rule.id);

      const byObjectId = new Map(groups.map(g => [g.members[0].objectId, g]));
      expect(byObjectId.get('obj-named')?.members[0].displayName).toBe(
        'Repo Alpha',
      );
      // group name mirrors the first member's derived label
      expect(byObjectId.get('obj-named')?.name).toBe('Repo Alpha');
      // no label field → fall back to the object id
      expect(byObjectId.get('obj-unlabeled')?.members[0].displayName).toBe(
        'obj-unlabeled',
      );
    });
  });

  describe('getGroupsWithMembers member search', () => {
    it('keeps only groups with a member matching the query, with a filtered total', async () => {
      const datasourceId = randomUUID();

      await testDb('datastore').insert([
        {
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: 'obj-miklos',
          object: JSON.stringify({ name: 'Miklos Kiss', role: 'engineer' }),
        },
        {
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: 'obj-ada',
          object: JSON.stringify({ name: 'Ada Lovelace', role: 'engineer' }),
        },
      ]);

      const rule = await dao.createRule({
        name: 'Search Test',
        datasources: [{ datasourceId }],
      });
      await dao.materializeRule(rule.id);

      const matched = await dao.getGroupsWithMembers(rule.id, { q: 'miklos' });
      expect(matched.totalGroups).toBe(1);
      expect(matched.groups).toHaveLength(1);
      expect(matched.groups[0].members[0].objectId).toBe('obj-miklos');

      // A term shared by every member matches every group…
      const shared = await dao.getGroupsWithMembers(rule.id, { q: 'engineer' });
      expect(shared.totalGroups).toBe(2);

      // …and a term matching nothing returns the empty page.
      const none = await dao.getGroupsWithMembers(rule.id, {
        q: 'zzz-nothing',
      });
      expect(none.totalGroups).toBe(0);
      expect(none.groups).toHaveLength(0);
    });
  });

  describe('previewRule', () => {
    it('returns preview groups without persisting', async () => {
      const datasourceId = randomUUID();

      await testDb('datastore').insert([
        {
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: 'preview-obj-1',
          object: JSON.stringify({ name: 'Preview Object' }),
        },
      ]);

      const preview = await dao.previewRule({
        name: 'Preview Test',
        datasources: [{ datasourceId }],
      });

      expect(preview.groups).toHaveLength(1);
      expect(preview.totalGroups).toBe(1);

      const persistedGroups = await testDb('context_group').select();
      expect(persistedGroups).toHaveLength(0);
    });

    it('merges preview groups via mergeRelationshipTypes', async () => {
      const datasourceId = randomUUID();

      await testDb('datastore').insert(
        ['obj-1', 'obj-2', 'obj-3'].map(objectId => ({
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: objectId,
          object: JSON.stringify({ id: objectId }),
        })),
      );
      await testDb('datastore_relation').insert({
        id: randomUUID(),
        source_datasource_id: datasourceId,
        source_object_id: 'obj-1',
        destination_datasource_id: datasourceId,
        destination_object_id: 'obj-2',
        relation_type: 'sameApplication',
        origin: 'manual',
      });

      const preview = await dao.previewRule({
        name: 'Merge Preview Test',
        datasources: [{ datasourceId }],
        mergeRelationshipTypes: ['sameApplication'],
      });

      expect(preview.totalGroups).toBe(2);
      const objectIdsByGroup = preview.groups.map(group =>
        group.members.map(member => member.objectId).sort(),
      );
      expect(objectIdsByGroup).toContainEqual(['obj-1', 'obj-2']);
      expect(objectIdsByGroup).toContainEqual(['obj-3']);
    });

    it('merges preview groups when only the reciprocal name matches', async () => {
      const datasourceId = randomUUID();

      await testDb('datastore').insert(
        ['obj-1', 'obj-2'].map(objectId => ({
          id: randomUUID(),
          datasource_id: datasourceId,
          object_id: objectId,
          object: JSON.stringify({ id: objectId }),
        })),
      );
      await testDb('datastore_relation').insert({
        id: randomUUID(),
        source_datasource_id: datasourceId,
        source_object_id: 'obj-1',
        destination_datasource_id: datasourceId,
        destination_object_id: 'obj-2',
        relation_type: 'owns',
        reciprocal_relation_type: 'owned_by',
        origin: 'manual',
      });

      const preview = await dao.previewRule({
        name: 'Reciprocal Merge Preview Test',
        datasources: [{ datasourceId }],
        mergeRelationshipTypes: ['owned_by'],
      });

      expect(preview.totalGroups).toBe(1);
      expect(
        preview.groups[0].members.map(member => member.objectId).sort(),
      ).toEqual(['obj-1', 'obj-2']);
    });

    it('returns candidate status metadata on enriched rules', async () => {
      const datasourceId = randomUUID();
      const rule = await dao.createRule({
        name: 'Status Test',
        datasources: [{ datasourceId }, { seedName: 'Missing seed' }],
      });

      const enriched = await dao.enrichRule(rule);

      expect(enriched.datasources[0].status).toEqual(
        expect.objectContaining({
          live: false,
          datasourceId,
          inactiveReason: 'No successful sync yet',
        }),
      );
      expect(enriched.datasources[1].status).toEqual(
        expect.objectContaining({
          live: false,
          seedName: 'Missing seed',
          inactiveReason: 'Data source not found',
        }),
      );
    });
  });

  describe('findGroupsByMember', () => {
    it('finds groups containing a specific member', async () => {
      const datasourceId = randomUUID();

      await testDb('datastore').insert({
        id: randomUUID(),
        datasource_id: datasourceId,
        object_id: 'findable-obj',
        object: JSON.stringify({ name: 'Findable' }),
      });

      const rule = await dao.createRule({
        name: 'Find Test',
        datasources: [{ datasourceId }],
      });

      await dao.materializeRule(rule.id);

      const groups = await dao.findGroupsByMember(datasourceId, 'findable-obj');
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        ruleId: rule.id,
        ruleName: 'Find Test',
      });
    });
  });

  describe('listGroups scope filtering', () => {
    const seedRule = async (slug: string) => {
      const datasourceId = randomUUID();
      await testDb('datastore').insert({
        id: randomUUID(),
        datasource_id: datasourceId,
        object_id: `${slug}-obj`,
        object: JSON.stringify({ name: slug }),
      });
      const rule = await dao.createRule({
        name: slug,
        slug,
        datasources: [{ datasourceId }],
      });
      await dao.materializeRule(rule.id);
      return rule;
    };

    it('restricts groups to the parent rule slugs in allowedRuleSlugs', async () => {
      await seedRule('team-a');
      await seedRule('team-b');

      expect((await dao.listGroups()).total).toBe(2);

      const onlyA = await dao.listGroups({ allowedRuleSlugs: ['team-a'] });
      expect(onlyA.total).toBe(1);
      expect(await dao.getRuleSlugForGroup(onlyA.items[0].id)).toBe('team-a');
    });

    it('returns nothing for an empty allowedRuleSlugs list', async () => {
      await seedRule('team-a');
      const result = await dao.listGroups({ allowedRuleSlugs: [] });
      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
    });
  });
});
