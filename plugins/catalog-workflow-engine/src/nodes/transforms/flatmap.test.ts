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

import { vi } from 'vitest';
import { flatmapNode } from './flatmap';

describe('flatmapNode', () => {
  const createMockContext = (
    config: Record<string, unknown>,
    input: unknown,
  ) => ({
    config,
    input,
    log: vi.fn(),
    dryRun: false,
  });

  it('has correct metadata', () => {
    expect(flatmapNode.type).toBe('transform-flatmap');
    expect(flatmapNode.category).toBe('transform');
    expect(flatmapNode.supportsDryRun).toBe(true);
    expect(flatmapNode.workflowTypes).toEqual(['data-ingestion']);
  });

  describe('pagedHandler', () => {
    const createPagedContext = (
      config: Record<string, unknown>,
      pages: Array<Array<{ object: unknown; orderKey: number[] }>>,
    ) => {
      const emitted: Array<{ object: unknown; orderKey: readonly number[] }> =
        [];
      const emittedPageSizes: number[] = [];
      return {
        emitted,
        emittedPageSizes,
        ctx: {
          config,
          log: vi.fn(),
          io: {
            inputs: new Map([
              [
                'default',
                [
                  {
                    edgeId: 'e1',
                    sourceNodeId: 'src',
                    pages: (async function* stream() {
                      yield* pages;
                    })(),
                  },
                ],
              ],
            ]),
            emit: async (items: any[]) => {
              emittedPageSizes.push(items.length);
              emitted.push(...items);
            },
          },
        },
      };
    };

    it('expands each item and derives child order keys from the parent', async () => {
      const { ctx, emitted } = createPagedContext({ expression: 'repos' }, [
        [
          { object: { repos: [{ n: 'a' }, { n: 'b' }] }, orderKey: [0] },
          { object: { repos: [{ n: 'c' }] }, orderKey: [1] },
        ],
        [{ object: { repos: [{ n: 'd' }] }, orderKey: [2] }],
      ]);

      await flatmapNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([
        { n: 'a' },
        { n: 'b' },
        { n: 'c' },
        { n: 'd' },
      ]);
      expect(emitted.map(i => i.orderKey)).toEqual([
        [0, 0],
        [0, 1],
        [1, 0],
        [2, 0],
      ]);
    });

    it('emits nothing for items whose expression matches nothing', async () => {
      const { ctx, emitted } = createPagedContext({ expression: 'repos' }, [
        [
          { object: { id: 1 }, orderKey: [0] },
          { object: { repos: [{ n: 'a' }] }, orderKey: [1] },
        ],
      ]);

      await flatmapNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([{ n: 'a' }]);
      expect(emitted.map(i => i.orderKey)).toEqual([[1, 0]]);
    });

    it('attaches _parent when includeParent is set', async () => {
      const { ctx, emitted } = createPagedContext(
        { expression: 'repos', includeParent: true },
        [[{ object: { id: 1, repos: [{ n: 'a' }] }, orderKey: [0] }]],
      );

      await flatmapNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([
        { n: 'a', _parent: { id: 1, repos: [{ n: 'a' }] } },
      ]);
    });

    it('chunks a large expansion into pages instead of one page per input page', async () => {
      const { ctx, emitted, emittedPageSizes } = createPagedContext(
        { expression: 'repos' },
        [
          [
            {
              object: {
                repos: Array.from({ length: 2500 }, (_, i) => ({ i })),
              },
              orderKey: [0],
            },
          ],
        ],
      );

      await flatmapNode.pagedHandler!(ctx as any);

      expect(emitted).toHaveLength(2500);
      expect(emittedPageSizes).toEqual([1000, 1000, 500]);
    });

    it('passes items through when no expression is provided', async () => {
      const { ctx, emitted } = createPagedContext({ expression: '' }, [
        [{ object: { v: 1 }, orderKey: [0] }],
      ]);

      await flatmapNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([{ v: 1 }]);
      expect(ctx.log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('No flatmap expression'),
      );
    });

    it('throws when the expression fails for an item', async () => {
      const { ctx } = createPagedContext(
        { expression: '$number("not-a-number")' },
        [[{ object: { v: 1 }, orderKey: [0] }]],
      );

      await expect(flatmapNode.pagedHandler!(ctx as any)).rejects.toThrow(
        'Flatmap expression failed',
      );
    });

    it('expands the children a chained source enrich run embedded', async () => {
      const { ctx, emitted } = createPagedContext(
        { expression: '_additionalData.repos' },
        [
          [
            {
              object: {
                id: 1,
                _additionalData: { repos: [{ name: 'a' }, { name: 'b' }] },
              },
              orderKey: [0],
            },
          ],
        ],
      );

      await flatmapNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([
        { name: 'a' },
        { name: 'b' },
      ]);
    });

    it('wraps a non-object child under "value" when keeping the parent', async () => {
      const { ctx, emitted } = createPagedContext(
        { expression: 'tags', includeParent: true },
        [[{ object: { id: 1, tags: ['x', 'y'] }, orderKey: [0] }]],
      );

      await flatmapNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([
        { value: 'x', _parent: { id: 1, tags: ['x', 'y'] } },
        { value: 'y', _parent: { id: 1, tags: ['x', 'y'] } },
      ]);
    });

    it('leaves non-object children untouched without includeParent', async () => {
      const { ctx, emitted } = createPagedContext({ expression: 'tags' }, [
        [{ object: { id: 1, tags: ['x', 'y'] }, orderKey: [0] }],
      ]);

      await flatmapNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual(['x', 'y']);
    });

    it('keeps a single-element array as one item (JSONata unwraps singletons)', async () => {
      const { ctx, emitted } = createPagedContext({ expression: 'repos' }, [
        [{ object: { id: 1, repos: [{ name: 'only' }] }, orderKey: [0] }],
      ]);

      await flatmapNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([{ name: 'only' }]);
    });

    it('emits nothing for an item whose expression matches null', async () => {
      const { ctx, emitted } = createPagedContext({ expression: 'repos' }, [
        [
          { object: { id: 1, repos: [{ name: 'a' }] }, orderKey: [0] },
          { object: { id: 3, repos: null }, orderKey: [1] },
        ],
      ]);

      await flatmapNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([{ name: 'a' }]);
    });

    it('throws on an invalid JSONata expression', async () => {
      const { ctx } = createPagedContext({ expression: '{{invalid}}' }, [
        [{ object: { id: 1 }, orderKey: [0] }],
      ]);

      await expect(flatmapNode.pagedHandler!(ctx as any)).rejects.toThrow(
        'Invalid JSONata expression',
      );
    });
  });
});
