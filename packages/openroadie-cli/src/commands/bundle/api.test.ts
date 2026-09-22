import { describe, it, expect } from 'vitest';
import type { OpenRoadieConfig } from '../../config';
import { OpenRoadieHttpClient } from '../../http-client';
import {
  fetchWorkflows,
  fetchRules,
  fetchContextGroups,
  fetchCapabilities,
  createWorkflow,
} from './api';

const config = { backendUrl: 'http://localhost:7007' } as OpenRoadieConfig;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('bundle api wrappers', () => {
  it('fetchWorkflows unwraps {data}', async () => {
    const client = new OpenRoadieHttpClient(config, async () =>
      jsonResponse({
        data: [
          {
            id: 'w1',
            name: 'A',
            slug: 'a',
            workflowType: 'data-ingestion',
            nodes: [],
            edges: [],
            enabled: true,
          },
        ],
      }),
    );
    const rows = await fetchWorkflows(client);
    expect(rows).toHaveLength(1);
    expect(rows[0].slug).toBe('a');
  });

  it('fetchRules unwraps {items}', async () => {
    const client = new OpenRoadieHttpClient(config, async () =>
      jsonResponse({ items: [{ id: 'r1' }], total: 1 }),
    );
    expect(await fetchRules(client)).toHaveLength(1);
  });

  it('fetchContextGroups tolerates {data} and {items}', async () => {
    const asData = new OpenRoadieHttpClient(config, async () =>
      jsonResponse({ data: [{ id: 'g1' }] }),
    );
    const asItems = new OpenRoadieHttpClient(config, async () =>
      jsonResponse({ items: [{ id: 'g1' }] }),
    );
    expect(await fetchContextGroups(asData)).toHaveLength(1);
    expect(await fetchContextGroups(asItems)).toHaveLength(1);
  });

  it('throws the failure reason on error status', async () => {
    const client = new OpenRoadieHttpClient(
      config,
      async () => new Response('boom', { status: 500 }),
    );
    await expect(fetchWorkflows(client)).rejects.toThrow('boom');
  });

  it('fetchCapabilities passes a limit', async () => {
    let requested = '';
    const client = new OpenRoadieHttpClient(config, async url => {
      requested = String(url);
      return jsonResponse({ data: [] });
    });
    await fetchCapabilities(client);
    expect(requested).toContain('limit=500');
  });

  it('asks for the whole list in one request when it does not fit a page', async () => {
    const requested: string[] = [];
    const client = new OpenRoadieHttpClient(config, async url => {
      requested.push(String(url));
      const limit = Number(new URL(String(url)).searchParams.get('limit') ?? 0);
      return jsonResponse({
        items: Array.from({ length: Math.min(limit, 501) }, (_, i) => ({
          id: `r-${i}`,
        })),
        total: 501,
      });
    });
    const rows = await fetchRules(client);
    expect(rows).toHaveLength(501);
    // One probe page, then everything at once — no offset walk, because walking
    // an unstably-ordered list can skip a row without any way to detect it.
    expect(requested.map(u => new URL(u).searchParams.get('offset'))).toEqual([
      '0',
      '0',
    ]);
    expect(requested[1]).toContain('limit=1001');
  });

  it('makes a single request when the list fits in one page', async () => {
    const requested: string[] = [];
    const client = new OpenRoadieHttpClient(config, async url => {
      requested.push(String(url));
      return jsonResponse({ items: [{ id: 'r-1' }, { id: 'r-2' }], total: 2 });
    });
    expect(await fetchRules(client)).toHaveLength(2);
    expect(requested).toHaveLength(1);
  });

  it('collects every row when a tie-shuffled page repeats one and omits another', async () => {
    // 501 rows with tied timestamps: the offset=500 page re-serves a row from
    // page 1 instead of the one row page 1 missed. An offset walk ends one row
    // short here and cannot tell — on import that missing rule plans as `create`
    // and duplicates a row that already exists.
    const client = new OpenRoadieHttpClient(config, async url => {
      const params = new URL(String(url)).searchParams;
      const offset = Number(params.get('offset') ?? 0);
      const limit = Number(params.get('limit') ?? 0);
      if (offset > 0) {
        return jsonResponse({ items: [{ id: 'r-0' }], total: 501 });
      }
      return jsonResponse({
        items: Array.from({ length: Math.min(limit, 501) }, (_, i) => ({
          id: `r-${i}`,
        })),
        total: 501,
      });
    });
    const rows = await fetchRules(client);
    expect(rows).toHaveLength(501);
    expect(rows.map(r => r.id)).toContain('r-500');
  });

  it('refuses to report a truncated list as complete', async () => {
    // Caps the page at 100 and ignores `offset`, so no walk can reach 250. A
    // silently short list is worse than a failed export.
    const client = new OpenRoadieHttpClient(config, async () =>
      jsonResponse({
        items: Array.from({ length: 100 }, (_, i) => ({ id: `r-${i}` })),
        total: 250,
      }),
    );
    await expect(fetchRules(client)).rejects.toThrow(
      'returned 100 of 250 rows',
    );
  });

  it('throws rather than exporting nothing when the envelope has no list key', async () => {
    // A renamed field would otherwise read as "this environment has no rules".
    const client = new OpenRoadieHttpClient(config, async () =>
      jsonResponse({ rules: [{ id: 'r-1' }], total: 1 }),
    );
    await expect(fetchRules(client)).rejects.toThrow('the API shape changed');
  });

  it('never returns the same row twice', async () => {
    // Exporting a rule twice would write two manifests for it, which the
    // importer then rejects as a duplicate tuple.
    const client = new OpenRoadieHttpClient(config, async url => {
      const limit = Number(new URL(String(url)).searchParams.get('limit') ?? 0);
      const ids = Array.from({ length: Math.min(limit, 501) }, (_, i) =>
        // r-7 stands in for r-500, so the row appears twice in one response.
        i === 500 ? 'r-7' : `r-${i}`,
      );
      return jsonResponse({
        items: ids.map(id => ({ id })),
        total: 501,
      });
    });
    // 501 claimed, 500 distinct — that shortfall is an error, not a silent drop.
    await expect(fetchRules(client)).rejects.toThrow(
      'returned 500 of 501 rows',
    );
  });

  it('walks a server that caps its page size below the requested limit', async () => {
    const requested: string[] = [];
    const client = new OpenRoadieHttpClient(config, async url => {
      requested.push(String(url));
      const offset = Number(
        new URL(String(url)).searchParams.get('offset') ?? 0,
      );
      // Honours `offset` but serves 100 at a time, whatever limit is asked for.
      const page = Array.from({ length: 100 }, (_, i) => ({
        id: `r-${offset + i}`,
      })).filter(r => Number(r.id.slice(2)) < 250);
      return jsonResponse({ items: page, total: 250 });
    });
    const rows = await fetchRules(client);
    expect(rows).toHaveLength(250);
    // Probe, whole-list attempt (capped to 100), then the walk that finishes it.
    expect(requested.map(u => new URL(u).searchParams.get('offset'))).toEqual([
      '0',
      '0',
      '100',
      '200',
    ]);
  });

  it('createWorkflow posts the body verbatim and unwraps 201 {data}', async () => {
    const client = new OpenRoadieHttpClient(config, async (_url, init) => {
      expect(JSON.parse(String(init?.body)).slug).toBe('a');
      return jsonResponse({ data: { id: 'w1', slug: 'a' } }, 201);
    });
    const row = await createWorkflow(client, { slug: 'a' } as never);
    expect(row.id).toBe('w1');
  });
});
