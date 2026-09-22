import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chainedSourceNode } from './chainedSource';
import { NODE_TYPES } from '@roadiehq/catalog-workflow-common';

describe('chainedSourceNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('node definition', () => {
    it('exposes the expected node definition', () => {
      expect(chainedSourceNode.type).toBe(NODE_TYPES.SOURCE_CHAINED);
      expect(chainedSourceNode.category).toBe('source');
      expect(chainedSourceNode.supportsDryRun).toBe(true);
    });
  });

  describe('pagedHandler', () => {
    const createDeferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>(r => {
        resolve = r;
      });
      return { promise, resolve };
    };

    const createPagedContext = (options: {
      config: Record<string, unknown>;
      parentPages: Array<Array<{ object: unknown; orderKey: number[] }>>;
      integration?: Record<string, unknown> | undefined;
      previewLimit?: number;
    }) => {
      const emitted: Array<{
        object: any;
        orderKey: readonly number[];
      }> = [];
      const abort = new AbortController();
      const integration =
        'integration' in options
          ? options.integration
          : { id: 'test-int', name: 'Test HTTP', backendType: 'http' };
      const ctx = {
        config: options.config,
        log: vi.fn(),
        signal: abort.signal,
        previewLimit: options.previewLimit,
        executionId: 'test-execution-123',
        integrationClient: {
          getIntegration: vi.fn().mockResolvedValue(integration),
          request: vi.fn(),
          requestPages: vi.fn(),
        },
        io: {
          inputs: new Map([
            [
              'default',
              [
                {
                  edgeId: 'e1',
                  sourceNodeId: 'src',
                  pages: (async function* stream() {
                    yield* options.parentPages;
                  })(),
                },
              ],
            ],
          ]),
          emit: async (items: any[]) => {
            emitted.push(...items);
          },
        },
      };
      return { ctx, emitted, abort };
    };

    const baseConfig = {
      integrationId: 'test-int',
      path: '/api/{{id}}/details',
      arrayExpression: '$',
      objectIdExpression: 'name',
    };

    it('flattens children as rows with [parentOrder, childOrdinal] order keys', async () => {
      const { ctx, emitted } = createPagedContext({
        config: { ...baseConfig, resultMode: 'flatten', concurrency: 1 },
        parentPages: [
          [
            { object: { id: '1' }, orderKey: [0] },
            { object: { id: '2' }, orderKey: [1] },
          ],
        ],
      });
      let call = 0;
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          const idx = call++;
          yield { items: [{ name: `c${idx}a` }], pageIndex: 0 };
          yield { items: [{ name: `c${idx}b` }], pageIndex: 1 };
        },
      );

      await chainedSourceNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object.name)).toEqual([
        'c0a',
        'c0b',
        'c1a',
        'c1b',
      ]);
      expect(emitted.map(i => i.orderKey)).toEqual([
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ]);
      expect(emitted[0].object._parent).toEqual({ id: '1' });
      expect(emitted[2].object._parent).toEqual({ id: '2' });
    });

    it('enriches parents in place and retains the parent order key', async () => {
      const { ctx, emitted } = createPagedContext({
        config: { ...baseConfig, concurrency: 1 },
        parentPages: [
          [
            { object: { id: '1' }, orderKey: [0] },
            { object: { id: '2' }, orderKey: [1] },
          ],
        ],
      });
      let call = 0;
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          const idx = call++;
          yield { items: [{ name: `c${idx}a` }], pageIndex: 0 };
          yield { items: [{ name: `c${idx}b` }], pageIndex: 1 };
        },
      );

      await chainedSourceNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.orderKey)).toEqual([[0], [1]]);
      expect(emitted[0].object.id).toBe('1');
      expect(
        emitted[0].object._additionalData.details.map((c: any) => c.name),
      ).toEqual(['c0a', 'c0b']);
      expect(
        emitted[1].object._additionalData.details.map((c: any) => c.name),
      ).toEqual(['c1a', 'c1b']);
    });

    it('fetches items concurrently, bounded by the configured concurrency', async () => {
      const parents = Array.from({ length: 6 }, (_, i) => ({
        object: { id: String(i) },
        orderKey: [i],
      }));
      const { ctx } = createPagedContext({
        config: { ...baseConfig, concurrency: 2 },
        parentPages: [parents],
      });
      let inFlight = 0;
      let maxInFlight = 0;
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise(r => setTimeout(r, 5));
          inFlight--;
          yield { items: [{ name: 'c' }], pageIndex: 0 };
        },
      );

      await chainedSourceNode.pagedHandler!(ctx as any);

      expect(maxInFlight).toBe(2);
    });

    it('clamps concurrency to the maximum', async () => {
      const parents = Array.from({ length: 25 }, (_, i) => ({
        object: { id: String(i) },
        orderKey: [i],
      }));
      const { ctx } = createPagedContext({
        config: { ...baseConfig, concurrency: 50 },
        parentPages: [parents],
      });
      let inFlight = 0;
      let maxInFlight = 0;
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise(r => setTimeout(r, 5));
          inFlight--;
          yield { items: [{ name: 'c' }], pageIndex: 0 };
        },
      );

      await chainedSourceNode.pagedHandler!(ctx as any);

      expect(maxInFlight).toBe(20);
    });

    it('keeps order keys tied to the parent regardless of completion order', async () => {
      const { ctx, emitted } = createPagedContext({
        config: { ...baseConfig, resultMode: 'flatten', concurrency: 2 },
        parentPages: [
          [
            { object: { id: 'a' }, orderKey: [0] },
            { object: { id: 'b' }, orderKey: [1] },
          ],
        ],
      });
      const releaseFirst = createDeferred();
      let call = 0;
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          const idx = call++;
          if (idx === 0) {
            await releaseFirst.promise;
            yield { items: [{ name: 'a-child' }], pageIndex: 0 };
          } else {
            yield { items: [{ name: 'b-child' }], pageIndex: 0 };
            releaseFirst.resolve();
          }
        },
      );

      await chainedSourceNode.pagedHandler!(ctx as any);

      // b finished first, so it was emitted first...
      expect(emitted.map(i => i.object.name)).toEqual(['b-child', 'a-child']);
      // ...but each child's order key still derives from its parent's order,
      // so duplicate semantics match the sequential run.
      const byName = new Map(emitted.map(i => [i.object.name, i.orderKey]));
      expect(byName.get('a-child')).toEqual([0, 0]);
      expect(byName.get('b-child')).toEqual([1, 0]);
    });

    it('fails the run when the failure rate exceeds the limit', async () => {
      const { ctx, emitted } = createPagedContext({
        config: { ...baseConfig, resultMode: 'flatten', concurrency: 1 },
        parentPages: [
          [
            { object: { id: '1' }, orderKey: [0] },
            { object: { id: '2' }, orderKey: [1] },
          ],
        ],
      });
      let call = 0;
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          const idx = call++;
          if (idx === 0) {
            throw new Error('Network error');
          }
          yield { items: [{ name: 'ok' }], pageIndex: 0 };
        },
      );

      await expect(chainedSourceNode.pagedHandler!(ctx as any)).rejects.toThrow(
        /exceeding the failure rate limit/,
      );
      // The non-429 failure was not retried.
      expect(ctx.integrationClient.requestPages).toHaveBeenCalledTimes(2);
      expect(emitted.map(i => i.object.name)).toEqual(['ok']);
    });

    it('skips isolated failures below the limit, keeping enrich parents with empty results', async () => {
      const { ctx, emitted } = createPagedContext({
        config: { ...baseConfig, concurrency: 1, failureRateLimit: 0.6 },
        parentPages: [
          [
            { object: { id: '1' }, orderKey: [0] },
            { object: { id: '2' }, orderKey: [1] },
          ],
        ],
      });
      let call = 0;
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          const idx = call++;
          if (idx === 0) {
            throw new Error('Network error');
          }
          yield { items: [{ name: 'ok' }], pageIndex: 0 };
        },
      );

      await chainedSourceNode.pagedHandler!(ctx as any);

      expect(emitted).toHaveLength(2);
      expect(emitted[0].object._additionalData.details).toEqual([]);
      expect(
        emitted[1].object._additionalData.details.map((c: any) => c.name),
      ).toEqual(['ok']);
      expect(ctx.log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('Item failed'),
      );
    });

    it('fails the run with flatten guidance when the enrich child cap is exceeded', async () => {
      const { ctx } = createPagedContext({
        config: { ...baseConfig, enrichChildCap: 2 },
        parentPages: [[{ object: { id: '1' }, orderKey: [0] }]],
      });
      let pagesServed = 0;
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          for (;;) {
            pagesServed++;
            yield { items: [{ name: `c${pagesServed}` }], pageIndex: 0 };
          }
        },
      );

      await expect(chainedSourceNode.pagedHandler!(ctx as any)).rejects.toThrow(
        /flatten/,
      );
      // The per-item page loop stopped collecting at the cap instead of
      // draining the (unbounded) child stream.
      expect(pagesServed).toBe(3);
    });

    it('retries 429 responses with backoff before counting a failure', async () => {
      vi.useFakeTimers();
      try {
        const { ctx, emitted } = createPagedContext({
          config: { ...baseConfig, concurrency: 1 },
          parentPages: [[{ object: { id: '1' }, orderKey: [0] }]],
        });
        let call = 0;
        ctx.integrationClient.requestPages.mockImplementation(
          async function* requestPages() {
            const idx = call++;
            if (idx === 0) {
              throw Object.assign(new Error('Too Many Requests'), {
                statusCode: 429,
              });
            }
            yield { items: [{ name: 'ok' }], pageIndex: 0 };
          },
        );

        const run = chainedSourceNode.pagedHandler!(ctx as any);
        await vi.advanceTimersByTimeAsync(2_000);
        await run;

        expect(ctx.integrationClient.requestPages).toHaveBeenCalledTimes(2);
        expect(
          emitted[0].object._additionalData.details.map((c: any) => c.name),
        ).toEqual(['ok']);
        expect(ctx.log).toHaveBeenCalledWith(
          'warn',
          expect.stringContaining('Rate limited'),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('coalesces per-item progress into periodic events', async () => {
      const parents = Array.from({ length: 100 }, (_, i) => ({
        object: { id: String(i) },
        orderKey: [i],
      }));
      const { ctx } = createPagedContext({
        config: { ...baseConfig },
        parentPages: [parents],
      });
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          yield { items: [{ name: 'c' }], pageIndex: 0 };
        },
      );

      await chainedSourceNode.pagedHandler!(ctx as any);

      expect(ctx.log).toHaveBeenCalledWith(
        'info',
        'Processed 100 items (0 failed)',
      );
      const perItemLogs = ctx.log.mock.calls.filter(([, message]) =>
        /fetched \d+ results/.test(String(message)),
      );
      expect(perItemLogs).toHaveLength(0);
    });

    it('honors the preview limit in flatten mode', async () => {
      const { ctx, emitted } = createPagedContext({
        config: { ...baseConfig, resultMode: 'flatten', concurrency: 1 },
        parentPages: [
          [
            { object: { id: '1' }, orderKey: [0] },
            { object: { id: '2' }, orderKey: [1] },
          ],
        ],
        previewLimit: 3,
      });
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          yield {
            items: [{ name: 'x' }, { name: 'y' }],
            pageIndex: 0,
          };
        },
      );

      await chainedSourceNode.pagedHandler!(ctx as any);

      expect(emitted).toHaveLength(3);
      expect(emitted.map(i => i.orderKey)).toEqual([
        [0, 0],
        [0, 1],
        [1, 0],
      ]);
    });

    it('honors the preview limit in enrich mode by capping parents', async () => {
      const { ctx, emitted } = createPagedContext({
        config: { ...baseConfig, concurrency: 1 },
        parentPages: [
          [
            { object: { id: '1' }, orderKey: [0] },
            { object: { id: '2' }, orderKey: [1] },
            { object: { id: '3' }, orderKey: [2] },
          ],
        ],
        previewLimit: 1,
      });
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          yield { items: [{ name: 'c' }], pageIndex: 0 };
        },
      );

      await chainedSourceNode.pagedHandler!(ctx as any);

      expect(emitted).toHaveLength(1);
      expect(ctx.integrationClient.requestPages).toHaveBeenCalledTimes(1);
    });

    it('rejects when the execution is aborted mid-run', async () => {
      const { ctx, abort } = createPagedContext({
        config: { ...baseConfig, concurrency: 1 },
        parentPages: [
          [
            { object: { id: '1' }, orderKey: [0] },
            { object: { id: '2' }, orderKey: [1] },
          ],
        ],
      });
      ctx.integrationClient.requestPages.mockImplementation(
        // eslint-disable-next-line require-yield
        async function* requestPages() {
          abort.abort(new Error('user cancelled'));
          throw new Error('socket hang up');
        },
      );

      await expect(chainedSourceNode.pagedHandler!(ctx as any)).rejects.toThrow(
        /aborted/,
      );
    });

    it('excludes items abandoned by the preview stop from the failure rate', async () => {
      // Three parents at concurrency 3, preview limit 1: p0 fails, p1 fills
      // the limit (setting stop), p2 is still in flight and gets abandoned.
      // The rate must be judged on the two finished items (1/2 = 50%), not
      // diluted to 1/3 by the abandoned one - a preview must not report
      // false confidence below the limit.
      const { ctx } = createPagedContext({
        config: {
          ...baseConfig,
          resultMode: 'flatten',
          concurrency: 3,
          failureRateLimit: 0.4,
        },
        parentPages: [
          [
            { object: { id: '0' }, orderKey: [0] },
            { object: { id: '1' }, orderKey: [1] },
            { object: { id: '2' }, orderKey: [2] },
          ],
        ],
        previewLimit: 1,
      });
      const limitFilled = createDeferred();
      let call = 0;
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          const idx = call++;
          if (idx === 0) {
            throw new Error('boom');
          }
          if (idx === 1) {
            yield { items: [{ name: 'c1' }], pageIndex: 0 };
            return;
          }
          // p2 delivers its page only after p1's emit filled the limit, so
          // it is always the abandoned in-flight item.
          await limitFilled.promise;
          await new Promise(resolve => setTimeout(resolve, 20));
          yield { items: [{ name: 'c2' }], pageIndex: 0 };
        },
      );
      const originalEmit = ctx.io.emit;
      ctx.io.emit = async (items: any[]) => {
        await originalEmit(items);
        limitFilled.resolve();
      };

      await expect(chainedSourceNode.pagedHandler!(ctx as any)).rejects.toThrow(
        /exceeding the failure rate limit/,
      );
    });

    it('excludes failures of abandoned items from the failure rate', async () => {
      // Mirror of the dilution case: p0 fills the preview limit (setting
      // stop); the two in-flight stragglers then fail - one with a 429, one
      // with a network error. Neither failure is evidence about the dataset,
      // so the preview must pass on the one finished item (0 failed / 1),
      // and the 429 must not be retried during wind-down.
      const { ctx, emitted } = createPagedContext({
        config: {
          ...baseConfig,
          resultMode: 'flatten',
          concurrency: 3,
          failureRateLimit: 0.4,
        },
        parentPages: [
          [
            { object: { id: '0' }, orderKey: [0] },
            { object: { id: '1' }, orderKey: [1] },
            { object: { id: '2' }, orderKey: [2] },
          ],
        ],
        previewLimit: 1,
      });
      const limitFilled = createDeferred();
      let call = 0;
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          const idx = call++;
          if (idx === 0) {
            yield { items: [{ name: 'c0' }], pageIndex: 0 };
            return;
          }
          await limitFilled.promise;
          await new Promise(resolve => setTimeout(resolve, 20));
          if (idx === 1) {
            throw Object.assign(new Error('Too Many Requests'), {
              statusCode: 429,
            });
          }
          throw new Error('late network error');
        },
      );
      const originalEmit = ctx.io.emit;
      ctx.io.emit = async (items: any[]) => {
        await originalEmit(items);
        limitFilled.resolve();
      };

      await chainedSourceNode.pagedHandler!(ctx as any);

      expect(emitted).toHaveLength(1);
      expect(emitted[0].object.name).toBe('c0');
      // The abandoned 429 was not retried.
      expect(ctx.integrationClient.requestPages).toHaveBeenCalledTimes(3);
    });

    it('fails the run when an enrich flush cannot be staged, instead of dropping the batch', async () => {
      // Enough parents to trigger the mid-run buffer flush (PAGE_SIZE): a
      // transient staging failure there used to count as ONE failed item
      // while silently losing every already-successful parent in the batch.
      const parents = Array.from({ length: 1000 }, (_, i) => ({
        object: { id: String(i) },
        orderKey: [i],
      }));
      const { ctx, emitted } = createPagedContext({
        config: { ...baseConfig, concurrency: 1 },
        parentPages: [parents],
      });
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          yield { items: [{ name: 'c' }], pageIndex: 0 };
        },
      );
      let emitCalls = 0;
      ctx.io.emit = async (items: any[]) => {
        emitCalls++;
        if (emitCalls === 1) {
          throw new Error('connection reset');
        }
        emitted.push(...items);
      };

      await expect(chainedSourceNode.pagedHandler!(ctx as any)).rejects.toThrow(
        /Failed to write results to staging.*connection reset/,
      );
      expect(emitted).toHaveLength(0);
    });

    it('fails the run when a flatten emit cannot be staged, instead of skipping the item', async () => {
      const { ctx, emitted } = createPagedContext({
        config: {
          ...baseConfig,
          resultMode: 'flatten',
          concurrency: 1,
          // Generous limit: a skip-and-continue implementation would resolve.
          failureRateLimit: 0.9,
        },
        parentPages: [
          [
            { object: { id: '1' }, orderKey: [0] },
            { object: { id: '2' }, orderKey: [1] },
          ],
        ],
      });
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          yield { items: [{ name: 'c' }], pageIndex: 0 };
        },
      );
      let emitCalls = 0;
      ctx.io.emit = async (items: any[]) => {
        emitCalls++;
        if (emitCalls === 1) {
          throw new Error('connection reset');
        }
        emitted.push(...items);
      };

      await expect(chainedSourceNode.pagedHandler!(ctx as any)).rejects.toThrow(
        'Failed to write results to staging',
      );
    });

    it('handles empty input without calling the integration', async () => {
      const { ctx, emitted } = createPagedContext({
        config: { ...baseConfig },
        parentPages: [],
      });

      await chainedSourceNode.pagedHandler!(ctx as any);

      expect(emitted).toHaveLength(0);
      expect(ctx.integrationClient.requestPages).not.toHaveBeenCalled();
      expect(ctx.log).toHaveBeenCalledWith('info', 'No input items to process');
    });

    it('throws when integrationId is missing', async () => {
      const { ctx } = createPagedContext({ config: {}, parentPages: [] });

      await expect(chainedSourceNode.pagedHandler!(ctx as any)).rejects.toThrow(
        'Integration ID is required',
      );
    });

    it('throws when the integration client is not available', async () => {
      const { ctx } = createPagedContext({
        config: { integrationId: 'test-id' },
        parentPages: [],
      });
      ctx.integrationClient = undefined as any;

      await expect(chainedSourceNode.pagedHandler!(ctx as any)).rejects.toThrow(
        'Integration client not available',
      );
    });

    it('throws when the integration is not found', async () => {
      const { ctx } = createPagedContext({
        config: { integrationId: 'unknown-id' },
        parentPages: [],
        integration: undefined,
      });

      await expect(chainedSourceNode.pagedHandler!(ctx as any)).rejects.toThrow(
        'Integration not found: unknown-id',
      );
    });
  });
});
