import type { RelationshipSuggestionValueType } from '@roadiehq/catalog-datastore-common';
import { describe, expect, it } from 'vitest';
import type { FieldProfile } from './field-profiling';
import { buildTokenIdf } from './nameSimilarity';
import {
  type MeasureUCorpusInput,
  type PoolEntry,
  RANDOM_PAIR_COUNT,
  drawPairs,
  measureU,
} from './uEstimation';

function profile(overrides: Partial<FieldProfile> = {}): FieldProfile {
  return {
    field: 'field',
    rowCount: 100,
    distinctCount: 50,
    rowCoverage: 1,
    cardinalityRatio: 0.5,
    looksEnumLike: false,
    isIdentifierLike: false,
    dominantValueType: 'uuid',
    valueContainer: 'scalar',
    valueTypeDistribution: {},
    valueCounts: {},
    ...overrides,
  };
}

// Slug-shaped (non-null under classifyRelationshipCandidateValue) so these
// values count as "eligible" for the local containment math, independent of
// whatever `dominantValueType` a fixture sets on the profile itself.
function valueCounts(labels: string[]): Record<string, number> {
  return Object.fromEntries(labels.map(label => [label, 1]));
}

function slugValues(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

function buildIdf(corpora: MeasureUCorpusInput[]): Map<string, number> {
  return buildTokenIdf({
    fieldPathsByDatasource: Object.fromEntries(
      corpora.map(corpus => [
        corpus.datasourceId,
        Object.keys(corpus.profilesByField),
      ]),
    ),
    containerNamesByDatasourceId: Object.fromEntries(
      corpora
        .filter(corpus => corpus.containerName !== undefined)
        .map(corpus => [corpus.datasourceId, corpus.containerName as string]),
    ),
  });
}

function buildMixedCorpora(): MeasureUCorpusInput[] {
  return [
    {
      datasourceId: 'ds-1',
      containerName: 'users',
      profilesByField: {
        '$.id': profile({
          field: '$.id',
          dominantValueType: 'uuid',
          valueCounts: valueCounts(slugValues('a', 20)),
        }),
        '$.email': profile({
          field: '$.email',
          dominantValueType: 'email',
          valueCounts: valueCounts(slugValues('b', 20)),
        }),
      },
    },
    {
      datasourceId: 'ds-2',
      containerName: 'accounts',
      profilesByField: {
        '$.ownerId': profile({
          field: '$.ownerId',
          dominantValueType: 'uuid',
          valueCounts: valueCounts(slugValues('a', 15)),
        }),
        '$.name': profile({
          field: '$.name',
          dominantValueType: 'other',
          valueCounts: valueCounts(slugValues('c', 15)),
        }),
      },
    },
    {
      datasourceId: 'ds-3',
      containerName: 'teams',
      profilesByField: {
        '$.leadId': profile({
          field: '$.leadId',
          dominantValueType: 'uuid',
          valueCounts: valueCounts(slugValues('a', 10)),
        }),
      },
    },
  ];
}

function renameDatasources(
  corpora: MeasureUCorpusInput[],
  prefix: string,
): MeasureUCorpusInput[] {
  return corpora.map((corpus, index) => ({
    ...corpus,
    datasourceId: `${prefix}-${index}`,
  }));
}

describe('measureU', () => {
  it('is deterministic: identical corpora produce an identical Map across calls', () => {
    const corpora = buildMixedCorpora();
    const idf = buildIdf(corpora);

    const first = measureU({ corpora, idf });
    const second = measureU({ corpora, idf });

    expect(first.size).toBeGreaterThan(0);
    expect([...second]).toEqual([...first]);
  });

  it('is order-independent: original, reversed, and shuffled corpora order produce an identical Map', () => {
    const corpora = buildMixedCorpora();
    const reversed = [...corpora].reverse();
    const shuffled = [corpora[1], corpora[2], corpora[0]];

    const original = measureU({ corpora, idf: buildIdf(corpora) });
    const fromReversed = measureU({
      corpora: reversed,
      idf: buildIdf(reversed),
    });
    const fromShuffled = measureU({
      corpora: shuffled,
      idf: buildIdf(shuffled),
    });

    expect(original.size).toBeGreaterThan(0);
    expect([...fromReversed]).toEqual([...original]);
    expect([...fromShuffled]).toEqual([...original]);
  });

  it('draws different pairs (and measures different u) for different datasource-id sets', () => {
    const base = buildMixedCorpora();
    const corporaA = renameDatasources(base, 'set-a');
    const corporaB = renameDatasources(base, 'set-b');

    const resultA = measureU({ corpora: corporaA, idf: buildIdf(corporaA) });
    const resultB = measureU({ corpora: corporaB, idf: buildIdf(corporaB) });

    expect([...resultA]).not.toEqual([...resultB]);
  });

  it('measures type-agreement u = 1 for a uniformly same-typed pool', () => {
    const corpora: MeasureUCorpusInput[] = ['ds-1', 'ds-2', 'ds-3'].map(id => ({
      datasourceId: id,
      profilesByField: {
        '$.id': profile({
          field: '$.id',
          dominantValueType: 'uuid',
          valueCounts: valueCounts(slugValues(id, 5)),
        }),
      },
    }));

    const result = measureU({ corpora, idf: buildIdf(corpora) });

    // Every cross-datasource pair shares the same dominantValueType, so
    // type-agreement fires on every sampled pair regardless of which pairs
    // the PRNG happens to draw.
    expect(result.get('type-agreement')).toBe(1);
  });

  it('measures type-agreement u = 0 for a pool with no two datasources sharing a type', () => {
    const types: RelationshipSuggestionValueType[] = [
      'uuid',
      'email',
      'other',
      'handle',
    ];
    const corpora: MeasureUCorpusInput[] = types.map((type, index) => ({
      datasourceId: `ds-${index}`,
      profilesByField: {
        '$.field': profile({
          field: '$.field',
          dominantValueType: type,
          valueCounts: valueCounts(slugValues(`t${index}`, 5)),
        }),
      },
    }));

    const result = measureU({ corpora, idf: buildIdf(corpora) });

    // Every datasource has a distinct dominantValueType, so no
    // cross-datasource pair can ever match — deterministically 0 regardless
    // of which pairs get drawn.
    expect(result.get('type-agreement')).toBe(0);
  });

  it('never measures hierarchy-context, even when every pool field is parent-ish and would fire on every pair', () => {
    const corpora: MeasureUCorpusInput[] = ['ds-1', 'ds-2', 'ds-3'].map(id => ({
      datasourceId: id,
      profilesByField: {
        '$.parent_id': profile({
          field: '$.parent_id',
          dominantValueType: 'uuid',
          valueCounts: valueCounts(slugValues(id, 5)),
        }),
      },
    }));

    const result = measureU({ corpora, idf: buildIdf(corpora) });

    // Every sampled pair's dependent field is parent-ish, so hierarchy-context
    // would measure u = 1 here if it weren't skipped (fixedU) — the signal
    // must be entirely absent from the map, not merely under-measured, so
    // resolveU falls through to its seeded uSeed.
    expect(result.has('hierarchy-context')).toBe(false);
  });

  it('measures value-rarity and fan-out-sanity (both need a non-empty matched set)', () => {
    // Every datasource shares the same slug values on $.field, so random
    // cross-datasource pairs have a non-empty eligible intersection. Both
    // signals skip on an empty matched set, so before matchedValueCounts was
    // populated from the intersection they never recorded a u here.
    const shared = slugValues('shared', 6);
    const corpora: MeasureUCorpusInput[] = ['ds-1', 'ds-2', 'ds-3'].map(id => ({
      datasourceId: id,
      profilesByField: {
        '$.field': profile({
          field: '$.field',
          valueCounts: valueCounts(shared),
        }),
      },
    }));

    const result = measureU({ corpora, idf: buildIdf(corpora) });

    expect(result.has('value-rarity')).toBe(true);
    expect(result.has('fan-out-sanity')).toBe(true);
  });

  it('returns an empty Map for fewer than two datasources', () => {
    const idf = new Map<string, number>();

    expect(measureU({ corpora: [], idf })).toEqual(new Map());
    expect(
      measureU({
        corpora: [
          { datasourceId: 'only', profilesByField: { '$.id': profile() } },
        ],
        idf,
      }),
    ).toEqual(new Map());
  });

  it('falls back to seeds (empty Map) for a degenerate low-diversity corpus', () => {
    // Two datasources with one field each yield only two distinct
    // cross-datasource field-pairs — below MIN_DISTINCT_SAMPLED_PAIRS — so each
    // signal's empirical u would be a coin-flip on one or two pairs. measureU
    // returns no entries and every signal falls back to its seeded uSeed.
    const corpora: MeasureUCorpusInput[] = [
      {
        datasourceId: 'ds-1',
        profilesByField: {
          '$.id': profile({
            field: '$.id',
            dominantValueType: 'uuid',
            valueCounts: valueCounts(slugValues('a', 5)),
          }),
        },
      },
      {
        datasourceId: 'ds-2',
        profilesByField: {
          '$.ownerId': profile({
            field: '$.ownerId',
            dominantValueType: 'uuid',
            valueCounts: valueCounts(slugValues('a', 5)),
          }),
        },
      },
    ];

    expect(measureU({ corpora, idf: buildIdf(corpora) })).toEqual(new Map());
  });

  it('is unaffected for a diverse corpus (still measures u)', () => {
    const corpora = buildMixedCorpora();

    const result = measureU({ corpora, idf: buildIdf(corpora) });

    // 16 distinct cross-datasource field-pairs is well above the floor, so the
    // guard never triggers and empirical u is measured as before.
    expect(result.size).toBeGreaterThan(0);
  });

  it('returns an empty Map when the pool is empty', () => {
    const corpora: MeasureUCorpusInput[] = [
      { datasourceId: 'ds-1', profilesByField: {} },
      { datasourceId: 'ds-2', profilesByField: {} },
    ];

    expect(measureU({ corpora, idf: new Map() })).toEqual(new Map());
  });
});

describe('drawPairs', () => {
  function entry(datasourceId: string, fieldPath: string): PoolEntry {
    return { datasourceId, fieldPath, profile: profile({ field: fieldPath }) };
  }

  function fakeSequence(values: number[]): () => number {
    let index = 0;
    return () => {
      const value = values[Number(index % values.length)];
      index += 1;
      return value;
    };
  }

  it('never draws a pair with both sides from the same datasource', () => {
    // Pool sorted lexically: [ds-a.f1, ds-a.f2, ds-b.f1, ds-b.f2] -> indices 0..3.
    const pool: PoolEntry[] = [
      entry('ds-a', 'f1'),
      entry('ds-a', 'f2'),
      entry('ds-b', 'f1'),
      entry('ds-b', 'f2'),
    ];
    // index = floor(v * 4): 0.1 -> 0, 0.6 -> 2, 0.9 -> 3, 0.3 -> 1.
    // First draw (0.1, 0.1) is same-datasource (ds-a, ds-a) and must be
    // rejected; (0.1, 0.6) is the accepted replacement. Same for the second.
    const random = fakeSequence([0.1, 0.1, 0.1, 0.6, 0.9, 0.9, 0.9, 0.3]);

    const pairs = drawPairs({ pool, random, count: 2 });

    expect(pairs).toEqual([
      { i: pool[0], j: pool[2] },
      { i: pool[3], j: pool[1] },
    ]);
    for (const pair of pairs) {
      expect(pair.i.datasourceId).not.toBe(pair.j.datasourceId);
    }
  });

  it('never draws a same-datasource pair across a larger deterministic sequence', () => {
    const pool: PoolEntry[] = [];
    for (let ds = 0; ds < 5; ds += 1) {
      for (let field = 0; field < 4; field += 1) {
        pool.push(entry(`ds-${ds}`, `field-${field}`));
      }
    }
    // Small deterministic LCG — not the production PRNG, just a
    // reproducible stream for exercising drawPairs's rejection loop.
    let state = 42;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };

    const pairs = drawPairs({ pool, random, count: RANDOM_PAIR_COUNT });

    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) {
      expect(pair.i.datasourceId).not.toBe(pair.j.datasourceId);
    }
  });

  it('caps attempts at 20x the requested count and returns fewer pairs when draws are scarce', () => {
    const pool: PoolEntry[] = [];
    for (let field = 0; field < 99; field += 1) {
      pool.push(entry('ds-dominant', `field-${field}`));
    }
    pool.push(entry('ds-rare', 'field-0'));

    let state = 7;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };

    const pairs = drawPairs({ pool, random, count: 50 });

    expect(pairs.length).toBeLessThan(50);
    for (const pair of pairs) {
      expect(pair.i.datasourceId).not.toBe(pair.j.datasourceId);
    }
  });

  it('returns no pairs for a pool with fewer than two entries', () => {
    expect(drawPairs({ pool: [], random: () => 0.5 })).toEqual([]);
    expect(
      drawPairs({ pool: [entry('ds-a', 'f1')], random: () => 0.5 }),
    ).toEqual([]);
  });
});
