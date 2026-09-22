import { describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { ObjectDao, RelationshipRuleDao } from '../../database';
import {
  applyWithPassthrough,
  buildSuggestions,
  conflictKeyFieldFor,
  capSuggestionsByUnorderedPair,
  groupSuggestionsByPair,
  matchedValueCountsOf,
  persistNewRules,
  RESCUE_ATTEMPT_CAP,
  type SuggestionResult,
} from './suggestRelationshipsService';
import type { TransformProgram } from './transformSynthesis';
import type { FieldMatch } from './stringFieldAnalysis';
import { SuggestionCorpusCache } from './suggestionCorpus';
import {
  IDENTITY_CALIBRATION,
  type ScoreCalibration,
} from './scoreCalibration';

// Wraps the real implementation with a spy (behavior is untouched — every
// other test in this file exercises the genuine enumeration) so the
// memoization test below can assert call counts without reaching into
// suggestRelationshipsService.ts's private cache.
vi.mock('./filteredRuleRefinement', async importOriginal => {
  const actual =
    await importOriginal<typeof import('./filteredRuleRefinement')>();
  return {
    ...actual,
    enumerateFilterRefinements: vi.fn(actual.enumerateFilterRefinements),
  };
});
import { enumerateFilterRefinements } from './filteredRuleRefinement';

// Same spy-wrapping pattern, for the composite-synthesis memoization test —
// synthesizeTransform stays genuine so plain-transform rescue is unaffected.
vi.mock('./transformSynthesis', async importOriginal => {
  const actual = await importOriginal<typeof import('./transformSynthesis')>();
  return {
    ...actual,
    synthesizeCompositeKey: vi.fn(actual.synthesizeCompositeKey),
  };
});
import { synthesizeCompositeKey } from './transformSynthesis';

function makeObjectDao(overrides: {
  sourceObjects?: unknown[];
  targetObjects?: Record<string, unknown[]>;
}) {
  const sourceObjects = overrides.sourceObjects ?? [];
  const targetObjects = new Map(Object.entries(overrides.targetObjects ?? {}));

  // Keyed by presence in `targetObjects` rather than a hardcoded 'source' id,
  // so the same helper works for any source datasource id (e.g. 'ds-1').
  const sample = vi.fn(async (datasourceId: string) => {
    const objects = targetObjects.has(datasourceId)
      ? targetObjects.get(datasourceId)!
      : sourceObjects;
    return {
      total: objects.length,
      items: objects.map((object, index) => ({
        id: `${datasourceId}-${index}`,
        datasourceId,
        objectId: `${datasourceId}-${index}`,
        object,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };
  });

  return {
    randomSample: sample,
    sampleForSuggestions: sample,
  } as unknown as ObjectDao;
}

/**
 * Finds a candidate by source/target field regardless of which side of the
 * gates→FS-scoring pipeline it landed on. Several tests below only care that
 * the search/discovery pipeline produced the pairing at all — whether it then
 * cleared the FS score's medium/high threshold is a separate, scoring-level
 * concern covered by the "FS scoring" describe block.
 */
function findCandidate(
  result: SuggestionResult,
  predicate: (s: FieldMatch) => boolean,
): FieldMatch | undefined {
  return [...result.suggestions, ...result.suppressedSuggestions].find(
    predicate,
  );
}

function makeFieldMatch(overrides: Partial<FieldMatch> = {}): FieldMatch {
  return {
    sourceField: '$.handle',
    targetDatasourceId: 'target',
    targetField: '$.login',
    matchCount: 1,
    sampleValues: ['alpha'],
    suggestionKind: 'identity',
    score: 0.85,
    confidenceBand: 'high',
    contributedBy: ['deterministic'],
    evidenceSummary: {
      valueTypes: ['handle'],
      distinctMatchedValueCount: 1,
      sourceFieldStats: {
        distinctCount: 1,
        rowCoverage: 1,
        cardinalityRatio: 1,
        looksEnumLike: false,
        isIdentifierLike: true,
      },
      targetFieldStats: {
        distinctCount: 1,
        rowCoverage: 1,
        cardinalityRatio: 1,
        looksEnumLike: false,
        isIdentifierLike: true,
      },
      commonValuePenalty: 0,
      topMatchedValues: ['alpha'],
      explanation: 'test',
    },
    ...overrides,
  };
}

describe('buildSuggestions', () => {
  it('returns deterministic suggestions from exact value overlap', async () => {
    const objectDao = makeObjectDao({
      sourceObjects: [
        { handle: 'alpha' },
        { handle: 'bravo' },
        { handle: 'charlie' },
      ],
      targetObjects: {
        target: [{ login: 'alpha' }, { login: 'bravo' }, { login: 'charlie' }],
      },
    });

    // No searchValues stub — the exact match must come from the target
    // sample itself via collectExactSearchResults.
    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const match = findCandidate(
      result,
      s => s.sourceField === '$.handle' && s.targetField === '$.login',
    );
    expect(match).toMatchObject({
      sourceField: '$.handle',
      targetField: '$.login',
      contributedBy: ['deterministic'],
    });
  });

  it('surfaces fuzzy handle matches when source and target values are near-duplicates', async () => {
    const objectDao = makeObjectDao({
      sourceObjects: [
        { handle: 'alpha' },
        { handle: 'bravo' },
        { handle: 'davidson' },
        { handle: 'martha' },
      ],
      targetObjects: {
        target: [
          { login: 'alphas' },
          { login: 'bravos' },
          { login: 'davidsen' },
          { login: 'marhta' },
        ],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const fuzzyMatch = findCandidate(
      result,
      s => s.sourceField === '$.handle' && s.targetField === '$.login',
    );
    expect(fuzzyMatch).toBeDefined();
    expect(fuzzyMatch?.evidenceSummary.explanation).toBeTruthy();
  });

  it('does not fuzzy-match uuid or email values', async () => {
    const objectDao = makeObjectDao({
      sourceObjects: [
        { id: '550e8400-e29b-41d4-a716-446655440000' },
        { email: 'alice@a.com' },
      ],
      targetObjects: {
        target: [
          { id: '550e8400-e29b-41d4-a716-446655440001' },
          { email: 'alice@b.com' },
        ],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    expect(result.suggestions).toEqual([]);
  });

  it('does not produce suggestions from exact or near-matching timestamp fields', async () => {
    const objectDao = makeObjectDao({
      sourceObjects: [
        { updated_at: '2026-04-28T12:44:14Z' },
        { updated_at: '2026-04-28T12:44:15Z' },
      ],
      targetObjects: {
        target: [
          { metadata: { creationTimestamp: '2026-04-28T12:44:14Z' } },
          { metadata: { creationTimestamp: '2026-04-28T12:44:16Z' } },
        ],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    expect(result.candidateValueCount).toBe(0);
    expect(result.suggestions).toEqual([]);
    expect(result.suppressedSuggestions).toEqual([]);
  });

  // The old scorer's fuzzy-discount ("fuzzy matches score lower than exact
  // matches") is retired — signalScoring.ts has no matchCount-shaped fuzzy
  // discount, and fuzzy vs. exact provenance isn't one of its 11 signals.
  // fuzzyMatchCount is still tracked on CandidateMatch (see
  // stringFieldAnalysis.test.ts) for evidence display, not scoring.

  it('matches source handles against target person-name aliases from prefetched target samples', async () => {
    const objectDao = makeObjectDao({
      sourceObjects: [
        { login: 'aanderson' },
        { login: 'bbuilder' },
        { login: 'carolcooper' },
      ],
      targetObjects: {
        target: [
          { name: 'Alice Anderson' },
          { name: 'Bob Builder' },
          { name: 'Carol Cooper' },
        ],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const match = findCandidate(
      result,
      s => s.sourceField === '$.login' && s.targetField === '$.name',
    );
    expect(match).toMatchObject({
      targetDatasourceId: 'target',
      matchStrategy: 'person_name_alias',
      sampleValues: expect.arrayContaining(['aanderson']),
    });
  });

  it('returns an empty result without a global fallback when given no targets', async () => {
    const objectDao = makeObjectDao({
      sourceObjects: [{ handle: 'alpha' }, { handle: 'bravo' }],
    });

    const result = await buildSuggestions(objectDao, 'source', []);

    expect(result).toMatchObject({
      total: 2,
      candidateValueCount: 2,
      searchResultCount: 0,
      suggestions: [],
      suppressedSuggestions: [],
    });
  });

  it('produces identical suggestions across consecutive calls with the same data', async () => {
    const objectDao = makeObjectDao({
      sourceObjects: [
        { handle: 'alpha' },
        { handle: 'bravo' },
        { handle: 'charlie' },
      ],
      targetObjects: {
        target: [{ login: 'alpha' }, { login: 'bravo' }, { login: 'charlie' }],
      },
    });

    const first = await buildSuggestions(objectDao, 'source', ['target']);
    const second = await buildSuggestions(objectDao, 'source', ['target']);

    expect(second.suggestions).toEqual(first.suggestions);
    expect(second.suppressedSuggestions).toEqual(first.suppressedSuggestions);
  });

  it('produces byte-identical output for the same corpora', async () => {
    const objectDao = makeObjectDao({
      sourceObjects: [
        { handle: 'alpha' },
        { handle: 'bravo' },
        { handle: 'charlie' },
      ],
      targetObjects: {
        'ds-2': [{ login: 'alpha' }, { login: 'bravo' }, { login: 'charlie' }],
      },
    });
    const run = () =>
      buildSuggestions(
        objectDao,
        'ds-1',
        ['ds-2'],
        new SuggestionCorpusCache(objectDao),
      );

    expect(JSON.stringify(await run())).toEqual(JSON.stringify(await run()));
  });
});

describe('buildSuggestions — gate wiring', () => {
  // Mirrors the fixture shape used in candidateGates.test.ts so the
  // containment math lines up with what that suite already proves in
  // isolation.
  function eligibleHandles(count: number, prefix = 'handle'): string[] {
    return Array.from({ length: count }, (_, i) => `${prefix}${i}alpha`);
  }

  it('attaches passing gate evidence with containment >= 0.85 for a fully-overlapping key-like pair', async () => {
    const objectDao = makeObjectDao({
      sourceObjects: [
        { code: 'alpha' },
        { code: 'bravo' },
        { code: 'charlie' },
        { code: 'delta' },
        { code: 'echo' },
      ],
      targetObjects: {
        target: [
          { ref: 'alpha' },
          { ref: 'bravo' },
          { ref: 'charlie' },
          { ref: 'delta' },
          { ref: 'echo' },
        ],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    // Gate evidence is attached whether or not the candidate then clears the
    // FS score's medium/high threshold — that's a separate, scoring-level
    // concern (see the "FS scoring" describe block below).
    const match = findCandidate(
      result,
      s => s.sourceField === '$.code' && s.targetField === '$.ref',
    );
    expect(match).toBeDefined();
    expect(match!.evidenceSummary.gate).toBeDefined();
    expect(match!.evidenceSummary.gate!.containment).toBeGreaterThanOrEqual(
      0.85,
    );
    expect(match!.evidenceSummary.gate!.containmentDirection).toBe(
      'source-to-target',
    );
    expect(match!.evidenceSummary.gate!.containmentVerified).toBe(false);
    expect(
      match!.evidenceSummary.gate!.referencedCardinalityRatio,
    ).toBeGreaterThanOrEqual(0.95);
  });

  it('forms a suggestion from raw integer join keys on both sides (numeric_id)', async () => {
    // Non-dense values (not 1/2/3…) so cardinality math can't be confused
    // with a counter/index field; raw JSON numbers on both sides exercise the
    // target-side number-leaf walk in collectExactSearchResults end-to-end.
    const objectDao = makeObjectDao({
      sourceObjects: [{ user_id: 7001 }, { user_id: 8102 }, { user_id: 9433 }],
      targetObjects: {
        target: [{ id: 7001 }, { id: 8102 }, { id: 9433 }],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const match = findCandidate(
      result,
      s => s.sourceField === '$.user_id' && s.targetField === '$.id',
    );
    expect(match).toBeDefined();
    // numeric_id is now an identity-kind value type (both sides identifier-
    // like, high cardinality) — the canonical numeric-FK case this task
    // exists for.
    expect(match!.suggestionKind).toBe('identity');
    expect(match!.evidenceSummary.gate).toBeDefined();
    expect(match!.evidenceSummary.gate!.containment).toBeGreaterThanOrEqual(
      0.85,
    );
    expect(
      match!.evidenceSummary.gate!.referencedCardinalityRatio,
    ).toBeGreaterThanOrEqual(0.95);
  });

  it('suppresses a domain-trivial source field via the gate even though the scorer would pass it', async () => {
    const objectDao = makeObjectDao({
      sourceObjects: [
        ...Array.from({ length: 7 }, () => ({ tag: 'gold' })),
        ...Array.from({ length: 2 }, () => ({ tag: 'silver' })),
        { tag: 'bronze' },
      ],
      targetObjects: {
        target: [
          { label: 'gold' },
          { label: 'silver' },
          { label: 'bronze' },
          { label: 'ruby' },
          { label: 'sapphire' },
        ],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    expect(
      result.suggestions.find(
        s => s.sourceField === '$.tag' && s.targetField === '$.label',
      ),
    ).toBeUndefined();
    const suppressed = result.suppressedSuggestions.find(
      s => s.sourceField === '$.tag' && s.targetField === '$.label',
    );
    expect(suppressed).toBeDefined();
    expect(suppressed!.suppressionReason).toBe('trivial-domain');
    // The trivial-domain gate never measures containment/keyness — the gate
    // evidence must say so honestly (only rescueHint present) rather than
    // fabricating containment: 0 / containmentVerified: false.
    expect(suppressed!.evidenceSummary.gate).toEqual({
      rescueHint: 'try-filter',
    });
  });

  it('verifies a near-miss containment against the full target corpus via findValuesPresent', async () => {
    const sourceKeys = eligibleHandles(10);
    const overlapping = sourceKeys.slice(0, 6);
    const missingKeys = sourceKeys.slice(6);
    const targetOnlyNoise = eligibleHandles(4, 'noise');

    const sourceObjects = sourceKeys.map(v => ({ code: v }));
    const targetSampleObjects = [...overlapping, ...targetOnlyNoise].map(v => ({
      ref: v,
    }));

    const findValuesPresent = vi.fn(
      async (_datasourceId: string, _field: string, values: string[]) =>
        new Set(values),
    );
    const sample = vi.fn(async (datasourceId: string) => {
      const objects =
        datasourceId === 'target' ? targetSampleObjects : sourceObjects;
      return {
        // total > items.length for the target only — simulates a sample
        // drawn from a much larger corpus, which is what makes the gate's
        // staged verification kick in.
        total: datasourceId === 'target' ? 500 : objects.length,
        items: objects.map((object, index) => ({
          id: `${datasourceId}-${index}`,
          datasourceId,
          objectId: `${datasourceId}-${index}`,
          object,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
      };
    });
    const objectDao = {
      sampleForSuggestions: sample,
      findValuesPresent,
    } as unknown as ObjectDao;

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    expect(findValuesPresent).toHaveBeenCalledWith(
      'target',
      '$.ref',
      missingKeys.slice().sort(),
      undefined,
    );
    const match = findCandidate(
      result,
      s => s.sourceField === '$.code' && s.targetField === '$.ref',
    );
    expect(match).toBeDefined();
    expect(match!.evidenceSummary.gate!.containmentVerified).toBe(true);
    expect(match!.evidenceSummary.gate!.containment).toBeCloseTo(1);
  });

  it('suppresses an id↔id mirror pair via the gate as identity-mirror', async () => {
    const objectDao = makeObjectDao({
      sourceObjects: [{ id: 'aaa-bbb' }, { id: 'ccc-ddd' }, { id: 'eee-fff' }],
      targetObjects: {
        mirror: [{ id: 'aaa-bbb' }, { id: 'ccc-ddd' }, { id: 'eee-fff' }],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['mirror']);

    expect(
      result.suggestions.find(
        s => s.sourceField === '$.id' && s.targetField === '$.id',
      ),
    ).toBeUndefined();
    const suppressed = result.suppressedSuggestions.find(
      s => s.sourceField === '$.id' && s.targetField === '$.id',
    );
    expect(suppressed).toBeDefined();
    expect(suppressed!.suppressionReason).toBe('identity-mirror');
    // identity-mirror is an unconditional short-circuit — it measures
    // nothing, so the gate evidence must be an empty (but present) object,
    // not a fabricated containment: 0 / containmentVerified: false.
    expect(suppressed!.evidenceSummary.gate).toEqual({});
  });

  it('orders gate-suppressed entries before score-suppressed ones in suppressedSuggestions', async () => {
    // Two independent field pairs in one run: id<->id is an unconditional
    // gate rejection (identity-mirror). code<->ref passes every gate (full
    // containment, key-like referenced side) but carries no name/semantic
    // support in this tiny two-field corpus, so it lands below the FS
    // scorer's medium threshold — a gate survivor the scorer then suppresses,
    // the only way to get one of each kind out of the same result (a
    // gate-suppressed candidate is never scored at all).
    const objectDao = makeObjectDao({
      sourceObjects: [
        { id: 'aaa', code: 'alpha' },
        { id: 'bbb', code: 'bravo' },
        { id: 'ccc', code: 'charlie' },
        { id: 'ddd', code: 'delta' },
        { id: 'eee', code: 'echo' },
      ],
      targetObjects: {
        target: [
          { id: 'aaa', ref: 'alpha' },
          { id: 'bbb', ref: 'bravo' },
          { id: 'ccc', ref: 'charlie' },
          { id: 'ddd', ref: 'delta' },
          { id: 'eee', ref: 'echo' },
        ],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const gateSuppressed = result.suppressedSuggestions.find(
      s => s.sourceField === '$.id' && s.targetField === '$.id',
    );
    const scoreSuppressed = result.suppressedSuggestions.find(
      s => s.sourceField === '$.code' && s.targetField === '$.ref',
    );
    expect(gateSuppressed?.suppressionReason).toBe('identity-mirror');
    expect(gateSuppressed?.evidenceSummary.waterfall).toBeUndefined();
    expect(scoreSuppressed?.suppressionReason).toBe('score-below-threshold');
    expect(scoreSuppressed?.evidenceSummary.waterfall).toBeDefined();

    const gateIndex = result.suppressedSuggestions.indexOf(gateSuppressed!);
    const scoreIndex = result.suppressedSuggestions.indexOf(scoreSuppressed!);
    expect(gateIndex).toBeLessThan(scoreIndex);
  });

  it('resolves flip-corrected profiles for a reversed array_contains candidate and survives the gates', async () => {
    // buildFieldMatchSuggestions reverses this pairing because the run's
    // source field (issues.$.follower_ids) is array-valued and the matched
    // target field (users.$.id) is scalar: the emitted suggestion reads
    // users.$.id -> issues.$.follower_ids, with sourceDatasourceId ('users')
    // disagreeing with the run's own source id ('issues'). Every follower id
    // appears in some issue's follower_ids, so the pair should fully survive
    // the gates once the profile lookup follows the reversal.
    const users = ['user1', 'user2', 'user3', 'user4', 'user5', 'user6'].map(
      id => ({ id }),
    );
    const issues = [
      { follower_ids: ['user1', 'user2', 'user3'] },
      { follower_ids: ['user3', 'user4', 'user5'] },
      { follower_ids: ['user5', 'user6'] },
    ];
    const objectDao = makeObjectDao({
      sourceObjects: issues,
      targetObjects: { users },
    });

    const result = await buildSuggestions(objectDao, 'issues', ['users']);

    // Gates are what this test is about — whether the pair then clears the
    // FS score's medium/high threshold is a separate, scoring-level concern.
    const match = findCandidate(
      result,
      s => s.sourceField === '$.id' && s.targetField === '$.follower_ids',
    );
    expect(match).toBeDefined();
    expect(match).toMatchObject({
      sourceDatasourceId: 'users',
      targetDatasourceId: 'issues',
      matchStrategy: 'array_contains',
    });
    expect(match!.evidenceSummary.gate).toBeDefined();
    expect(match!.evidenceSummary.gate!.containment).toBeCloseTo(1);
    expect(match!.evidenceSummary.gate!.containmentDirection).toBe(
      'source-to-target',
    );
    expect(match!.evidenceSummary.gate!.containmentVerified).toBe(false);
    expect(
      match!.evidenceSummary.gate!.referencedCardinalityRatio,
    ).toBeGreaterThanOrEqual(0.95);
  });
});

describe('buildSuggestions — resolve wiring', () => {
  function decoysFor(index: number, side: 'source' | 'target') {
    // Mirrors the FS-scoring suite's withIndexedDecoys below: gives measureU
    // a non-degenerate cross-field pool so the ownerId<->refId candidate
    // isn't scored against a corpus with only one signal-bearing field —
    // without this diversity the pair lands 'low' (score-suppressed) instead
    // of surviving into a genuine resolve conflict.
    return side === 'source'
      ? {
          decoyStatus: index % 3 === 0 ? 'active' : 'inactive',
          decoyNote: uuidv4(),
          decoyEmail: `user${index}@example.com`,
          decoySlug: `item-${index}-alpha`,
        }
      : {
          decoyState: index % 3 === 0 ? 'open' : 'closed',
          decoyRef: uuidv4(),
          decoyEmail2: `person${index}@example.org`,
          decoySlug2: `record-${index}-beta`,
        };
  }

  it('collapses co-linear redundant fields to one representative through the real pipeline', async () => {
    const ids = Array.from({ length: 40 }, (_unused, i) => i);
    // The same repos on both sides (a subset/duplicate datasource): three
    // handle-typed identifier fields, each a perfect 1:1 key over the same
    // objects, so all three produce the identical edge set. Handle-typed (not
    // URL/'other') so the joins clear the FS band under measured u and reach
    // the collapse pass — the real GitHub case surfaces via its typed id/name
    // fields the same way, with the *_url fields collapsing into them. Decoys
    // differ per side so measureU stays non-degenerate without themselves
    // becoming perfect keys.
    const keyFieldsFor = (i: number) => ({
      apiRef: `apihandle${i}xyz`,
      cloneRef: `clonehandle${i}xyz`,
      webRef: `webhandle${i}xyz`,
    });
    const objectDao = makeObjectDao({
      sourceObjects: ids.map(i => ({
        ...keyFieldsFor(i),
        ...decoysFor(i, 'source'),
      })),
      targetObjects: {
        target: ids.map(i => ({
          ...keyFieldsFor(i),
          ...decoysFor(i, 'target'),
        })),
      },
    });

    const result = await buildSuggestions(
      objectDao,
      'source',
      ['target'],
      undefined,
      {
        target: 'platform-repos',
      },
    );

    const keyFields = ['$.apiRef', '$.cloneRef', '$.webRef'];
    const isSelfKeyJoin = (s: FieldMatch) =>
      keyFields.includes(s.sourceField) && s.sourceField === s.targetField;

    const keptKey = result.suggestions.filter(isSelfKeyJoin);
    const redundant = result.suppressedSuggestions.filter(
      s => s.suppressionReason === 'redundant-field' && isSelfKeyJoin(s),
    );

    // All three self-joins are discovered; exactly one survives as the kept
    // representative and the other two are suppressed as redundant.
    expect(keptKey).toHaveLength(1);
    expect(redundant).toHaveLength(2);
    expect(keptKey.length + redundant.length).toBe(3);

    // The suppressed carry an explanation naming the kept representative and
    // keep their score/band untouched — genuine survivors, not weak matches.
    for (const suppressed of redundant) {
      expect(suppressed.evidenceSummary.explanation).toContain(
        `redundant: same edge set as ${keptKey[0].sourceField}`,
      );
      expect(suppressed.score).toBeGreaterThan(0);
      expect(suppressed.confidenceBand).toBeDefined();
    }
  });

  it('suppresses a candidate whose entire match is one shared literal (insufficient-match-support)', async () => {
    // Live junk shape: repo `topics` arrays vs namespace `finalizers` arrays
    // whose only value anywhere is the literal "kubernetes". Containment hits
    // 1.0 target-to-source on that single value, keyness only tests the
    // referenced side — the min-support gate is what stops it.
    const objectDao = makeObjectDao({
      sourceObjects: Array.from({ length: 20 }, (_unused, i) => ({
        topics: ['kubernetes', `topic-${i}-alpha`],
        ...decoysFor(i, 'source'),
      })),
      targetObjects: {
        namespaces: Array.from({ length: 10 }, (_unused, i) => ({
          finalizers: ['kubernetes'],
          ...decoysFor(i, 'target'),
        })),
      },
    });

    const result = await buildSuggestions(
      objectDao,
      'source',
      ['namespaces'],
      undefined,
      { namespaces: 'Namespaces' },
    );

    const junk = findCandidate(
      result,
      s => s.sourceField === '$.topics' && s.targetField === '$.finalizers',
    );
    // The pairing is discovered but must not survive as a suggestion.
    expect(junk).toBeDefined();
    expect(junk?.suppressionReason).toBe('insufficient-match-support');
    expect(
      result.suggestions.some(
        s => s.sourceField === '$.topics' && s.targetField === '$.finalizers',
      ),
    ).toBe(false);
  });

  it('does not gate-drop a person_name→alias join: honest coverage counts source names', async () => {
    // Regression: the accumulator records the matched ALIAS token (`aanderson`),
    // which the source profile never stores (it holds `Alice Anderson`), so a
    // literal intersect collapsed coverage to 0 and dropped the join as
    // containment-below-threshold / insufficient-match-support. Mapping matched
    // tokens back to canonical source names restores honest coverage.
    const first = [
      'Alice',
      'Bob',
      'Carol',
      'David',
      'Erin',
      'Frank',
      'Grace',
      'Heidi',
      'Ivan',
      'Judy',
      'Karl',
      'Liam',
    ];
    const last = [
      'Anderson',
      'Brown',
      'Clark',
      'Davis',
      'Evans',
      'Ford',
      'Green',
      'Hall',
      'Irwin',
      'Jones',
      'King',
      'Lee',
    ];
    const people = first.map((f, i) => ({
      full: `${f} ${last[i]}`,
      alias: `${f[0]!.toLowerCase()}${last[i]!.toLowerCase()}`,
    }));
    const objectDao = makeObjectDao({
      sourceObjects: people.map((p, i) => ({
        owner: p.full,
        decoy: `sdecoy${i}zz`,
      })),
      targetObjects: {
        target: people.map((p, i) => ({
          author: p.alias,
          decoy: `tdecoy${i}zz`,
        })),
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);
    const aliasJoin = [
      ...result.suggestions,
      ...result.suppressedSuggestions,
    ].find(s => s.sourceField === '$.owner' && s.targetField === '$.author');

    expect(aliasJoin?.matchStrategy).toBe('person_name_alias');
    // The gates no longer drop it: containment is the honest source-name
    // coverage (all 12 people matched → 1.0), not the collapsed-to-0 the alias
    // tokens produced.
    expect(aliasJoin?.suppressionReason).not.toBe(
      'containment-below-threshold',
    );
    expect(aliasJoin?.suppressionReason).not.toBe('insufficient-match-support');
    expect(aliasJoin?.evidenceSummary.gate?.containment).toBeGreaterThan(0.85);
  });

  it('does not remap a genuine handle value to a person-name alias from a sibling field', async () => {
    // Regression: the canonical-alias table must be scoped per field. `aanderson`
    // is an ALIAS of `Alice Anderson` on the name field, but a GENUINE value on
    // the handle field. A datasource-wide table rewrites the real handle to the
    // person name (absent from the handle's domain), collapsing coverage and
    // gate-dropping a real identifier join. Field-scoping keeps the handle join
    // honest while the name→alias join still works off the name field.
    const first = [
      'Alice',
      'Bob',
      'Carol',
      'David',
      'Erin',
      'Frank',
      'Grace',
      'Heidi',
      'Ivan',
      'Judy',
      'Karl',
      'Liam',
    ];
    const last = [
      'Anderson',
      'Brown',
      'Clark',
      'Davis',
      'Evans',
      'Ford',
      'Green',
      'Hall',
      'Irwin',
      'Jones',
      'King',
      'Lee',
    ];
    const people = first.map((f, i) => ({
      full: `${f} ${last[i]}`,
      handle: `${f[0]!.toLowerCase()}${last[i]!.toLowerCase()}`,
    }));
    const objectDao = makeObjectDao({
      sourceObjects: people.map((p, i) => ({
        name: p.full,
        handle: p.handle,
        decoy: `sdecoy${i}zz`,
      })),
      targetObjects: {
        target: people.map((p, i) => ({
          login: p.handle,
          decoy: `tdecoy${i}zz`,
        })),
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);
    const handleJoin = [
      ...result.suggestions,
      ...result.suppressedSuggestions,
    ].find(s => s.sourceField === '$.handle' && s.targetField === '$.login');

    // The genuine handle→login literal join survives: its matched tokens are
    // real handle values, not remapped to person names off the sibling field.
    expect(handleJoin).toBeDefined();
    expect(handleJoin?.suppressionReason).not.toBe(
      'containment-below-threshold',
    );
    expect(handleJoin?.suppressionReason).not.toBe(
      'insufficient-match-support',
    );
    expect(handleJoin?.evidenceSummary.gate?.containment).toBeGreaterThan(0.85);
  });

  it('keeps a redundant pair alive via a sibling field when its best field loses a cross-target conflict', async () => {
    // Regression for collapse ordering: `alpha` (codepoint-smallest, so the
    // collapse representative) is a perfect key into BOTH targets, `beta` only
    // into `duplicate`. `canonical` wins the alpha conflict (smaller id). If
    // collapse ran before resolve it would drop `duplicate`'s `beta` as
    // redundant, then resolve would drop `duplicate`'s `alpha` — erasing the
    // whole source→duplicate relationship. Running collapse after resolve keeps
    // `duplicate` alive via `beta`.
    const ids = Array.from({ length: 40 }, (_unused, i) => i);
    const objectDao = makeObjectDao({
      sourceObjects: ids.map(i => ({
        alpha: `alpha-${i}`,
        beta: `beta-${i}`,
        ...decoysFor(i, 'source'),
      })),
      targetObjects: {
        canonical: ids.map(i => ({
          alpha: `alpha-${i}`,
          ...decoysFor(i, 'target'),
        })),
        duplicate: ids.map(i => ({
          alpha: `alpha-${i}`,
          beta: `beta-${i}`,
          ...decoysFor(i, 'target'),
        })),
      },
    });

    const result = await buildSuggestions(
      objectDao,
      'source',
      ['canonical', 'duplicate'],
      undefined,
      { canonical: 'Canonical', duplicate: 'Duplicate' },
    );

    // The source→duplicate relationship survives — via beta, not the lost alpha.
    const duplicateKept = result.suggestions.filter(
      s => s.targetDatasourceId === 'duplicate',
    );
    expect(duplicateKept).toHaveLength(1);
    expect(duplicateKept[0].sourceField).toBe('$.beta');

    // alpha went to canonical; duplicate's alpha lost the cross-target conflict.
    const canonicalAlpha = result.suggestions.find(
      s => s.targetDatasourceId === 'canonical' && s.sourceField === '$.alpha',
    );
    expect(canonicalAlpha).toBeDefined();
    const duplicateAlpha = result.suppressedSuggestions.find(
      s => s.targetDatasourceId === 'duplicate' && s.sourceField === '$.alpha',
    );
    expect(duplicateAlpha?.suppressionReason).toBe('lost-conflict-resolution');
  });

  it('resolves a conflict between two target datasources sharing one dependent field through the real pipeline', async () => {
    const ids = Array.from({ length: 40 }, () => uuidv4());
    // target-a and target-b are the SAME object array under two different
    // datasource ids — a byte-identical corpus on both sides of the
    // candidate, so their FS scores are guaranteed to tie and
    // resolveSuggestions' documented tie-break (smaller targetDatasourceId
    // wins) picks target-a deterministically, rather than this test
    // depending on the scorer's internals.
    const targetCore = ids.map((value, index) => ({
      refId: value,
      ...decoysFor(index, 'target'),
    }));
    const objectDao = makeObjectDao({
      sourceObjects: ids.map((value, index) => ({
        ownerId: value,
        ...decoysFor(index, 'source'),
      })),
      targetObjects: { 'target-a': targetCore, 'target-b': targetCore },
    });

    const result = await buildSuggestions(
      objectDao,
      'source',
      ['target-a', 'target-b'],
      undefined,
      { 'target-a': 'owners', 'target-b': 'owners' },
    );

    const winner = result.suggestions.find(
      s => s.sourceField === '$.ownerId' && s.targetField === '$.refId',
    );
    expect(winner).toBeDefined();
    expect(winner?.targetDatasourceId).toBe('target-a');
    expect(winner?.suppressionReason).toBeUndefined();
    expect(
      result.suggestions.some(s => s.targetDatasourceId === 'target-b'),
    ).toBe(false);

    const loser = result.suppressedSuggestions.find(
      s => s.sourceField === '$.ownerId' && s.targetDatasourceId === 'target-b',
    );
    expect(loser).toBeDefined();
    expect(loser?.suppressionReason).toBe('lost-conflict-resolution');
    // Score/band/waterfall are untouched by resolve — this was a genuine FS
    // survivor, not a weak match.
    expect(loser?.score).toBe(winner?.score);
    expect(loser?.confidenceBand).toBe(winner?.confidenceBand);
    expect(loser?.evidenceSummary.waterfall).toEqual(
      winner?.evidenceSummary.waterfall,
    );
    expect(loser?.evidenceSummary.explanation).toMatch(
      /^resolve: lost to target-a \$\.refId \(p=[\d.]+\) — /,
    );

    // The conflict loser must never reach persistence: feed the real
    // result.suggestions (post-resolve) into persistNewRules and confirm
    // only the winning pair is created.
    const findExistingRule = vi.fn(async () => undefined);
    const createRelationshipRule = vi.fn(async input => ({
      id: 'rule-1',
      ...input,
      state: 'suggested',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const ruleDao = {
      findExistingRule,
      createRelationshipRule,
      updateRelationshipRule: vi.fn(),
      listRelationshipRulesByDatasourceId: vi.fn(async () => []),
      updateRelationshipRuleState: vi.fn(),
    } as unknown as RelationshipRuleDao;

    const createdRules = await persistNewRules(
      ruleDao,
      [result],
      new Set(['source', 'target-a', 'target-b']),
    );

    expect(createdRules).toHaveLength(1);
    expect(createRelationshipRule).toHaveBeenCalledTimes(1);
    expect(createRelationshipRule.mock.calls[0][0]).toMatchObject({
      sourceDatasourceId: 'source',
      sourceFieldExpression: '$.ownerId',
      targetDatasourceId: 'target-a',
      targetFieldExpression: '$.refId',
    });
  });

  it('orders suppressedSuggestions as gate > rescued-score > resolve > score', async () => {
    const ids = Array.from({ length: 40 }, () => uuidv4());
    const commonValues = ['vip', 'gold', 'silver', 'bronze', 'elite'];

    // Every field below is carried on the SAME 40 rows on each side, so no
    // field's rowCoverage is diluted by another field's unrelated rows.
    const sourceObjects = ids.map((value, index) => ({
      id: `mirror-${index}`,
      ownerId: value,
      tier: commonValues[index % commonValues.length],
      ...decoysFor(index, 'source'),
    }));
    const targetACore = ids.map((value, index) => ({
      id: `mirror-${index}`,
      refId: value,
      ...decoysFor(index, 'target'),
    }));
    const targetB = ids.map((value, index) => ({
      refId: value,
      ...decoysFor(index, 'target'),
    }));
    // Standalone target for the weak enum-vocabulary pair (archetype (c) in
    // the FS-scoring suite below): 5 common "tier" values repeated 8x each
    // (matching sourceObjects' cycle) surrounded by 960 unique singles, so
    // the pair passes every gate but lands 'low' on non-firing rarity/fan-out.
    const targetC = [
      ...commonValues.flatMap(v =>
        Array.from({ length: 8 }, () => ({ label: v })),
      ),
      ...Array.from({ length: 960 }, (_, i) => ({
        label: `uniq-${i}-${uuidv4()}`,
      })),
    ];

    const objectDao = makeObjectDao({
      sourceObjects,
      targetObjects: {
        'target-a': targetACore,
        'target-b': targetB,
        'target-c': targetC,
      },
    });

    const result = await buildSuggestions(
      objectDao,
      'source',
      ['target-a', 'target-b', 'target-c'],
      undefined,
      { 'target-a': 'owners', 'target-b': 'owners' },
    );

    const gateSuppressed = result.suppressedSuggestions.find(
      s => s.suppressionReason === 'identity-mirror',
    );
    const resolveSuppressed = result.suppressedSuggestions.find(
      s => s.suppressionReason === 'lost-conflict-resolution',
    );
    const scoreSuppressed = result.suppressedSuggestions.find(
      s => s.suppressionReason === 'score-below-threshold',
    );

    expect(gateSuppressed).toBeDefined();
    expect(resolveSuppressed).toBeDefined();
    expect(scoreSuppressed).toBeDefined();

    const gateIndex = result.suppressedSuggestions.indexOf(gateSuppressed!);
    const resolveIndex = result.suppressedSuggestions.indexOf(
      resolveSuppressed!,
    );
    const scoreIndex = result.suppressedSuggestions.indexOf(scoreSuppressed!);

    expect(gateIndex).toBeLessThan(resolveIndex);
    expect(resolveIndex).toBeLessThan(scoreIndex);
  });
});

describe('buildSuggestions — FS scoring', () => {
  function withIndexedDecoys(index: number, side: 'source' | 'target') {
    // Present in every fixture below so measureU's random cross-datasource
    // pairs have a non-degenerate pool to sample: a corpus with exactly one
    // field per side makes every random pair the real signal-bearing one,
    // which pins measured u to whatever that single pair looks like instead
    // of a realistic base rate.
    return side === 'source'
      ? {
          decoyStatus: index % 3 === 0 ? 'active' : 'inactive',
          decoyNote: uuidv4(),
          decoyEmail: `user${index}@example.com`,
          decoySlug: `item-${index}-alpha`,
        }
      : {
          decoyState: index % 3 === 0 ? 'open' : 'closed',
          decoyRef: uuidv4(),
          decoyEmail2: `person${index}@example.org`,
          decoySlug2: `record-${index}-beta`,
        };
  }

  // (a) uuid FK: 40 matched uuids, containment 1.0, matching leaf tokens
  // (owner_id bridges to the "owners" container name plural), key-like
  // referenced side → band 'high'.
  it('archetype (a): uuid FK with matching name tokens and a key-like referenced side lands "high"', async () => {
    const ids = Array.from({ length: 40 }, () => uuidv4());
    const objectDao = makeObjectDao({
      sourceObjects: ids.map((value, index) => ({
        ownerId: value,
        ...withIndexedDecoys(index, 'source'),
      })),
      targetObjects: {
        target: ids.map((value, index) => ({
          id: value,
          ...withIndexedDecoys(index, 'target'),
        })),
      },
    });

    const result = await buildSuggestions(
      objectDao,
      'source',
      ['target'],
      undefined,
      { target: 'owners' },
    );

    const match = findCandidate(
      result,
      s => s.sourceField === '$.ownerId' && s.targetField === '$.id',
    );
    expect(match?.confidenceBand).toBe('high');
    expect(match?.suppressionReason).toBeUndefined();
  });

  // (b) Same shape, but both sides are the generic, semantics-free leaf "id"
  // (nested on the source side so it isn't the literal $.id<->$.id the gate's
  // identity-mirror short-circuit exists for) and a small, low-distinct-count
  // referenced side (distribution-agreement needs >= 20 distinct to
  // evaluate) — weaker evidence, but still at least 'medium'.
  it('archetype (b): generic id-only names with no distribution evidence still lands at least "medium"', async () => {
    const targetIds = Array.from({ length: 10 }, () => uuidv4());
    // Many-to-one: 30 dependent rows citing 10 distinct referenced ids, so
    // the dependent side's cardinality stays well under key-key-penalty's
    // 0.95 "both sides key-like" threshold.
    const sourceIds = Array.from({ length: 30 }, (_, i) => targetIds[i % 10]);
    const objectDao = makeObjectDao({
      sourceObjects: sourceIds.map((value, index) => ({
        ref: { id: value },
        ...withIndexedDecoys(index, 'source'),
      })),
      targetObjects: {
        target: targetIds.map((value, index) => ({
          ref: { id: value },
          ...withIndexedDecoys(index, 'target'),
        })),
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const match = findCandidate(
      result,
      s => s.sourceField === '$.ref.id' && s.targetField === '$.ref.id',
    );
    expect(
      match?.evidenceSummary.waterfall?.some(
        e => e.signal === 'distribution-agreement',
      ),
    ).toBe(false);
    expect(['medium', 'high']).toContain(match?.confidenceBand);
  });

  // (c) Enum-vocabulary overlap constructed to pass every gate (5 distinct
  // shared "tier" values, full containment, referenced side key-like at
  // ~0.965) but where the 5 shared values are each common in the referenced
  // corpus (repeated 8x, vs. 960 singleton rows around them) — value-rarity
  // doesn't fire and fan-out-sanity does. The resulting suppression is
  // over-determined (p≈0.00): non-firing type-agreement contributes the
  // largest single penalty (-4.3, because the singleton rows pull the
  // referenced side's dominant type away from the shared "tier" values'),
  // with fan-out (-2.3) and rarity (-1.8) also contributing — not "rarity +
  // fan-out push it below the threshold" on their own.
  it('archetype (c): common enum-vocabulary overlap passes gates but is suppressed score-below-threshold', async () => {
    const commonValues = ['vip', 'gold', 'silver', 'bronze', 'elite'];
    const sourceObjects = commonValues.flatMap(v => [{ tier: v }, { tier: v }]);
    const repeated = commonValues.flatMap(v =>
      Array.from({ length: 8 }, () => ({ label: v })),
    );
    const singles = Array.from({ length: 960 }, (_, i) => ({
      label: `uniq-${i}-${uuidv4()}`,
    }));
    const objectDao = makeObjectDao({
      sourceObjects,
      targetObjects: { target: [...repeated, ...singles] },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const match = findCandidate(
      result,
      s => s.sourceField === '$.tier' && s.targetField === '$.label',
    );
    expect(match?.evidenceSummary.gate?.containment).toBeGreaterThanOrEqual(
      0.85,
    );
    expect(
      match?.evidenceSummary.gate?.referencedCardinalityRatio,
    ).toBeGreaterThanOrEqual(0.95);
    expect(match?.suppressionReason).toBe('score-below-threshold');
    expect(match?.confidenceBand).toBe('low');
    const rarityEntry = match?.evidenceSummary.waterfall?.find(
      e => e.signal === 'value-rarity',
    );
    const fanOutEntry = match?.evidenceSummary.waterfall?.find(
      e => e.signal === 'fan-out-sanity',
    );
    // Value-rarity is the driver here: common enum values, so it doesn't fire
    // and carries a negative weight. Fan-out does NOT fire — the honest edge
    // estimate (dependent 2 × referenced 8 over 5 values = 80) is well under
    // the 5-distinct threshold (250); only the buggy referenced-squared
    // estimate ever tripped it on this modest enum overlap.
    expect(rarityEntry).toMatchObject({ fired: false });
    expect(rarityEntry!.weight).toBeLessThan(0);
    expect(fanOutEntry).toMatchObject({ fired: false });
  });

  it('waterfall presence: gate survivors carry a waterfall (prior first); gate-suppressed candidates carry none', async () => {
    const ids = Array.from({ length: 40 }, () => uuidv4());
    const objectDao = makeObjectDao({
      sourceObjects: [
        ...ids.map((value, index) => ({
          ownerId: value,
          ...withIndexedDecoys(index, 'source'),
        })),
        { id: 'aaa-bbb' },
      ],
      targetObjects: {
        target: [
          ...ids.map((value, index) => ({
            id: value,
            ...withIndexedDecoys(index, 'target'),
          })),
          { id: 'aaa-bbb' },
        ],
      },
    });

    const result = await buildSuggestions(
      objectDao,
      'source',
      ['target'],
      undefined,
      { target: 'owners' },
    );

    const survivor = findCandidate(
      result,
      s => s.sourceField === '$.ownerId' && s.targetField === '$.id',
    );
    expect(survivor?.evidenceSummary.waterfall?.[0]).toMatchObject({
      signal: 'prior',
      fired: true,
    });
    expect(survivor?.evidenceSummary.waterfall?.length).toBeGreaterThan(1);

    const gateSuppressed = result.suppressedSuggestions.find(
      s => s.sourceField === '$.id' && s.targetField === '$.id',
    );
    expect(gateSuppressed?.suppressionReason).toBe('identity-mirror');
    expect(gateSuppressed?.evidenceSummary.waterfall).toBeUndefined();

    // CandidateMatch's raw-evidence-only fields must never leak onto the
    // wire FieldMatch — valueCounts is a Map, which JSON.stringify silently
    // lies about (`{}`), and the rest belong inside evidenceSummary instead.
    const candidateOnlyKeys = [
      'valueCounts',
      'valueTypes',
      'distinctMatchedValueCount',
      'fuzzyMatchCount',
      'sourceFieldSemantic',
      'targetFieldSemantic',
      'topMatchedValues',
    ];
    for (const key of candidateOnlyKeys) {
      expect(key in survivor!).toBe(false);
      expect(key in gateSuppressed!).toBe(false);
    }
  });

  it('direction swap: a target-to-source gate swaps dependent/referenced sides before scoring', async () => {
    // `tag` (source) has a large (50) distinct domain; `category` (target)
    // has a small (5) distinct domain that is a SUBSET of `tag`'s — so
    // containment is computed target-to-source (category's values are the
    // ones contained in tag), and the gate reports containmentDirection:
    // 'target-to-source'. Per the direction-swap contract, `category`
    // becomes the DEPENDENT side and `tag` the REFERENCED side for FS
    // scoring — observable two ways here (referencedSampleScale is covered
    // separately below, since its observable — fan-out-sanity firing — is
    // mutually exclusive with value-rarity firing, per the documented
    // "fan-out-sanity does not fire when value-rarity also fired"
    // cross-signal dependency):
    //  1. name-similarity's detail records the swapped dependent/referenced
    //     field order ($.category↔..., not $.tag↔...), with the container
    //     name resolved from `datasourceNamesById['source']` (the
    //     REFERENCED side's own datasource after the swap), not `['target']`.
    //  2. value-rarity reads referencedValueCounts off `tag`'s profile (each
    //     shared value appears once there — rare, fires) rather than
    //     `category`'s own profile (each shared value appears 6 times —
    //     common, would NOT fire).
    // An unswapped implementation would get both backwards.
    const sharedValues = Array.from({ length: 5 }, (_, i) => `shared-${i}`);
    const sourceOnlyValues = Array.from(
      { length: 45 },
      (_, i) => `sourceonly-${i}`,
    );
    const objectDao = makeObjectDao({
      sourceObjects: [...sharedValues, ...sourceOnlyValues].map(value => ({
        tag: value,
      })),
      targetObjects: {
        target: sharedValues.flatMap(value =>
          Array.from({ length: 6 }, () => ({ category: value })),
        ),
      },
    });

    const result = await buildSuggestions(
      objectDao,
      'source',
      ['target'],
      undefined,
      { source: 'tags-catalog' },
    );

    const match = findCandidate(
      result,
      s => s.sourceField === '$.tag' && s.targetField === '$.category',
    );
    expect(match?.evidenceSummary.gate?.containmentDirection).toBe(
      'target-to-source',
    );
    const nameEntry = match?.evidenceSummary.waterfall?.find(
      e => e.signal === 'name-similarity',
    );
    expect(nameEntry?.detail).toBe('name $.category↔tags-catalog.$.tag');
    const rarityEntry = match?.evidenceSummary.waterfall?.find(
      e => e.signal === 'value-rarity',
    );
    expect(rarityEntry).toMatchObject({ fired: true });
  });

  it("direction swap: referencedSampleScale comes from the referenced side's own partial-sample scale", async () => {
    // Same target-to-source shape, but the 5 shared values are made common
    // (not rare) on the referenced (`tag`/source) side — each appears 3
    // times there, against 285 singleton rows, keeping the referenced side
    // key-like (290/300 ≈ 0.97 ≥ 0.95) while median-referenced-frequency
    // (3) is above value-rarity's <=2 threshold. That keeps value-rarity
    // from firing, so it can't suppress fan-out-sanity — letting
    // fan-out-sanity's own firing isolate the referencedSampleScale swap:
    // expected edges (5 values x 3 dependent-occurrences x 3
    // referenced-occurrences = 45) clears the fan-out threshold (250) only
    // once scaled by the REFERENCED side's (source's) own partial-sample
    // scale (3000 total / 300 sampled = 10x -> 450 > 250); the fully-sampled
    // target's scale (1x) would leave it at 45 <= 250.
    const sharedValues = Array.from({ length: 5 }, (_, i) => `shared-${i}`);
    const sourceOnlyValues = Array.from(
      { length: 285 },
      (_, i) => `sourceonly-${i}`,
    );
    const sourceObjects = sharedValues
      .flatMap(value => Array.from({ length: 3 }, () => ({ tag: value })))
      .concat(sourceOnlyValues.map(value => ({ tag: value })));
    const targetObjects = sharedValues.flatMap(value =>
      Array.from({ length: 3 }, () => ({ category: value })),
    );
    const sample = vi.fn(async (datasourceId: string) => {
      const objects = datasourceId === 'target' ? targetObjects : sourceObjects;
      return {
        // The source corpus is a partial sample of a much larger table
        // (3000 total, only 300 — sourceObjects.length — sampled: scale
        // 10x) — target is fully sampled (scale 1x).
        total: datasourceId === 'target' ? objects.length : 3000,
        items: objects.map((object, index) => ({
          id: `${datasourceId}-${index}`,
          datasourceId,
          objectId: `${datasourceId}-${index}`,
          object,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
      };
    });
    const objectDao = { sampleForSuggestions: sample } as unknown as ObjectDao;

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const match = findCandidate(
      result,
      s => s.sourceField === '$.tag' && s.targetField === '$.category',
    );
    expect(match?.evidenceSummary.gate?.containmentDirection).toBe(
      'target-to-source',
    );
    const rarityEntry = match?.evidenceSummary.waterfall?.find(
      e => e.signal === 'value-rarity',
    );
    expect(rarityEntry).toMatchObject({ fired: false });
    const fanOutEntry = match?.evidenceSummary.waterfall?.find(
      e => e.signal === 'fan-out-sanity',
    );
    expect(fanOutEntry).toMatchObject({ fired: true });
  });

  // Task 4: hierarchy-context signal + live childOf/parentOf verb inference.
  // hierarchy-context is `fixedU` (see signalScoring.ts) — measureU never
  // produces an entry for it, so its fired weight is always the seeded
  // log2(0.30/0.45) regardless of pool shape; no decoy-field gymnastics
  // needed to dodge a measured-u flip. 'other'-typed values (urn:-shaped)
  // keep both profiles
  // `isIdentifierLike: false`, which keeps `suggestionKind` at
  // 'relationship' rather than 'identity' — inferRelationshipType
  // short-circuits identity candidates to relatedTo/relatesTo regardless of
  // field name, so a uuid/handle/slug fixture (as archetype (a) uses) would
  // silently defeat this test.
  it('a parent_id -> id candidate infers childOf/parentOf and fires hierarchy-context with a negative weight', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `urn:node:${i}`);
    const objectDao = makeObjectDao({
      sourceObjects: ids.map(value => ({ parent_id: value })),
      targetObjects: {
        target: ids.map(value => ({ id: value })),
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const match = findCandidate(
      result,
      s => s.sourceField === '$.parent_id' && s.targetField === '$.id',
    );
    expect(match?.suppressionReason).not.toBe('identity-mirror');
    expect(match?.suggestionKind).toBe('relationship');
    expect(match?.relationshipType).toBe('childOf');
    expect(match?.reciprocalRelationshipType).toBe('parentOf');

    const hierarchyEntry = match?.evidenceSummary.waterfall?.find(
      e => e.signal === 'hierarchy-context',
    );
    expect(hierarchyEntry?.fired).toBe(true);
    expect(hierarchyEntry?.weight).toBe(-0.585); // log2(0.30/0.45), always the seed
  });

  // Task 4 (stage 7): calibration threads from buildSuggestions all the way
  // to fsScoreCandidate's sigmoid. Reuses archetype (a)'s fixture (uuid FK,
  // matching name tokens, key-like referenced side) since it is already an
  // established, deterministic 'high' — the ideal case to show a sharpening
  // calibration pushes an already-high score even higher.
  it('calibration: a sharpening calibration pushes score higher than identity, while the per-signal waterfall (raw, pre-calibration) stays identical', async () => {
    const ids = Array.from({ length: 40 }, () => uuidv4());
    const objectDao = makeObjectDao({
      sourceObjects: ids.map((value, index) => ({
        ownerId: value,
        ...withIndexedDecoys(index, 'source'),
      })),
      targetObjects: {
        target: ids.map((value, index) => ({
          id: value,
          ...withIndexedDecoys(index, 'target'),
        })),
      },
    });

    const noArgResult = await buildSuggestions(
      objectDao,
      'source',
      ['target'],
      undefined,
      { target: 'owners' },
    );
    // Explicit IDENTITY_CALIBRATION must be a byte-identical no-op vs.
    // omitting the argument — the regression guard the ~30+ pre-existing
    // callers in this file rely on.
    const identityResult = await buildSuggestions(
      objectDao,
      'source',
      ['target'],
      undefined,
      { target: 'owners' },
      IDENTITY_CALIBRATION,
    );
    expect(identityResult).toEqual(noArgResult);

    const sharpening: ScoreCalibration = { a: 1.5, b: 0.3, labelCount: 40 };
    const sharpenedResult = await buildSuggestions(
      objectDao,
      'source',
      ['target'],
      undefined,
      { target: 'owners' },
      sharpening,
    );

    const identityMatch = findCandidate(
      identityResult,
      s => s.sourceField === '$.ownerId' && s.targetField === '$.id',
    );
    const sharpenedMatch = findCandidate(
      sharpenedResult,
      s => s.sourceField === '$.ownerId' && s.targetField === '$.id',
    );
    expect(identityMatch?.confidenceBand).toBe('high');
    // Already saturated at 'high' under identity, so sharpening's expected
    // upward push has no band left to cross into — it still shows up as a
    // strictly higher probability, asserted below.
    expect(sharpenedMatch?.confidenceBand).toBe('high');

    // The waterfall's per-signal weights are computed before calibration is
    // applied (see fsScoreCandidate) — calibration must only move the final
    // aggregate score/band, never the decomposition.
    expect(sharpenedMatch?.evidenceSummary.waterfall).toEqual(
      identityMatch?.evidenceSummary.waterfall,
    );

    expect(sharpenedMatch?.score).toBeGreaterThan(identityMatch!.score);

    // Recompute the expected calibrated probability from the identity run's
    // own (uncalibrated) score via the documented public formula
    // (scoreCalibration.ts's applyCalibration + fsScoreCandidate's sigmoid),
    // to prove `calibration` reached fsScoreCandidate rather than merely
    // being accepted and silently dropped somewhere in between.
    const rawLogOdds = Math.log2(
      identityMatch!.score / (1 - identityMatch!.score),
    );
    const expectedEffectiveLogOdds =
      sharpening.a * rawLogOdds + sharpening.b / Math.LN2;
    const expectedScore = 1 / (1 + 2 ** -expectedEffectiveLogOdds);
    expect(sharpenedMatch!.score).toBeCloseTo(expectedScore, 3);
  });

  it('calibration: the zero-target-datasources branch accepts the param (identity and sharpening) without throwing', async () => {
    const objectDao = makeObjectDao({
      sourceObjects: [{ handle: 'alpha' }],
    });

    await expect(
      buildSuggestions(
        objectDao,
        'source',
        [],
        undefined,
        undefined,
        IDENTITY_CALIBRATION,
      ),
    ).resolves.toMatchObject({
      datasourceId: 'source',
      suggestions: [],
      suppressedSuggestions: [],
    });

    const sharpening: ScoreCalibration = { a: 1.5, b: 0.3, labelCount: 40 };
    await expect(
      buildSuggestions(
        objectDao,
        'source',
        [],
        undefined,
        undefined,
        sharpening,
      ),
    ).resolves.toMatchObject({
      datasourceId: 'source',
      suggestions: [],
      suppressedSuggestions: [],
    });
  });
});

describe('SuggestionCorpusCache', () => {
  it('samples each datasource once across a batch-shaped run', async () => {
    const objectDao = makeObjectDao({
      sourceObjects: [{ handle: 'alpha' }],
      targetObjects: {
        'target-a': [{ login: 'alpha' }],
        'target-b': [{ login: 'alpha' }],
      },
    });
    const cache = new SuggestionCorpusCache(objectDao);

    // A batch over {source, target-a, target-b} evaluates each datasource
    // against the other two; without the cache that is 9 samples, with it 3.
    await Promise.all([
      buildSuggestions(objectDao, 'source', ['target-a', 'target-b'], cache),
      buildSuggestions(objectDao, 'target-a', ['source', 'target-b'], cache),
      buildSuggestions(objectDao, 'target-b', ['source', 'target-a'], cache),
    ]);

    const sample = objectDao.sampleForSuggestions as unknown as ReturnType<
      typeof vi.fn
    >;
    expect(sample).toHaveBeenCalledTimes(3);
    expect(new Set(sample.mock.calls.map(call => call[0]))).toEqual(
      new Set(['source', 'target-a', 'target-b']),
    );
  });

  it('produces the same suggestions with and without a shared cache', async () => {
    const makeDao = () =>
      makeObjectDao({
        sourceObjects: [
          { handle: 'alpha' },
          { handle: 'bravo' },
          { handle: 'charlie' },
        ],
        targetObjects: {
          target: [
            { login: 'alpha' },
            { login: 'bravo' },
            { login: 'charlie' },
          ],
        },
      });

    const uncachedDao = makeDao();
    const cachedDao = makeDao();
    const uncached = await buildSuggestions(uncachedDao, 'source', ['target']);
    const cached = await buildSuggestions(
      cachedDao,
      'source',
      ['target'],
      new SuggestionCorpusCache(cachedDao),
    );

    expect(cached.suggestions).toEqual(uncached.suggestions);
    expect(cached.suppressedSuggestions).toEqual(
      uncached.suppressedSuggestions,
    );
  });
});

describe('capSuggestionsByUnorderedPair', () => {
  const makeResult = (
    datasourceId: string,
    suggestions: FieldMatch[],
  ): SuggestionResult => ({
    datasourceId,
    total: suggestions.length,
    candidateValueCount: 0,
    searchResultCount: 0,
    suggestions,
    suppressedSuggestions: [],
  });

  // 20 distinct-field suggestions from `source` to `target`, each a valid
  // per-direction survivor (resolve already capped each direction at 25).
  const directionOf = (
    source: string,
    target: string,
    count: number,
    scoreBase: number,
  ): FieldMatch[] =>
    Array.from({ length: count }, (_, i) =>
      makeFieldMatch({
        sourceDatasourceId: source,
        sourceField: `$.f${source}_${i}`,
        targetDatasourceId: target,
        targetField: `$.g${target}_${i}`,
        score: scoreBase - i * 0.001,
      }),
    );

  it('caps an unordered pair across both directions at PAIR_PERSIST_CAP', () => {
    // 20 a→b + 20 b→a = 40 for the unordered {a,b} pair — over the 25 cap.
    const capped = capSuggestionsByUnorderedPair([
      makeResult('a', directionOf('a', 'b', 20, 0.9)),
      makeResult('b', directionOf('b', 'a', 20, 0.8)),
    ]);

    const kept = capped.flatMap(r => r.suggestions);
    expect(kept).toHaveLength(25);
    const demoted = capped.flatMap(r =>
      r.suppressedSuggestions.filter(
        s => s.suppressionReason === 'over-pair-cap',
      ),
    );
    expect(demoted).toHaveLength(15);
    // The kept set is the highest-scored across BOTH directions: all 20 a→b
    // (0.9…) outrank b→a (0.8…), plus the top 5 b→a.
    expect(kept.filter(s => s.sourceDatasourceId === 'a')).toHaveLength(20);
    expect(kept.filter(s => s.sourceDatasourceId === 'b')).toHaveLength(5);
  });

  it('inserts over-pair-cap receipts ahead of the score-suppressed tail', () => {
    // The result already carries a score-suppressed receipt (the evictable
    // tail SchemaController slices with SUPPRESSED_RESPONSE_CAP). The demotions
    // must land before it, or the review loses them past the slice.
    const bDir = makeResult('b', directionOf('b', 'a', 20, 0.8));
    bDir.suppressedSuggestions = [
      makeFieldMatch({
        sourceField: '$.weak',
        targetDatasourceId: 'a',
        suppressionReason: 'score-below-threshold',
      }),
    ];
    const capped = capSuggestionsByUnorderedPair([
      makeResult('a', directionOf('a', 'b', 20, 0.9)),
      bDir,
    ]);

    const bResult = capped.find(r => r.datasourceId === 'b')!;
    const reasons = bResult.suppressedSuggestions.map(s => s.suppressionReason);
    const firstScore = reasons.indexOf('score-below-threshold');
    const firstCap = reasons.indexOf('over-pair-cap');
    expect(firstCap).toBeGreaterThanOrEqual(0);
    expect(firstCap).toBeLessThan(firstScore);
  });

  it('leaves a pair under the cap untouched (same array references)', () => {
    const results = [
      makeResult('a', directionOf('a', 'b', 10, 0.9)),
      makeResult('b', directionOf('b', 'a', 10, 0.8)),
    ];
    // 20 combined <= 25 → no-op, returns the same result objects.
    expect(capSuggestionsByUnorderedPair(results)).toBe(results);
  });
});

describe('groupSuggestionsByPair', () => {
  const makeResult = (
    datasourceId: string,
    suggestions: FieldMatch[],
  ): SuggestionResult => ({
    datasourceId,
    total: suggestions.length,
    candidateValueCount: 0,
    searchResultCount: 0,
    suggestions,
    suppressedSuggestions: [],
  });

  it('groups suggestions by unordered datasource pair', () => {
    const groups = groupSuggestionsByPair([
      makeResult('a', [
        makeFieldMatch({ targetDatasourceId: 'b' }),
        makeFieldMatch({
          sourceField: '$.owner',
          targetDatasourceId: 'c',
          targetField: '$.name',
        }),
      ]),
      makeResult('b', [
        makeFieldMatch({
          sourceField: '$.repo',
          targetDatasourceId: 'c',
          targetField: '$.slug',
        }),
      ]),
    ]);

    expect(groups.map(g => g.datasourceIds)).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
    expect(groups[0].suggestions).toHaveLength(1);
    expect(groups[0].suggestions[0]).toMatchObject({
      sourceDatasourceId: 'a',
      targetDatasourceId: 'b',
    });
  });

  it('keeps only the higher-scoring direction of a mirrored join', () => {
    const groups = groupSuggestionsByPair([
      makeResult('a', [
        makeFieldMatch({
          sourceField: '$.handle',
          targetDatasourceId: 'b',
          targetField: '$.login',
          score: 0.6,
        }),
      ]),
      makeResult('b', [
        makeFieldMatch({
          sourceField: '$.login',
          targetDatasourceId: 'a',
          targetField: '$.handle',
          score: 0.9,
        }),
      ]),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].suggestions).toHaveLength(1);
    expect(groups[0].suggestions[0]).toMatchObject({
      sourceDatasourceId: 'b',
      targetDatasourceId: 'a',
      score: 0.9,
    });
  });

  it('orders the pair by codepoint, not locale (uppercase before lowercase)', () => {
    // 'B' (0x42) sorts before 'a' (0x61) by codepoint, but a locale-aware
    // localeCompare('B','a') puts 'a' first — so this asserts the orientation
    // uses the deterministic codepoint comparator (no ICU/Node-version drift).
    const groups = groupSuggestionsByPair([
      makeResult('B', [makeFieldMatch({ targetDatasourceId: 'a' })]),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].datasourceIds).toEqual(['B', 'a']);
  });

  it('honours explicit sourceDatasourceId from direction-flipped suggestions', () => {
    const groups = groupSuggestionsByPair([
      makeResult('a', [
        // e.g. an array-contains flip: found while evaluating `a`, but the
        // canonical rule direction is b → a.
        makeFieldMatch({
          sourceDatasourceId: 'b',
          sourceField: '$.id',
          targetDatasourceId: 'a',
          targetField: '$.member_ids',
        }),
      ]),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].datasourceIds).toEqual(['a', 'b']);
    expect(groups[0].suggestions[0]).toMatchObject({
      sourceDatasourceId: 'b',
      targetDatasourceId: 'a',
    });
  });
});

describe('applyWithPassthrough — render/apply parity for a folded transform', () => {
  // A faithful stand-in for withFinalFold(stripSuffixProgram('-svc')): base
  // strip returns undefined when the literal is absent, the fold lowercases a
  // hit, and foldsResult marks that the rendered JSONata wraps its output in
  // $lowercase. This is exactly the program shape the parity bug lived in.
  const foldedStripSvc: TransformProgram = {
    name: 'strip-suffix:-svc+fold',
    renderExpression: fieldPath =>
      `$lowercase($substringBefore(${fieldPath}, '-svc'))`,
    apply: value => {
      const idx = value.indexOf('-svc');
      return idx === -1 ? undefined : value.slice(0, idx).toLowerCase();
    },
    foldsResult: true,
  };

  it('lowercases a pass-through value so it matches the deployed $lowercase rule, not the raw value', () => {
    // `queue-svc` has the literal (-> 'queue'); `MixedName` does not, so the
    // persisted `$lowercase($substringBefore('MixedName', '-svc'))` evaluates
    // to 'mixedname' (JSONata's $substringBefore returns the whole string when
    // the literal is absent). The internal apply must produce the SAME thing.
    const distribution = applyWithPassthrough(foldedStripSvc, {
      'queue-svc': 3,
      MixedName: 5,
    });

    expect(distribution).toEqual({ queue: 3, mixedname: 5 });
    // Crucially NOT the un-lowercased raw form the pre-fix `?? value` recorded.
    expect(distribution).not.toHaveProperty('MixedName');
  });

  it('does not over-report re-gate matches for a raw mixed-case value in the referenced set', () => {
    // The referenced set carries the RAW 'MixedName' — the shape that made the
    // pre-fix re-gate count it as a match the deployed lowercasing rule would
    // never reproduce.
    const distribution = applyWithPassthrough(foldedStripSvc, {
      'queue-svc': 3,
      MixedName: 5,
    });
    const referenced = new Set(['queue', 'MixedName']);

    const matched = matchedValueCountsOf(distribution, referenced);

    // Only 'queue' lands; 'mixedname' !== referenced 'MixedName'.
    expect(matched.size).toBe(1); // distinctMatchedValueCount
    expect([...matched.values()].reduce((a, b) => a + b, 0)).toBe(3); // matchCount
    expect(matched.has('MixedName')).toBe(false);
  });
});

describe('conflictKeyFieldFor', () => {
  // This is the pre-mapping buildSuggestionResultFromData applies to every
  // suggestion before the resolve pass — see resolveSuggestions.ts's
  // conflictKeyField. A genuine end-to-end fixture where a transform-rescued
  // candidate and a plain candidate both survive FS scoring and collide in
  // conflict resolution is disproportionate to engineer here (the rescue
  // archetype fixtures above already show how narrow the scoring window is);
  // this pins the mapping itself instead.
  it('returns evidenceSummary.rescue.originalField for a transform-rescued suggestion', () => {
    const rescued = makeFieldMatch({
      sourceField: "$substringBefore($.id, '-backstage')",
      evidenceSummary: {
        ...makeFieldMatch().evidenceSummary,
        rescue: {
          kind: 'transform',
          detail: 'strip-suffix:-backstage',
          originalField: '$.id',
        },
      },
    });

    expect(conflictKeyFieldFor(rescued)).toBe('$.id');
  });

  it('falls back to sourceField when there is no rescue evidence', () => {
    const plain = makeFieldMatch({ sourceField: '$.owner' });

    expect(conflictKeyFieldFor(plain)).toBe('$.owner');
  });

  it('falls back to sourceField for a filter-rescued suggestion (originalField is transform-only)', () => {
    const filterRescued = makeFieldMatch({
      sourceField: '$.id',
      evidenceSummary: {
        ...makeFieldMatch().evidenceSummary,
        rescue: {
          kind: 'filter',
          detail: "$.kind = 'Deployment'",
        },
      },
    });

    expect(conflictKeyFieldFor(filterRescued)).toBe('$.id');
  });
});

describe('persistNewRules', () => {
  function makeRuleDao() {
    const findExistingRule = vi.fn(async () => undefined);
    const createRelationshipRule = vi.fn(async input => ({
      id: 'rule-1',
      ...input,
      state: 'suggested',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const updateRelationshipRule = vi.fn(async (id, input) => ({
      id,
      ...input,
      state: 'suggested',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const listRelationshipRulesByDatasourceId = vi.fn(async () => []);
    const updateRelationshipRuleState = vi.fn(async (id, state, opts) => ({
      id,
      state,
      reviewReason: opts?.reviewReason ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    return {
      findExistingRule,
      createRelationshipRule,
      updateRelationshipRule,
      listRelationshipRulesByDatasourceId,
      updateRelationshipRuleState,
    } as unknown as RelationshipRuleDao;
  }

  async function persistSuggestion(suggestion: FieldMatch) {
    const ruleDao = makeRuleDao();
    const activeDatasourceIds = new Set([
      'source',
      'target',
      suggestion.sourceDatasourceId ?? 'source',
      suggestion.targetDatasourceId,
    ]);
    await persistNewRules(
      ruleDao,
      [
        {
          datasourceId: 'source',
          total: 1,
          candidateValueCount: 1,
          searchResultCount: 1,
          suggestions: [suggestion],
          suppressedSuggestions: [],
        },
      ],
      activeDatasourceIds,
    );
    return ruleDao.createRelationshipRule as unknown as ReturnType<
      typeof vi.fn
    >;
  }

  it('tags deterministic matches with origin generated', async () => {
    const createRelationshipRule = await persistSuggestion(
      makeFieldMatch({ contributedBy: ['deterministic'] }),
    );

    expect(createRelationshipRule.mock.calls[0][0].origin).toBe('generated');
  });

  it('persists canonical source datasource from reversed suggestions', async () => {
    const createRelationshipRule = await persistSuggestion(
      makeFieldMatch({
        sourceDatasourceId: 'users',
        sourceField: '$.id',
        targetDatasourceId: 'issues',
        targetField: '$.follower_ids',
        matchStrategy: 'array_contains',
      }),
    );

    expect(createRelationshipRule.mock.calls[0][0]).toMatchObject({
      sourceDatasourceId: 'users',
      sourceFieldExpression: '$.id',
      targetDatasourceId: 'issues',
      targetFieldExpression: '$.follower_ids',
      matchStrategy: 'array_contains',
    });
  });

  it('updates an existing suggested rule when a stronger suggestion is found', async () => {
    const ruleDao = makeRuleDao();
    const existing = {
      id: 'existing-rule',
      state: 'suggested',
      origin: 'generated',
      strategy: 'field-matching',
      score: 0.4,
    };
    (
      ruleDao.findExistingRule as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(existing);

    const createdRules = await persistNewRules(
      ruleDao,
      [
        {
          datasourceId: 'source',
          total: 1,
          candidateValueCount: 1,
          searchResultCount: 1,
          suggestions: [makeFieldMatch({ score: 0.9, confidenceBand: 'high' })],
          suppressedSuggestions: [],
        },
      ],
      new Set(['target']),
    );

    expect(createdRules).toEqual([]);
    expect(ruleDao.createRelationshipRule).not.toHaveBeenCalled();
    expect(ruleDao.updateRelationshipRule).toHaveBeenCalledWith(
      'existing-rule',
      expect.objectContaining({
        score: 0.9,
        confidenceBand: 'high',
        sourceDatasourceId: 'source',
        targetDatasourceId: 'target',
      }),
      undefined,
    );
  });

  it('clears a stale sourceFilterExpression when refresh is won by a higher-scoring unfiltered suggestion', async () => {
    const ruleDao = makeRuleDao();
    const existing = {
      id: 'filtered-rule',
      state: 'suggested',
      origin: 'generated',
      strategy: 'field-matching',
      score: 0.4,
      sourceFilterExpression: "$.kind = 'Deployment'",
    };
    (
      ruleDao.findExistingRule as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(existing);

    await persistNewRules(
      ruleDao,
      [
        {
          datasourceId: 'source',
          total: 1,
          candidateValueCount: 1,
          searchResultCount: 1,
          // No sourceFilterExpression: this run's winning candidate needs no
          // narrowing filter at all.
          suggestions: [makeFieldMatch({ score: 0.9, confidenceBand: 'high' })],
          suppressedSuggestions: [],
        },
      ],
      new Set(['target']),
    );

    expect(ruleDao.updateRelationshipRule).toHaveBeenCalledWith(
      'filtered-rule',
      expect.objectContaining({ sourceFilterExpression: null }),
      undefined,
    );
  });

  it('always rewrites an old-format suggested rule (no waterfall), regardless of score comparison', async () => {
    // Score 0.9 here was produced by the old additive scorer (0-1 on a
    // different scale) — comparing it against a new FS probability of 0.75
    // would keep the old scorer's most "confident" rules permanently
    // un-refreshable, exactly backwards from the migration story.
    const ruleDao = makeRuleDao();
    const oldFormatRule = {
      id: 'old-format-rule',
      state: 'suggested',
      origin: 'generated',
      strategy: 'field-matching',
      score: 0.9,
      // No evidenceSummary at all — the shape a rule persisted before this
      // stage's `waterfall` field existed.
    };
    (
      ruleDao.findExistingRule as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(oldFormatRule);

    const createdRules = await persistNewRules(
      ruleDao,
      [
        {
          datasourceId: 'source',
          total: 1,
          candidateValueCount: 1,
          searchResultCount: 1,
          suggestions: [
            makeFieldMatch({ score: 0.75, confidenceBand: 'medium' }),
          ],
          suppressedSuggestions: [],
        },
      ],
      new Set(['target']),
    );

    expect(createdRules).toEqual([]);
    expect(ruleDao.createRelationshipRule).not.toHaveBeenCalled();
    expect(ruleDao.updateRelationshipRule).toHaveBeenCalledWith(
      'old-format-rule',
      expect.objectContaining({ score: 0.75, confidenceBand: 'medium' }),
      undefined,
    );
  });

  it('keeps the score comparison for a suggested rule that already carries a waterfall', async () => {
    const ruleDao = makeRuleDao();
    const newFormatRule = {
      id: 'new-format-rule',
      state: 'suggested',
      origin: 'generated',
      strategy: 'field-matching',
      score: 0.9,
      evidenceSummary: {
        distinctMatchedValueCount: 3,
        waterfall: [{ signal: 'prior', fired: true, weight: -5 }],
      },
    };
    (
      ruleDao.findExistingRule as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(newFormatRule);

    const createdRules = await persistNewRules(
      ruleDao,
      [
        {
          datasourceId: 'source',
          total: 1,
          candidateValueCount: 1,
          searchResultCount: 1,
          suggestions: [
            makeFieldMatch({ score: 0.75, confidenceBand: 'medium' }),
          ],
          suppressedSuggestions: [],
        },
      ],
      new Set(['target']),
    );

    expect(createdRules).toEqual([]);
    expect(ruleDao.createRelationshipRule).not.toHaveBeenCalled();
    expect(ruleDao.updateRelationshipRule).not.toHaveBeenCalled();
  });

  it('does not duplicate a reviewed existing rule', async () => {
    const ruleDao = makeRuleDao();
    (
      ruleDao.findExistingRule as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      id: 'active-rule',
      state: 'active',
      score: 0.4,
    });

    const createdRules = await persistNewRules(
      ruleDao,
      [
        {
          datasourceId: 'source',
          total: 1,
          candidateValueCount: 1,
          searchResultCount: 1,
          suggestions: [makeFieldMatch({ score: 0.9 })],
          suppressedSuggestions: [],
        },
      ],
      new Set(['target']),
    );

    expect(createdRules).toEqual([]);
    expect(ruleDao.createRelationshipRule).not.toHaveBeenCalled();
    expect(ruleDao.updateRelationshipRule).not.toHaveBeenCalled();
  });

  it('rewrites a weaker suggested inverse instead of creating a duplicate inverse', async () => {
    const ruleDao = makeRuleDao();
    (ruleDao.findExistingRule as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 'reverse-rule',
        state: 'suggested',
        origin: 'generated',
        strategy: 'field-matching',
        score: 0.3,
      });

    const createdRules = await persistNewRules(
      ruleDao,
      [
        {
          datasourceId: 'source',
          total: 1,
          candidateValueCount: 1,
          searchResultCount: 1,
          suggestions: [makeFieldMatch({ score: 0.9 })],
          suppressedSuggestions: [],
        },
      ],
      new Set(['target']),
    );

    expect(createdRules).toEqual([]);
    expect(ruleDao.createRelationshipRule).not.toHaveBeenCalled();
    expect(ruleDao.updateRelationshipRule).toHaveBeenCalledWith(
      'reverse-rule',
      expect.objectContaining({
        sourceDatasourceId: 'source',
        targetDatasourceId: 'target',
        sourceFieldExpression: '$.handle',
        targetFieldExpression: '$.login',
      }),
      undefined,
    );
  });

  it('auto-stales unreviewed prior suggestions that did not surface in this run', async () => {
    const ruleDao = makeRuleDao();
    (
      ruleDao.listRelationshipRulesByDatasourceId as unknown as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValueOnce([
      {
        id: 'stale-rule',
        sourceDatasourceId: 'source',
        targetDatasourceId: 'target',
        sourceFieldExpression: '$.handle',
        targetFieldExpression: '$.legacyLogin',
        state: 'suggested',
        origin: 'generated',
        strategy: 'field-matching',
      },
    ]);

    await persistNewRules(
      ruleDao,
      [
        {
          datasourceId: 'source',
          total: 1,
          candidateValueCount: 1,
          searchResultCount: 1,
          suggestions: [
            makeFieldMatch({
              sourceField: '$.handle',
              targetField: '$.login',
            }),
          ],
          suppressedSuggestions: [],
        },
      ],
      new Set(['target']),
    );

    expect(ruleDao.updateRelationshipRuleState).toHaveBeenCalledWith(
      'stale-rule',
      'inactive',
      { reviewReason: 'auto-staled', workspaceId: undefined },
    );
  });

  it('does not auto-stale a prior suggestion that the current run still produces', async () => {
    const ruleDao = makeRuleDao();
    (
      ruleDao.listRelationshipRulesByDatasourceId as unknown as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValueOnce([
      {
        id: 'still-relevant',
        sourceDatasourceId: 'source',
        targetDatasourceId: 'target',
        sourceFieldExpression: '$.handle',
        targetFieldExpression: '$.login',
        state: 'suggested',
        origin: 'generated',
        strategy: 'field-matching',
      },
    ]);

    await persistNewRules(
      ruleDao,
      [
        {
          datasourceId: 'source',
          total: 1,
          candidateValueCount: 1,
          searchResultCount: 1,
          suggestions: [
            makeFieldMatch({
              sourceField: '$.handle',
              targetField: '$.login',
            }),
          ],
          suppressedSuggestions: [],
        },
      ],
      new Set(['target']),
    );

    expect(ruleDao.updateRelationshipRuleState).not.toHaveBeenCalled();
  });

  it('resurrects an auto-staled rule when its evidence reappears', async () => {
    const ruleDao = makeRuleDao();
    (
      ruleDao.findExistingRule as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      id: 'staled-rule',
      state: 'inactive',
      reviewReason: 'auto-staled',
      origin: 'generated',
      strategy: 'field-matching',
      score: 0.7,
    });

    const createdRules = await persistNewRules(
      ruleDao,
      [
        {
          datasourceId: 'source',
          total: 1,
          candidateValueCount: 1,
          searchResultCount: 1,
          suggestions: [makeFieldMatch({ score: 0.6 })],
          suppressedSuggestions: [],
        },
      ],
      new Set(['target']),
    );

    expect(createdRules).toEqual([]);
    expect(ruleDao.createRelationshipRule).not.toHaveBeenCalled();
    expect(ruleDao.updateRelationshipRule).toHaveBeenCalledWith(
      'staled-rule',
      expect.objectContaining({ score: 0.6 }),
      undefined,
    );
    expect(ruleDao.updateRelationshipRuleState).toHaveBeenCalledWith(
      'staled-rule',
      'suggested',
      { reviewReason: null, workspaceId: undefined },
    );
  });

  it('leaves a manually dismissed rule dismissed even when evidence reappears', async () => {
    const ruleDao = makeRuleDao();
    (
      ruleDao.findExistingRule as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      id: 'dismissed-rule',
      state: 'inactive',
      reviewReason: 'manual-dismiss',
      origin: 'generated',
      strategy: 'field-matching',
      score: 0.4,
    });

    const createdRules = await persistNewRules(
      ruleDao,
      [
        {
          datasourceId: 'source',
          total: 1,
          candidateValueCount: 1,
          searchResultCount: 1,
          suggestions: [makeFieldMatch({ score: 0.9 })],
          suppressedSuggestions: [],
        },
      ],
      new Set(['target']),
    );

    expect(createdRules).toEqual([]);
    expect(ruleDao.createRelationshipRule).not.toHaveBeenCalled();
    expect(ruleDao.updateRelationshipRule).not.toHaveBeenCalled();
    expect(ruleDao.updateRelationshipRuleState).not.toHaveBeenCalled();
  });

  it('resurrects an auto-staled reverse rule instead of creating its inverse', async () => {
    const ruleDao = makeRuleDao();
    (ruleDao.findExistingRule as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 'staled-reverse',
        state: 'inactive',
        reviewReason: 'auto-staled',
        origin: 'generated',
        strategy: 'field-matching',
        score: 0.3,
      });

    const createdRules = await persistNewRules(
      ruleDao,
      [
        {
          datasourceId: 'source',
          total: 1,
          candidateValueCount: 1,
          searchResultCount: 1,
          suggestions: [makeFieldMatch({ score: 0.9 })],
          suppressedSuggestions: [],
        },
      ],
      new Set(['target']),
    );

    expect(createdRules).toEqual([]);
    expect(ruleDao.createRelationshipRule).not.toHaveBeenCalled();
    expect(ruleDao.updateRelationshipRuleState).toHaveBeenCalledWith(
      'staled-reverse',
      'suggested',
      { reviewReason: null, workspaceId: undefined },
    );
  });

  it('does not auto-stale suggested rules owned by other actors', async () => {
    const ruleDao = makeRuleDao();
    (
      ruleDao.listRelationshipRulesByDatasourceId as unknown as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValueOnce([
      {
        // An MCP-agent proposal awaiting human review.
        id: 'agent-proposed',
        sourceDatasourceId: 'source',
        targetDatasourceId: 'target',
        sourceFieldExpression: '$.handle',
        targetFieldExpression: '$.curatedLogin',
        state: 'suggested',
        origin: 'mcp',
        strategy: 'field-matching',
      },
      {
        // An integration-backed draft the deterministic pipeline can never
        // reproduce.
        id: 'integration-draft',
        sourceDatasourceId: 'source',
        targetDatasourceId: 'target',
        sourceFieldExpression: '$.handle',
        targetFieldExpression: '$.resolvedLogin',
        state: 'suggested',
        origin: 'generated',
        strategy: 'integration-backed',
      },
    ]);

    await persistNewRules(
      ruleDao,
      [
        {
          datasourceId: 'source',
          total: 1,
          candidateValueCount: 1,
          searchResultCount: 1,
          suggestions: [
            makeFieldMatch({
              sourceField: '$.handle',
              targetField: '$.login',
            }),
          ],
          suppressedSuggestions: [],
        },
      ],
      new Set(['target']),
    );

    expect(ruleDao.updateRelationshipRuleState).not.toHaveBeenCalled();
  });

  it('does not overwrite a same-field-pair suggested rule owned by another actor', async () => {
    const ruleDao = makeRuleDao();
    (
      ruleDao.findExistingRule as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      id: 'agent-proposed',
      state: 'suggested',
      origin: 'mcp',
      strategy: 'integration-backed',
      score: 0.1,
    });

    const createdRules = await persistNewRules(
      ruleDao,
      [
        {
          datasourceId: 'source',
          total: 1,
          candidateValueCount: 1,
          searchResultCount: 1,
          suggestions: [makeFieldMatch({ score: 0.9 })],
          suppressedSuggestions: [],
        },
      ],
      new Set(['target']),
    );

    expect(createdRules).toEqual([]);
    expect(ruleDao.createRelationshipRule).not.toHaveBeenCalled();
    expect(ruleDao.updateRelationshipRule).not.toHaveBeenCalled();
  });

  it('only queries suggested rules when staling, leaving active and dismissed alone', async () => {
    const ruleDao = makeRuleDao();

    await persistNewRules(
      ruleDao,
      [
        {
          datasourceId: 'source',
          total: 0,
          candidateValueCount: 0,
          searchResultCount: 0,
          suggestions: [],
          suppressedSuggestions: [],
        },
      ],
      new Set(['target']),
    );

    expect(ruleDao.listRelationshipRulesByDatasourceId).toHaveBeenCalledWith(
      'source',
      { state: 'suggested' },
    );
  });
});

describe('buildSuggestions — rescue loop', () => {
  function makeRescueRuleDao() {
    const createRelationshipRule = vi.fn(async input => ({
      id: 'rule-1',
      ...input,
      state: 'suggested',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const ruleDao = {
      findExistingRule: vi.fn(async () => undefined),
      createRelationshipRule,
      updateRelationshipRule: vi.fn(async () => undefined),
      listRelationshipRulesByDatasourceId: vi.fn(async () => []),
      updateRelationshipRuleState: vi.fn(async () => undefined),
    } as unknown as RelationshipRuleDao;
    return { ruleDao, createRelationshipRule };
  }

  it('-backstage archetype: rescues a suppressed identifier-suffix mismatch via transform synthesis and persists the rendered JSONata', async () => {
    const objectDao = makeObjectDao({
      // Repeated values (rather than 3 all-unique rows) keep the rescued
      // synthetic profile's cardinalityRatio in [0.5, 0.95) — enough to
      // satisfy isIdentifierLike (driving the original rescueHint) without
      // also tripping FS scoring's key-key-penalty, which fires whenever
      // BOTH the dependent and referenced sides look like unique keys and
      // name-similarity can't rescue it (a rendered JSONata expression
      // tokenizes nothing like the plain target field name it's compared
      // against).
      sourceObjects: [
        { id: 'queue-service-backstage' },
        { id: 'queue-service-backstage' },
        { id: 'billing-api-backstage' },
        { id: 'billing-api-backstage' },
        { id: 'auth-proxy-backstage' },
      ],
      targetObjects: {
        target: [
          { name: 'queue-service' },
          { name: 'billing-api' },
          { name: 'auth-proxy' },
          // Decoy: a literal, unmodified copy of a source value on the
          // target side — the only way this pairing is discovered by the
          // deterministic exact-match pass at all (no suffixed source value
          // otherwise equals any clean target value), without diluting the
          // dependent field's own suffix-consistency measurement.
          { name: 'queue-service-backstage' },
        ],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const originalSuppressed = result.suppressedSuggestions.find(
      s =>
        s.sourceField === '$.id' &&
        s.targetField === '$.name' &&
        s.evidenceSummary.rescue === undefined,
    );
    expect(originalSuppressed).toBeUndefined();

    const rendered = "$substringBefore($.id, '-backstage')";
    const rescued = findCandidate(result, s => s.sourceField === rendered);
    expect(rescued).toBeDefined();
    expect(rescued!.sourceExpression).toBe(rendered);
    expect(rescued!.evidenceSummary.rescue).toEqual({
      kind: 'transform',
      detail: 'strip-suffix:-backstage',
      originalField: '$.id',
    });
    expect(rescued!.evidenceSummary.gate?.containment).toBeCloseTo(1);
    expect(rescued!.evidenceSummary.gate?.containmentDirection).toBe(
      'source-to-target',
    );
    // Match evidence describes the TRANSFORMED (post-rescue) values — not
    // the pre-rescue "queue-service-backstage" raw strings a rule based on
    // this evidence would never actually see.
    expect(rescued!.sampleValues).toEqual([
      'billing-api',
      'queue-service',
      'auth-proxy',
    ]);
    expect(rescued!.evidenceSummary.topMatchedValues).toEqual([
      'billing-api',
      'queue-service',
      'auth-proxy',
    ]);
    expect(rescued!.evidenceSummary.distinctMatchedValueCount).toBe(3);
    expect(rescued!.matchCount).toBe(5);
    // Synthesis validated exact set membership — a transform rescue must
    // not carry forward whatever strategy the pre-rescue discovery used.
    expect(rescued!.matchStrategy).toBe('exact');

    // Persistence is asserted directly off the rescued suggestion (rather
    // than depending on it having cleared FS scoring's band threshold too —
    // a separate, already-tested concern) so this stays a test of the
    // rescue loop's wiring, not of FS-score calibration for this fixture.
    const { ruleDao, createRelationshipRule } = makeRescueRuleDao();
    await persistNewRules(
      ruleDao,
      [{ ...result, suggestions: [rescued!] }],
      new Set(['source', 'target']),
    );
    const persistedInput = createRelationshipRule.mock.calls.find(
      call => call[0].sourceFieldExpression === rendered,
    )?.[0];
    expect(persistedInput).toBeDefined();
    expect(persistedInput.sourceFieldExpression).toBe(rendered);
  });

  it('reports honest (non-inflated) containment for a 0.9-consistency transform: fires containment-0.85, not containment-0.99', async () => {
    // 9 of 10 dependent values carry the "-backstage" suffix (a clean
    // strip-suffix synthesis at exactly 0.9 consistency); the 10th has no
    // suffix at all, so the rendered rule would pass it through unchanged at
    // apply time and it would never match the referenced set. The honest
    // synthetic profile must include that 10th value (not just the 9
    // synthesis "hits") so the re-gate's containment is 9/10 = 0.9, not a
    // circular/inflated 1.0.
    const suffixed = [
      'queue-service-backstage',
      'billing-payment-backstage',
      'auth-gateway-backstage',
      'search-index-backstage',
      'cache-redis-backstage',
      'notify-queue-backstage',
      'media-upload-backstage',
      'audit-log-backstage',
      'metrics-collector-backstage',
    ];
    const objectDao = makeObjectDao({
      sourceObjects: [
        ...suffixed.map(id => ({ id })),
        // The 10th value: no suffix, so strip-suffix passes it through
        // unchanged — and unchanged, it matches nothing on the target side.
        { id: 'extraservice' },
      ],
      targetObjects: {
        target: [
          ...suffixed.map(id => ({ name: id.replace('-backstage', '') })),
          // Decoy: a literal, unmodified copy of one source value — the only
          // way this pairing is discovered by the exact-match pass at all.
          { name: suffixed[0] },
        ],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const rendered = "$substringBefore($.id, '-backstage')";
    const rescued = findCandidate(result, s => s.sourceField === rendered);
    expect(rescued).toBeDefined();
    expect(rescued!.evidenceSummary.gate?.containment).toBeCloseTo(0.9, 5);
    expect(rescued!.evidenceSummary.gate?.containmentDirection).toBe(
      'source-to-target',
    );
    const containmentEntries = (rescued!.evidenceSummary.waterfall ?? [])
      .filter(entry => entry.signal.startsWith('containment'))
      .map(entry => ({ signal: entry.signal, fired: entry.fired }));
    expect(containmentEntries).toEqual([
      { signal: 'containment-0.85', fired: true },
    ]);
  });

  it('forces matchStrategy exact for a transform-rescued candidate originally discovered via contains', async () => {
    // No exact matches anywhere: the ONLY evidence for this candidate is a
    // prefix-contains match (a raw suffixed source value happens to be a
    // strict prefix of one noisy target value), so field-match-builder would
    // tag it matchStrategy: 'contains' — synthesis then validates exact set
    // membership on the CLEAN (transformed) values, so the rescue must not
    // carry that pre-rescue strategy forward.
    const objectDao = makeObjectDao({
      sourceObjects: [
        { id: 'queue-service-backstage' },
        { id: 'queue-service-backstage' },
        { id: 'billing-api-backstage' },
        { id: 'billing-api-backstage' },
        { id: 'auth-proxy-backstage' },
      ],
      targetObjects: {
        target: [
          { name: 'queue-service' },
          { name: 'billing-api' },
          { name: 'auth-proxy' },
          // Contains-match trigger (not an exact copy): source's
          // "queue-service-backstage" is a strict prefix of this value,
          // followed by a delimiter — the only discovery evidence here.
          { name: 'queue-service-backstage-extra' },
        ],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const rendered = "$substringBefore($.id, '-backstage')";
    const rescued = findCandidate(result, s => s.sourceField === rendered);
    expect(rescued).toBeDefined();
    expect(rescued!.matchStrategy).toBe('exact');
  });

  it('orders a rescued-but-still-score-suppressed entry right after gateSuppressed, ahead of ordinary score-suppressed entries', async () => {
    // Three independent candidates in one run: an unrescuable gate
    // suppression (identity-mirror), a transform-rescued candidate whose
    // gate now passes but still scores 'low' (all-unique dependent values —
    // no repeats to escape key-key-penalty, unlike the -backstage archetype
    // test above, so it deliberately stays score-suppressed post-rescue),
    // and an ordinary (never gate-suppressed) score-suppressed candidate
    // (archetype (c)'s enum-vocabulary overlap, reused verbatim).
    const commonValues = ['vip', 'gold', 'silver', 'bronze', 'elite'];
    const repeated = commonValues.flatMap(v =>
      Array.from({ length: 8 }, () => ({ label: v })),
    );
    const singles = Array.from({ length: 960 }, (_, i) => ({
      label: `uniq-${i}-${uuidv4()}`,
    }));
    const objectDao = makeObjectDao({
      sourceObjects: [
        { id: 'aaa-bbb' },
        { id: 'ccc-ddd' },
        { id: 'eee-fff' },
        // 4 distinct values (not 3): this run's combined source corpus is
        // much larger than the -backstage archetype test's own (it also
        // carries the id and tier rows), so $.code needs enough of its own
        // rows to keep rowCoverage >= 0.2 (isIdentifierLike's floor) —
        // otherwise the gate never sets a rescueHint for it at all.
        { code: 'queue-service-backstage' },
        { code: 'billing-api-backstage' },
        { code: 'auth-proxy-backstage' },
        { code: 'search-index-backstage' },
        ...commonValues.flatMap(v => [{ tier: v }, { tier: v }]),
      ],
      targetObjects: {
        mirror: [{ id: 'aaa-bbb' }, { id: 'ccc-ddd' }, { id: 'eee-fff' }],
        lowrescue: [
          { name: 'queue-service' },
          { name: 'billing-api' },
          { name: 'auth-proxy' },
          { name: 'search-index' },
          { name: 'queue-service-backstage' },
        ],
        enum: [...repeated, ...singles],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', [
      'mirror',
      'lowrescue',
      'enum',
    ]);

    const rendered = "$substringBefore($.code, '-backstage')";
    const mirrorIndex = result.suppressedSuggestions.findIndex(
      s => s.sourceField === '$.id' && s.targetField === '$.id',
    );
    const rescuedIndex = result.suppressedSuggestions.findIndex(
      s => s.sourceField === rendered,
    );
    const enumIndex = result.suppressedSuggestions.findIndex(
      s => s.sourceField === '$.tier' && s.targetField === '$.label',
    );

    expect(mirrorIndex).toBeGreaterThanOrEqual(0);
    expect(rescuedIndex).toBeGreaterThanOrEqual(0);
    expect(enumIndex).toBeGreaterThanOrEqual(0);
    const rescuedEntry = result.suppressedSuggestions.find(
      s => s.sourceField === rendered,
    );
    expect(rescuedEntry?.suppressionReason).toBe('score-below-threshold');
    expect(rescuedEntry?.evidenceSummary.rescue?.kind).toBe('transform');
    expect(mirrorIndex).toBeLessThan(rescuedIndex);
    expect(rescuedIndex).toBeLessThan(enumIndex);
  });

  it('k8s archetype: rescues a global CONTAINMENT failure (not trivial-domain) under an enum-sibling filter and persists the JSONata filter', async () => {
    // The real spec archetype: $.metadata.name is high-cardinality (well
    // above the trivial-domain tiny-enum branch's <=5 distinct — so this
    // fails at the CONTAINMENT gate, not trivial-domain) and noisy across
    // kinds — 10 Service names never appear in the target at all — but
    // clean (fully contained) once sliced to $.kind = 'Deployment'.
    const deploymentNames = [
      'checkout-service',
      'billing-service',
      'auth-service',
      'search-service',
    ];
    const serviceNoiseNames = [
      'cache-proxy',
      'log-shipper',
      'metrics-agent',
      'config-sync',
      'health-check',
      'rate-limiter',
      'session-store',
      'token-issuer',
      'audit-relay',
      'backup-runner',
    ];
    const objectDao = makeObjectDao({
      sourceObjects: [
        // 4 replicas per deployment name: realistic many-to-one shaping
        // (multiple pods per deployment). What actually carries the band is
        // the same-path metadata.name↔metadata.name join — the canonical k8s
        // shape — whose fired name-similarity avoids the −1.3 mismatch term;
        // measured: a differently-named target lands sub-medium even with
        // replicas, while this fixture clears medium with or without them.
        ...deploymentNames.flatMap(name =>
          Array.from({ length: 4 }, () => ({
            kind: 'Deployment',
            metadata: { name },
          })),
        ),
        ...serviceNoiseNames.map(name => ({
          kind: 'Service',
          metadata: { name },
        })),
      ],
      targetObjects: {
        // Another k8s-shaped resource collection (also metadata.name) with
        // 20 unrelated entries of its own — large enough that the reverse
        // (target-to-source) direction isn't trivially fully contained by
        // this run's small source, which would let the gate pass outright
        // without any rescue.
        target: [
          ...deploymentNames.map(name => ({ metadata: { name } })),
          ...Array.from({ length: 20 }, (_, i) => ({
            metadata: { name: `ref-noise-${i}` },
          })),
        ],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const originalSuppressed = result.suppressedSuggestions.find(
      s =>
        s.sourceField === '$.metadata.name' &&
        s.targetField === '$.metadata.name' &&
        s.sourceFilterExpression === undefined,
    );
    expect(originalSuppressed).toBeUndefined();

    const rescued = result.suggestions.find(
      s =>
        s.sourceField === '$.metadata.name' &&
        s.targetField === '$.metadata.name' &&
        s.sourceFilterExpression !== undefined,
    );
    expect(rescued).toBeDefined();
    expect(rescued!.confidenceBand).not.toBe('low');
    expect(['medium', 'high']).toContain(rescued!.confidenceBand);
    expect(rescued!.sourceFilterExpression).toBe("$.kind = 'Deployment'");
    expect(rescued!.evidenceSummary.rescue).toEqual({
      kind: 'filter',
      detail: "$.kind = 'Deployment'",
    });
    // The original gate failure this rescued: a global containment miss
    // (10 noisy Service names never present in the target), not a tiny,
    // dominant-value domain.
    expect(rescued!.suppressionReason).toBeUndefined();
    // Match evidence describes the RESCUED (filtered) values, not the
    // pre-rescue global set that included the 10 unrelated Service names.
    expect(rescued!.sampleValues.slice().sort()).toEqual(
      deploymentNames.slice().sort(),
    );
    expect(rescued!.evidenceSummary.topMatchedValues.slice().sort()).toEqual(
      deploymentNames.slice().sort(),
    );

    // No hand-injecting into persistNewRules — this is the real pipeline's
    // `result.suggestions`, which already contains the rescued entry above.
    const { ruleDao, createRelationshipRule } = makeRescueRuleDao();
    await persistNewRules(ruleDao, [result], new Set(['source', 'target']));
    const persistedInput = createRelationshipRule.mock.calls.find(
      call => call[0].sourceFilterExpression === "$.kind = 'Deployment'",
    )?.[0];
    expect(persistedInput).toBeDefined();
    expect(persistedInput.sourceFieldExpression).toBe('$.metadata.name');
    expect(persistedInput.sourceFilterExpression).toBe("$.kind = 'Deployment'");
  });

  it('produces byte-identical output across repeated runs for a rescuing (filter) fixture', async () => {
    const deploymentNames = [
      'checkout-service',
      'billing-service',
      'auth-service',
      'search-service',
    ];
    const serviceNoiseNames = [
      'cache-proxy',
      'log-shipper',
      'metrics-agent',
      'config-sync',
      'health-check',
    ];
    const objectDao = makeObjectDao({
      sourceObjects: [
        ...deploymentNames.flatMap(name =>
          Array.from({ length: 4 }, () => ({
            kind: 'Deployment',
            metadata: { name },
          })),
        ),
        ...serviceNoiseNames.map(name => ({
          kind: 'Service',
          metadata: { name },
        })),
      ],
      targetObjects: {
        target: [
          ...deploymentNames.map(name => ({ metadata: { name } })),
          ...Array.from({ length: 20 }, (_, i) => ({
            metadata: { name: `ref-noise-${i}` },
          })),
        ],
      },
    });

    const run = () => buildSuggestions(objectDao, 'source', ['target']);
    const first = JSON.stringify(await run());
    const second = JSON.stringify(await run());
    expect(second).toEqual(first);
    // Confirms the rescue loop actually ran (not a vacuous determinism check).
    expect(first).toContain('"kind":"filter"');
  });

  it('memoizes enumerateFilterRefinements per sourceField instead of once per rescue attempt sharing that field', async () => {
    vi.mocked(enumerateFilterRefinements).mockClear();

    const deploymentNames = [
      'checkout-service',
      'billing-service',
      'auth-service',
      'search-service',
    ];
    const serviceNoiseNames = [
      'cache-proxy',
      'log-shipper',
      'metrics-agent',
      'config-sync',
      'health-check',
      'rate-limiter',
      'session-store',
      'token-issuer',
      'audit-relay',
      'backup-runner',
    ];
    const makeTargetRefs = () => [
      ...deploymentNames.map(name => ({ metadata: { name } })),
      ...Array.from({ length: 20 }, (_, i) => ({
        metadata: { name: `ref-noise-${i}` },
      })),
    ];
    const objectDao = makeObjectDao({
      sourceObjects: [
        ...deploymentNames.map(name => ({
          kind: 'Deployment',
          metadata: { name },
        })),
        ...serviceNoiseNames.map(name => ({
          kind: 'Service',
          metadata: { name },
        })),
      ],
      // Three separate target datasources all pairing against the SAME
      // source field ($.metadata.name) and all needing the same filter
      // rescue — the enumeration (slicing + re-profiling every enum-field/
      // value combination) is identical every time, so it should run once,
      // not once per rescue attempt.
      targetObjects: {
        t1: makeTargetRefs(),
        t2: makeTargetRefs(),
        t3: makeTargetRefs(),
      },
    });

    const result = await buildSuggestions(objectDao, 'source', [
      't1',
      't2',
      't3',
    ]);

    const rescuedCount = [
      ...result.suggestions,
      ...result.suppressedSuggestions,
    ].filter(
      s =>
        s.sourceField === '$.metadata.name' &&
        s.sourceFilterExpression !== undefined,
    ).length;
    expect(rescuedCount).toBe(3);
    expect(enumerateFilterRefinements).toHaveBeenCalledTimes(1);
  });

  it('composite rescue: joins two sibling fields (repo & tag) when plain transform synthesis fails, without claiming a circular containment', async () => {
    const objectDao = makeObjectDao({
      sourceObjects: [
        { repo: 'roadie-app', tag: 'v1' },
        { repo: 'roadie-app', tag: 'v2' },
        { repo: 'roadie-infra', tag: 'v1' },
        { repo: 'roadie-web', tag: 'v1' },
        { repo: 'roadie-docs', tag: 'v1' },
        { repo: 'roadie-cli', tag: 'v1' },
      ],
      // tag-first ("v1:roadie-app") rather than repo-first: a repo-first
      // combined value ("roadie-app:v1") would let collectPrefixContainsResults
      // discover (and fully validate, via coverage) this pairing on its own —
      // $.repo's values are literal prefixes of it — passing the plain gate
      // outright and never exercising the composite fallback this test wants.
      targetObjects: {
        target: [
          { image: 'v1:roadie-app' },
          { image: 'v2:roadie-app' },
          { image: 'v1:roadie-infra' },
          { image: 'v1:roadie-web' },
          { image: 'v1:roadie-docs' },
          { image: 'v1:roadie-cli' },
          // Decoy: a literal copy of one source value, the only way this
          // pairing is discovered at all (no plain $.repo value equals a
          // "tag:repo" combined string).
          { image: 'roadie-app' },
        ],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const rendered = "$.tag & ':' & $.repo";
    const rescued = findCandidate(result, s => s.sourceField === rendered);
    expect(rescued).toBeDefined();
    expect(rescued!.sourceExpression).toBe(rendered);
    expect(rescued!.evidenceSummary.rescue?.kind).toBe('transform');
    expect(rescued!.evidenceSummary.rescue?.detail).toMatch(/^composite:/);
    expect(rescued!.evidenceSummary.rescue?.originalField).toBe('$.repo');
    // A composite's re-gated containment against its own matched-referenced
    // intersection would trivially be ~1.0 by construction — the rescue
    // loop skips that gate entirely, so the wire evidence must never claim a
    // gate-measured containment value for a composite rescue.
    expect(rescued!.evidenceSummary.gate?.containment).toBeUndefined();
    expect(rescued!.evidenceSummary.gate?.containmentDirection).toBeUndefined();

    const originalSuppressed = result.suppressedSuggestions.find(
      s => s.sourceField === '$.repo' && s.targetField === '$.image',
    );
    expect(originalSuppressed).toBeUndefined();
  });

  it('memoizes composite synthesis per target field and dedups the identical rescued rule two source fields render', async () => {
    vi.mocked(synthesizeCompositeKey).mockClear();

    const objectDao = makeObjectDao({
      sourceObjects: [
        // $.repo and $.repo2 are two independent candidates (each discovered
        // via its own copy of the "roadie-app" decoy below) that both fail
        // plain transform and both fall back to composite rescue against the
        // SAME target field ($.image) — composite synthesis depends only on
        // the run's sibling fields + the referenced set, not on which
        // original field triggered the search, so the underlying
        // synthesizeCompositeKey call should run once, not twice.
        { repo: 'roadie-app', repo2: 'roadie-app', tag: 'v1' },
        { repo: 'roadie-app', repo2: 'repo2-b', tag: 'v2' },
        { repo: 'roadie-infra', repo2: 'repo2-c', tag: 'v1' },
        { repo: 'roadie-web', repo2: 'repo2-d', tag: 'v1' },
        { repo: 'roadie-docs', repo2: 'repo2-e', tag: 'v1' },
        { repo: 'roadie-cli', repo2: 'repo2-f', tag: 'v1' },
      ],
      targetObjects: {
        target: [
          { image: 'v1:roadie-app' },
          { image: 'v2:roadie-app' },
          { image: 'v1:roadie-infra' },
          { image: 'v1:roadie-web' },
          { image: 'v1:roadie-docs' },
          { image: 'v1:roadie-cli' },
          // Decoy, discovers BOTH $.repo and $.repo2 as raw candidates.
          { image: 'roadie-app' },
        ],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    // Both $.repo and $.repo2 render the SAME composite ("$.tag & ':' & $.repo")
    // — the rendered expression ignores which failed source field triggered
    // the search — so they are the same rule. Pre-fix both were emitted and
    // only collapsed at persistence; now exactly one rescued suggestion is
    // produced for that rule.
    const rendered = "$.tag & ':' & $.repo";
    const compositeRescues = [
      ...result.suggestions,
      ...result.suppressedSuggestions,
    ].filter(
      s =>
        s.evidenceSummary.rescue?.kind === 'transform' &&
        s.sourceField === rendered,
    );
    expect(compositeRescues).toHaveLength(1);
    // Memoization still holds: the underlying synthesis ran once for the shared
    // target field, not once per failed-transform candidate.
    expect(synthesizeCompositeKey).toHaveBeenCalledTimes(1);
  });

  it('leaves suppression intact when neither plain nor composite transform synthesis succeeds', async () => {
    const objectDao = makeObjectDao({
      sourceObjects: [
        { code: 'zulu-nine' },
        { code: 'yankee-two' },
        { code: 'xray-five' },
        { code: 'decoy-match' },
      ],
      targetObjects: {
        target: [
          { ref: 'alpha-one' },
          { ref: 'bravo-three' },
          { ref: 'charlie-four' },
          // Decoy: the only overlap, so a candidate is discovered at all.
          { ref: 'decoy-match' },
        ],
      },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const suppressed = result.suppressedSuggestions.find(
      s => s.sourceField === '$.code' && s.targetField === '$.ref',
    );
    expect(suppressed).toBeDefined();
    expect(suppressed!.suppressionReason).toBe('containment-below-threshold');
    expect(suppressed!.evidenceSummary.gate?.rescueHint).toBe('try-transform');
    expect(suppressed!.evidenceSummary.rescue).toBeUndefined();
    expect(
      result.suggestions.find(
        s => s.sourceField === '$.code' && s.targetField === '$.ref',
      ),
    ).toBeUndefined();
  });

  it('honors RESCUE_ATTEMPT_CAP: only the first cap-worth of hinted candidates are attempted, the rest stay suppressed untouched', async () => {
    const fieldCount = RESCUE_ATTEMPT_CAP + 1;
    // Every field independently satisfies a reliable case-fold rescue: three
    // mixed-case dependent values plus a lowercase decoy (the only value
    // that also appears, unmodified, on the target side — the sole reason
    // each pairing is discovered by the exact-match pass at all).
    const sourceObjects = Array.from({ length: 4 }, (_, row) => {
      const object: Record<string, string> = {};
      for (let i = 0; i < fieldCount; i += 1) {
        object[`field${i}`] = [`Foo${i}A`, `Foo${i}B`, `Foo${i}C`, `foo${i}z`][
          row
        ];
      }
      return object;
    });
    const targetObjects = Array.from({ length: 4 }, (_, row) => {
      const object: Record<string, string> = {};
      for (let i = 0; i < fieldCount; i += 1) {
        object[`ref${i}`] = [`foo${i}a`, `foo${i}b`, `foo${i}c`, `foo${i}z`][
          row
        ];
      }
      return object;
    });
    const objectDao = makeObjectDao({
      sourceObjects,
      targetObjects: { target: targetObjects },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const rescuedCount = [
      ...result.suggestions,
      ...result.suppressedSuggestions,
    ].filter(s => s.evidenceSummary.rescue?.kind === 'transform').length;
    expect(rescuedCount).toBe(RESCUE_ATTEMPT_CAP);

    const stillSuppressedCount = result.suppressedSuggestions.filter(
      s =>
        s.evidenceSummary.gate?.rescueHint === 'try-transform' &&
        s.evidenceSummary.rescue === undefined,
    ).length;
    expect(stillSuppressedCount).toBe(fieldCount - RESCUE_ATTEMPT_CAP);
  });

  it('a structurally unrescuable candidate never consumes a RESCUE_ATTEMPT_CAP slot: cap-many target-to-source entries preceding a feasible one still let it through', async () => {
    // RESCUE_ATTEMPT_CAP fields, each independently gate-failing with reason
    // containment-below-threshold + rescueHint try-transform, but in the
    // TARGET-TO-SOURCE direction — attemptTransformRescue requires
    // source-to-target, and attemptRescue's own filter fallback for this
    // reason re-checks the same direction, so every one of these is doomed
    // regardless of cap room (see the `rescuable` filter in
    // buildSuggestionResultFromData). Each field's matchCount (6) is higher
    // than the genuine field's (4, below), so these sort first — before this
    // fix, they alone would exhaust the cap and the genuine field, sorted
    // last, would never even be attempted.
    const infeasibleCount = RESCUE_ATTEMPT_CAP;
    const sourceObjects = Array.from({ length: 10 }, (_, row) => {
      const object: Record<string, string> = {};
      for (let i = 0; i < infeasibleCount; i += 1) {
        object[`field${i}`] = `src-${i}-${row}`;
      }
      if (row < 4) {
        // A genuine, independently rescuable (case-fold) candidate — direction
        // source-to-target, so a fixed rescuable predicate must still reach it.
        object.genuine = ['GenuineA', 'GenuineB', 'GenuineC', 'genuinez'][row];
      }
      return object;
    });
    const targetObjects = Array.from({ length: 8 }, (_, row) => {
      const object: Record<string, string> = {};
      for (let i = 0; i < infeasibleCount; i += 1) {
        // 6 of 8 target values are drawn from the source's 10 (t2s = 6/8 =
        // 0.75, s2t/coverage = 6/10 = 0.6) — t2s wins, so direction is
        // target-to-source, and 0.75 stays below the 0.85 gate threshold.
        object[`ref${i}`] = row < 6 ? `src-${i}-${row}` : `noise-${i}-${row}`;
      }
      if (row < 4) {
        object.ref = ['genuinea', 'genuineb', 'genuinec', 'genuinez'][row];
      }
      return object;
    });
    const objectDao = makeObjectDao({
      sourceObjects,
      targetObjects: { target: targetObjects },
    });

    const result = await buildSuggestions(objectDao, 'source', ['target']);

    const infeasibleEntries = [
      ...result.suggestions,
      ...result.suppressedSuggestions,
    ].filter(s => /^\$\.field\d+$/.test(s.sourceField));
    expect(infeasibleEntries).toHaveLength(infeasibleCount);
    expect(
      infeasibleEntries.every(
        s =>
          s.evidenceSummary.gate?.containmentDirection === 'target-to-source',
      ),
    ).toBe(true);
    expect(
      infeasibleEntries.every(s => s.evidenceSummary.rescue === undefined),
    ).toBe(true);

    const rescuedGenuine = [
      ...result.suggestions,
      ...result.suppressedSuggestions,
    ].find(s => s.evidenceSummary.rescue?.originalField === '$.genuine');
    expect(rescuedGenuine).toBeDefined();
    expect(rescuedGenuine!.evidenceSummary.rescue).toEqual({
      kind: 'transform',
      detail: 'case-fold',
      originalField: '$.genuine',
    });
  });
});
