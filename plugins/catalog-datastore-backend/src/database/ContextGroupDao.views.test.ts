import { TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { applyMigrations } from './applyMigrations';
import { ContextGroupDao } from './ContextGroupDao';
import { DatasourceFilter } from './types';
import {
  DEFAULT_VIEW_NAME,
  DEFAULT_VIEW_TEMPLATE,
  ViewNotFoundError,
  ViewValidationError,
} from './contextGroupViews';

const databases = TestDatabases.create();

describe('ContextGroupDao views', () => {
  let testDb: Knex;
  let dao: ContextGroupDao;
  // The workflow service is the source of document keys: every datasource
  // has a unique slug. Tests register theirs here.
  let workflows: Array<{ id: string; slug: string }> = [];
  let workspaceWorkflows = new Map<
    string,
    Array<{ id: string; slug: string }>
  >();

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    dao = new ContextGroupDao({
      knex: testDb,
      catalogWorkflowClient: {
        list: async (options: { workspaceId?: string }) => {
          const scoped = options.workspaceId
            ? workspaceWorkflows.get(options.workspaceId)
            : undefined;
          const data = scoped ?? workflows;
          return { data, total: data.length };
        },
      } as any,
    });
  }, 120_000);

  beforeEach(async () => {
    workflows = [];
    workspaceWorkflows = new Map();
    await testDb('context_group_member').del();
    await testDb('context_group').del();
    await testDb('context_group_view').del();
    await testDb('context_group_rule').del();
    await testDb('datastore_relation').del();
    await testDb('datastore').del();
  });

  afterAll(async () => {
    await testDb.destroy();
  });

  const createRule = (
    datasources: DatasourceFilter[] = [{ datasourceId: randomUUID() }],
  ) => dao.createRule({ name: `Rule ${randomUUID()}`, datasources });

  describe('view CRUD', () => {
    it('auto-creates a default view with the rule', async () => {
      const rule = await createRule();
      const views = await dao.listViews(rule.id);
      expect(views).toHaveLength(1);
      expect(views[0]).toMatchObject({
        ruleId: rule.id,
        name: DEFAULT_VIEW_NAME,
        isDefault: true,
        template: DEFAULT_VIEW_TEMPLATE,
      });
    });

    it('creates additional named views', async () => {
      const rule = await createRule();
      const created = await dao.createView(rule.id, {
        name: 'identifiers-only',
        description: 'Names and emails',
        template: '{{ group.name }}',
      });
      expect(created).toMatchObject({
        name: 'identifiers-only',
        isDefault: false,
      });
      const views = await dao.listViews(rule.id);
      expect(views.map(p => p.name)).toEqual([
        DEFAULT_VIEW_NAME,
        'identifiers-only',
      ]);
    });

    it('rejects invalid view names', async () => {
      const rule = await createRule();
      await expect(
        dao.createView(rule.id, {
          name: 'Not A Slug',
          template: 'x',
        }),
      ).rejects.toThrow(ViewValidationError);
    });

    it('rejects templates that do not parse, with position info', async () => {
      const rule = await createRule();
      const error = await dao
        .createView(rule.id, {
          name: 'broken',
          template: 'line one\n{% if %}',
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ViewValidationError);
      expect((error as ViewValidationError).issues[0].line).toBe(2);
    });

    it('rejects templates using disallowed tags or undeclared filters', async () => {
      const rule = await createRule();
      await expect(
        dao.createView(rule.id, {
          name: 'sneaky',
          template: "{% include 'other' %}",
        }),
      ).rejects.toThrow(ViewValidationError);
      // The data functions are declared, so they validate fine.
      await expect(
        dao.createView(rule.id, {
          name: 'uses-data',
          template: "{{ members.github[0] | related: 'owns' | size }}",
        }),
      ).resolves.toMatchObject({ name: 'uses-data' });
    });

    it('rejects duplicate view names within a rule', async () => {
      const rule = await createRule();
      await dao.createView(rule.id, { name: 'view', template: 'a' });
      await expect(
        dao.createView(rule.id, { name: 'view', template: 'b' }),
      ).rejects.toThrow();
    });

    it('promoting a view to default demotes the previous default', async () => {
      const rule = await createRule();
      const view = await dao.createView(rule.id, {
        name: 'view',
        template: 'a',
      });
      await dao.updateView(view.id, { isDefault: true });
      const views = await dao.listViews(rule.id);
      expect(views.find(p => p.name === DEFAULT_VIEW_NAME)?.isDefault).toBe(
        false,
      );
      expect(views.find(p => p.name === 'view')?.isDefault).toBe(true);
    });

    it('refuses to unset the default flag directly', async () => {
      const rule = await createRule();
      const [def] = await dao.listViews(rule.id);
      await expect(
        dao.updateView(def.id, { isDefault: false }),
      ).rejects.toThrow(/promote another view/);
    });

    it('refuses to delete the default view but deletes others', async () => {
      const rule = await createRule();
      const [def] = await dao.listViews(rule.id);
      const view = await dao.createView(rule.id, {
        name: 'view',
        template: 'a',
      });
      await expect(dao.deleteView(def.id)).rejects.toThrow(/cannot be deleted/);
      await dao.deleteView(view.id);
      expect(await dao.listViews(rule.id)).toHaveLength(1);
    });

    it('validates templates on update', async () => {
      const rule = await createRule();
      const [def] = await dao.listViews(rule.id);
      await expect(
        dao.updateView(def.id, { template: '{% if %}' }),
      ).rejects.toThrow(ViewValidationError);
      const updated = await dao.updateView(def.id, {
        template: 'hello {{ group.name }}',
      });
      expect(updated?.template).toBe('hello {{ group.name }}');
    });
  });

  /** Seed a group with members and their objects; returns ids. */
  async function seedGroup(params: {
    ruleDatasources: Array<{ datasourceId: string; seedName?: string }>;
    objects: Array<{ datasourceId: string; objectId: string; object: object }>;
    members: Array<{ datasourceId: string; objectId: string }>;
  }) {
    const rule = await createRule(params.ruleDatasources);
    const groupId = randomUUID();
    await testDb('context_group').insert({ id: groupId, rule_id: rule.id });
    await testDb('datastore').insert(
      params.objects.map(o => ({
        id: randomUUID(),
        datasource_id: o.datasourceId,
        object_id: o.objectId,
        object: JSON.stringify(o.object),
      })),
    );
    await testDb('context_group_member').insert(
      params.members.map(m => ({
        context_group_id: groupId,
        datasource_id: m.datasourceId,
        object_id: m.objectId,
      })),
    );
    return { rule, groupId };
  }

  describe('getGroupDocument', () => {
    it('keys members by datasource slug with identity wrappers', async () => {
      const githubDs = randomUUID();
      const shortcutDs = randomUUID();
      workflows = [
        { id: githubDs, slug: 'github-members' },
        { id: shortcutDs, slug: 'shortcut-users' },
      ];
      const { groupId } = await seedGroup({
        ruleDatasources: [
          { datasourceId: githubDs, seedName: 'GitHub Members' },
          { datasourceId: shortcutDs, seedName: 'Shortcut Users' },
        ],
        objects: [
          {
            datasourceId: githubDs,
            objectId: 'user-1',
            object: { name: 'Brian Fletcher', email: 'brian@example.com' },
          },
          {
            datasourceId: shortcutDs,
            objectId: 'sc-1',
            object: { profile: { full_name: 'B. Fletcher' } },
          },
        ],
        members: [
          { datasourceId: githubDs, objectId: 'user-1' },
          { datasourceId: shortcutDs, objectId: 'sc-1' },
        ],
      });

      const document = await dao.getGroupDocument(groupId);
      expect(document).not.toBeNull();
      expect(document!.group.name).toBe('Brian Fletcher');
      expect(Object.keys(document!.members).sort()).toEqual([
        'github-members',
        'shortcut-users',
      ]);
      expect(document!.members['github-members'][0]).toEqual({
        datasourceId: githubDs,
        objectId: 'user-1',
        data: { name: 'Brian Fletcher', email: 'brian@example.com' },
      });
    });

    it('omits members whose datasource has no resolvable slug', async () => {
      const knownDs = randomUUID();
      const goneDs = randomUUID();
      workflows = [{ id: knownDs, slug: 'github-members' }];
      const { groupId } = await seedGroup({
        ruleDatasources: [{ datasourceId: knownDs, seedName: 'GitHub' }],
        objects: [
          { datasourceId: knownDs, objectId: 'user-1', object: { name: 'B' } },
          { datasourceId: goneDs, objectId: 'old-1', object: { name: 'X' } },
        ],
        members: [
          { datasourceId: knownDs, objectId: 'user-1' },
          { datasourceId: goneDs, objectId: 'old-1' },
        ],
      });

      const document = await dao.getGroupDocument(groupId);
      expect(Object.keys(document!.members)).toEqual(['github-members']);
    });

    it('returns null for an unknown group', async () => {
      expect(await dao.getGroupDocument(randomUUID())).toBeNull();
    });
  });

  describe('getRuleDocumentKeys', () => {
    it('keys each datasource by its slug, in rule order', async () => {
      const githubDs = randomUUID();
      const shortcutDs = randomUUID();
      workflows = [
        { id: githubDs, slug: 'github-members' },
        { id: shortcutDs, slug: 'shortcut-users' },
      ];
      const rule = await createRule([
        { datasourceId: githubDs, seedName: 'GitHub Members' },
        { datasourceId: shortcutDs, seedName: 'Shortcut Users' },
      ]);
      expect(await dao.getRuleDocumentKeys(rule)).toEqual([
        { datasourceId: githubDs, key: 'github-members' },
        { datasourceId: shortcutDs, key: 'shortcut-users' },
      ]);
    });

    it('excludes a datasource the workflow service cannot resolve to a slug', async () => {
      const known = randomUUID();
      const unknown = randomUUID();
      workflows = [{ id: known, slug: 'github-members' }];
      const rule = await createRule([
        { datasourceId: unknown, seedName: 'Gone' },
        { datasourceId: known, seedName: 'GitHub Members' },
      ]);
      expect(await dao.getRuleDocumentKeys(rule)).toEqual([
        { datasourceId: known, key: 'github-members' },
      ]);
    });

    it('resolves datasource slugs in the rule workspace', async () => {
      const workspaceId = randomUUID();
      const datasourceId = randomUUID();
      workspaceWorkflows.set(workspaceId, [
        { id: datasourceId, slug: 'workspace-members' },
      ]);
      const rule = await dao.createRule(
        {
          name: 'Workspace rule',
          datasources: [{ datasourceId }],
        },
        workspaceId,
      );

      await expect(dao.getRuleDocumentKeys(rule, workspaceId)).resolves.toEqual(
        [{ datasourceId, key: 'workspace-members' }],
      );
    });
  });

  describe('findSampleGroupIdForDatasource', () => {
    it('finds a group containing the datasource, scoped to the rule', async () => {
      const githubDs = randomUUID();
      const shortcutDs = randomUUID();
      const rule = await createRule([
        { datasourceId: githubDs, seedName: 'GitHub' },
        { datasourceId: shortcutDs, seedName: 'Shortcut' },
      ]);
      // Single-source groups, as a rule without merge relationships produces.
      const githubGroupId = randomUUID();
      const shortcutGroupId = randomUUID();
      await testDb('context_group').insert([
        { id: githubGroupId, rule_id: rule.id },
        { id: shortcutGroupId, rule_id: rule.id },
      ]);
      await testDb('context_group_member').insert([
        {
          context_group_id: githubGroupId,
          datasource_id: githubDs,
          object_id: 'user-1',
        },
        {
          context_group_id: shortcutGroupId,
          datasource_id: shortcutDs,
          object_id: 'sc-1',
        },
      ]);

      expect(await dao.findSampleGroupIdForDatasource(rule.id, githubDs)).toBe(
        githubGroupId,
      );
      expect(
        await dao.findSampleGroupIdForDatasource(rule.id, shortcutDs),
      ).toBe(shortcutGroupId);
      expect(
        await dao.findSampleGroupIdForDatasource(rule.id, randomUUID()),
      ).toBeUndefined();
      // Another rule's groups don't leak in.
      const otherRule = await createRule([{ datasourceId: githubDs }]);
      expect(
        await dao.findSampleGroupIdForDatasource(otherRule.id, githubDs),
      ).toBeUndefined();
    });
  });

  describe('renderBundle', () => {
    it('renders the default members-dump view', async () => {
      const ds = randomUUID();
      const prDs = randomUUID();
      workflows = [{ id: ds, slug: 'github' }];
      const { groupId } = await seedGroup({
        ruleDatasources: [{ datasourceId: ds, seedName: 'GitHub' }],
        objects: [
          {
            datasourceId: ds,
            objectId: 'user-1',
            object: { name: 'Brian Fletcher' },
          },
          {
            datasourceId: prDs,
            objectId: 'pr-1',
            object: { title: 'Fix bug' },
          },
        ],
        members: [{ datasourceId: ds, objectId: 'user-1' }],
      });
      await testDb('datastore_relation').insert({
        id: randomUUID(),
        source_datasource_id: ds,
        source_object_id: 'user-1',
        destination_datasource_id: prDs,
        destination_object_id: 'pr-1',
        relation_type: 'owns',
        origin: 'manual',
      });

      const bundle = await dao.renderBundle(groupId);
      expect(bundle).not.toBeNull();
      expect(bundle!.view.name).toBe(DEFAULT_VIEW_NAME);
      expect(bundle!.group).toEqual({ id: groupId, name: 'Brian Fletcher' });
      expect(bundle!.rule).toMatchObject({ id: bundle!.ruleId });
      const parsed = JSON.parse(bundle!.rendered);
      // Untyped `related` returns identity references grouped by relationship
      // type; datasourceSlug falls back to the raw id for a datasource the
      // workflow service doesn't know.
      expect(parsed.github).toEqual([
        {
          objectId: 'user-1',
          data: { name: 'Brian Fletcher' },
          related: {
            owns: {
              count: 1,
              items: [
                { datasourceId: prDs, datasourceSlug: prDs, objectId: 'pr-1' },
              ],
            },
          },
        },
      ]);
      expect(bundle!.availableViews).toEqual([
        {
          name: DEFAULT_VIEW_NAME,
          description: expect.any(String),
          isDefault: true,
        },
      ]);
    });

    it('renders a named view using the related data function', async () => {
      const peopleDs = randomUUID();
      const prDs = randomUUID();
      workflows = [{ id: peopleDs, slug: 'people' }];
      const { rule, groupId } = await seedGroup({
        ruleDatasources: [{ datasourceId: peopleDs, seedName: 'People' }],
        objects: [
          {
            datasourceId: peopleDs,
            objectId: 'user-1',
            object: { name: 'Brian Fletcher' },
          },
          {
            datasourceId: prDs,
            objectId: 'pr-1',
            object: { title: 'Fix bug' },
          },
          {
            datasourceId: prDs,
            objectId: 'pr-2',
            object: { title: 'Add feature' },
          },
        ],
        members: [{ datasourceId: peopleDs, objectId: 'user-1' }],
      });
      await testDb('datastore_relation').insert(
        ['pr-1', 'pr-2'].map(objectId => ({
          id: randomUUID(),
          source_datasource_id: peopleDs,
          source_object_id: 'user-1',
          destination_datasource_id: prDs,
          destination_object_id: objectId,
          relation_type: 'owns',
          origin: 'manual',
        })),
      );

      await dao.createView(rule.id, {
        name: 'activity',
        template: [
          'name: {{ members.people[0].data.name }}',
          "pull-request-count: {{ members.people[0] | related: 'owns' | size }}",
          "first-pr: {{ members.people[0] | related: 'owns' | map: 'data' | map: 'title' | sort | first }}",
        ].join('\n'),
      });

      const bundle = await dao.renderBundle(groupId, {
        view: 'activity',
      });
      expect(bundle!.rendered).toContain('name: Brian Fletcher');
      expect(bundle!.rendered).toContain('pull-request-count: 2');
      expect(bundle!.rendered).toContain('first-pr: Add feature');
      expect(bundle!.view.name).toBe('activity');
      expect(bundle!.availableViews.map(p => p.name)).toEqual([
        DEFAULT_VIEW_NAME,
        'activity',
      ]);
    });

    it('groups unfiltered related targets by relationship type', async () => {
      const peopleDs = randomUUID();
      const otherDs = randomUUID();
      workflows = [{ id: peopleDs, slug: 'people' }];
      const { rule, groupId } = await seedGroup({
        ruleDatasources: [{ datasourceId: peopleDs, seedName: 'People' }],
        objects: [
          {
            datasourceId: peopleDs,
            objectId: 'user-1',
            object: { name: 'Brian Fletcher' },
          },
          {
            datasourceId: otherDs,
            objectId: 'pr-1',
            object: { title: 'Fix bug' },
          },
          {
            datasourceId: otherDs,
            objectId: 'team-1',
            object: { name: 'Platform Team' },
          },
        ],
        members: [{ datasourceId: peopleDs, objectId: 'user-1' }],
      });
      await testDb('datastore_relation').insert(
        [
          { objectId: 'pr-1', type: 'owns' },
          { objectId: 'team-1', type: 'member-of' },
        ].map(r => ({
          id: randomUUID(),
          source_datasource_id: peopleDs,
          source_object_id: 'user-1',
          destination_datasource_id: otherDs,
          destination_object_id: r.objectId,
          relation_type: r.type,
          origin: 'manual',
        })),
      );

      await dao.createView(rule.id, {
        name: 'by-type',
        template: '{{ members.people[0] | related | json: 2 }}',
      });

      const bundle = await dao.renderBundle(groupId, {
        view: 'by-type',
      });
      expect(JSON.parse(bundle!.rendered)).toEqual({
        owns: {
          count: 1,
          items: [
            {
              datasourceId: otherDs,
              datasourceSlug: otherDs,
              objectId: 'pr-1',
            },
          ],
        },
        'member-of': {
          count: 1,
          items: [
            {
              datasourceId: otherDs,
              datasourceSlug: otherDs,
              objectId: 'team-1',
            },
          ],
        },
      });

      // A reference expands to the full object via the `object` data function.
      await dao.createView(rule.id, {
        name: 'expand-first',
        template: [
          '{% assign refs = members.people[0] | related %}',
          '{% assign ref = refs.owns.items | first %}',
          '{{ ref.datasourceId | object: ref.objectId | json }}',
        ].join(''),
      });
      const expanded = await dao.renderBundle(groupId, {
        view: 'expand-first',
      });
      expect(JSON.parse(expanded!.rendered)).toEqual({
        datasourceId: otherDs,
        objectId: 'pr-1',
        data: { title: 'Fix bug' },
      });
    });

    it('supports the object data function for point lookups', async () => {
      const ds = randomUUID();
      const otherDs = randomUUID();
      const { rule, groupId } = await seedGroup({
        ruleDatasources: [{ datasourceId: ds, seedName: 'People' }],
        objects: [
          {
            datasourceId: ds,
            objectId: 'user-1',
            object: { name: 'Brian Fletcher' },
          },
          {
            datasourceId: otherDs,
            objectId: 'team-1',
            object: { name: 'Platform Team' },
          },
        ],
        members: [{ datasourceId: ds, objectId: 'user-1' }],
      });
      await dao.createView(rule.id, {
        name: 'with-team',
        template: `team: {{ '${otherDs}' | object: 'team-1' | map: 'data' | map: 'name' }}`,
      });

      const bundle = await dao.renderBundle(groupId, {
        view: 'with-team',
      });
      expect(bundle!.rendered).toContain('team: Platform Team');
    });

    it('throws ViewNotFoundError for an unknown view name', async () => {
      const ds = randomUUID();
      const { groupId } = await seedGroup({
        ruleDatasources: [{ datasourceId: ds }],
        objects: [{ datasourceId: ds, objectId: 'o-1', object: { name: 'X' } }],
        members: [{ datasourceId: ds, objectId: 'o-1' }],
      });
      await expect(dao.renderBundle(groupId, { view: 'nope' })).rejects.toThrow(
        ViewNotFoundError,
      );
    });

    it('returns null for an unknown group', async () => {
      expect(await dao.renderBundle(randomUUID())).toBeNull();
    });
  });
});
