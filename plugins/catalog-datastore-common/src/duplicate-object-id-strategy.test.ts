/*
 * Copyright 2026 Larder Software Ltd.
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

import {
  ADDITIONAL_DEDUPLICATION_RESULTS_FIELD,
  DEFAULT_DUPLICATE_OBJECT_ID_STRATEGY,
  DUPLICATE_OBJECT_ID_EXPAND_SEP,
  normalizeDatastoreObjectIdKey,
  parseDuplicateObjectIdStrategy,
  resolveDatastoreItemsByObjectIdStrategy,
} from './duplicate-object-id-strategy';

describe('duplicate-object-id-strategy', () => {
  const items = [
    { objectId: 'a', v: 1 },
    { objectId: 'b', v: 2 },
    { objectId: 'a', v: 3 },
  ];

  it('parses invalid values to default', () => {
    expect(parseDuplicateObjectIdStrategy(undefined)).toBe(
      DEFAULT_DUPLICATE_OBJECT_ID_STRATEGY,
    );
    expect(parseDuplicateObjectIdStrategy('nope')).toBe(
      DEFAULT_DUPLICATE_OBJECT_ID_STRATEGY,
    );
    expect(parseDuplicateObjectIdStrategy('  keep_last  ')).toBe(
      DEFAULT_DUPLICATE_OBJECT_ID_STRATEGY,
    );
    expect(parseDuplicateObjectIdStrategy('keep_last')).toBe('keep_last');
    expect(parseDuplicateObjectIdStrategy('append')).toBe('append');
    expect(parseDuplicateObjectIdStrategy('expand')).toBe('expand');
  });

  it('treats Unicode NFC-equivalent objectIds as duplicates', () => {
    const composed = '\u00e9pisode';
    const decomposed = 'e\u0301pisode';
    expect(normalizeDatastoreObjectIdKey(composed)).toBe(
      normalizeDatastoreObjectIdKey(decomposed),
    );
    const r = resolveDatastoreItemsByObjectIdStrategy(
      [
        { objectId: composed, n: 1 },
        { objectId: decomposed, n: 2 },
      ],
      'keep_last',
    );
    expect(r.removed).toBe(1);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].objectId).toBe(normalizeDatastoreObjectIdKey(composed));
  });

  it('keep_last prefers later rows', () => {
    const r = resolveDatastoreItemsByObjectIdStrategy(items, 'keep_last');
    expect(r.removed).toBe(1);
    expect(r.duplicateObjectIds).toEqual(['a']);
    expect(r.items).toEqual([
      { objectId: 'a', v: 3 },
      { objectId: 'b', v: 2 },
    ]);
  });

  it('fail throws with index expression context and the duplicate value', () => {
    const run = () =>
      resolveDatastoreItemsByObjectIdStrategy(items, 'fail', {
        indexExpression: '$.id',
      });
    expect(run).toThrow(/Index expression "\$\.id" produced duplicate/);
    expect(run).toThrow(/duplicate value: a/);
  });

  it('append keeps the first row and lists later rows under additionalResults', () => {
    const secondRow = { x: 2, tags: ['q'] };
    const payload = [
      { objectId: 'a', object: { x: 1, tags: ['p'] } },
      { objectId: 'b', object: { y: 2 } },
      { objectId: 'a', object: secondRow },
    ];
    const r = resolveDatastoreItemsByObjectIdStrategy(payload, 'append');
    expect(r.removed).toBe(1);
    expect(r.items).toHaveLength(2);
    const mergedA = r.items.find(i => i.objectId === 'a');
    expect(mergedA?.object).toEqual({
      x: 1,
      tags: ['p'],
      [ADDITIONAL_DEDUPLICATION_RESULTS_FIELD]: [secondRow],
    });
  });

  it('append extends existing additionalResults on the first row', () => {
    const payload = [
      {
        objectId: 'a',
        object: { id: 1, [ADDITIONAL_DEDUPLICATION_RESULTS_FIELD]: [{ n: 0 }] },
      },
      { objectId: 'a', object: { id: 2, extra: true } },
    ];
    const r = resolveDatastoreItemsByObjectIdStrategy(payload, 'append');
    expect(r.removed).toBe(1);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].object).toEqual({
      id: 1,
      [ADDITIONAL_DEDUPLICATION_RESULTS_FIELD]: [
        { n: 0 },
        { id: 2, extra: true },
      ],
    });
  });

  it('append without object field falls back to last row per id', () => {
    const r = resolveDatastoreItemsByObjectIdStrategy(
      [
        { objectId: 'a', v: 1 },
        { objectId: 'a', v: 2 },
      ],
      'append',
    );
    expect(r.removed).toBe(1);
    expect(r.items).toEqual([{ objectId: 'a', v: 2 }]);
  });

  it('expand assigns compound objectIds in input order', () => {
    const r = resolveDatastoreItemsByObjectIdStrategy(
      [
        { objectId: 'a', n: 1 },
        { objectId: 'b', n: 2 },
        { objectId: 'a', n: 3 },
      ],
      'expand',
    );
    expect(r.removed).toBe(0);
    expect(r.duplicateObjectIds).toEqual(['a']);
    expect(r.items.map(i => i.objectId)).toEqual([
      'a',
      'b',
      `a${DUPLICATE_OBJECT_ID_EXPAND_SEP}1`,
    ]);
    expect(r.items.map(i => i.n)).toEqual([1, 2, 3]);
  });
});
