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

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IntegrationUsageService } from './IntegrationUsageService';

const logger = {
  child: () => logger,
  info: () => {},
  warn: vi.fn(),
  error: () => {},
  debug: () => {},
} as any;

const discovery = {
  getBaseUrl: async (pluginId: string) => `http://localhost/api/${pluginId}`,
  getExternalBaseUrl: async (pluginId: string) => `http://x/api/${pluginId}`,
};

function ok(items: unknown[]) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ items }),
  } as unknown as Response;
}

/**
 * Stands in for `internalFetchServiceRef`. Credential resolution is that
 * service's job, so these tests only assert which URLs get probed and how
 * failures are classified.
 */
function fetchApi(fetchImpl: (url: string) => Promise<Response>) {
  return { fetch: vi.fn(fetchImpl) as unknown as typeof fetch };
}

/** Routes a probe by which plugin's URL it hits. */
function routed(
  handlers: Partial<
    Record<
      'catalog-workflow' | 'actions' | 'catalog-datastore',
      () => Promise<Response>
    >
  >,
) {
  return fetchApi(async (url: string) => {
    for (const [pluginId, handler] of Object.entries(handlers)) {
      if (url.includes(`/api/${pluginId}/`)) return handler!();
    }
    return ok([]);
  });
}

function makeService(internalFetch: { fetch: typeof fetch }) {
  return new IntegrationUsageService({ discovery, logger, internalFetch });
}

beforeEach(() => {
  logger.warn.mockReset();
});

describe('findUsage', () => {
  it('reports no usage when every probe comes back empty', async () => {
    const service = makeService(routed({}));

    await expect(service.findUsage('int-1')).resolves.toEqual({
      references: [],
      unavailable: [],
    });
  });

  it('merges references and tags each with its owning kind', async () => {
    const service = makeService(
      routed({
        'catalog-workflow': async () =>
          ok([{ id: 'ws-1', name: 'GitHub Repos', slug: 'github-repos' }]),
        actions: async () =>
          ok([{ id: 'act-1', name: 'Create Issue', slug: 'create-issue' }]),
        'catalog-datastore': async () => ok([{ id: 'rule-1', name: 'Owns' }]),
      }),
    );

    const { references, unavailable } = await service.findUsage('int-1');

    expect(unavailable).toEqual([]);
    expect(references).toEqual([
      {
        kind: 'data-source',
        id: 'ws-1',
        name: 'GitHub Repos',
        slug: 'github-repos',
      },
      {
        kind: 'action',
        id: 'act-1',
        name: 'Create Issue',
        slug: 'create-issue',
      },
      { kind: 'relationship-rule', id: 'rule-1', name: 'Owns' },
    ]);
  });

  it('probes every plugin that can hold a reference', async () => {
    const api = routed({});
    await makeService(api).findUsage('int-1');

    const urls = (api.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map(call => String(call[0]))
      .sort();
    expect(urls).toEqual([
      'http://localhost/api/actions/integration-usage/int-1',
      'http://localhost/api/catalog-datastore/relationship-rules/integration-usage/int-1',
      'http://localhost/api/catalog-workflow/workflows/integration-usage/int-1',
    ]);
  });

  it('marks a plugin unavailable when its probe rejects, keeping the rest', async () => {
    const service = makeService(
      routed({
        actions: async () => {
          throw new Error('ECONNREFUSED');
        },
        'catalog-workflow': async () =>
          ok([{ id: 'ws-1', name: 'GitHub Repos' }]),
      }),
    );

    const { references, unavailable } = await service.findUsage('int-1');

    // Callers must read this as "unknown", never "no usage".
    expect(unavailable).toEqual(['actions']);
    expect(references).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('marks a plugin unavailable on a non-OK response', async () => {
    const service = makeService(
      routed({
        'catalog-datastore': async () =>
          ({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            json: async () => ({}),
          }) as unknown as Response,
      }),
    );

    const { unavailable } = await service.findUsage('int-1');
    expect(unavailable).toEqual(['catalog-datastore']);
  });

  it('runs the probes concurrently rather than in series', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const service = makeService(
      fetchApi(async () => {
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await new Promise(resolve => setTimeout(resolve, 5));
        inFlight--;
        return ok([]);
      }),
    );

    await service.findUsage('int-1');

    expect(maxInFlight).toBe(3);
  });

  it('drops malformed rows rather than emitting id-less references', async () => {
    const service = makeService(
      routed({ actions: async () => ok([{ name: 'No id' }, { id: 'act-1' }]) }),
    );

    const { references } = await service.findUsage('int-1');
    // The surviving row falls back to its id when unnamed.
    expect(references).toEqual([
      { kind: 'action', id: 'act-1', name: 'act-1' },
    ]);
  });
});
