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
import { ConflictError, InputError } from '@roadiehq/errors';
import { applyDatabaseMigrations } from './migrations';
import { WorkflowDao } from './WorkflowDao';

const logger = {
  child: () => logger,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any;

const databases = TestDatabases.create();

function baseInput(overrides?: Record<string, unknown>) {
  return {
    name: 'Sentry Projects',
    workflowType: 'data-ingestion' as const,
    nodes: [],
    edges: [],
    enabled: false,
    createdBy: 'user-1',
    ...overrides,
  };
}

describe('WorkflowDao slug handling', () => {
  let knex: Knex;
  let dao: WorkflowDao;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applyDatabaseMigrations(knex);
    dao = new WorkflowDao({ knex, logger });
  }, 120_000);

  beforeEach(async () => {
    await knex('catalog_workflows').del();
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('derives a slug from the name when none is given', async () => {
    const workflow = await dao.create(baseInput());
    expect(workflow.slug).toBe('sentry-projects');
  });

  it('honours an explicit slug', async () => {
    const workflow = await dao.create(baseInput({ slug: 'sentry' }));
    expect(workflow.slug).toBe('sentry');
  });

  it('rejects a duplicate slug on create', async () => {
    await dao.create(baseInput({ name: 'First', slug: 'shared' }));
    await expect(
      dao.create(baseInput({ name: 'Second', slug: 'shared' })),
    ).rejects.toThrow(/slug/);
  });

  it('looks a workflow up by slug', async () => {
    await dao.create(baseInput({ slug: 'sentry-projects' }));
    const found = await dao.getBySlug('sentry-projects');
    expect(found?.name).toBe('Sentry Projects');
  });

  it('keeps data-source definitions within their workspace', async () => {
    const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';
    const organizationWorkflow = await dao.create(
      baseInput({ name: 'Shared name', slug: 'shared-slug' }),
    );
    const workspaceWorkflow = await dao.create(
      baseInput({ name: 'Shared name', slug: 'shared-slug' }),
      undefined,
      otherWorkspaceId,
    );

    expect(workspaceWorkflow.workspaceId).toBe(otherWorkspaceId);
    expect(organizationWorkflow.ownership).toBe('org');
    expect(workspaceWorkflow.ownership).toBe('workspace');
    await expect(
      dao.list({ workspaceId: otherWorkspaceId }),
    ).resolves.toMatchObject({
      total: 1,
      workflows: [{ id: workspaceWorkflow.id }],
    });
    await expect(
      dao.getBySlug('shared-slug', undefined, otherWorkspaceId),
    ).resolves.toMatchObject({ id: workspaceWorkflow.id });
    await expect(
      dao.getById(organizationWorkflow.id, undefined, otherWorkspaceId),
    ).rejects.toThrow('Workflow not found');
    await expect(dao.getById(workspaceWorkflow.id)).resolves.toMatchObject({
      id: workspaceWorkflow.id,
    });
    await expect(dao.list()).resolves.toMatchObject({ total: 2 });
    await expect(
      dao.update(
        organizationWorkflow.id,
        { name: 'Wrong workspace' },
        otherWorkspaceId,
      ),
    ).rejects.toThrow('Workflow not found');
    await expect(
      dao.delete(organizationWorkflow.id, otherWorkspaceId),
    ).rejects.toThrow('Workflow not found');
  });

  it('keeps the slug stable across a rename', async () => {
    const created = await dao.create(baseInput({ slug: 'sentry-projects' }));
    const updated = await dao.update(created.id, { name: 'Renamed Source' });
    expect(updated.name).toBe('Renamed Source');
    expect(updated.slug).toBe('sentry-projects');
  });

  it('updates the slug when one is supplied explicitly', async () => {
    const created = await dao.create(baseInput({ slug: 'old-slug' }));
    const updated = await dao.update(created.id, { slug: 'new-slug' });
    expect(updated.slug).toBe('new-slug');
  });

  it('rejects updating to a slug already in use', async () => {
    await dao.create(baseInput({ name: 'A', slug: 'taken' }));
    const other = await dao.create(baseInput({ name: 'B', slug: 'free' }));
    // A collision is a ConflictError, not an InputError — the slug is
    // well-formed, it is just taken.
    await expect(dao.update(other.id, { slug: 'taken' })).rejects.toThrow(
      ConflictError,
    );
  });

  // A slug off the grammar can never appear in an `@datasource:<slug>` token,
  // so it is malformed input rather than a conflict.
  describe('slug grammar', () => {
    it.each(['My_Source', 'Bad Slug', 'a--b', '-lead', 'trail-', 'UPPER'])(
      'rejects %s on create',
      async slug => {
        await expect(dao.create(baseInput({ slug }))).rejects.toThrow(
          InputError,
        );
      },
    );

    it.each(['My_Source', 'a--b', ''])('rejects %s on update', async slug => {
      const created = await dao.create(baseInput({ slug: 'valid-slug' }));
      await expect(dao.update(created.id, { slug })).rejects.toThrow(
        InputError,
      );
    });

    it('rejects a name that slugifies to nothing', async () => {
      await expect(dao.create(baseInput({ name: '日本語' }))).rejects.toThrow(
        InputError,
      );
    });

    it('accepts a name that slugifies cleanly', async () => {
      const workflow = await dao.create(baseInput({ name: 'A  B -- C!' }));
      expect(workflow.slug).toBe('a-b-c');
    });
  });

  describe('findByIntegrationId', () => {
    function nodeFor(integrationId: string) {
      return {
        id: 'n1',
        type: 'source',
        position: { x: 0, y: 0 },
        data: { config: { integrationId } },
      };
    }

    it('finds data sources with a node bound to the integration', async () => {
      await dao.create(
        baseInput({
          name: 'Uses It',
          slug: 'uses-it',
          nodes: [nodeFor('int-1')],
        }),
      );

      const found = await dao.findByIntegrationId('int-1');
      expect(found).toEqual([
        { id: expect.any(String), name: 'Uses It', slug: 'uses-it' },
      ]);
    });

    it('ignores data sources bound to a different integration', async () => {
      await dao.create(
        baseInput({ name: 'Other', slug: 'other', nodes: [nodeFor('int-2')] }),
      );
      await expect(dao.findByIntegrationId('int-1')).resolves.toEqual([]);
    });

    it('ignores data sources with no nodes', async () => {
      await dao.create(baseInput({ name: 'Empty', slug: 'empty', nodes: [] }));
      await expect(dao.findByIntegrationId('int-1')).resolves.toEqual([]);
    });

    it('matches a node at any position, not just the first', async () => {
      await dao.create(
        baseInput({
          name: 'Second Node',
          slug: 'second-node',
          nodes: [nodeFor('int-other'), nodeFor('int-1')],
        }),
      );
      const found = await dao.findByIntegrationId('int-1');
      expect(found).toHaveLength(1);
    });

    it('includes a disabled data source — it still holds the reference', async () => {
      await dao.create(
        baseInput({
          name: 'Disabled',
          slug: 'disabled',
          enabled: false,
          nodes: [nodeFor('int-1')],
        }),
      );
      const found = await dao.findByIntegrationId('int-1');
      expect(found).toHaveLength(1);
    });
  });

  describe('node layout preservation on update', () => {
    const placed = {
      id: 'n1',
      type: 'source',
      position: { x: 120, y: 340 },
      width: 200,
      height: 80,
      data: { label: 'Source', config: { url: 'a' } },
    };

    it('keeps position, width and height when a write omits them', async () => {
      const created = await dao.create(
        baseInput({ name: 'Layout', slug: 'layout', nodes: [placed] }),
      );

      // What a config-management client sends: the semantic graph only. Layout
      // is not in its desired state, so it must not be reset by the write.
      const updated = await dao.update(created.id, {
        nodes: [
          {
            id: 'n1',
            type: 'source',
            data: { label: 'Source', config: { url: 'b' } },
          },
        ] as any,
      });

      expect(updated.nodes[0]).toMatchObject({
        position: { x: 120, y: 340 },
        width: 200,
        height: 80,
        data: { config: { url: 'b' } },
      });
    });

    it('still lets an explicit position through', async () => {
      const created = await dao.create(
        baseInput({ name: 'Dragged', slug: 'dragged', nodes: [placed] }),
      );

      const updated = await dao.update(created.id, {
        nodes: [{ ...placed, position: { x: 5, y: 6 } }] as any,
      });

      expect(updated.nodes[0].position).toEqual({ x: 5, y: 6 });
    });

    it('gives a brand new node the origin rather than dropping position', async () => {
      const created = await dao.create(
        baseInput({ name: 'Added', slug: 'added', nodes: [placed] }),
      );

      const updated = await dao.update(created.id, {
        nodes: [
          placed,
          { id: 'n2', type: 'sink', data: { label: 'Sink', config: {} } },
        ] as any,
      });

      // A node with no counterpart has no layout to inherit. It must still have
      // a position — the graph editor cannot render one without it.
      expect(updated.nodes[1].position).toEqual({ x: 0, y: 0 });
      expect(updated.nodes[0].position).toEqual({ x: 120, y: 340 });
    });

    it('does not resurrect layout for a node that was removed and re-added', async () => {
      const created = await dao.create(
        baseInput({ name: 'Recycled', slug: 'recycled', nodes: [placed] }),
      );
      await dao.update(created.id, { nodes: [] as any });
      const updated = await dao.update(created.id, {
        nodes: [
          { id: 'n1', type: 'source', data: { label: 'S', config: {} } },
        ] as any,
      });

      expect(updated.nodes[0].position).toEqual({ x: 0, y: 0 });
    });
  });

  describe('list ordering', () => {
    /**
     * Asserts on the emitted SQL rather than on returned rows, because a
     * behavioural test here proves nothing: a seeded batch shares `updated_at`,
     * but for a table small enough to seq-scan Postgres returns rows in physical
     * order, so paging looks stable whether or not the sort is total. The
     * property that actually matters — the ORDER BY leaves no ties for the
     * planner to break — is a property of the query.
     */
    async function sqlFor(run: () => Promise<unknown>): Promise<string[]> {
      const statements: string[] = [];
      const capture = (q: { sql: string }) => statements.push(q.sql);
      knex.on('query', capture);
      try {
        await run();
      } finally {
        knex.removeListener('query', capture);
      }
      return statements;
    }

    it('orders by a total key so paging cannot skip or repeat a row', async () => {
      await dao.create(baseInput({ name: 'One', slug: 'one' }));

      const statements = await sqlFor(() => dao.list({ limit: 2, offset: 0 }));
      const select = statements.find(s => s.includes('limit'));

      expect(select).toBeDefined();
      expect(select).toMatch(/order by .*"updated_at" desc, "id" desc/);
    });

    it('still returns every row when timestamps tie', async () => {
      for (let i = 0; i < 7; i++) {
        await dao.create(baseInput({ name: `Tied ${i}`, slug: `tied-${i}` }));
      }
      await knex('catalog_workflows').update({
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      });

      const seen: string[] = [];
      for (let offset = 0; offset < 7; offset += 2) {
        const page = await dao.list({ limit: 2, offset });
        seen.push(...page.workflows.map(w => w.slug));
      }

      expect(new Set(seen).size).toBe(7);
    });
  });
});
