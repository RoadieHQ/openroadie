import express from 'express';
import request from 'supertest';
import { createHarnessConfigRouter } from './createHarnessConfigRouter';
import { createHarnessPluginRouter } from './createHarnessPluginRouter';

describe('harness setup', () => {
  it('installs Claude Code with the generated service token', async () => {
    const app = express().use(
      createHarnessPluginRouter({ baseUrl: 'https://app.example.com' }),
    );

    const response = await request(app)
      .get('/claude-code/setup.sh')
      .set('Authorization', 'Bearer service-token');

    expect(response.status).toBe(200);
    expect(response.text).toContain(
      'claude mcp add openroadie --transport http "https://app.example.com/api/mcp/v1/" --header "Authorization: Bearer service-token"',
    );
  });

  it('returns the scopes required by the installed MCP tools', async () => {
    const app = express().use(
      createHarnessConfigRouter({
        baseUrl: 'https://app.example.com',
        mcpScopes: ['catalog-datastore:query', 'action:execute'],
      }),
    );

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.mcpScopes).toEqual([
      'catalog-datastore:query',
      'action:execute',
    ]);
  });
});
