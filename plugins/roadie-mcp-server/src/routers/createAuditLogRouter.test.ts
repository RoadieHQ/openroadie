import express from 'express';
import request from 'supertest';
import type { Knex } from 'knex';
import { allowAllScopeService } from '@roadiehq/scopes';
import { createAuditLogRouter } from './createAuditLogRouter';

type Operation = { method: string; args: unknown[] };

function makeKnex() {
  const operations: Operation[][] = [];
  const knex = vi.fn(() => {
    const calls: Operation[] = [];
    operations.push(calls);
    let terminal: 'rows' | 'count' | 'first' = 'rows';
    const builder = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === 'then') {
            const value =
              terminal === 'first'
                ? { count: '0' }
                : terminal === 'count'
                  ? [{ count: '0' }]
                  : [];
            return Promise.resolve(value).then.bind(Promise.resolve(value));
          }
          return (...args: unknown[]) => {
            const method = String(property);
            calls.push({ method, args });
            if (method === 'count' || method === 'countDistinct') {
              terminal = 'count';
            }
            if (method === 'first') {
              terminal = 'first';
            }
            return builder;
          };
        },
      },
    );
    return builder;
  });
  return { knex: knex as unknown as Knex, operations };
}

describe('createAuditLogRouter workspace scope', () => {
  it.each(['/facets', '/'])('filters %s by workspace', async path => {
    const { knex, operations } = makeKnex();
    const router = createAuditLogRouter(knex, allowAllScopeService, {
      resolveWorkspaceId: async () => 'workspace-a',
      workspaceExists: async () => true,
    });
    const app = express();
    app.use('/audit-log', router);

    const response = await request(app).get(`/audit-log${path}`);

    expect(response.status).toBe(200);
    expect(operations.length).toBeGreaterThan(0);
    for (const query of operations) {
      expect(query).toContainEqual({
        method: 'where',
        args: ['workspace_id', 'workspace-a'],
      });
    }
  });
});
