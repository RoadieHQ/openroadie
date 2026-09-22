import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DateTime } from 'luxon';
import * as undici from 'undici';
import {
  HttpBackend,
  normalizeCertificate,
  normalizePrivateKey,
} from './Backend';
import { Integration } from '../../index';
import { HttpRequestOptions } from './index';
import type { SecretStoreService } from '@roadiehq/secrets-node';
import { buildPdf } from './pdfFixture.test-utils';

const envBackedSecretStore: SecretStoreService = {
  resolver: () => ({
    async resolve(refs) {
      const out = new Map<string, string>();
      for (const ref of refs) {
        const v = new Map(Object.entries(process.env)).get(ref);
        if (v !== undefined) {
          out.set(ref, v);
        }
      }
      return Object.fromEntries(out);
    },
  }),
  writer: () => ({
    readOnly: true,
    async put() {
      throw new Error('read-only');
    },
    async delete() {
      throw new Error('read-only');
    },
    async listRefs() {
      return [];
    },
    async exists(ref) {
      return new Map(Object.entries(process.env)).has(ref);
    },
  }),
  info: () => ({ mode: 'env', readOnly: true }),
};

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

const voidLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  child: () => voidLogger,
} as any;

vi.mock('undici', async importOriginal => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: mockFetch,
}));

describe('HttpBackend', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  /**
   * Names an inline HTTP options literal. `request`/`requestPages` take the base
   * `RequestOptions`, so a fresh literal carrying `path`, `method` and friends is
   * an excess-property error there. Most call sites below hoist a
   * `const options: HttpRequestOptions`; this is the same thing for the ones that
   * read better inline, and it checks the literal rather than casting it away.
   */
  const httpOptions = (options: HttpRequestOptions): HttpRequestOptions =>
    options;

  const mockIntegration: Integration = {
    id: 'test-id',
    name: 'test-integration',
    slug: 'test-integration',
    type: 'other',
    host: 'https://api.example.com',
    authType: 'none',
    authConfig: null,
    requestsPerHour: 36000,
    backendType: 'http',
    config: {},
    readyForCurrentScope: true,
    createdBy: 'test-user',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  function createJsonResponse(body: unknown, headers?: Record<string, string>) {
    const h = { 'content-type': 'application/json', ...headers };
    return new undici.Response(JSON.stringify(body), {
      status: 200,
      headers: h,
    });
  }

  describe('config placeholders in paths', () => {
    it('resolves {{config.KEY}} from the integration config', async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({ slug: 'ws' }));
      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });
      await backend.request(
        { ...mockIntegration, config: { workspace: 'roadie-test-2' } },
        httpOptions({
          backendType: 'http',
          path: '/2.0/workspaces/{{config.workspace}}',
        }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/2.0/workspaces/roadie-test-2',
        expect.anything(),
      );
    });

    it('fails loudly when a config placeholder is missing', async () => {
      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });
      await expect(
        backend.request(
          mockIntegration,
          httpOptions({
            backendType: 'http',
            path: '/2.0/workspaces/{{config.workspace}}',
          }),
        ),
      ).rejects.toThrow(/config.workspace/);
    });
  });

  describe('request', () => {
    it('includes POST JSON bodies in emitted request logs', async () => {
      const onRequestLog = vi.fn();
      mockFetch.mockResolvedValue(createJsonResponse({ ok: true }));

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      await backend.request(
        mockIntegration,
        httpOptions({
          backendType: 'http',
          path: '/items/search',
          method: 'POST',
          body: { page: 1 },
          onRequestLog,
        }),
      );

      expect(onRequestLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'POST',
          requestBody: { page: 1 },
          responseBody: { ok: true },
        }),
      );
    });
  });

  describe('requestPages - no pagination', () => {
    it('includes POST JSON bodies in emitted request logs', async () => {
      const data = [{ id: '1' }];
      const onRequestLog = vi.fn();
      mockFetch.mockResolvedValue(createJsonResponse(data));

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items/search',
        method: 'POST',
        body: { page: 1, dateRange: { from: '2026-01-01' } },
        arrayPath: '$',
        onRequestLog,
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(onRequestLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'POST',
          requestBody: { page: 1, dateRange: { from: '2026-01-01' } },
        }),
      );
    });

    it('includes only the Link response header in emitted request logs', async () => {
      const link = '<https://api.example.com/items?page=2>; rel="next"';
      const onRequestLog = vi.fn();
      mockFetch.mockResolvedValue(
        createJsonResponse([{ id: '1' }], {
          link,
          'set-cookie': 'sid=secret',
          authorization: 'Bearer secret',
        }),
      );

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        pagination: {
          type: 'link',
          perPage: 0,
          nextLinkCondition: { param: 'rel', equals: 'never' },
        },
        arrayPath: '$',
        onRequestLog,
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(onRequestLog).toHaveBeenCalledWith(
        expect.objectContaining({
          responseHeaders: { link },
        }),
      );
    });

    it('yields a single page when no pagination config is provided', async () => {
      const data = [{ id: '1' }, { id: '2' }];
      mockFetch.mockResolvedValue(createJsonResponse(data));

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].pageIndex).toBe(0);
      expect(pages[0].items).toEqual([data]);
    });

    it('extracts items via arrayPath', async () => {
      const data = { results: [{ id: '1' }, { id: '2' }] };
      mockFetch.mockResolvedValue(createJsonResponse(data));

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: 'results',
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].items).toEqual([{ id: '1' }, { id: '2' }]);
    });

    it('auto-follows Link rel=next when pagination is not configured', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createJsonResponse([{ id: '1' }], {
            link: '<https://api.example.com/items?page=2>; rel="next"',
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse([{ id: '2' }], {
            link: '<https://api.example.com/items?page=3>; rel="next"',
          }),
        )
        .mockResolvedValueOnce(createJsonResponse([{ id: '3' }]));

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: '$',
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(3);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(pages.flatMap(p => p.items)).toEqual([
        { id: '1' },
        { id: '2' },
        { id: '3' },
      ]);
    });

    it('still yields a single page when no Link header is present', async () => {
      mockFetch.mockResolvedValueOnce(
        createJsonResponse([{ id: '1' }, { id: '2' }]),
      );

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: '$',
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not auto-follow Link headers when implicit pagination is disabled', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createJsonResponse([{ id: '1' }], {
            link: '<https://api.example.com/items?page=2>; rel="next"',
          }),
        )
        .mockResolvedValueOnce(createJsonResponse([{ id: '2' }]));

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: '$',
        pagination: { type: 'none' },
        disableImplicitPagination: true,
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(pages[0].items).toEqual([{ id: '1' }]);
    });
  });

  describe('requestPages - cursor pagination', () => {
    it('follows cursor through multiple pages', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createJsonResponse({
            items: [{ id: '1' }],
            next_cursor: 'cursor-abc',
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            items: [{ id: '2' }],
            next_cursor: '',
          }),
        );

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: 'items',
        pagination: {
          type: 'cursor',
          cursorParam: 'cursor',
          nextCursorExpression: 'next_cursor',
        },
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0].items).toEqual([{ id: '1' }]);
      expect(pages[1].items).toEqual([{ id: '2' }]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.example.com/items');
      expect(mockFetch.mock.calls[1][0]).toBe(
        'https://api.example.com/items?cursor=cursor-abc',
      );
    });

    it('merges the cursor into a nested body object via bodyParamsPath', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createJsonResponse({
            results: [{ id: '1' }],
            skipToken: 'token-abc',
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            results: [{ id: '2' }],
            skipToken: '',
          }),
        );

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/providers/Microsoft.ResourceGraph/resources',
        method: 'POST',
        body: {
          query: 'authorizationresources',
          options: { resultFormat: 'objectArray', $top: 100 },
        },
        arrayPath: 'results',
        pagination: {
          type: 'cursor',
          cursorParam: '$skipToken',
          nextCursorExpression: 'skipToken',
          paramLocation: 'body',
          bodyParamsPath: 'options',
        },
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body as string)).toEqual({
        query: 'authorizationresources',
        options: { resultFormat: 'objectArray', $top: 100 },
      });
      expect(JSON.parse(mockFetch.mock.calls[1][1].body as string)).toEqual({
        query: 'authorizationresources',
        options: {
          resultFormat: 'objectArray',
          $top: 100,
          $skipToken: 'token-abc',
        },
      });
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://api.example.com/providers/Microsoft.ResourceGraph/resources',
      );
      expect(mockFetch.mock.calls[1][0]).toBe(
        'https://api.example.com/providers/Microsoft.ResourceGraph/resources',
      );
    });

    it('merges the cursor at the top level of the body when bodyParamsPath is absent', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createJsonResponse({
            items: [{ id: '1' }],
            next_cursor: 'cursor-abc',
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            items: [{ id: '2' }],
            next_cursor: '',
          }),
        );

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/search',
        method: 'POST',
        body: { query: 'catalog-info.yaml' },
        arrayPath: 'items',
        pagination: {
          type: 'cursor',
          cursorParam: 'cursor',
          nextCursorExpression: 'next_cursor',
          paramLocation: 'body',
        },
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body as string)).toEqual({
        query: 'catalog-info.yaml',
      });
      expect(JSON.parse(mockFetch.mock.calls[1][1].body as string)).toEqual({
        query: 'catalog-info.yaml',
        cursor: 'cursor-abc',
      });
    });

    it('requires POST when cursor parameters are placed in the body', async () => {
      mockFetch.mockResolvedValueOnce(
        createJsonResponse({
          items: [{ id: '1' }],
          next_cursor: 'cursor-abc',
        }),
      );

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      await expect(async () => {
        for await (const page of backend.requestPages(
          mockIntegration,
          httpOptions({
            backendType: 'http',
            path: '/items',
            method: 'GET',
            body: {},
            arrayPath: 'items',
            pagination: {
              type: 'cursor',
              cursorParam: 'cursor',
              nextCursorExpression: 'next_cursor',
              paramLocation: 'body',
            },
          }),
        )) {
          void page;
        }
      }).rejects.toThrow('Body cursor pagination requires a POST request');
    });
  });

  describe('requestPages - page pagination', () => {
    it('iterates pages until fewer items than perPage', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createJsonResponse({ items: [{ id: '1' }, { id: '2' }] }),
        )
        .mockResolvedValueOnce(createJsonResponse({ items: [{ id: '3' }] }));

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: 'items',
        pagination: {
          type: 'page',
          pageParam: 'page',
          perPageParam: 'per_page',
          perPage: 2,
          startPage: 1,
        },
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0].items).toEqual([{ id: '1' }, { id: '2' }]);
      expect(pages[1].items).toEqual([{ id: '3' }]);
    });
  });

  describe('requestPages - offset pagination', () => {
    it('advances by received count and stops on an empty page', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createJsonResponse({ data: [{ id: '1' }, { id: '2' }] }),
        )
        .mockResolvedValueOnce(createJsonResponse({ data: [{ id: '3' }] }))
        .mockResolvedValueOnce(createJsonResponse({ data: [] }));

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: 'data',
        pagination: {
          type: 'offset',
          offsetParam: 'offset',
          limitParam: 'limit',
          limit: 2,
        },
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(3);
      expect(pages[0].pageIndex).toBe(0);
      expect(pages[1].pageIndex).toBe(1);
      expect(mockFetch.mock.calls[1][0]).toContain('offset=2');
      expect(mockFetch.mock.calls[2][0]).toContain('offset=3');
    });

    it('can place offset parameters in a POST body and stop at a response total', async () => {
      const firstPage = Array.from({ length: 1000 }, (_, index) => ({
        id: `item-${index}`,
      }));
      const secondPage = Array.from({ length: 804 }, (_, index) => ({
        id: `item-${index + 1000}`,
      }));
      mockFetch
        .mockResolvedValueOnce(
          createJsonResponse({ count: 1804, results: firstPage }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({ count: 1804, results: secondPage }),
        );

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/_apis/search/codesearchresults?api-version=7.1',
        method: 'POST',
        body: {
          searchText: 'filename:catalog-info.yaml',
          filters: { Project: ['Project A'] },
        },
        arrayPath: 'results',
        pagination: {
          type: 'offset',
          offsetParam: '$skip',
          limitParam: '$top',
          limit: 1000,
          paramLocation: 'body',
          totalExpression: 'count',
        },
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://api.example.com/_apis/search/codesearchresults?api-version=7.1',
      );
      expect(JSON.parse(mockFetch.mock.calls[0][1].body as string)).toEqual({
        searchText: 'filename:catalog-info.yaml',
        filters: { Project: ['Project A'] },
        $skip: 0,
        $top: 1000,
      });
      expect(JSON.parse(mockFetch.mock.calls[1][1].body as string)).toEqual({
        searchText: 'filename:catalog-info.yaml',
        filters: { Project: ['Project A'] },
        $skip: 1000,
        $top: 1000,
      });
    });

    it('merges offset parameters into a nested body object via bodyParamsPath', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createJsonResponse({ count: 3, results: [{ id: '1' }, { id: '2' }] }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({ count: 3, results: [{ id: '3' }] }),
        );

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/search',
        method: 'POST',
        body: {
          query: 'catalog-info.yaml',
          options: { includeArchived: true },
        },
        arrayPath: 'results',
        pagination: {
          type: 'offset',
          offsetParam: '$skip',
          limitParam: '$top',
          limit: 2,
          paramLocation: 'body',
          bodyParamsPath: 'options',
          totalExpression: 'count',
        },
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body as string)).toEqual({
        query: 'catalog-info.yaml',
        options: { includeArchived: true, $skip: 0, $top: 2 },
      });
      expect(JSON.parse(mockFetch.mock.calls[1][1].body as string)).toEqual({
        query: 'catalog-info.yaml',
        options: { includeArchived: true, $skip: 2, $top: 2 },
      });
    });

    it('creates missing objects along a dot-separated bodyParamsPath', async () => {
      mockFetch.mockResolvedValueOnce(
        createJsonResponse({ count: 1, results: [{ id: '1' }] }),
      );

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/search',
        method: 'POST',
        body: { query: 'catalog-info.yaml' },
        arrayPath: 'results',
        pagination: {
          type: 'offset',
          offsetParam: '$skip',
          limitParam: '$top',
          limit: 100,
          paramLocation: 'body',
          bodyParamsPath: 'request.paging',
          totalExpression: 'count',
        },
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body as string)).toEqual({
        query: 'catalog-info.yaml',
        request: { paging: { $skip: 0, $top: 100 } },
      });
    });

    it('rejects a bodyParamsPath that points at a non-object value', async () => {
      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      await expect(async () => {
        for await (const page of backend.requestPages(
          mockIntegration,
          httpOptions({
            backendType: 'http',
            path: '/search',
            method: 'POST',
            body: { options: 'not-an-object' },
            arrayPath: 'results',
            pagination: {
              type: 'offset',
              offsetParam: '$skip',
              limitParam: '$top',
              limit: 100,
              paramLocation: 'body',
              bodyParamsPath: 'options',
            },
          }),
        )) {
          void page;
        }
      }).rejects.toThrow(
        'Body pagination bodyParamsPath "options" points at a non-object value at "options"',
      );
    });

    it('requires POST when offset parameters are placed in the body', async () => {
      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      await expect(async () => {
        for await (const page of backend.requestPages(
          mockIntegration,
          httpOptions({
            backendType: 'http',
            path: '/items',
            method: 'GET',
            body: {},
            arrayPath: 'items',
            pagination: {
              type: 'offset',
              offsetParam: 'offset',
              limitParam: 'limit',
              limit: 100,
              paramLocation: 'body',
            },
          }),
        )) {
          void page;
        }
      }).rejects.toThrow('Body offset pagination requires a POST request');
    });

    it('requires a JSON object body for body offset pagination', async () => {
      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      await expect(async () => {
        for await (const page of backend.requestPages(
          mockIntegration,
          httpOptions({
            backendType: 'http',
            path: '/items',
            method: 'POST',
            body: ['not-an-object'],
            arrayPath: 'items',
            pagination: {
              type: 'offset',
              offsetParam: 'offset',
              limitParam: 'limit',
              limit: 100,
              paramLocation: 'body',
            },
          }),
        )) {
          void page;
        }
      }).rejects.toThrow('Body offset pagination requires a JSON object body');
    });
  });

  describe('requestPages - link header pagination', () => {
    it('follows Link header rel=next', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createJsonResponse([{ id: '1' }], {
            link: '<https://api.example.com/items?page=2>; rel="next"',
          }),
        )
        .mockResolvedValueOnce(createJsonResponse([{ id: '2' }]));

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        pagination: {
          type: 'link',
          perPageParam: 'per_page',
          perPage: 10,
        },
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('can switch follow-up Link requests to GET', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createJsonResponse([{ id: '1' }], {
            link: '<https://api.example.com/items?page=2>; rel="next"',
          }),
        )
        .mockResolvedValueOnce(createJsonResponse([{ id: '2' }]));

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        method: 'POST',
        body: { query: 'status:active' },
        pagination: {
          type: 'link',
          perPageParam: 'per_page',
          perPage: 10,
          nextRequestMethod: 'GET',
        },
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      const [, firstInit] = mockFetch.mock.calls[0];
      const [, secondInit] = mockFetch.mock.calls[1];
      expect(firstInit?.method).toBe('POST');
      expect(firstInit?.body).toBe(JSON.stringify({ query: 'status:active' }));
      expect(secondInit?.method).toBe('GET');
      expect(secondInit?.body).toBeUndefined();
    });

    it('respects nextLinkCondition when following Link headers', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createJsonResponse([{ id: '1' }], {
            link: '<https://api.example.com/items?page=2>; rel="next"; results="true"',
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse([{ id: '2' }], {
            link: '<https://api.example.com/items?page=3>; rel="next"; results="false"',
          }),
        )
        .mockResolvedValueOnce(createJsonResponse([{ id: '3' }]));

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        pagination: {
          type: 'link',
          perPageParam: 'per_page',
          perPage: 10,
          nextLinkCondition: {
            param: 'results',
            equals: 'true',
          },
        },
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('requestPages - body-link pagination', () => {
    it('follows next link from response body', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createJsonResponse({
            items: [{ id: '1' }],
            links: { next: 'https://api.example.com/items?page=2' },
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            items: [{ id: '2' }],
            links: { next: null },
          }),
        );

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: 'items',
        pagination: {
          type: 'body-link',
          nextLinkExpression: 'links.next',
          perPageParam: 'per_page',
          perPage: 10,
        },
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0].items).toEqual([{ id: '1' }]);
      expect(pages[1].items).toEqual([{ id: '2' }]);
    });

    it('can switch follow-up body-link requests to GET', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createJsonResponse({
            items: [{ id: '1' }],
            links: { next: 'https://api.example.com/items?page=2' },
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            items: [{ id: '2' }],
            links: { next: null },
          }),
        );

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        method: 'POST',
        body: { query: 'status:active' },
        arrayPath: 'items',
        pagination: {
          type: 'body-link',
          nextLinkExpression: 'links.next',
          perPageParam: 'per_page',
          perPage: 10,
          nextRequestMethod: 'GET',
        },
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      const [, firstInit] = mockFetch.mock.calls[0];
      const [, secondInit] = mockFetch.mock.calls[1];
      expect(firstInit?.method).toBe('POST');
      expect(secondInit?.method).toBe('GET');
      expect(secondInit?.body).toBeUndefined();
    });
  });

  describe('callbacks', () => {
    it('calls beforeRequest before each page fetch', async () => {
      const callOrder: string[] = [];
      mockFetch.mockImplementation(async () => {
        callOrder.push('fetch');
        return createJsonResponse({ items: [{ id: '1' }] });
      });
      const beforeRequest = vi.fn().mockImplementation(async () => {
        callOrder.push('beforeRequest');
      });

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: 'items',
        beforeRequest,
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(beforeRequest).toHaveBeenCalledTimes(1);
      expect(callOrder).toEqual(['beforeRequest', 'fetch']);
    });

    it('calls onRequestLog per page', async () => {
      mockFetch.mockResolvedValue(createJsonResponse({ items: [{ id: '1' }] }));
      const onRequestLog = vi.fn();

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: 'items',
        onRequestLog,
      };

      for await (const page of backend.requestPages(mockIntegration, options)) {
        void page;
      }

      expect(onRequestLog).toHaveBeenCalledTimes(1);
      expect(onRequestLog).toHaveBeenCalledWith(
        expect.objectContaining({
          target: 'https://api.example.com/items',
          operation: 'GET',
          status: '200',
        }),
      );
    });
  });

  describe('error logging', () => {
    it('emits a request log with error when request fails', async () => {
      mockFetch.mockResolvedValue(
        new undici.Response('Not Found', {
          status: 404,
          statusText: 'Not Found',
        }),
      );
      const onRequestLog = vi.fn();

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/missing',
        onRequestLog,
      };

      await expect(async () => {
        for await (const page of backend.requestPages(
          mockIntegration,
          options,
        )) {
          void page;
        }
      }).rejects.toThrow(/Request failed: 404/);

      expect(onRequestLog).toHaveBeenCalledTimes(1);
      expect(onRequestLog).toHaveBeenCalledWith(
        expect.objectContaining({
          target: 'https://api.example.com/missing',
          operation: 'GET',
          status: '404',
          error: expect.stringMatching(/Request failed: 404/),
        }),
      );
    });

    it('emits a request log with error during paginated requests', async () => {
      mockFetch
        .mockResolvedValueOnce(
          new undici.Response(
            JSON.stringify({ items: [{ id: '1' }], next_cursor: 'abc' }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        )
        .mockResolvedValueOnce(
          new undici.Response('Server Error', {
            status: 500,
            statusText: 'Internal Server Error',
          }),
        );
      const onRequestLog = vi.fn();

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: 'items',
        onRequestLog,
        pagination: {
          type: 'cursor',
          cursorParam: 'cursor',
          nextCursorExpression: 'next_cursor',
        },
      };

      await expect(async () => {
        for await (const page of backend.requestPages(
          mockIntegration,
          options,
        )) {
          void page;
        }
      }).rejects.toThrow(/Request failed: 500/);

      expect(onRequestLog).toHaveBeenCalledTimes(2);
      expect(onRequestLog).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: '500',
          error: expect.stringMatching(/Request failed: 500/),
        }),
      );
    });
  });

  describe('fetch error cause surfacing', () => {
    it('surfaces the root cause from TypeError with .cause', async () => {
      const rootCause = new Error('connect ECONNREFUSED 127.0.0.1:443');
      const fetchError = new TypeError('fetch failed');
      Object.defineProperty(fetchError, 'cause', { value: rootCause });

      mockFetch.mockRejectedValue(fetchError);

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/api/v1/namespaces',
      };

      await expect(async () => {
        for await (const page of backend.requestPages(
          mockIntegration,
          options,
        )) {
          void page;
        }
      }).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:443');
    });

    it('forwards errors without .cause as-is', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/api/v1/namespaces',
      };

      await expect(async () => {
        for await (const page of backend.requestPages(
          mockIntegration,
          options,
        )) {
          void page;
        }
      }).rejects.toThrow('fetch failed');
    });

    it('includes the enriched error in onRequestLog', async () => {
      const rootCause = new Error('getaddrinfo ENOTFOUND bad-host.example.com');
      const fetchError = new TypeError('fetch failed');
      Object.defineProperty(fetchError, 'cause', { value: rootCause });

      mockFetch.mockRejectedValue(fetchError);
      const onRequestLog = vi.fn();

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        onRequestLog,
      };

      await expect(async () => {
        for await (const page of backend.requestPages(
          mockIntegration,
          options,
        )) {
          void page;
        }
      }).rejects.toThrow();

      expect(onRequestLog).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining(
            'getaddrinfo ENOTFOUND bad-host.example.com',
          ),
        }),
      );
    });
  });

  describe('abort signal', () => {
    it('respects abort signal during request', async () => {
      const controller = new AbortController();
      controller.abort();

      mockFetch.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        signal: controller.signal,
      };

      await expect(async () => {
        for await (const page of backend.requestPages(
          mockIntegration,
          options,
        )) {
          void page;
        }
      }).rejects.toThrow();
    });
  });

  describe('header array normalization', () => {
    it('normalizes array-format headers into record format', async () => {
      const data = { items: [{ id: '1' }] };
      mockFetch.mockResolvedValue(createJsonResponse(data));

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: 'items',
        headers: [{ key: 'X-Custom', value: 'val' }],
      };

      for await (const page of backend.requestPages(mockIntegration, options)) {
        void page;
      }

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Custom': 'val' }),
        }),
      );
    });

    it('passes record-format headers through unchanged', async () => {
      const data = { items: [{ id: '1' }] };
      mockFetch.mockResolvedValue(createJsonResponse(data));

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: 'items',
        headers: { 'X-Custom': 'val' },
      };

      for await (const page of backend.requestPages(mockIntegration, options)) {
        void page;
      }

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Custom': 'val' }),
        }),
      );
    });
  });

  describe('smart array detection', () => {
    it('auto-detects array when arrayPath returns an object with nested arrays', async () => {
      const data = {
        wrapper: {
          items: [{ id: '1' }, { id: '2' }],
          next_page: 'abc',
        },
      };
      mockFetch.mockResolvedValue(createJsonResponse(data));

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: 'wrapper',
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].items).toEqual([{ id: '1' }, { id: '2' }]);
    });

    it('throws when arrayPath returns a non-object non-array value', async () => {
      const data = { value: 'just-a-string' };
      mockFetch.mockResolvedValue(createJsonResponse(data));

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: 'value',
      };

      await expect(async () => {
        for await (const page of backend.requestPages(
          mockIntegration,
          options,
        )) {
          void page;
        }
      }).rejects.toThrow(
        'Array expression "value" did not return an array or object',
      );
    });
  });

  describe('JSON fallback parsing', () => {
    it('parses JSON from text/plain response', async () => {
      const body = JSON.stringify({ items: [{ id: '1' }] });
      mockFetch.mockResolvedValue(
        new undici.Response(body, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
        arrayPath: 'items',
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].items).toEqual([{ id: '1' }]);
    });

    it('keeps non-JSON text as string', async () => {
      mockFetch.mockResolvedValue(
        new undici.Response('plain text', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/items',
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].items).toEqual(['plain text']);
    });
  });

  describe('PDF text extraction', () => {
    const backend = () =>
      new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

    async function fetchBody(response: undici.Response) {
      mockFetch.mockResolvedValue(response);
      const onRequestLog = vi.fn();
      await backend().request(
        mockIntegration,
        httpOptions({ backendType: 'http', path: '/doc', onRequestLog }),
      );
      return onRequestLog.mock.calls[0][0].responseBody;
    }

    it('returns the text of an application/pdf response', async () => {
      const body = await fetchBody(
        new undici.Response(buildPdf(['Members Present: Cllr A. Breen']), {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
      );

      expect(body).toMatchObject({
        contentType: 'application/pdf',
        pageCount: 1,
        pages: ['Members Present: Cllr A. Breen'],
      });
    });

    it('sniffs a PDF served as application/octet-stream', async () => {
      const body = await fetchBody(
        new undici.Response(buildPdf(['Page one']), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
      );

      expect(body).toMatchObject({
        contentType: 'application/pdf',
        text: 'Page one',
      });
    });

    it('still parses JSON served as application/octet-stream', async () => {
      const body = await fetchBody(
        new undici.Response(JSON.stringify({ id: '1' }), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
      );

      expect(body).toEqual({ id: '1' });
    });

    it('leaves HTML responses as text', async () => {
      const body = await fetchBody(
        new undici.Response('<html>%PDF- in prose</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      );

      expect(body).toBe('<html>%PDF- in prose</html>');
    });

    it('fails the request when a PDF cannot be parsed', async () => {
      mockFetch.mockResolvedValue(
        new undici.Response('%PDF-1.4 truncated', {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
      );

      await expect(
        backend().request(
          mockIntegration,
          httpOptions({ backendType: 'http', path: '/doc' }),
        ),
      ).rejects.toThrow(
        /Failed to extract text from PDF at GET https:\/\/api\.example\.com\/doc/,
      );
    });
  });

  describe('scope-scoped caches', () => {
    const originalEnv = { ...process.env };

    const testCaCert = `-----BEGIN CERTIFICATE-----
MIIC5zCCAc+gAwIBAgIBADANBgkqhkiG9w0BAQsFADAVMRMwEQYDVQQDEwprdWJl
cm5ldGVzMB4XDTIxMDQyODExNTc0OVoXDTMxMDQyNjExNTc0OVowFTETMBEGA1UE
AxMKa3ViZXJuZXRlczCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAOWM
-----END CERTIFICATE-----`;

    beforeEach(() => {
      process.env.CLIENT_ID = 'client-id';
      process.env.CLIENT_SECRET = 'client-secret';
      process.env.CA_CERT = testCaCert;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('reuses oauth tokens for scope-less callers', async () => {
      let tokenRequests = 0;
      mockFetch.mockImplementation(async (input: string | URL) => {
        const url = String(input);
        if (url === 'https://auth.example.com/token') {
          tokenRequests++;
          return createJsonResponse({
            access_token: `token-${tokenRequests}`,
            expires_in: 3600,
          });
        }
        return createJsonResponse({ ok: true });
      });

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(['CLIENT_ID', 'CLIENT_SECRET']),
        secretStore: envBackedSecretStore,
      });

      const integration: Integration = {
        ...mockIntegration,
        authType: 'oauth2-client-credentials',
        authConfig: {
          clientId: '${CLIENT_ID}',
          clientSecret: '${CLIENT_SECRET}',
          tokenUrl: 'https://auth.example.com/token',
          scope: 'read:items',
        },
      };

      await backend.request(
        integration,
        httpOptions({
          backendType: 'http',
          path: '/items',
        }),
      );
      await backend.request(
        integration,
        httpOptions({
          backendType: 'http',
          path: '/items',
        }),
      );

      expect(tokenRequests).toBe(1);
    });

    it('includes audience in the client-credentials token request when configured', async () => {
      mockFetch.mockImplementation(async (input: string | URL) => {
        if (String(input) === 'https://auth.example.com/token') {
          return createJsonResponse({
            access_token: 'token-1',
            expires_in: 3600,
          });
        }
        return createJsonResponse({ ok: true });
      });

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(['CLIENT_ID', 'CLIENT_SECRET']),
        secretStore: envBackedSecretStore,
      });

      const integration: Integration = {
        ...mockIntegration,
        authType: 'oauth2-client-credentials',
        authConfig: {
          clientId: '${CLIENT_ID}',
          clientSecret: '${CLIENT_SECRET}',
          tokenUrl: 'https://auth.example.com/token',
          audience: 'https://roadie.eu.auth0.com/api/v2/',
        },
      };

      await backend.request(
        integration,
        httpOptions({
          backendType: 'http',
          path: '/items',
        }),
      );

      const tokenCall = mockFetch.mock.calls.find(
        ([input]) => String(input) === 'https://auth.example.com/token',
      );
      expect(tokenCall).toBeDefined();
      const tokenBody = new URLSearchParams(tokenCall![1].body as string);
      expect(tokenBody.get('grant_type')).toBe('client_credentials');
      expect(tokenBody.get('audience')).toBe(
        'https://roadie.eu.auth0.com/api/v2/',
      );
      // scope was not configured, so it must be omitted from the request.
      expect(tokenBody.has('scope')).toBe(false);
    });

    it('separates oauth token cache entries by scopeId and clearCachedToken target', async () => {
      let tokenRequests = 0;
      mockFetch.mockImplementation(async (input: string | URL) => {
        const url = String(input);
        if (url === 'https://auth.example.com/token') {
          tokenRequests++;
          return createJsonResponse({
            access_token: `token-${tokenRequests}`,
            expires_in: 3600,
          });
        }
        return createJsonResponse({ ok: true });
      });

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(['CLIENT_ID', 'CLIENT_SECRET']),
        secretStore: envBackedSecretStore,
      });

      const integration: Integration = {
        ...mockIntegration,
        authType: 'oauth2-client-credentials',
        authConfig: {
          clientId: '${CLIENT_ID}',
          clientSecret: '${CLIENT_SECRET}',
          tokenUrl: 'https://auth.example.com/token',
          scope: 'read:items',
        },
      };

      await backend.request(
        integration,
        httpOptions({
          backendType: 'http',
          path: '/items',
          scopeId: 'acme',
        }),
      );
      await backend.request(
        integration,
        httpOptions({
          backendType: 'http',
          path: '/items',
          scopeId: 'globex',
        }),
      );
      await backend.request(
        integration,
        httpOptions({
          backendType: 'http',
          path: '/items',
          scopeId: 'acme',
        }),
      );
      backend.clearCachedToken(integration.id, 'acme');
      await backend.request(
        integration,
        httpOptions({
          backendType: 'http',
          path: '/items',
          scopeId: 'acme',
        }),
      );
      await backend.request(
        integration,
        httpOptions({
          backendType: 'http',
          path: '/items',
          scopeId: 'globex',
        }),
      );

      expect(tokenRequests).toBe(3);
    });

    it('normalizes empty scopeId to scope-less cache entries', async () => {
      let tokenRequests = 0;
      mockFetch.mockImplementation(async (input: string | URL) => {
        const url = String(input);
        if (url === 'https://auth.example.com/token') {
          tokenRequests++;
          return createJsonResponse({
            access_token: `token-${tokenRequests}`,
            expires_in: 3600,
          });
        }
        return createJsonResponse({ ok: true });
      });

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(['CLIENT_ID', 'CLIENT_SECRET']),
        secretStore: envBackedSecretStore,
      });

      const integration: Integration = {
        ...mockIntegration,
        authType: 'oauth2-client-credentials',
        authConfig: {
          clientId: '${CLIENT_ID}',
          clientSecret: '${CLIENT_SECRET}',
          tokenUrl: 'https://auth.example.com/token',
          scope: 'read:items',
        },
      };

      await backend.request(
        integration,
        httpOptions({
          backendType: 'http',
          path: '/items',
          scopeId: '',
        }),
      );
      await backend.request(
        integration,
        httpOptions({
          backendType: 'http',
          path: '/items',
        }),
      );

      expect(tokenRequests).toBe(1);
    });

    it('keeps dispatcher caches scope-scoped while preserving scope-less reuse', async () => {
      mockFetch.mockImplementation(async () =>
        createJsonResponse({ ok: true }),
      );

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(['CA_CERT']),
        secretStore: envBackedSecretStore,
      });

      const integration: Integration = {
        ...mockIntegration,
        config: {
          caCertificate: '${CA_CERT}',
        },
      };

      await backend.request(
        integration,
        httpOptions({
          backendType: 'http',
          path: '/items',
        }),
      );
      await backend.request(
        integration,
        httpOptions({
          backendType: 'http',
          path: '/items',
          scopeId: '',
        }),
      );
      await backend.request(
        integration,
        httpOptions({
          backendType: 'http',
          path: '/items',
          scopeId: 'acme',
        }),
      );

      const scopelessDispatcher = mockFetch.mock.calls[0][1]?.dispatcher;
      const emptyScopeDispatcher = mockFetch.mock.calls[1][1]?.dispatcher;
      const scopedDispatcher = mockFetch.mock.calls[2][1]?.dispatcher;

      expect(scopelessDispatcher).toBeDefined();
      expect(scopelessDispatcher).toBe(emptyScopeDispatcher);
      expect(scopedDispatcher).toBeDefined();
      expect(scopedDispatcher).not.toBe(scopelessDispatcher);
    });
  });

  describe('secret allow list resolution', () => {
    it('refreshes the allow list between requests', async () => {
      const previousSecret = process.env.TENANT_A_SECRET;
      process.env.TENANT_A_SECRET = 'tenant-a-token';
      mockFetch.mockResolvedValue(createJsonResponse([{ id: '1' }]));

      let currentAllowList = new Set(['TENANT_A_SECRET']);

      const backend = new HttpBackend({
        logger: voidLogger,
        getEnvVarAllowList: async () => new Set(currentAllowList),
        secretStore: envBackedSecretStore,
      });

      const integration: Integration = {
        ...mockIntegration,
        authType: 'header',
        authConfig: {
          headers: {
            Authorization: 'Bearer ${TENANT_A_SECRET}',
          },
        },
      };

      try {
        const firstPages = [];
        for await (const page of backend.requestPages(
          integration,
          httpOptions({
            backendType: 'http',
            path: '/items',
          }),
        )) {
          firstPages.push(page);
        }

        expect(firstPages).toHaveLength(1);

        currentAllowList = new Set(['TENANT_B_SECRET']);

        await expect(async () => {
          for await (const page of backend.requestPages(
            integration,
            httpOptions({
              backendType: 'http',
              path: '/items',
            }),
          )) {
            void page;
          }
        }).rejects.toThrow(
          'Secret substitution not permitted for the referenced variable.',
        );
      } finally {
        if (previousSecret === undefined) {
          delete process.env.TENANT_A_SECRET;
        } else {
          process.env.TENANT_A_SECRET = previousSecret;
        }
      }
    });
  });

  describe('normalizeCertificate', () => {
    const certWithRealNewlines = `-----BEGIN CERTIFICATE-----
MIIC5zCCAc+gAwIBAgIBADANBgkqhkiG9w0BAQsFADAVMRMwEQYDVQQDEwprdWJl
cm5ldGVzMB4XDTIxMDQyODExNTc0OVoXDTMxMDQyNjExNTc0OVowFTETMBEGA1UE
-----END CERTIFICATE-----`;
    const wrappedBody =
      'MIIC5zCCAc+gAwIBAgIBADANBgkqhkiG9w0BAQsFADAVMRMwEQYDVQQDEwprdWJl\ncm5ldGVzMB4XDTIxMDQyODExNTc0OVoXDTMxMDQyNjExNTc0OVowFTETMBEGA1UE';

    it('converts escaped \\n sequences to real newlines', () => {
      const certWithEscapedNewlines =
        '-----BEGIN CERTIFICATE-----\\nMIIC5zCCAc+gAwIBAgIBADANBgkqhkiG9w0BAQsFADAVMRMwEQYDVQQDEwprdWJl\\ncm5ldGVzMB4XDTIxMDQyODExNTc0OVoXDTMxMDQyNjExNTc0OVowFTETMBEGA1UE\\n-----END CERTIFICATE-----';
      const result = normalizeCertificate(certWithEscapedNewlines);
      expect(result).toContain('\n');
      expect(result).not.toContain('\\n');
      expect(result).toMatch(/^-----BEGIN CERTIFICATE-----\n/);
      expect(result).toMatch(/\n-----END CERTIFICATE-----$/);
    });

    it('returns certificate with real newlines unchanged', () => {
      const result = normalizeCertificate(certWithRealNewlines);
      expect(result).toBe(certWithRealNewlines);
    });

    it('normalizes escaped CRLF sequences to LF newlines', () => {
      const certWithEscapedCR = 'test\\r\\ncontent';
      const result = normalizeCertificate(certWithEscapedCR);
      expect(result).toBe('test\ncontent');
    });

    it('normalizes Windows-style CRLF line endings to LF', () => {
      const certWithCrlf = certWithRealNewlines.replace(/\n/g, '\r\n');
      const result = normalizeCertificate(certWithCrlf);
      expect(result).toBe(certWithRealNewlines);
    });

    it('reconstructs a flattened single-line PEM with spaces', () => {
      const flattened = `-----BEGIN CERTIFICATE----- ${wrappedBody.replace(
        /\n/g,
        '',
      )} -----END CERTIFICATE-----`;

      expect(normalizeCertificate(flattened)).toBe(certWithRealNewlines);
    });
  });

  describe('normalizePrivateKey', () => {
    const header = '-----BEGIN PRIVATE KEY-----';
    const footer = '-----END PRIVATE KEY-----';
    const body64 = 'A'.repeat(256);
    const wrappedBody = body64.match(/.{1,64}/g)!.join('\n');

    it('returns a valid multiline PEM unchanged', () => {
      const pem = `${header}\n${wrappedBody}\n${footer}`;
      expect(normalizePrivateKey(pem)).toBe(pem);
    });

    it('converts escaped \\n sequences to real newlines', () => {
      const escaped = `${header}\\n${wrappedBody.replace(
        /\n/g,
        '\\n',
      )}\\n${footer}`;
      const result = normalizePrivateKey(escaped);
      expect(result).toContain('\n');
      expect(result).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
      expect(result).toMatch(/\n-----END PRIVATE KEY-----$/);
    });

    it('normalises Windows-style CRLF line endings', () => {
      const crlf = `${header}\r\n${wrappedBody.replace(
        /\n/g,
        '\r\n',
      )}\r\n${footer}`;
      const result = normalizePrivateKey(crlf);
      expect(result).not.toContain('\r');
    });

    it('reconstructs a flattened single-line PEM with spaces', () => {
      const flatBody = body64;
      const flattened = `${header} ${flatBody} ${footer}`;
      const result = normalizePrivateKey(flattened);
      expect(result).toBe(`${header}\n${wrappedBody}\n${footer}`);
    });

    it('handles RSA key label in flattened PEM', () => {
      const rsaHeader = '-----BEGIN RSA PRIVATE KEY-----';
      const rsaFooter = '-----END RSA PRIVATE KEY-----';
      const flattened = `${rsaHeader} ${body64} ${rsaFooter}`;
      const result = normalizePrivateKey(flattened);
      expect(result).toMatch(/^-----BEGIN RSA PRIVATE KEY-----\n/);
      expect(result).toMatch(/\n-----END RSA PRIVATE KEY-----$/);
    });

    it('trims leading and trailing whitespace', () => {
      const pem = `\n  ${header}\n${wrappedBody}\n${footer}  \n`;
      const result = normalizePrivateKey(pem);
      expect(result.startsWith(header)).toBe(true);
    });
  });

  describe('template rendering in path', () => {
    it('renders {{ now }} in path to actual date', async () => {
      const today = DateTime.now().toISODate();
      const data = [{ id: '1' }];
      mockFetch.mockResolvedValue(createJsonResponse(data));

      const backend = new HttpBackend({
        logger: voidLogger,

        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/api?date={{ now }}',
      };

      for await (const page of backend.requestPages(mockIntegration, options)) {
        void page;
      }

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.example.com/api?date=${today}`,
        expect.any(Object),
      );
    });
  });

  describe('GraphQL requests', () => {
    it('throws when the response body contains a non-empty errors array', async () => {
      mockFetch.mockResolvedValue(
        createJsonResponse({
          data: null,
          errors: [{ message: 'Something exploded' }],
        }),
      );

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/graphql',
        method: 'POST',
        body: { query: '{ viewer { login } }' },
        isGraphQL: true,
      };

      await expect(async () => {
        for await (const page of backend.requestPages(
          mockIntegration,
          options,
        )) {
          void page;
        }
      }).rejects.toThrow(/Something exploded/);
    });

    it('does not throw when errors array is empty', async () => {
      mockFetch.mockResolvedValue(
        createJsonResponse({
          data: { viewer: { login: 'davidtuite' } },
          errors: [],
        }),
      );

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/graphql',
        method: 'POST',
        body: { query: '{ viewer { login } }' },
        isGraphQL: true,
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
    });
  });

  describe('requestPages - graphql-cursor pagination', () => {
    it('injects the cursor into body.variables and walks pages', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createJsonResponse({
            data: {
              org: {
                members: {
                  nodes: [{ login: 'alice' }],
                  pageInfo: { endCursor: 'C1', hasNextPage: true },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            data: {
              org: {
                members: {
                  nodes: [{ login: 'bob' }],
                  pageInfo: { endCursor: 'C2', hasNextPage: false },
                },
              },
            },
          }),
        );

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/graphql',
        method: 'POST',
        body: {
          query:
            'query($after:String){ org { members(after:$after){ nodes { login } pageInfo { endCursor hasNextPage } } } }',
          variables: { first: 1 },
        },
        isGraphQL: true,
        arrayPath: 'data.org.members.nodes',
        pagination: {
          type: 'graphql-cursor',
          cursorVariable: 'after',
          nextCursorExpression: 'data.org.members.pageInfo.endCursor',
          hasNextPageExpression: 'data.org.members.pageInfo.hasNextPage',
        },
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0].items).toEqual([{ login: 'alice' }]);
      expect(pages[1].items).toEqual([{ login: 'bob' }]);

      const [, firstInit] = mockFetch.mock.calls[0];
      const [, secondInit] = mockFetch.mock.calls[1];
      const firstBody = JSON.parse(firstInit.body as string);
      const secondBody = JSON.parse(secondInit.body as string);
      expect(firstBody.variables).toEqual({ first: 1 });
      expect(secondBody.variables.after).toBe('C1');
      expect(secondBody.variables.first).toBe(1);
    });

    it('terminates when hasNextPage is false even if endCursor is present', async () => {
      mockFetch.mockResolvedValueOnce(
        createJsonResponse({
          data: {
            things: {
              nodes: [{ id: '1' }],
              pageInfo: { endCursor: 'X', hasNextPage: false },
            },
          },
        }),
      );

      const backend = new HttpBackend({
        logger: voidLogger,
        envVarAllowList: new Set(),
        secretStore: envBackedSecretStore,
      });

      const options: HttpRequestOptions = {
        backendType: 'http',
        path: '/graphql',
        method: 'POST',
        body: {
          query:
            '{ things { nodes { id } pageInfo { endCursor hasNextPage } } }',
        },
        isGraphQL: true,
        arrayPath: 'data.things.nodes',
        pagination: {
          type: 'graphql-cursor',
          cursorVariable: 'after',
          nextCursorExpression: 'data.things.pageInfo.endCursor',
          hasNextPageExpression: 'data.things.pageInfo.hasNextPage',
        },
      };

      const pages = [];
      for await (const page of backend.requestPages(mockIntegration, options)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
