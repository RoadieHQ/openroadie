import { TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { applyMigrations } from './applyMigrations';
import { RelationshipDao } from './RelationshipDao';
import { RelationshipRuleDao } from './RelationshipRuleDao';
import { ObjectDao } from './ObjectDao';

const databases = TestDatabases.create();

describe('RelationshipDao graph traversals', () => {
  let testDb: Knex;
  let relationshipDao: RelationshipDao;
  let relationshipRuleDao: RelationshipRuleDao;
  let objectDao: ObjectDao;

  const DS_A = randomUUID();
  const DS_B = randomUUID();
  const DS_C = randomUUID();

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
    await applyMigrations(testDb);
    relationshipDao = new RelationshipDao({ knex: testDb });
    relationshipRuleDao = new RelationshipRuleDao({ knex: testDb });
    objectDao = new ObjectDao({ knex: testDb });
  }, 120_000);

  beforeEach(async () => {
    await testDb('datastore_relation').del();
    await testDb('datastore_relationship_rule').del();
    await testDb('datastore').del();
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  async function seedObject(
    datasourceId: string,
    objectId: string,
    object: Record<string, unknown> = { id: objectId },
    workspaceId = '00000000-0000-4000-8000-000000000001',
  ) {
    await testDb('datastore').insert({
      id: randomUUID(),
      datasource_id: datasourceId,
      object_id: objectId,
      object: JSON.stringify(object),
      workspace_id: workspaceId,
    });
  }

  async function seedEdge(options: {
    from: [string, string];
    to: [string, string];
    type?: string;
    reciprocal?: string;
    ruleId?: string;
    workspaceId?: string;
  }) {
    await testDb('datastore_relation').insert({
      id: randomUUID(),
      source_datasource_id: options.from[0],
      source_object_id: options.from[1],
      destination_datasource_id: options.to[0],
      destination_object_id: options.to[1],
      relation_type: options.type ?? 'linked-to',
      reciprocal_relation_type: options.reciprocal ?? null,
      rule_id: options.ruleId ?? null,
      origin: 'manual',
      workspace_id:
        options.workspaceId ?? '00000000-0000-4000-8000-000000000001',
    });
  }

  async function seedRule(): Promise<string> {
    const rule = await relationshipRuleDao.createRelationshipRule(
      {
        name: `rule-${randomUUID()}`,
        sourceDatasourceId: DS_A,
        targetDatasourceId: DS_B,
        sourceFieldExpression: 'owner',
        targetFieldExpression: 'name',
        relationshipType: 'linked-to',
        matchStrategy: 'exact',
      },
      { origin: 'manual' },
    );
    return rule.id;
  }

  const bothFilters = { direction: 'both' as const };

  function nodeKeys(result: {
    nodes: Array<{ datasourceId: string; objectId: string }>;
  }): string[] {
    return result.nodes.map(node => `${node.datasourceId}:${node.objectId}`);
  }

  describe('traverseFromRoot', () => {
    it('does not walk edges from another workspace', async () => {
      const workspaceA = randomUUID();
      const workspaceB = randomUUID();
      await seedObject(DS_A, 'workspace-a-neighbor', undefined, workspaceA);
      await seedObject(DS_A, 'workspace-b-neighbor', undefined, workspaceB);
      await seedEdge({
        from: [DS_A, 'shared-root'],
        to: [DS_A, 'workspace-a-neighbor'],
        workspaceId: workspaceA,
      });
      await seedEdge({
        from: [DS_A, 'shared-root'],
        to: [DS_A, 'workspace-b-neighbor'],
        workspaceId: workspaceB,
      });

      const result = await relationshipDao.traverseFromRoot({
        workspaceId: workspaceA,
        root: { datasourceId: DS_A, objectId: 'shared-root' },
        depth: 1,
        nodeLimit: 100,
        filters: bothFilters,
      });

      expect(result.nodes.map(node => node.objectId).sort()).toEqual([
        'shared-root',
        'workspace-a-neighbor',
      ]);
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0]).toMatchObject({
        workspaceId: workspaceA,
        ownership: 'workspace',
      });
    });

    it('walks a chain to the requested depth with min depths', async () => {
      for (const id of ['a1', 'a2', 'a3', 'a4']) {
        await seedObject(DS_A, id);
      }
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_A, 'a2'] });
      await seedEdge({ from: [DS_A, 'a2'], to: [DS_A, 'a3'] });
      await seedEdge({ from: [DS_A, 'a3'], to: [DS_A, 'a4'] });

      const shallow = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 1,
        nodeLimit: 100,
        filters: bothFilters,
      });
      expect(nodeKeys(shallow).sort()).toEqual([`${DS_A}:a1`, `${DS_A}:a2`]);

      const deep = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 3,
        nodeLimit: 100,
        filters: bothFilters,
      });
      expect(nodeKeys(deep)).toHaveLength(4);
      const depths = Object.fromEntries(
        deep.nodes.map(node => [node.objectId, node.depth]),
      );
      expect(depths).toEqual({ a1: 0, a2: 1, a3: 2, a4: 3 });
    });

    it('terminates on cycles and keeps minimum depths', async () => {
      await seedObject(DS_A, 'a1');
      await seedObject(DS_A, 'a2');
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_A, 'a2'] });
      await seedEdge({ from: [DS_A, 'a2'], to: [DS_A, 'a1'] });

      const result = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 3,
        nodeLimit: 100,
        filters: bothFilters,
      });
      expect(nodeKeys(result).sort()).toEqual([`${DS_A}:a1`, `${DS_A}:a2`]);
      expect(result.nodes.find(n => n.objectId === 'a2')?.depth).toBe(1);
    });

    it('honors traversal direction', async () => {
      for (const id of ['a1', 'a2', 'a3']) {
        await seedObject(DS_A, id);
      }
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_A, 'a2'] });
      await seedEdge({ from: [DS_A, 'a3'], to: [DS_A, 'a1'] });

      const out = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 1,
        nodeLimit: 100,
        filters: { direction: 'out' },
      });
      expect(nodeKeys(out).sort()).toEqual([`${DS_A}:a1`, `${DS_A}:a2`]);

      const incoming = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 1,
        nodeLimit: 100,
        filters: { direction: 'in' },
      });
      expect(nodeKeys(incoming).sort()).toEqual([`${DS_A}:a1`, `${DS_A}:a3`]);

      const both = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 1,
        nodeLimit: 100,
        filters: bothFilters,
      });
      expect(nodeKeys(both)).toHaveLength(3);
    });

    it('matches relationship types against the reciprocal name too', async () => {
      for (const id of ['a1', 'a2', 'a3']) {
        await seedObject(DS_A, id);
      }
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_A, 'a2'], type: 'owns' });
      await seedEdge({
        from: [DS_A, 'a1'],
        to: [DS_A, 'a3'],
        type: 'uses',
        reciprocal: 'used-by',
      });

      const viaReciprocal = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 1,
        nodeLimit: 100,
        filters: { direction: 'both', relationshipTypes: ['used-by'] },
      });
      expect(nodeKeys(viaReciprocal).sort()).toEqual([
        `${DS_A}:a1`,
        `${DS_A}:a3`,
      ]);

      const viaPrimary = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 1,
        nodeLimit: 100,
        filters: { direction: 'both', relationshipTypes: ['owns'] },
      });
      expect(nodeKeys(viaPrimary).sort()).toEqual([`${DS_A}:a1`, `${DS_A}:a2`]);
    });

    it('filters rule vs direct edges by rule linkage, not origin text', async () => {
      for (const id of ['a1', 'a2', 'a3']) {
        await seedObject(DS_A, id);
      }
      const ruleId = await seedRule();
      // Both edges carry origin 'manual' — only rule_id discriminates.
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_A, 'a2'], ruleId });
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_A, 'a3'] });

      const rule = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 1,
        nodeLimit: 100,
        filters: { direction: 'both', origin: 'rule' },
      });
      expect(nodeKeys(rule).sort()).toEqual([`${DS_A}:a1`, `${DS_A}:a2`]);

      const direct = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 1,
        nodeLimit: 100,
        filters: { direction: 'both', origin: 'direct' },
      });
      expect(nodeKeys(direct).sort()).toEqual([`${DS_A}:a1`, `${DS_A}:a3`]);
    });

    it('never walks into an out-of-scope data source', async () => {
      await seedObject(DS_A, 'a1');
      await seedObject(DS_B, 'b1');
      await seedObject(DS_C, 'c1');
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_B, 'b1'] });
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_C, 'c1'] });

      const result = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 2,
        nodeLimit: 100,
        filters: { direction: 'both', datasourceIds: [DS_A, DS_B] },
      });
      // DS ids are random uuids, so the expected keys must be sorted too.
      expect(nodeKeys(result).sort()).toEqual(
        [`${DS_A}:a1`, `${DS_B}:b1`].sort(),
      );
    });

    it('truncates at the node limit', async () => {
      await seedObject(DS_A, 'a1');
      for (const id of ['n1', 'n2', 'n3']) {
        await seedObject(DS_A, id);
        await seedEdge({ from: [DS_A, 'a1'], to: [DS_A, id] });
      }

      const result = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 1,
        nodeLimit: 2,
        filters: bothFilters,
      });
      expect(result.nodes).toHaveLength(2);
      expect(result.truncated).toBe(true);
    });

    it('returns induced edges between reached nodes', async () => {
      for (const id of ['a1', 'a2', 'a3']) {
        await seedObject(DS_A, id);
      }
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_A, 'a2'] });
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_A, 'a3'] });
      // Not traversed at depth 1 (both endpoints already found), but induced.
      await seedEdge({ from: [DS_A, 'a2'], to: [DS_A, 'a3'] });

      const result = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 1,
        nodeLimit: 100,
        filters: bothFilters,
      });
      expect(result.relationships).toHaveLength(3);
    });

    it('counts hidden neighbors under the same filters, excluding dangling endpoints', async () => {
      for (const id of ['a1', 'a2', 'a3', 'a4']) {
        await seedObject(DS_A, id);
      }
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_A, 'a2'] });
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_A, 'a3'] });
      // Beyond depth 1 from a1 — hidden behind a2.
      await seedEdge({ from: [DS_A, 'a2'], to: [DS_A, 'a4'], type: 'owns' });
      // Dangling endpoint: must count for neither node.
      await seedEdge({ from: [DS_A, 'a2'], to: [DS_A, 'ghost'] });

      const result = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 1,
        nodeLimit: 100,
        filters: bothFilters,
      });
      expect(nodeKeys(result)).not.toContain(`${DS_A}:ghost`);
      expect(result.hiddenNeighborCounts.get(`${DS_A}:a1`) ?? 0).toBe(0);
      expect(result.hiddenNeighborCounts.get(`${DS_A}:a2`)).toBe(1);

      // The a2→a4 edge is 'owns'; filtering to another type hides nothing.
      const filtered = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 1,
        nodeLimit: 100,
        filters: { direction: 'both', relationshipTypes: ['linked-to'] },
      });
      expect(filtered.hiddenNeighborCounts.get(`${DS_A}:a2`) ?? 0).toBe(0);
    });

    it('skips dangling endpoints during the walk', async () => {
      await seedObject(DS_A, 'a1');
      await seedObject(DS_A, 'a2');
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_A, 'ghost'] });
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_A, 'a2'] });

      const result = await relationshipDao.traverseFromRoot({
        root: { datasourceId: DS_A, objectId: 'a1' },
        depth: 2,
        nodeLimit: 100,
        filters: bothFilters,
      });
      expect(nodeKeys(result).sort()).toEqual([`${DS_A}:a1`, `${DS_A}:a2`]);
    });
  });

  describe('findPaths', () => {
    it('finds all simple paths in a diamond, shortest first', async () => {
      for (const id of ['s', 'x1', 'x2', 't']) {
        await seedObject(DS_A, id);
      }
      await seedEdge({ from: [DS_A, 's'], to: [DS_A, 'x1'] });
      await seedEdge({ from: [DS_A, 'x1'], to: [DS_A, 't'] });
      await seedEdge({ from: [DS_A, 's'], to: [DS_A, 'x2'] });
      await seedEdge({ from: [DS_A, 'x2'], to: [DS_A, 't'] });

      const result = await relationshipDao.findPaths({
        source: { datasourceId: DS_A, objectId: 's' },
        target: { datasourceId: DS_A, objectId: 't' },
        maxDepth: 4,
        pathLimit: 50,
        filters: bothFilters,
      });
      expect(result.paths).toHaveLength(2);
      expect(result.truncated).toBe(false);
      for (const path of result.paths) {
        expect(path.hops).toBe(2);
        expect(path.nodes[0].objectId).toBe('s');
        expect(path.nodes[2].objectId).toBe('t');
        expect(path.relationshipIds).toHaveLength(2);
      }
    });

    it('respects maxDepth', async () => {
      for (const id of ['s', 'm1', 'm2', 't']) {
        await seedObject(DS_A, id);
      }
      await seedEdge({ from: [DS_A, 's'], to: [DS_A, 'm1'] });
      await seedEdge({ from: [DS_A, 'm1'], to: [DS_A, 'm2'] });
      await seedEdge({ from: [DS_A, 'm2'], to: [DS_A, 't'] });

      const tooShallow = await relationshipDao.findPaths({
        source: { datasourceId: DS_A, objectId: 's' },
        target: { datasourceId: DS_A, objectId: 't' },
        maxDepth: 2,
        pathLimit: 50,
        filters: bothFilters,
      });
      expect(tooShallow.paths).toHaveLength(0);

      const deepEnough = await relationshipDao.findPaths({
        source: { datasourceId: DS_A, objectId: 's' },
        target: { datasourceId: DS_A, objectId: 't' },
        maxDepth: 3,
        pathLimit: 50,
        filters: bothFilters,
      });
      expect(deepEnough.paths).toHaveLength(1);
      expect(deepEnough.paths[0].hops).toBe(3);
    });

    it('truncates at the path limit', async () => {
      for (const id of ['s', 'x1', 'x2', 't']) {
        await seedObject(DS_A, id);
      }
      await seedEdge({ from: [DS_A, 's'], to: [DS_A, 'x1'] });
      await seedEdge({ from: [DS_A, 'x1'], to: [DS_A, 't'] });
      await seedEdge({ from: [DS_A, 's'], to: [DS_A, 'x2'] });
      await seedEdge({ from: [DS_A, 'x2'], to: [DS_A, 't'] });

      const result = await relationshipDao.findPaths({
        source: { datasourceId: DS_A, objectId: 's' },
        target: { datasourceId: DS_A, objectId: 't' },
        maxDepth: 4,
        pathLimit: 1,
        filters: bothFilters,
      });
      expect(result.paths).toHaveLength(1);
      expect(result.truncated).toBe(true);
    });

    it('returns empty when no path exists', async () => {
      await seedObject(DS_A, 's');
      await seedObject(DS_A, 't');

      const result = await relationshipDao.findPaths({
        source: { datasourceId: DS_A, objectId: 's' },
        target: { datasourceId: DS_A, objectId: 't' },
        maxDepth: 6,
        pathLimit: 50,
        filters: bothFilters,
      });
      expect(result.paths).toHaveLength(0);
      expect(result.truncated).toBe(false);
    });

    it('honors direction', async () => {
      await seedObject(DS_A, 's');
      await seedObject(DS_A, 't');
      await seedEdge({ from: [DS_A, 't'], to: [DS_A, 's'] });

      const out = await relationshipDao.findPaths({
        source: { datasourceId: DS_A, objectId: 's' },
        target: { datasourceId: DS_A, objectId: 't' },
        maxDepth: 3,
        pathLimit: 50,
        filters: { direction: 'out' },
      });
      expect(out.paths).toHaveLength(0);

      const both = await relationshipDao.findPaths({
        source: { datasourceId: DS_A, objectId: 's' },
        target: { datasourceId: DS_A, objectId: 't' },
        maxDepth: 3,
        pathLimit: 50,
        filters: bothFilters,
      });
      expect(both.paths).toHaveLength(1);
      expect(both.paths[0].hops).toBe(1);
    });

    it('returns simple paths only (no revisits, no extension past target)', async () => {
      for (const id of ['s', 'a', 't']) {
        await seedObject(DS_A, id);
      }
      await seedEdge({ from: [DS_A, 's'], to: [DS_A, 'a'] });
      await seedEdge({ from: [DS_A, 'a'], to: [DS_A, 's'] });
      await seedEdge({ from: [DS_A, 'a'], to: [DS_A, 't'] });
      await seedEdge({ from: [DS_A, 't'], to: [DS_A, 's'] });

      const result = await relationshipDao.findPaths({
        source: { datasourceId: DS_A, objectId: 's' },
        target: { datasourceId: DS_A, objectId: 't' },
        maxDepth: 6,
        pathLimit: 50,
        filters: { direction: 'out' },
      });
      expect(result.paths).toHaveLength(1);
      expect(result.paths[0].nodes.map(node => node.objectId)).toEqual([
        's',
        'a',
        't',
      ]);
    });
  });

  describe('summarizeGraphEdges', () => {
    it('groups counts by datasource pair and type under the filters', async () => {
      const ruleId = await seedRule();
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_B, 'b1'], type: 'owns' });
      await seedEdge({ from: [DS_A, 'a2'], to: [DS_B, 'b2'], type: 'owns' });
      await seedEdge({
        from: [DS_A, 'a1'],
        to: [DS_B, 'b1'],
        type: 'uses',
        ruleId,
      });
      await seedEdge({ from: [DS_A, 'a1'], to: [DS_C, 'c1'], type: 'owns' });

      const all = await relationshipDao.summarizeGraphEdges({});
      expect(all.totalRelationships).toBe(4);
      expect(all.items[0]).toEqual({
        sourceDatasourceId: DS_A,
        destinationDatasourceId: DS_B,
        relationshipType: 'owns',
        count: 2,
      });

      const scoped = await relationshipDao.summarizeGraphEdges({
        datasourceIds: [DS_A, DS_B],
      });
      expect(scoped.totalRelationships).toBe(3);

      const direct = await relationshipDao.summarizeGraphEdges({
        origin: 'direct',
      });
      expect(direct.totalRelationships).toBe(3);

      const typed = await relationshipDao.summarizeGraphEdges({
        relationshipTypes: ['uses'],
      });
      expect(typed.totalRelationships).toBe(1);
    });
  });

  describe('listRelationshipTypes', () => {
    it('includes reciprocal names and scopes on either endpoint', async () => {
      await seedEdge({
        from: [DS_A, 'a1'],
        to: [DS_B, 'b1'],
        type: 'uses',
        reciprocal: 'used-by',
      });
      await seedEdge({ from: [DS_C, 'c1'], to: [DS_C, 'c2'], type: 'owns' });

      const all = await relationshipDao.listRelationshipTypes();
      expect(all).toEqual(['owns', 'used-by', 'uses']);

      // DS_B only appears as a destination — the scope must still match.
      const scopedToB = await relationshipDao.listRelationshipTypes({
        datasourceIds: [DS_B],
      });
      expect(scopedToB).toEqual(['used-by', 'uses']);

      const scopedToC = await relationshipDao.listRelationshipTypes({
        datasourceIds: [DS_C],
      });
      expect(scopedToC).toEqual(['owns']);
    });
  });

  describe('ObjectDao.queryGraphNodesByRefs', () => {
    it('resolves the same labels as queryGraphNodes', async () => {
      await seedObject(DS_A, 'a1', { name: 'Alpha One' });
      await seedObject(DS_A, 'a2', { title: 'Alpha Two' });
      await seedObject(DS_A, 'a3', {});

      const byRefs = await objectDao.queryGraphNodesByRefs([
        { datasourceId: DS_A, objectId: 'a1' },
        { datasourceId: DS_A, objectId: 'a2' },
        { datasourceId: DS_A, objectId: 'a3' },
      ]);
      const whole = await objectDao.queryGraphNodes({
        datasourceIds: [DS_A],
      });

      const byKey = (items: Array<{ objectId: string; displayName: string }>) =>
        Object.fromEntries(
          items.map(item => [item.objectId, item.displayName]),
        );
      expect(byKey(byRefs)).toEqual(byKey(whole.items));
      expect(byKey(byRefs)).toEqual({
        a1: 'Alpha One',
        a2: 'Alpha Two',
        a3: 'a3',
      });
    });

    it('returns empty for an empty ref list', async () => {
      expect(await objectDao.queryGraphNodesByRefs([])).toEqual([]);
    });
  });
});
