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

import { mapNode } from './map';

describe('mapNode', () => {
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
    expect(mapNode.type).toBe('transform-map');
    expect(mapNode.category).toBe('transform');
    expect(mapNode.supportsDryRun).toBe(true);
    expect(mapNode.workflowTypes).toEqual(['data-ingestion']);
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

    it('transforms each item and keeps the input order keys', async () => {
      const { ctx, emitted } = createPagedContext(
        { expression: '{ "double": v * 2 }' },
        [
          [
            { object: { v: 1 }, orderKey: [0] },
            { object: { v: 2 }, orderKey: [1] },
          ],
          [{ object: { v: 3 }, orderKey: [2] }],
        ],
      );

      await mapNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([
        { double: 2 },
        { double: 4 },
        { double: 6 },
      ]);
      expect(emitted.map(i => i.orderKey)).toEqual([[0], [1], [2]]);
    });

    it('maps a no-match result to null', async () => {
      const { ctx, emitted } = createPagedContext({ expression: 'missing' }, [
        [{ object: { v: 1 }, orderKey: [0] }],
      ]);

      await mapNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([null]);
    });

    it('passes items through when no expression is provided', async () => {
      const { ctx, emitted } = createPagedContext({ expression: '' }, [
        [{ object: { v: 1 }, orderKey: [0] }],
      ]);

      await mapNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([{ v: 1 }]);
      expect(ctx.log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('No map expression'),
      );
    });

    it('throws when the expression fails for an item', async () => {
      const { ctx } = createPagedContext(
        { expression: '$number("not-a-number")' },
        [[{ object: { v: 1 }, orderKey: [0] }]],
      );

      await expect(mapNode.pagedHandler!(ctx as any)).rejects.toThrow(
        'Map expression failed',
      );
    });

    it('passes items through unchanged with the $ expression', async () => {
      const { ctx, emitted } = createPagedContext({ expression: '$' }, [
        [
          { object: { id: 1 }, orderKey: [0] },
          { object: { id: 2 }, orderKey: [1] },
        ],
      ]);

      await mapNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('emits a scalar when the expression extracts a single field', async () => {
      const { ctx, emitted } = createPagedContext({ expression: 'name' }, [
        [
          { object: { id: 1, name: 'Alice' }, orderKey: [0] },
          { object: { id: 2, name: 'Bob' }, orderKey: [1] },
        ],
      ]);

      await mapNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual(['Alice', 'Bob']);
    });

    it('throws on an invalid JSONata expression', async () => {
      const { ctx } = createPagedContext({ expression: '{{invalid}}' }, [
        [{ object: { id: 1 }, orderKey: [0] }],
      ]);

      await expect(mapNode.pagedHandler!(ctx as any)).rejects.toThrow(
        'Invalid JSONata expression',
      );
    });

    it('supports a composed object expression', async () => {
      const { ctx, emitted } = createPagedContext(
        {
          expression: '{"id": id, "label": name & " (" & $string(count) & ")"}',
        },
        [[{ object: { id: 7, name: 'svc', count: 3 }, orderKey: [0] }]],
      );

      await mapNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([{ id: 7, label: 'svc (3)' }]);
    });
  });
});
