import { describe, expect, it } from 'vitest';
import type { FieldProfile } from './field-profiling';
import {
  IDENTITY_CALIBRATION,
  type ScoreCalibration,
  applyCalibration,
} from './scoreCalibration';
import {
  FAN_OUT_SANITY_MAX,
  HIGH_BAND_MIN_P,
  MEDIUM_BAND_MIN_P,
  PRIOR_LOG_ODDS,
  SIGNAL_TABLE,
  type SignalContext,
  U_FLOOR,
  fsScoreCandidate,
} from './signalScoring';

function baseContext(overrides: Partial<SignalContext> = {}): SignalContext {
  return {
    sourceField: 'source',
    targetField: 'target',
    containment: 0.99,
    matchedValueCounts: new Map(),
    idf: new Map(),
    referencedSampleScale: 1,
    ...overrides,
  };
}

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

const signalByName = (name: string) =>
  SIGNAL_TABLE.find(signal => signal.name === name)!;

describe('SIGNAL_TABLE', () => {
  it('matches the plan-locked name/m/uSeed rows exactly, in order', () => {
    expect(
      SIGNAL_TABLE.map(signal => [signal.name, signal.m, signal.uSeed]),
    ).toEqual([
      ['containment-0.99', 0.55, 0.01],
      ['containment-0.95', 0.25, 0.02],
      ['containment-0.85', 0.15, 0.05],
      ['distribution-agreement', 0.7, 0.15],
      ['name-similarity', 0.6, 0.05],
      ['type-agreement', 0.95, 0.5],
      ['value-rarity', 0.8, 0.3],
      ['key-key-penalty', 0.05, 0.3],
      ['semantic-compatible', 0.5, 0.1],
      ['semantic-incompatible', 0.02, 0.2],
      ['fan-out-sanity', 0.05, 0.25],
      ['hierarchy-context', 0.3, 0.45],
    ]);
  });

  it('marks only hierarchy-context as fixedU (never measured by u-estimation)', () => {
    expect(
      SIGNAL_TABLE.map(signal => [signal.name, signal.fixedU === true]),
    ).toEqual([
      ['containment-0.99', false],
      ['containment-0.95', false],
      ['containment-0.85', false],
      ['distribution-agreement', false],
      ['name-similarity', false],
      ['type-agreement', false],
      ['value-rarity', false],
      ['key-key-penalty', false],
      ['semantic-compatible', false],
      ['semantic-incompatible', false],
      ['fan-out-sanity', false],
      ['hierarchy-context', true],
    ]);
  });
});

describe('containment-0.99 / containment-0.95 / containment-0.85', () => {
  const containment99 = signalByName('containment-0.99');
  const containment95 = signalByName('containment-0.95');
  const containment85 = signalByName('containment-0.85');

  it('containment-0.99 fires at exactly 0.99', () => {
    expect(containment99.evaluate(baseContext({ containment: 0.99 }))).toBe(
      true,
    );
  });

  it('containment-0.99 fires above 1 (alias-coverage containment)', () => {
    expect(containment99.evaluate(baseContext({ containment: 1.2 }))).toBe(
      true,
    );
  });

  it('containment-0.95 does not fire at 0.99 (owned by the 0.99 level)', () => {
    expect(containment95.evaluate(baseContext({ containment: 0.99 }))).toBe(
      false,
    );
  });

  it('containment-0.95 fires at exactly 0.95', () => {
    expect(containment95.evaluate(baseContext({ containment: 0.95 }))).toBe(
      true,
    );
  });

  it('containment-0.95 does not fire just below 0.95', () => {
    expect(
      containment95.evaluate(baseContext({ containment: 0.9499999 })),
    ).toBe(false);
  });

  it('containment-0.85 does not fire at 0.95 (owned by the 0.95 level)', () => {
    expect(containment85.evaluate(baseContext({ containment: 0.95 }))).toBe(
      false,
    );
  });

  it('containment-0.85 fires at exactly 0.85', () => {
    expect(containment85.evaluate(baseContext({ containment: 0.85 }))).toBe(
      true,
    );
  });

  it('none of the three fire just below 0.85', () => {
    const context = baseContext({ containment: 0.8499999 });
    expect(containment99.evaluate(context)).toBe(false);
    expect(containment95.evaluate(context)).toBe(false);
    expect(containment85.evaluate(context)).toBe(false);
  });
});

describe('distribution-agreement', () => {
  const signal = signalByName('distribution-agreement');

  it('skips when either profile is missing', () => {
    expect(
      signal.evaluate(baseContext({ sourceProfile: profile() })),
    ).toBeUndefined();
  });

  it('skips when referenced distinct values are below the quantile bucket count', () => {
    const context = baseContext({
      sourceProfile: profile({ valueCounts: { a: 1 } }),
      targetProfile: profile({ valueCounts: { a: 1, b: 1 } }), // 2 < 20
    });
    expect(signal.evaluate(context)).toBeUndefined();
  });

  it('fires when the Bhattacharyya coefficient meets the threshold (identical distributions)', () => {
    const valueCounts = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`v${i}`, 1]),
    );
    const context = baseContext({
      sourceProfile: profile({ valueCounts }),
      targetProfile: profile({ valueCounts }),
    });
    expect(signal.evaluate(context)).toBe(true);
  });

  it('does not fire when distributions disagree', () => {
    const referenced = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`v${i}`, 1]),
    );
    const context = baseContext({
      sourceProfile: profile({ valueCounts: { v0: 1000 } }), // all mass on one bucket
      targetProfile: profile({ valueCounts: referenced }),
    });
    expect(signal.evaluate(context)).toBe(false);
  });
});

describe('name-similarity', () => {
  const signal = signalByName('name-similarity');

  it('fires when the IDF-weighted overlap meets NAME_SIMILARITY_MIN', () => {
    const context = baseContext({
      sourceField: 'owner_id',
      targetField: 'id',
      referencedContainerName: 'owners',
      idf: new Map([
        ['owner', 3],
        ['id', 1],
      ]),
    });
    expect(signal.evaluate(context)).toBe(true);
  });

  it('does not fire for disjoint tokens', () => {
    const context = baseContext({
      sourceField: 'color',
      targetField: 'region',
      idf: new Map(),
    });
    expect(signal.evaluate(context)).toBe(false);
  });

  it('never skips (always returns a boolean)', () => {
    expect(signal.evaluate(baseContext())).not.toBeUndefined();
  });
});

describe('type-agreement', () => {
  const signal = signalByName('type-agreement');

  it('skips when either profile is missing', () => {
    expect(
      signal.evaluate(baseContext({ targetProfile: profile() })),
    ).toBeUndefined();
  });

  it('fires when dominant value types match and are not "other"', () => {
    const context = baseContext({
      sourceProfile: profile({ dominantValueType: 'uuid' }),
      targetProfile: profile({ dominantValueType: 'uuid' }),
    });
    expect(signal.evaluate(context)).toBe(true);
  });

  it('does not fire when dominant types match but are both "other"', () => {
    const context = baseContext({
      sourceProfile: profile({ dominantValueType: 'other' }),
      targetProfile: profile({ dominantValueType: 'other' }),
    });
    expect(signal.evaluate(context)).toBe(false);
  });

  it('does not fire when dominant types differ', () => {
    const context = baseContext({
      sourceProfile: profile({ dominantValueType: 'uuid' }),
      targetProfile: profile({ dominantValueType: 'email' }),
    });
    expect(signal.evaluate(context)).toBe(false);
  });
});

describe('value-rarity', () => {
  const signal = signalByName('value-rarity');

  it('skips when there are no matched values', () => {
    expect(signal.evaluate(baseContext())).toBeUndefined();
  });

  it('skips when referencedValueCounts is absent', () => {
    const context = baseContext({
      matchedValueCounts: new Map([['v1', 1]]),
    });
    expect(signal.evaluate(context)).toBeUndefined();
  });

  it('fires when the median referenced frequency of matched values is <= 2', () => {
    const context = baseContext({
      matchedValueCounts: new Map([
        ['v1', 5],
        ['v2', 3],
      ]),
      referencedValueCounts: { v1: 1, v2: 2 },
    });
    expect(signal.evaluate(context)).toBe(true);
  });

  it('does not fire when the median referenced frequency is above 2', () => {
    const context = baseContext({
      matchedValueCounts: new Map([
        ['v1', 5],
        ['v2', 3],
      ]),
      referencedValueCounts: { v1: 10, v2: 20 },
    });
    expect(signal.evaluate(context)).toBe(false);
  });

  it('falls back to a frequency of 1 for a matched value missing from referencedValueCounts', () => {
    const context = baseContext({
      matchedValueCounts: new Map([['v1', 1]]),
      referencedValueCounts: {},
    });
    expect(signal.evaluate(context)).toBe(true); // median([1]) = 1 <= 2
  });
});

describe('key-key-penalty', () => {
  const signal = signalByName('key-key-penalty');

  it('skips when either profile is missing', () => {
    expect(
      signal.evaluate(baseContext({ sourceProfile: profile() })),
    ).toBeUndefined();
  });

  it('fires when both sides are key-like (cardinalityRatio >= 0.95)', () => {
    const context = baseContext({
      sourceProfile: profile({ cardinalityRatio: 0.99 }),
      targetProfile: profile({ cardinalityRatio: 0.97 }),
    });
    expect(signal.evaluate(context)).toBe(true);
  });

  it('does not fire when only one side is key-like', () => {
    const context = baseContext({
      sourceProfile: profile({ cardinalityRatio: 0.99 }),
      targetProfile: profile({ cardinalityRatio: 0.5 }),
    });
    expect(signal.evaluate(context)).toBe(false);
  });
});

describe('semantic-compatible / semantic-incompatible', () => {
  const compatible = signalByName('semantic-compatible');
  const incompatible = signalByName('semantic-incompatible');

  it('both skip when the source semantic is unknown', () => {
    const context = baseContext({ sourceField: 'gibberish_zzz' });
    expect(compatible.evaluate(context)).toBeUndefined();
    expect(incompatible.evaluate(context)).toBeUndefined();
  });

  it('semantic-compatible fires for the same domain', () => {
    const context = baseContext({
      sourceField: 'email_address',
      targetField: 'email',
    });
    expect(compatible.evaluate(context)).toBe(true);
    expect(incompatible.evaluate(context)).toBe(false);
  });

  it('semantic-incompatible fires for a mismatched domain', () => {
    const context = baseContext({
      sourceField: 'status',
      targetField: 'tenant',
    });
    expect(incompatible.evaluate(context)).toBe(true);
    expect(compatible.evaluate(context)).toBe(false);
  });

  it('both skip for a known-but-unlisted domain pair (fixed weak-domain fallthrough)', () => {
    // tenant ↔ service: both classify to a real (non-'unknown') semantic,
    // but the pair isn't in any explicit same/related/mismatch branch of
    // semanticCompatibility, so it falls through to 'weak-domain' — which
    // must skip both signals, not silently count as a 'mismatch' penalty.
    const context = baseContext({
      sourceField: 'tenant_id',
      targetField: 'name',
      referencedContainerName: 'deployment',
    });
    expect(compatible.evaluate(context)).toBeUndefined();
    expect(incompatible.evaluate(context)).toBeUndefined();
  });
});

describe('fan-out-sanity', () => {
  const signal = signalByName('fan-out-sanity');

  it('skips when there are no matched values', () => {
    expect(signal.evaluate(baseContext())).toBeUndefined();
  });

  it('skips when referencedValueCounts is absent', () => {
    const context = baseContext({
      matchedValueCounts: new Map([['v1', 1]]),
    });
    expect(signal.evaluate(context)).toBeUndefined();
  });

  it('fires when expected materialized edges exceed the sanity threshold', () => {
    // dependent(v1)=100 * referenced(v1)=100 * scale(1) = 10000
    // > FAN_OUT_SANITY_MAX(50) * max(1, 1 matched distinct) = 50.
    const context = baseContext({
      matchedValueCounts: new Map([['v1', 1]]),
      sourceProfile: profile({ valueCounts: { v1: 100 } }),
      referencedValueCounts: { v1: 100 },
      referencedSampleScale: 1,
    });
    expect(signal.evaluate(context)).toBe(true);
    expect(100 * 100 * 1).toBeGreaterThan(FAN_OUT_SANITY_MAX * 1);
  });

  it('does not fire when expected edges stay within the threshold', () => {
    const context = baseContext({
      matchedValueCounts: new Map([['v1', 1]]),
      sourceProfile: profile({ valueCounts: { v1: 2 } }),
      referencedValueCounts: { v1: 2 },
      referencedSampleScale: 1,
    });
    expect(signal.evaluate(context)).toBe(false);
  });

  it('uses the dependent profile frequency, not the accumulator match count', () => {
    // Regression: the accumulator counts are referenced-side search hits, so
    // using them as the dependent frequency squared the referenced count. A
    // huge match count with a low dependent frequency must NOT fire.
    const context = baseContext({
      matchedValueCounts: new Map([['v1', 1000]]),
      sourceProfile: profile({ valueCounts: { v1: 1 } }),
      referencedValueCounts: { v1: 1 },
      referencedSampleScale: 1,
    });
    // dependent(1) * referenced(1) = 1 <= 50, despite the 1000 match count.
    expect(signal.evaluate(context)).toBe(false);
  });

  it('scales expected edges by referencedSampleScale', () => {
    const nearBoundary = baseContext({
      matchedValueCounts: new Map([['v1', 1]]),
      sourceProfile: profile({ valueCounts: { v1: 5 } }),
      referencedValueCounts: { v1: 9 }, // 5*9=45 <= 50, does not fire unscaled
      referencedSampleScale: 1,
    });
    const scaledOverBoundary = { ...nearBoundary, referencedSampleScale: 2 }; // 45*2=90 > 50
    expect(signal.evaluate(nearBoundary)).toBe(false);
    expect(signal.evaluate(scaledOverBoundary)).toBe(true);
  });
});

describe('hierarchy-context', () => {
  const signal = signalByName('hierarchy-context');

  it('never skips (path is always known)', () => {
    expect(signal.evaluate(baseContext())).not.toBeUndefined();
  });

  it('fires when the dependent field path has a parent-ish segment (parent_id, collapsed to "parentid")', () => {
    const context = baseContext({ sourceField: '$.parent_id' });
    expect(signal.evaluate(context)).toBe(true);

    const result = fsScoreCandidate(context);
    const entry = result.waterfall.find(e => e.signal === 'hierarchy-context');
    expect(entry?.fired).toBe(true);
    expect(entry?.weight).toBe(-0.585); // log2(0.30/0.45)
  });

  it('does not fire for an ordinary field path', () => {
    const context = baseContext({ sourceField: '$.status' });
    expect(signal.evaluate(context)).toBe(false);

    const result = fsScoreCandidate(context);
    const entry = result.waterfall.find(e => e.signal === 'hierarchy-context');
    expect(entry?.fired).toBe(false);
    expect(entry?.weight).toBe(0.348); // log2(0.70/0.55)
  });

  it.each(['$.parent', '$._parent', '$.ancestor', '$.ancestors'])(
    'fires for the parent-token bucket segment %s',
    field => {
      expect(signal.evaluate(baseContext({ sourceField: field }))).toBe(true);
    },
  );

  it('always scores at the seeded weights regardless of measured-u overrides for other signals (fixedU: measureU never contributes an entry for it)', () => {
    // Mirrors what a real run's uBySignal map looks like post-Fix-1: every
    // other signal may carry a measured override, but hierarchy-context
    // never has a key (see uEstimation.test.ts) — resolveU falls through to
    // its uSeed regardless of what other signals measured.
    const uBySignal = new Map([
      ['containment-0.99', 0.3],
      ['type-agreement', 0.4],
      ['name-similarity', 0.1],
    ]);

    const fired = fsScoreCandidate(
      baseContext({ sourceField: '$.parent_id' }),
      uBySignal,
    );
    const notFired = fsScoreCandidate(
      baseContext({ sourceField: '$.status' }),
      uBySignal,
    );

    expect(
      fired.waterfall.find(e => e.signal === 'hierarchy-context')?.weight,
    ).toBe(-0.585);
    expect(
      notFired.waterfall.find(e => e.signal === 'hierarchy-context')?.weight,
    ).toBe(0.348);
  });
});

describe('fsScoreCandidate: FS math', () => {
  it('hand-computed case with clean power-of-two u overrides', () => {
    // containment-0.99 (m=.55) with u=.55/4 -> weight = log2(4) = 2
    // type-agreement   (m=.95) with u=.95/8 -> weight = log2(8) = 3
    // everything else skipped -> logOdds = -5 + 2 + 3 = 0 -> p = sigmoid(0) = 0.5
    const context = baseContext({
      containment: 0.99,
      sourceField: 'gibberish_zzz', // unknown semantic, disjoint name tokens
      targetField: 'other_gibberish_yyy',
      sourceProfile: profile({ dominantValueType: 'uuid', valueCounts: {} }),
      targetProfile: profile({
        dominantValueType: 'uuid',
        valueCounts: { a: 1 }, // < 20 distinct -> distribution-agreement skips
      }),
    });
    const uBySignal = new Map([
      ['containment-0.99', 0.55 / 4],
      ['type-agreement', 0.95 / 8],
      // neutralize name-similarity, key-key-penalty and hierarchy-context:
      // u === m makes their contribution exactly log2(1) = 0 regardless of
      // fired/not-fired.
      ['name-similarity', 0.6],
      ['key-key-penalty', 0.05],
      ['hierarchy-context', 0.3],
    ]);

    const result = fsScoreCandidate(context, uBySignal);

    expect(result.logOdds).toBeCloseTo(0, 9);
    expect(result.probability).toBeCloseTo(0.5, 9);
    expect(result.band).toBe('low');

    const containmentEntry = result.waterfall.find(
      e => e.signal === 'containment-0.99',
    );
    expect(containmentEntry?.weight).toBe(2);
    const typeEntry = result.waterfall.find(e => e.signal === 'type-agreement');
    expect(typeEntry?.weight).toBe(3);
  });

  it('seed-default case: containment-0.99 + type-agreement fire, name-similarity and key-key-penalty present-but-not-fired, everything else skips', () => {
    // hierarchy-context never skips, so it would otherwise also contribute a
    // real (uSeed-derived) term here — neutralize it (u === m -> weight 0) so
    // this test stays scoped to the four signals its name and comments are
    // about; every other weight below still uses the table's uSeed with no
    // override. Profiles are present (required for type-agreement to fire),
    // which also forces key-key-penalty to be evaluated rather than skipped
    // (its only skip condition is a missing profile) — it does not fire
    // because cardinalityRatio (0.5 default, see `profile()`) is < 0.95 on
    // both sides. name-similarity never skips and does not fire here because
    // 'gibberish_zzz'/'other_gibberish_yyy' share no idf-informative tokens
    // (the default `idf` map is empty, so every token falls back to the
    // generic weight and the ratio's denominator is 0 -> score 0).
    // distribution-agreement skips (target has 1 distinct value, < 20).
    // value-rarity/fan-out-sanity skip (no matched values). semantic-
    // compatible/incompatible skip (both fields classify 'unknown').
    //
    // Hand/verified arithmetic (log base 2):
    //   containment-0.99 (fired):        log2(0.55/0.01)        = 5.781359713524660
    //   type-agreement (fired):          log2(0.95/0.50)        = 0.925999418556223
    //   name-similarity (not fired):      log2(0.40/0.95)        = -1.247927513443585
    //   key-key-penalty (not fired):      log2(0.95/0.70)        = 0.440572591385981
    //   logOdds = -5 + 5.781359713524660 + 0.925999418556223
    //           - 1.247927513443585 + 0.440572591385981 = 0.900004210023279
    // which rounds to 4dp as 0.9 (the 5th decimal digit is 0, not 5+, so it
    // rounds down, not to 0.9001) — probability is insensitive to that last
    // ten-thousandth either way.
    const context = baseContext({
      containment: 0.99,
      sourceField: 'gibberish_zzz', // unknown semantic; no shared idf-weighted tokens
      targetField: 'other_gibberish_yyy',
      sourceProfile: profile({ dominantValueType: 'uuid', valueCounts: {} }),
      targetProfile: profile({
        dominantValueType: 'uuid',
        valueCounts: { a: 1 }, // 1 distinct < 20 -> distribution-agreement skips
      }),
    });

    const result = fsScoreCandidate(
      context,
      new Map([['hierarchy-context', 0.3]]),
    );

    const containmentEntry = result.waterfall.find(
      e => e.signal === 'containment-0.99',
    );
    const typeEntry = result.waterfall.find(e => e.signal === 'type-agreement');
    const nameEntry = result.waterfall.find(
      e => e.signal === 'name-similarity',
    );
    const kkEntry = result.waterfall.find(e => e.signal === 'key-key-penalty');

    expect(containmentEntry?.fired).toBe(true);
    expect(containmentEntry?.weight).toBe(5.781);
    expect(typeEntry?.fired).toBe(true);
    expect(typeEntry?.weight).toBe(0.926);
    expect(nameEntry?.fired).toBe(false);
    expect(kkEntry?.fired).toBe(false);

    const signals = result.waterfall.map(e => e.signal);
    expect(signals).not.toContain('distribution-agreement');
    expect(signals).not.toContain('value-rarity');
    expect(signals).not.toContain('fan-out-sanity');
    expect(signals).not.toContain('semantic-compatible');
    expect(signals).not.toContain('semantic-incompatible');

    expect(result.logOdds).toBe(0.9);
    expect(result.probability).toBe(0.6511);
    expect(result.band).toBe('low');
  });

  it('a non-firing signal contributes a negative term: log2((1-m)/(1-u))', () => {
    const context = baseContext({
      containment: 0.5, // below 0.85 -> containment group non-firing branch
      sourceField: 'color', // disjoint from targetField -> name-similarity != fire
      targetField: 'region',
    });
    const result = fsScoreCandidate(context);
    const nameEntry = result.waterfall.find(
      e => e.signal === 'name-similarity',
    );
    expect(nameEntry).toBeDefined();
    expect(nameEntry?.fired).toBe(false);
    const expected = Math.round(Math.log2(0.4 / 0.95) * 1000) / 1000;
    expect(expected).toBeLessThan(0);
    expect(nameEntry?.weight).toBe(expected);
  });

  it('an override to u changes the resulting weight', () => {
    const context = baseContext({
      sourceProfile: profile({ dominantValueType: 'uuid' }),
      targetProfile: profile({ dominantValueType: 'uuid' }),
    });
    const withoutOverride = fsScoreCandidate(context);
    const withOverride = fsScoreCandidate(
      context,
      new Map([['type-agreement', 0.2]]),
    );
    const entryWithout = withoutOverride.waterfall.find(
      e => e.signal === 'type-agreement',
    );
    const entryWith = withOverride.waterfall.find(
      e => e.signal === 'type-agreement',
    );
    expect(entryWithout?.weight).not.toBe(entryWith?.weight);
    expect(entryWith?.weight).toBe(
      Math.round(Math.log2(0.95 / 0.2) * 1000) / 1000,
    );
  });

  it('u is floored and capped even when overridden out of range', () => {
    const context = baseContext({
      sourceProfile: profile({ dominantValueType: 'uuid' }),
      targetProfile: profile({ dominantValueType: 'uuid' }),
    });
    const flooredBelow = fsScoreCandidate(
      context,
      new Map([['type-agreement', 0]]),
    );
    const flooredEntry = flooredBelow.waterfall.find(
      e => e.signal === 'type-agreement',
    );
    expect(flooredEntry?.weight).toBe(
      Math.round(Math.log2(0.95 / U_FLOOR) * 1000) / 1000,
    );

    const cappedAbove = fsScoreCandidate(
      context,
      new Map([['type-agreement', 10]]),
    );
    const cappedEntry = cappedAbove.waterfall.find(
      e => e.signal === 'type-agreement',
    );
    expect(cappedEntry?.weight).toBe(
      Math.round(Math.log2(0.95 / 0.95) * 1000) / 1000,
    );
  });

  it('a firing penalty signal (key-key-penalty) lowers the probability', () => {
    const withoutPenalty = baseContext({
      sourceField: 'alpha', // disjoint from targetField -> name-similarity never fires
      targetField: 'beta',
      sourceProfile: profile({ cardinalityRatio: 0.5 }),
      targetProfile: profile({ cardinalityRatio: 0.5 }),
    });
    const withPenalty = baseContext({
      sourceField: 'alpha',
      targetField: 'beta',
      sourceProfile: profile({ cardinalityRatio: 0.99 }),
      targetProfile: profile({ cardinalityRatio: 0.99 }),
    });

    const before = fsScoreCandidate(withoutPenalty);
    const after = fsScoreCandidate(withPenalty);

    const penaltyEntry = after.waterfall.find(
      e => e.signal === 'key-key-penalty',
    );
    expect(penaltyEntry?.fired).toBe(true);
    expect(after.probability).toBeLessThan(before.probability);
  });

  it('key-key-penalty does not fire when name-similarity also fired (documented dependency)', () => {
    const context = baseContext({
      sourceField: 'owner_id',
      targetField: 'id',
      referencedContainerName: 'owners',
      idf: new Map([
        ['owner', 3],
        ['id', 1],
      ]),
      sourceProfile: profile({ cardinalityRatio: 0.99 }),
      targetProfile: profile({ cardinalityRatio: 0.99 }),
    });
    const result = fsScoreCandidate(context);
    const nameEntry = result.waterfall.find(
      e => e.signal === 'name-similarity',
    );
    const penaltyEntry = result.waterfall.find(
      e => e.signal === 'key-key-penalty',
    );
    expect(nameEntry?.fired).toBe(true);
    expect(penaltyEntry?.fired).toBe(false);
  });

  it('fan-out-sanity does not fire when value-rarity also fired (documented dependency)', () => {
    const context = baseContext({
      matchedValueCounts: new Map([['v1', 100]]),
      referencedValueCounts: { v1: 1 }, // rare (median<=2) AND high fan-out
      referencedSampleScale: 1,
    });
    const result = fsScoreCandidate(context);
    const rarityEntry = result.waterfall.find(e => e.signal === 'value-rarity');
    const fanOutEntry = result.waterfall.find(
      e => e.signal === 'fan-out-sanity',
    );
    expect(rarityEntry?.fired).toBe(true);
    expect(fanOutEntry?.fired).toBe(false);
  });

  it('skipped signals are absent from the waterfall', () => {
    const context = baseContext({
      containment: 0.99,
      sourceField: 'gibberish_zzz',
      targetField: 'other_gibberish_yyy',
      // no profiles -> distribution-agreement, type-agreement, key-key-penalty skip
      // no matched values -> value-rarity, fan-out-sanity skip
      // unknown semantics -> semantic-compatible/incompatible skip
    });
    const result = fsScoreCandidate(context);
    const signals = result.waterfall.map(e => e.signal);
    expect(signals).not.toContain('distribution-agreement');
    expect(signals).not.toContain('type-agreement');
    expect(signals).not.toContain('key-key-penalty');
    expect(signals).not.toContain('value-rarity');
    expect(signals).not.toContain('fan-out-sanity');
    expect(signals).not.toContain('semantic-compatible');
    expect(signals).not.toContain('semantic-incompatible');
    // containment and name-similarity never skip
    expect(signals).toContain('containment-0.99');
    expect(signals).toContain('name-similarity');
  });

  it('containment < 0.85 collapses the group into one non-firing "containment" entry', () => {
    const context = baseContext({ containment: 0.5 });
    const result = fsScoreCandidate(context);
    const containmentEntries = result.waterfall.filter(e =>
      e.signal.startsWith('containment'),
    );
    expect(containmentEntries).toHaveLength(1);
    expect(containmentEntries[0].signal).toBe('containment');
    expect(containmentEntries[0].fired).toBe(false);
    expect(containmentEntries[0].detail).toBe('containment 0.50');
    const expectedU = Math.min(0.95, 0.01 + 0.02 + 0.05);
    expect(containmentEntries[0].weight).toBe(
      Math.round(Math.log2(0.05 / (1 - expectedU)) * 1000) / 1000,
    );
  });

  it('the waterfall lists prior first, then the containment group, then table order', () => {
    const context = baseContext({
      sourceProfile: profile({
        dominantValueType: 'uuid',
        cardinalityRatio: 0.99,
      }),
      targetProfile: profile({
        dominantValueType: 'uuid',
        cardinalityRatio: 0.99,
      }),
    });
    const result = fsScoreCandidate(context);
    const order = result.waterfall.map(e => e.signal);
    expect(order[0]).toBe('prior');
    expect(order[1]).toBe('containment-0.99');
    // name-similarity precedes type-agreement per table order
    expect(order.indexOf('name-similarity')).toBeLessThan(
      order.indexOf('type-agreement'),
    );
  });

  it('is deterministic across repeated calls with the same input', () => {
    const context = baseContext({
      sourceProfile: profile({ dominantValueType: 'uuid' }),
      targetProfile: profile({ dominantValueType: 'uuid' }),
      matchedValueCounts: new Map([['v1', 2]]),
      referencedValueCounts: { v1: 1 },
    });
    const first = fsScoreCandidate(context);
    const second = fsScoreCandidate(context);
    expect(second).toEqual(first);
  });
});

describe('fsScoreCandidate: explanation format', () => {
  it('pins the exact format: top-3 |weight| entries, then prior, then p', () => {
    const context = baseContext({
      containment: 0.99,
      sourceField: 'owner_id',
      targetField: 'id',
      referencedContainerName: 'owners',
      idf: new Map([
        ['owner', 3],
        ['id', 1],
      ]),
      sourceProfile: profile({ dominantValueType: 'uuid', valueCounts: {} }),
      targetProfile: profile({
        dominantValueType: 'uuid',
        cardinalityRatio: 0.5,
        valueCounts: { a: 1, b: 1 }, // < 20 -> distribution-agreement skips
      }),
    });
    const uBySignal = new Map([
      ['containment-0.99', 0.55 / 8], // weight = log2(8) = 3
      ['name-similarity', 0.6 / 16], // weight = log2(16) = 4
      ['type-agreement', 0.95 / 2], // weight = log2(2) = 1
      ['key-key-penalty', 0.05], // neutralized: u === m -> weight 0
      ['hierarchy-context', 0.3], // neutralized: u === m -> weight 0
    ]);

    const result = fsScoreCandidate(context, uBySignal);

    expect(result.logOdds).toBe(3); // -5 + 4 + 3 + 1 + 0
    expect(result.probability).toBeCloseTo(8 / 9, 4);
    expect(result.explanation).toBe(
      'name owner_id↔owners.id (+4.00), containment 0.99 (+3.00), type-agreement (+1.00), prior (−5.00) → p=0.89',
    );
  });
});

describe('fsScoreCandidate: band mapping', () => {
  it('p exactly at HIGH_BAND_MIN_P (0.9) is "high"', () => {
    // Split the needed weight across two signals so each u stays within
    // [U_FLOOR, 0.95] — no single table signal can reach this alone.
    const targetLogOdds = Math.log2(HIGH_BAND_MIN_P / (1 - HIGH_BAND_MIN_P));
    const neededWeight = targetLogOdds - PRIOR_LOG_ODDS;
    const half = neededWeight / 2;
    const context = baseContext({
      containment: 0.99,
      sourceField: 'gibberish_zzz',
      targetField: 'other_gibberish_yyy',
      sourceProfile: profile({ dominantValueType: 'uuid', valueCounts: {} }),
      targetProfile: profile({
        dominantValueType: 'uuid',
        valueCounts: { a: 1 },
      }),
    });
    const uBySignal = new Map([
      ['containment-0.99', 0.55 / 2 ** half],
      ['type-agreement', 0.95 / 2 ** half],
      ['name-similarity', 0.6],
      ['key-key-penalty', 0.05],
      ['hierarchy-context', 0.3],
    ]);
    const result = fsScoreCandidate(context, uBySignal);
    expect(result.probability).toBeCloseTo(HIGH_BAND_MIN_P, 4);
    expect(result.band).toBe('high');
  });

  it('p just below HIGH_BAND_MIN_P (0.9) is "medium"', () => {
    const targetLogOdds = Math.log2(HIGH_BAND_MIN_P / (1 - HIGH_BAND_MIN_P));
    const neededWeight = targetLogOdds - PRIOR_LOG_ODDS - 0.05; // nudge below
    const half = neededWeight / 2;
    const context = baseContext({
      containment: 0.99,
      sourceField: 'gibberish_zzz',
      targetField: 'other_gibberish_yyy',
      sourceProfile: profile({ dominantValueType: 'uuid', valueCounts: {} }),
      targetProfile: profile({
        dominantValueType: 'uuid',
        valueCounts: { a: 1 },
      }),
    });
    const uBySignal = new Map([
      ['containment-0.99', 0.55 / 2 ** half],
      ['type-agreement', 0.95 / 2 ** half],
      ['name-similarity', 0.6],
      ['key-key-penalty', 0.05],
      ['hierarchy-context', 0.3],
    ]);
    const result = fsScoreCandidate(context, uBySignal);
    expect(result.probability).toBeLessThan(HIGH_BAND_MIN_P);
    expect(result.band).toBe('medium');
  });

  it('p exactly at MEDIUM_BAND_MIN_P (0.7) is "medium"', () => {
    const targetLogOdds = Math.log2(
      MEDIUM_BAND_MIN_P / (1 - MEDIUM_BAND_MIN_P),
    );
    const neededWeight = targetLogOdds - PRIOR_LOG_ODDS;
    const context = baseContext({
      containment: 0.99,
      sourceField: 'gibberish_zzz',
      targetField: 'other_gibberish_yyy',
    });
    const uBySignal = new Map([
      ['containment-0.99', 0.55 / 2 ** neededWeight],
      ['name-similarity', 0.6],
      ['hierarchy-context', 0.3],
    ]);
    const result = fsScoreCandidate(context, uBySignal);
    expect(result.probability).toBeCloseTo(MEDIUM_BAND_MIN_P, 4);
    expect(result.band).toBe('medium');
  });

  it('p just below MEDIUM_BAND_MIN_P (0.7) is "low"', () => {
    const targetLogOdds = Math.log2(
      MEDIUM_BAND_MIN_P / (1 - MEDIUM_BAND_MIN_P),
    );
    const neededWeight = targetLogOdds - PRIOR_LOG_ODDS - 0.05;
    const context = baseContext({
      containment: 0.99,
      sourceField: 'gibberish_zzz',
      targetField: 'other_gibberish_yyy',
    });
    const uBySignal = new Map([
      ['containment-0.99', 0.55 / 2 ** neededWeight],
      ['name-similarity', 0.6],
      ['hierarchy-context', 0.3],
    ]);
    const result = fsScoreCandidate(context, uBySignal);
    expect(result.probability).toBeLessThan(MEDIUM_BAND_MIN_P);
    expect(result.band).toBe('low');
  });
});

describe('fsScoreCandidate: calibration', () => {
  it('identity regression: passing IDENTITY_CALIBRATION is byte-identical to omitting calibration', () => {
    const context = baseContext({
      containment: 0.99,
      sourceField: 'gibberish_zzz',
      targetField: 'other_gibberish_yyy',
      sourceProfile: profile({ dominantValueType: 'uuid', valueCounts: {} }),
      targetProfile: profile({
        dominantValueType: 'uuid',
        valueCounts: { a: 1 },
      }),
    });
    const uBySignal = new Map([['hierarchy-context', 0.3]]);

    const withoutCalibration = fsScoreCandidate(context, uBySignal);
    const withIdentity = fsScoreCandidate(
      context,
      uBySignal,
      IDENTITY_CALIBRATION,
    );

    expect(withIdentity).toEqual(withoutCalibration);
  });

  it('sharpening (a=1.5, b=0.3) re-bands a medium score to high, matches applyCalibration exactly, and leaves waterfall weights unchanged', () => {
    const context = baseContext({
      containment: 0.99,
      sourceField: 'gibberish_zzz',
      targetField: 'other_gibberish_yyy',
      sourceProfile: profile({ dominantValueType: 'uuid', valueCounts: {} }),
      targetProfile: profile({
        dominantValueType: 'uuid',
        valueCounts: { a: 1 },
      }),
    });
    // containment-0.99 (m=.55) with u=.55/4  -> weight = log2(4)  = 2
    // type-agreement   (m=.95) with u=.95/32 -> weight = log2(32) = 5
    // logOdds = -5 + 2 + 5 = 2 -> p = sigmoid(2) = 0.8 -> band 'medium'
    const uBySignal = new Map([
      ['containment-0.99', 0.55 / 4],
      ['type-agreement', 0.95 / 32],
      ['name-similarity', 0.6],
      ['key-key-penalty', 0.05],
      ['hierarchy-context', 0.3],
    ]);
    const calibration: ScoreCalibration = { a: 1.5, b: 0.3, labelCount: 40 };

    const before = fsScoreCandidate(context, uBySignal);
    const after = fsScoreCandidate(context, uBySignal, calibration);

    expect(before.logOdds).toBeCloseTo(2, 9);
    expect(before.probability).toBeCloseTo(0.8, 9);
    expect(before.band).toBe('medium');

    const expectedEffectiveLogOdds =
      Math.round(applyCalibration(before.logOdds, calibration) * 10000) / 10000;
    expect(after.logOdds).toBe(expectedEffectiveLogOdds);
    expect(after.band).toBe('high');

    // Raw evidence stays honest: only the summed probability/logOdds/band move.
    expect(after.waterfall).toEqual(before.waterfall);
  });

  it('explanation reflects the calibrated probability, not the raw one', () => {
    const context = baseContext({
      containment: 0.99,
      sourceField: 'gibberish_zzz',
      targetField: 'other_gibberish_yyy',
      sourceProfile: profile({ dominantValueType: 'uuid', valueCounts: {} }),
      targetProfile: profile({
        dominantValueType: 'uuid',
        valueCounts: { a: 1 },
      }),
    });
    const uBySignal = new Map([
      ['containment-0.99', 0.55 / 4],
      ['type-agreement', 0.95 / 32],
      ['name-similarity', 0.6],
      ['key-key-penalty', 0.05],
      ['hierarchy-context', 0.3],
    ]);
    const calibration: ScoreCalibration = { a: 1.5, b: 0.3, labelCount: 40 };

    const raw = fsScoreCandidate(context, uBySignal);
    const calibrated = fsScoreCandidate(context, uBySignal, calibration);

    expect(calibrated.probability).not.toBe(raw.probability);
    expect(calibrated.explanation).toContain(
      `p=${calibrated.probability.toFixed(2)}`,
    );
    expect(calibrated.explanation).not.toContain(
      `p=${raw.probability.toFixed(2)}`,
    );
  });

  it('a below-threshold identity-VALUED calibration copy (not the IDENTITY_CALIBRATION singleton) is a byte-identical no-op — the real <30-label production path', () => {
    const context = baseContext({
      sourceProfile: profile({ dominantValueType: 'uuid' }),
      targetProfile: profile({ dominantValueType: 'uuid' }),
    });
    const uBySignal = new Map([['type-agreement', 0.2]]);
    // Deliberately NOT the IDENTITY_CALIBRATION singleton — this is the
    // reference-distinct, identity-VALUED copy computeCalibration returns
    // below MIN_CALIBRATION_LABELS (see scoreCalibration.ts). A reference
    // check would send this down the arithmetic path; only a value check
    // (a===1 && b===0) inside applyCalibration keeps it a byte-exact no-op.
    const belowThresholdCopy: ScoreCalibration = {
      a: 1,
      b: 0,
      labelCount: 37,
    };
    expect(belowThresholdCopy).not.toBe(IDENTITY_CALIBRATION);

    const withoutCalibration = fsScoreCandidate(context, uBySignal);
    const withCopy = fsScoreCandidate(context, uBySignal, belowThresholdCopy);

    expect(withCopy).toEqual(withoutCalibration);
  });
});
