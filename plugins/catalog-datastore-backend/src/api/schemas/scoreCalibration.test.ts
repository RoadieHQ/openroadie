import { describe, expect, it } from 'vitest';
import type {
  RelationshipSuggestionEvidenceSummary,
  RelationshipSuggestionWaterfallEntry,
} from '@roadiehq/catalog-datastore-common';
import type { SuggestionVerdict } from '../../database/SuggestionVerdictDao';
import {
  applyCalibration,
  computeCalibration,
  IDENTITY_CALIBRATION,
  MIN_CALIBRATION_LABELS,
} from './scoreCalibration';

const FIELD_STATS = {
  distinctCount: 0,
  rowCoverage: 0,
  cardinalityRatio: 0,
  looksEnumLike: false,
  isIdentifierLike: false,
};

function evidenceWithLogOdds(
  rawLogOdds: number,
): RelationshipSuggestionEvidenceSummary {
  // A single 'prior' waterfall entry whose weight is the whole rawLogOdds is
  // enough to exercise the reconstruction sum — computeCalibration only ever
  // sums `waterfall[].weight`, it does not care how many entries there are.
  const waterfall: RelationshipSuggestionWaterfallEntry[] = [
    { signal: 'prior', fired: true, weight: rawLogOdds },
  ];
  return {
    valueTypes: [],
    distinctMatchedValueCount: 0,
    sourceFieldStats: FIELD_STATS,
    targetFieldStats: FIELD_STATS,
    commonValuePenalty: 0,
    topMatchedValues: [],
    explanation: '',
    waterfall,
  };
}

function evidenceWithRawWaterfall(
  waterfall: unknown,
): RelationshipSuggestionEvidenceSummary {
  // Bypasses the RelationshipSuggestionWaterfallEntry[] type on purpose: this
  // constructs the exact shape a corrupt/legacy verdict row can carry (a
  // truthy non-array, or an array with a non-numeric weight) so the guards in
  // reconstructLogOdds are exercised the way real corrupt data would hit them.
  return {
    valueTypes: [],
    distinctMatchedValueCount: 0,
    sourceFieldStats: FIELD_STATS,
    targetFieldStats: FIELD_STATS,
    commonValuePenalty: 0,
    topMatchedValues: [],
    explanation: '',
    waterfall: waterfall as RelationshipSuggestionWaterfallEntry[],
  };
}

let nextVerdictId = 0;
function verdict(
  ruleId: string,
  action: SuggestionVerdict['action'],
  rawLogOdds: number | null,
  createdAt = '2026-01-01T00:00:00.000Z',
): SuggestionVerdict {
  nextVerdictId += 1;
  return {
    id: `verdict-${nextVerdictId}`,
    ruleId,
    action,
    actor: 'user:default/test',
    score: null,
    confidenceBand: null,
    evidenceSummary:
      rawLogOdds === null ? null : evidenceWithLogOdds(rawLogOdds),
    rankShown: null,
    createdAt,
  };
}

describe('computeCalibration', () => {
  it('returns IDENTITY_CALIBRATION below MIN_CALIBRATION_LABELS', () => {
    const verdicts: SuggestionVerdict[] = [];
    for (let i = 0; i < 10; i += 1) {
      verdicts.push(verdict(`approve-rule-${i}`, 'approve', 4));
      verdicts.push(verdict(`dismiss-rule-${i}`, 'dismiss', -4));
    }
    expect(verdicts.length).toBeLessThan(MIN_CALIBRATION_LABELS * 2);
    const result = computeCalibration(verdicts);
    expect(result).toEqual({ ...IDENTITY_CALIBRATION, labelCount: 20 });
  });

  it('returns identity when only one class is present', () => {
    const verdicts: SuggestionVerdict[] = [];
    for (let i = 0; i < 40; i += 1) {
      verdicts.push(verdict(`approve-rule-${i}`, 'approve', 2));
    }
    const result = computeCalibration(verdicts);
    expect(result).toEqual({ ...IDENTITY_CALIBRATION, labelCount: 40 });
  });

  it('excludes reset verdicts and applies latest-wins dedup to labelCount', () => {
    const verdicts: SuggestionVerdict[] = [];
    // 14 plain approves + 14 plain dismisses (28 labels) plus:
    for (let i = 0; i < 14; i += 1) {
      verdicts.push(verdict(`approve-rule-${i}`, 'approve', 3));
      verdicts.push(verdict(`dismiss-rule-${i}`, 'dismiss', -3));
    }
    // a rule whose terminal verdict is `reset` -> contributes no label
    verdicts.push(
      verdict('reset-rule', 'dismiss', -3, '2026-01-01T00:00:01.000Z'),
    );
    verdicts.push(
      verdict('reset-rule', 'reset', -3, '2026-01-01T00:00:02.000Z'),
    );
    // a rule dismissed then later approved -> counts once, as approve
    verdicts.push(
      verdict('flipped-rule', 'dismiss', 3, '2026-01-01T00:00:01.000Z'),
    );
    verdicts.push(
      verdict('flipped-rule', 'approve', 3, '2026-01-01T00:00:02.000Z'),
    );

    const result = computeCalibration(verdicts);
    // 28 plain + 1 flipped (reset-rule contributes nothing) = 29 < 30
    expect(result.labelCount).toBe(29);
    expect(result).toEqual({ ...IDENTITY_CALIBRATION, labelCount: 29 });
  });

  it('clamps an anti-correlated fit to a >= 0 rather than inverting every score', () => {
    // The exact sign-mirror of the "separable data sharpens the fit (a > 1)"
    // case: approvals sit at LOW raw-log-odds and dismissals at HIGH — the
    // model is anti-predictive, which fits a < 0 (a ~= -1.098 unclamped) and
    // would invert confidence for the whole run (higher raw score -> lower
    // calibrated score). The clamp floors it at 0 instead.
    const verdicts: SuggestionVerdict[] = [];
    for (let i = 0; i < 20; i += 1) {
      verdicts.push(verdict(`approve-low-${i}`, 'approve', -4));
      verdicts.push(verdict(`dismiss-high-${i}`, 'dismiss', 4));
    }
    const result = computeCalibration(verdicts);

    expect(result.labelCount).toBe(40);
    expect(result.a).toBe(0);
    expect(result.a).toBeGreaterThanOrEqual(0);
    // No inversion: a higher raw score must never calibrate below a lower one.
    // With a == 0 the calibrated value is constant, so the two are equal.
    expect(applyCalibration(8, result)).toBeGreaterThanOrEqual(
      applyCalibration(-8, result),
    );
  });

  it('skips verdicts with missing or waterfall-less evidence', () => {
    const verdicts: SuggestionVerdict[] = [];
    for (let i = 0; i < 16; i += 1) {
      verdicts.push(verdict(`approve-rule-${i}`, 'approve', 3));
      verdicts.push(verdict(`dismiss-rule-${i}`, 'dismiss', -3));
    }
    // null evidenceSummary
    verdicts.push(verdict('no-evidence-rule', 'approve', null));
    // evidenceSummary present but without a waterfall
    const evidenceNoWaterfall: RelationshipSuggestionEvidenceSummary = {
      valueTypes: [],
      distinctMatchedValueCount: 0,
      sourceFieldStats: FIELD_STATS,
      targetFieldStats: FIELD_STATS,
      commonValuePenalty: 0,
      topMatchedValues: [],
      explanation: '',
    };
    verdicts.push({
      id: 'verdict-no-waterfall',
      ruleId: 'no-waterfall-rule',
      action: 'dismiss',
      actor: 'user:default/test',
      score: null,
      confidenceBand: null,
      evidenceSummary: evidenceNoWaterfall,
      rankShown: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(() => computeCalibration(verdicts)).not.toThrow();
    const result = computeCalibration(verdicts);
    // 32 labelled points; the two extra verdicts are dropped, not counted.
    expect(result.labelCount).toBe(32);
  });

  it('does not throw on a truthy non-array waterfall and cleanly drops that verdict', () => {
    // Scenario 1 from the calibration-hardening review: a corrupt row whose
    // evidenceSummary.waterfall is a truthy non-array (e.g. `{}`) must not
    // make the reduce inside reconstructLogOdds throw — every subsequent
    // Generate would 500 forever since calibration reads the whole log.
    const verdicts: SuggestionVerdict[] = [];
    for (let i = 0; i < 20; i += 1) {
      verdicts.push(verdict(`approve-rule-${i}`, 'approve', 4));
      verdicts.push(verdict(`dismiss-rule-${i}`, 'dismiss', -4));
    }
    const baseline = computeCalibration(verdicts);

    const poisoned = [...verdicts];
    poisoned.push({
      id: 'poison-nonarray-verdict',
      ruleId: 'poison-nonarray-rule',
      action: 'approve',
      actor: 'user:default/test',
      score: null,
      confidenceBand: null,
      evidenceSummary: evidenceWithRawWaterfall({}),
      rankShown: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(() => computeCalibration(poisoned)).not.toThrow();
    const result = computeCalibration(poisoned);
    // The poison row is skipped, not counted — labelCount and the fit are
    // byte-identical to the fit without it, proving it was cleanly dropped.
    expect(result).toEqual(baseline);
    expect(result.labelCount).toBe(40);
  });

  it('drops a verdict with a non-numeric waterfall weight instead of collapsing the fit', () => {
    // Scenario 2 from the calibration-hardening review: a single non-numeric
    // weight makes the waterfall sum NaN, which (without the guard) makes the
    // fit's initial loss NaN, the line search never accepts a step, and
    // computeCalibration silently returns a degenerate {slope: 0, ...} fit —
    // every candidate collapses to the same probability. Assert the fit
    // instead matches the golden, non-degenerate separable-data value.
    const verdicts: SuggestionVerdict[] = [];
    for (let i = 0; i < 20; i += 1) {
      verdicts.push(verdict(`approve-rule-${i}`, 'approve', 4));
      verdicts.push(verdict(`dismiss-rule-${i}`, 'dismiss', -4));
    }
    verdicts.push({
      id: 'poison-weight-verdict',
      ruleId: 'poison-weight-rule',
      action: 'approve',
      actor: 'user:default/test',
      score: null,
      confidenceBand: null,
      evidenceSummary: evidenceWithRawWaterfall([
        { signal: 'prior', fired: true, weight: 'not-a-number' },
      ]),
      rankShown: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(() => computeCalibration(verdicts)).not.toThrow();
    const result = computeCalibration(verdicts);
    // The poison row is dropped; the remaining 40 valid labels produce the
    // same golden fit as the "separable data sharpens the fit" test — not the
    // degenerate a=0 constant-collapse the missing guard would have produced.
    expect(result.labelCount).toBe(40);
    expect(result.a).not.toBe(0);
    expect(result.a).toBeCloseTo(1.0980793556932782, 9);
    expect(result.b).toBeCloseTo(0, 9);
  });
});

describe('applyCalibration', () => {
  it('is an exact no-op under IDENTITY_CALIBRATION and any identity-valued calibration', () => {
    const values = [
      0, 1, -1, 4, -4, 2.5, -3.333, 7.777, 0.001, -0.001, 100, -100,
      // Adversarial: these lose a ULP through the bare arithmetic
      // `(x*Math.LN2)/Math.LN2` (confirmed empirically — about 17% of
      // doubles do), so they only pass if applyCalibration short-circuits on
      // identity-valued {a,b} rather than always computing through LN2.
      0.1234667, 0.3704601, 1.4829204000000002, 1.8541005000000002, 3.2166342,
    ];
    // A below-threshold-style COPY of the identity values, reference-distinct
    // from IDENTITY_CALIBRATION (as computeCalibration actually returns via
    // `{...IDENTITY_CALIBRATION, labelCount: n}`) — the short-circuit must be
    // value-based, not `calibration === IDENTITY_CALIBRATION`.
    const identityValuedCopy = { a: 1, b: 0, labelCount: 42 };
    expect(identityValuedCopy).not.toBe(IDENTITY_CALIBRATION);

    for (const rawLogOdds of values) {
      expect(applyCalibration(rawLogOdds, IDENTITY_CALIBRATION)).toBe(
        rawLogOdds,
      );
      expect(applyCalibration(rawLogOdds, identityValuedCopy)).toBe(rawLogOdds);
    }
  });

  it('pins the sign direction: well-separated approve-high/dismiss-low data yields a > 0', () => {
    const verdicts: SuggestionVerdict[] = [];
    for (let i = 0; i < 20; i += 1) {
      verdicts.push(verdict(`approve-rule-${i}`, 'approve', 4));
      verdicts.push(verdict(`dismiss-rule-${i}`, 'dismiss', -4));
    }
    const result = computeCalibration(verdicts);
    expect(result.a).toBeGreaterThan(0);
    // A flipped-sign transcription would produce a < 0 here (probabilities
    // moving the wrong way as xe increases) — fail loudly if that happens.
    expect(applyCalibration(8, result)).toBeGreaterThan(
      applyCalibration(-8, result),
    );
  });

  it('separable data sharpens the fit (a > 1), golden-pinned', () => {
    const verdicts: SuggestionVerdict[] = [];
    for (let i = 0; i < 20; i += 1) {
      verdicts.push(verdict(`approve-rule-${i}`, 'approve', 4));
      verdicts.push(verdict(`dismiss-rule-${i}`, 'dismiss', -4));
    }
    const result = computeCalibration(verdicts);
    expect(result.labelCount).toBe(40);
    expect(result.a).toBeGreaterThan(1);
    // Golden values pinned from a passing run — see task-2-report.md for the
    // exact input and how to reproduce them independently.
    expect(result.a).toBeCloseTo(1.0980793556932782, 9);
    expect(result.b).toBeCloseTo(0, 9);
  });

  it('overlapping (miscalibrated-optimistic) data flattens the fit (a < 1), golden-pinned', () => {
    const verdicts: SuggestionVerdict[] = [];
    // The raw score claims strong separation (+4 / -4) but the true labels
    // overlap at both ends — the model was overconfident, so calibration
    // should dampen the slope.
    for (let i = 0; i < 12; i += 1) {
      verdicts.push(verdict(`approve-high-${i}`, 'approve', 4));
    }
    for (let i = 0; i < 8; i += 1) {
      verdicts.push(verdict(`dismiss-high-${i}`, 'dismiss', 4));
    }
    for (let i = 0; i < 12; i += 1) {
      verdicts.push(verdict(`dismiss-low-${i}`, 'dismiss', -4));
    }
    for (let i = 0; i < 8; i += 1) {
      verdicts.push(verdict(`approve-low-${i}`, 'approve', -4));
    }
    const result = computeCalibration(verdicts);
    expect(result.labelCount).toBe(40);
    expect(result.a).toBeGreaterThan(0);
    expect(result.a).toBeLessThan(1);
    // Golden values pinned from a passing run — see task-2-report.md.
    expect(result.a).toBeCloseTo(0.13262867917462035, 9);
    expect(result.b).toBeCloseTo(0, 9);
  });

  it('is deterministic: original and shuffled verdict order produce byte-identical output', () => {
    const verdicts: SuggestionVerdict[] = [];
    for (let i = 0; i < 20; i += 1) {
      verdicts.push(verdict(`approve-rule-${i}`, 'approve', 3 + i * 0.037));
      verdicts.push(verdict(`dismiss-rule-${i}`, 'dismiss', -3 - i * 0.053));
    }
    const result = computeCalibration(verdicts);

    // Fixed pseudo-random shuffle (deterministic seed, not Math.random) so
    // the test itself stays reproducible.
    const shuffled = [...verdicts];
    let seed = 42;
    const nextRandom = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(nextRandom() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const shuffledResult = computeCalibration(shuffled);
    expect(shuffledResult).toEqual(result);
  });
});
