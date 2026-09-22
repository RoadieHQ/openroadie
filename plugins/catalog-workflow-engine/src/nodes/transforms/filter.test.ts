import { vi } from 'vitest';

/*
 * Copyright 2025 Larder Software Limited
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

import { filterNode } from './filter';

describe('filterNode', () => {
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
    expect(filterNode.type).toBe('transform-filter');
    expect(filterNode.category).toBe('transform');
    expect(filterNode.supportsDryRun).toBe(true);
    expect(filterNode.workflowTypes).toEqual(['data-ingestion']);
  });

  describe('pagedHandler', () => {
    const createPagedContext = (
      config: Record<string, unknown>,
      pages: Array<Array<{ object: unknown; orderKey: number[] }>>,
    ) => {
      const emitted: Array<{ object: unknown; orderKey: readonly number[] }> =
        [];
      return {
        emitted,
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
              emitted.push(...items);
            },
          },
        },
      };
    };

    it('filters per item and keeps the input order keys', async () => {
      const { ctx, emitted } = createPagedContext({ expression: 'v > 3' }, [
        [
          { object: { v: 1 }, orderKey: [0] },
          { object: { v: 5 }, orderKey: [1] },
        ],
        [{ object: { v: 7 }, orderKey: [2] }],
      ]);

      await filterNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([{ v: 5 }, { v: 7 }]);
      expect(emitted.map(i => i.orderKey)).toEqual([[1], [2]]);
    });

    it('supports remove mode', async () => {
      const { ctx, emitted } = createPagedContext(
        { expression: 'v > 3', mode: 'remove' },
        [
          [
            { object: { v: 1 }, orderKey: [0] },
            { object: { v: 5 }, orderKey: [1] },
          ],
        ],
      );

      await filterNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([{ v: 1 }]);
    });

    it('passes items through when no expression is provided', async () => {
      const { ctx, emitted } = createPagedContext({ expression: '  ' }, [
        [{ object: { v: 1 }, orderKey: [0] }],
      ]);

      await filterNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([{ v: 1 }]);
      expect(ctx.log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('No filter expression'),
      );
    });

    it('throws on invalid JSONata expression', async () => {
      const { ctx } = createPagedContext({ expression: '{{invalid}}' }, [
        [{ object: { v: 1 }, orderKey: [0] }],
      ]);

      await expect(filterNode.pagedHandler!(ctx as any)).rejects.toThrow(
        'Invalid JSONata expression',
      );
    });

    it('matches boolean fields with a boolean equality expression (sc-34595)', async () => {
      const { ctx, emitted } = createPagedContext(
        { expression: 'archived = true' },
        [
          [
            { object: { id: 1, archived: true }, orderKey: [0] },
            { object: { id: 2, archived: false }, orderKey: [1] },
            { object: { id: 3, archived: true }, orderKey: [2] },
          ],
        ],
      );

      await filterNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([
        { id: 1, archived: true },
        { id: 3, archived: true },
      ]);
    });

    it('never matches boolean fields against a quoted "true" — why the builder must emit booleans (sc-34595)', async () => {
      const { ctx, emitted } = createPagedContext(
        { expression: 'archived = "true"' },
        [
          [
            { object: { id: 1, archived: true }, orderKey: [0] },
            { object: { id: 2, archived: false }, orderKey: [1] },
          ],
        ],
      );

      await filterNode.pagedHandler!(ctx as any);

      expect(emitted).toEqual([]);
    });

    it('supports the existence-checked is-empty expression the builder emits — matches missing and null fields (sc-34595)', async () => {
      const { ctx, emitted } = createPagedContext(
        { expression: '($not($exists(description)) or description = null)' },
        [
          [
            { object: { id: 1, description: 'has one' }, orderKey: [0] },
            { object: { id: 2, description: null }, orderKey: [1] },
            { object: { id: 3 }, orderKey: [2] },
          ],
        ],
      );

      await filterNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([
        { id: 2, description: null },
        { id: 3 },
      ]);
    });

    it('supports the negated $contains expression the builder emits for "not contains" (sc-34595)', async () => {
      const { ctx, emitted } = createPagedContext(
        { expression: '$not($contains(name, "svc"))' },
        [
          [
            { object: { name: 'svc-alpha' }, orderKey: [0] },
            { object: { name: 'web-gamma' }, orderKey: [1] },
            { object: { name: 'svc-beta' }, orderKey: [2] },
          ],
        ],
      );

      await filterNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([{ name: 'web-gamma' }]);
    });

    it('warns when the expression is an empty string', async () => {
      const { ctx, emitted } = createPagedContext({ expression: '' }, [
        [
          { object: { id: 1 }, orderKey: [0] },
          { object: { id: 2 }, orderKey: [1] },
        ],
      ]);

      await filterNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([{ id: 1 }, { id: 2 }]);
      expect(ctx.log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('No filter expression'),
      );
    });

    it('drops items whose expression result is falsy', async () => {
      const { ctx, emitted } = createPagedContext({ expression: 'name' }, [
        [
          { object: { name: 'valid' }, orderKey: [0] },
          { object: { noName: true }, orderKey: [1] },
          { object: { name: 'also valid' }, orderKey: [2] },
        ],
      ]);

      await filterNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([
        { name: 'valid' },
        { name: 'also valid' },
      ]);
    });
  });
});
