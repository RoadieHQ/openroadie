import { describe, expect, it, vi } from 'vitest';
import type { FieldProfile } from './field-profiling';
import {
  applyCandidateGates,
  VERIFICATION_VALUE_CAP,
  type GateCandidate,
  type GateContext,
} from './candidateGates';

function profile(
  overrides: Partial<FieldProfile> & { valueCounts: Record<string, number> },
): FieldProfile {
  const distinctCount = Object.keys(overrides.valueCounts).length;
  return {
    field: 'field',
    rowCount: distinctCount,
    distinctCount,
    rowCoverage: 1,
    cardinalityRatio: 1,
    looksEnumLike: false,
    isIdentifierLike: false,
    dominantValueType: 'handle',
    valueContainer: 'scalar',
    valueTypeDistribution: {},
    ...overrides,
  };
}

function candidate(overrides: Partial<GateCandidate> = {}): GateCandidate {
  return {
    sourceField: 'sourceField',
    targetField: 'targetField',
    distinctMatchedValueCount: 0,
    ...overrides,
  };
}

const NO_VERIFY_CONTEXT: GateContext = { targetCorpusPartial: false };

// A source/target pair with plenty of eligible values, full overlap, and
// key-like referenced cardinality — the "everything else passes" baseline so
// individual gate tests can isolate the gate under test.
function passthroughProfiles(keys: string[]): {
  source: FieldProfile;
  target: FieldProfile;
} {
  const valueCounts = Object.fromEntries(keys.map(k => [k, 1]));
  return {
    source: profile({
      valueCounts,
      cardinalityRatio: 1,
      isIdentifierLike: true,
    }),
    target: profile({
      valueCounts,
      cardinalityRatio: 1,
      isIdentifierLike: true,
    }),
  };
}

function eligibleHandles(count: number, prefix = 'handle'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}alpha`);
}

describe('applyCandidateGates — identity-mirror', () => {
  it('fails when both sides are id fields', async () => {
    const result = await applyCandidateGates(
      candidate({ sourceField: '$.id', targetField: '$.id' }),
      NO_VERIFY_CONTEXT,
    );
    expect(result).toEqual({
      passed: false,
      reason: 'identity-mirror',
      evidence: {},
    });
  });

  it('passes through when only one side is an id field', async () => {
    const { source, target } = passthroughProfiles(eligibleHandles(10));
    const result = await applyCandidateGates(
      candidate({
        sourceField: '$.id',
        targetField: '$.owner',
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: 10,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result.passed).toBe(true);
  });
});

describe('applyCandidateGates — trivial-domain', () => {
  it('fails when source has fewer than 3 eligible distinct values', async () => {
    const source = profile({
      valueCounts: { alphaone: 1, alphatwo: 1 },
    });
    const result = await applyCandidateGates(
      candidate({ sourceProfile: source }),
      NO_VERIFY_CONTEXT,
    );
    expect(result).toEqual({
      passed: false,
      reason: 'trivial-domain',
      evidence: {},
    });
  });

  it('fails when source is boolean-like', async () => {
    // 'true'/'false' alone are only 2 distinct values — pad past the
    // distinct-count gate with a third boolean-like eligible value.
    const source = profile({
      valueCounts: { true: 5, false: 5, yes: 2 },
    });
    const result = await applyCandidateGates(
      candidate({ sourceProfile: source }),
      NO_VERIFY_CONTEXT,
    );
    expect(result).toEqual({
      passed: false,
      reason: 'trivial-domain',
      evidence: {},
    });
  });

  it('fails a tiny enum with a dominant top value, with try-filter rescue hint', async () => {
    const source = profile({
      valueCounts: {
        alphaone: 60,
        alphatwo: 15,
        alphathree: 15,
        alphafour: 10,
      },
    });
    const result = await applyCandidateGates(
      candidate({ sourceProfile: source }),
      NO_VERIFY_CONTEXT,
    );
    expect(result).toEqual({
      passed: false,
      reason: 'trivial-domain',
      evidence: {},
      rescueHint: 'try-filter',
    });
  });

  it('passes a tiny enum whose top value is not dominant', async () => {
    const keys = ['alphaone', 'alphatwo', 'alphathree', 'alphafour'];
    const valueCounts = {
      alphaone: 30,
      alphatwo: 25,
      alphathree: 25,
      alphafour: 20,
    };
    const { target } = passthroughProfiles(keys);
    const source = profile({
      valueCounts,
      cardinalityRatio: 1,
      isIdentifierLike: true,
    });
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: keys.length,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result.passed).toBe(true);
  });

  it('fails when source values classify to null (e.g. ISO dates)', async () => {
    const source = profile({
      valueCounts: {
        '2024-01-01': 1,
        '2024-01-02': 1,
        '2024-01-03': 1,
      },
    });
    const result = await applyCandidateGates(
      candidate({ sourceProfile: source }),
      NO_VERIFY_CONTEXT,
    );
    expect(result).toEqual({
      passed: false,
      reason: 'trivial-domain',
      evidence: {},
    });
  });
});

describe('applyCandidateGates — containment', () => {
  it('passes via 90% raw source-to-target overlap', async () => {
    const sourceKeys = eligibleHandles(10);
    const targetKeys = [...sourceKeys.slice(0, 9), 'onlyintarget'];
    const source = profile({
      valueCounts: Object.fromEntries(sourceKeys.map(k => [k, 1])),
      isIdentifierLike: true,
    });
    const target = profile({
      valueCounts: Object.fromEntries(targetKeys.map(k => [k, 1])),
      cardinalityRatio: 1,
      isIdentifierLike: true,
    });
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: 9,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.evidence.containmentDirection).toBe('source-to-target');
      expect(result.evidence.containment).toBeCloseTo(0.9);
    }
  });

  it('passes via distinctMatchedValueCount coverage when raw overlap is 0 (alias archetype)', async () => {
    const sourceKeys = eligibleHandles(10, 'srcperson');
    const targetKeys = eligibleHandles(10, 'tgtperson');
    const source = profile({
      valueCounts: Object.fromEntries(sourceKeys.map(k => [k, 1])),
    });
    const target = profile({
      valueCounts: Object.fromEntries(targetKeys.map(k => [k, 1])),
      cardinalityRatio: 1,
    });
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: 9,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.evidence.containmentDirection).toBe('source-to-target');
      expect(result.evidence.containment).toBeCloseTo(0.9);
    }
  });

  it('passes via target-to-source when the target set is contained in the source', async () => {
    const targetKeys = eligibleHandles(10);
    const sourceKeys = [...targetKeys, ...eligibleHandles(20, 'extra')];
    const source = profile({
      valueCounts: Object.fromEntries(sourceKeys.map(k => [k, 1])),
    });
    const target = profile({
      valueCounts: Object.fromEntries(targetKeys.map(k => [k, 1])),
      cardinalityRatio: 1,
    });
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: 0,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.evidence.containmentDirection).toBe('target-to-source');
      expect(result.evidence.containment).toBeCloseTo(1);
    }
  });

  it('fails 60% overlap with try-transform rescue hint when both sides are identifier-like', async () => {
    const sourceKeys = eligibleHandles(10);
    const targetKeys = [
      ...sourceKeys.slice(0, 6),
      ...eligibleHandles(4, 'onlytarget'),
    ];
    const source = profile({
      valueCounts: Object.fromEntries(sourceKeys.map(k => [k, 1])),
      isIdentifierLike: true,
    });
    const target = profile({
      valueCounts: Object.fromEntries(targetKeys.map(k => [k, 1])),
      cardinalityRatio: 1,
      isIdentifierLike: true,
    });
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: 6,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result).toMatchObject({
      passed: false,
      reason: 'containment-below-threshold',
      rescueHint: 'try-transform',
    });
  });

  it('verifies missing values against the full corpus and passes when verification closes the gap', async () => {
    const sourceKeys = eligibleHandles(10);
    const overlapping = sourceKeys.slice(0, 6);
    const missingKeys = sourceKeys.slice(6);
    // Target-only noise keeps |T| large enough that raw t2s doesn't overtake
    // s2t/coverage and flip the direction — this pins the scenario to the
    // source-to-target verification branch.
    const targetOnlyNoise = eligibleHandles(4, 'noise');
    const source = profile({
      valueCounts: Object.fromEntries(sourceKeys.map(k => [k, 1])),
    });
    const target = profile({
      valueCounts: Object.fromEntries(
        [...overlapping, ...targetOnlyNoise].map(k => [k, 1]),
      ),
      cardinalityRatio: 1,
    });
    const verifyValuesPresent = vi.fn(
      async (values: string[]) => new Set(values),
    );
    const context: GateContext = {
      targetCorpusPartial: true,
      verifyValuesPresent,
    };
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: 6,
      }),
      context,
    );
    expect(verifyValuesPresent).toHaveBeenCalledWith(
      missingKeys.slice().sort(),
    );
    expect(result).toMatchObject({
      passed: true,
      evidence: {
        containmentDirection: 'source-to-target',
        containmentVerified: true,
      },
    });
  });

  it('does not call verifyValuesPresent when the target corpus is not partial', async () => {
    const sourceKeys = eligibleHandles(10);
    const overlapping = sourceKeys.slice(0, 6);
    const targetOnlyNoise = eligibleHandles(4, 'noise');
    const source = profile({
      valueCounts: Object.fromEntries(sourceKeys.map(k => [k, 1])),
    });
    const target = profile({
      valueCounts: Object.fromEntries(
        [...overlapping, ...targetOnlyNoise].map(k => [k, 1]),
      ),
      cardinalityRatio: 1,
    });
    const verifyValuesPresent = vi.fn(
      async (values: string[]) => new Set(values),
    );
    const context: GateContext = {
      targetCorpusPartial: false,
      verifyValuesPresent,
    };
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: 6,
      }),
      context,
    );
    expect(verifyValuesPresent).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      passed: false,
      reason: 'containment-below-threshold',
      evidence: {
        containmentDirection: 'source-to-target',
        containmentVerified: false,
      },
    });
  });
});

describe('applyCandidateGates — verification containment floor', () => {
  it('does not call verifyValuesPresent when best containment is just below the floor', async () => {
    // Out-of-order keys (see the cap test below) aren't needed here — this
    // fixture only pins `best` to a value, not the missing-values ordering.
    const sourceKeys = eligibleHandles(100);
    const overlapping = sourceKeys.slice(0, 49);
    // Keep |target| large so t2s (49/249) stays well below best (0.49) and
    // the direction doesn't flip to target-to-source.
    const targetOnlyNoise = eligibleHandles(200, 'noise');
    const source = profile({
      valueCounts: Object.fromEntries(sourceKeys.map(k => [k, 1])),
    });
    const target = profile({
      valueCounts: Object.fromEntries(
        [...overlapping, ...targetOnlyNoise].map(k => [k, 1]),
      ),
      cardinalityRatio: 1,
    });
    const verifyValuesPresent = vi.fn(
      async (values: string[]) => new Set(values),
    );
    const context: GateContext = {
      targetCorpusPartial: true,
      verifyValuesPresent,
    };
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: overlapping.length,
      }),
      context,
    );
    expect(verifyValuesPresent).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      passed: false,
      reason: 'containment-below-threshold',
    });
    expect(!result.passed && result.evidence.containment).toBeCloseTo(0.49);
  });

  it('calls verifyValuesPresent when best containment is at the floor', async () => {
    const sourceKeys = eligibleHandles(100);
    const overlapping = sourceKeys.slice(0, 50);
    const missingKeys = sourceKeys.slice(50);
    const targetOnlyNoise = eligibleHandles(200, 'noise');
    const source = profile({
      valueCounts: Object.fromEntries(sourceKeys.map(k => [k, 1])),
    });
    const target = profile({
      valueCounts: Object.fromEntries(
        [...overlapping, ...targetOnlyNoise].map(k => [k, 1]),
      ),
      cardinalityRatio: 1,
    });
    const verifyValuesPresent = vi.fn(async () => new Set<string>());
    const context: GateContext = {
      targetCorpusPartial: true,
      verifyValuesPresent,
    };
    await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: overlapping.length,
      }),
      context,
    );
    expect(verifyValuesPresent).toHaveBeenCalledWith(
      missingKeys.slice().sort(),
    );
  });
});

describe('applyCandidateGates — verification value cap', () => {
  it('caps verification at the 200 lexically-smallest missing values', async () => {
    // 250 source-eligible values with none in the target: every one of them
    // is "missing", well over VERIFICATION_VALUE_CAP, and their natural
    // numeric insertion order ("handle1alpha", "handle10alpha", …) is not
    // their lexical sort order — so this also exercises the determinism
    // sort, unlike a fixture whose keys already arrive in sorted order.
    const sourceKeys = eligibleHandles(250);
    const targetNoise = eligibleHandles(5, 'noise');
    const source = profile({
      valueCounts: Object.fromEntries(sourceKeys.map(k => [k, 1])),
    });
    const target = profile({
      valueCounts: Object.fromEntries(targetNoise.map(k => [k, 1])),
      cardinalityRatio: 1,
    });
    const verifyValuesPresent = vi.fn(
      async (_values: string[]) => new Set<string>(),
    );
    const context: GateContext = {
      targetCorpusPartial: true,
      verifyValuesPresent,
    };
    // distinctMatchedValueCount (200) pushes coverage to 0.8, clearing the
    // floor, independent of the (zero) raw source/target overlap — coverage
    // and raw overlap are measured over different evidence (see
    // checkContainment).
    await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: 200,
      }),
      context,
    );
    const expectedMissing = [...sourceKeys]
      .sort()
      .slice(0, VERIFICATION_VALUE_CAP);
    expect(verifyValuesPresent).toHaveBeenCalledTimes(1);
    const actualMissing = verifyValuesPresent.mock.calls[0][0];
    expect(actualMissing).toHaveLength(VERIFICATION_VALUE_CAP);
    expect(actualMissing).toEqual(expectedMissing);
  });
});

describe('applyCandidateGates — key-ness', () => {
  it('fails when the referenced (target) cardinality ratio is below threshold', async () => {
    const keys = eligibleHandles(10);
    const source = profile({
      valueCounts: Object.fromEntries(keys.map(k => [k, 1])),
    });
    const target = profile({
      valueCounts: Object.fromEntries(keys.map(k => [k, 1])),
      cardinalityRatio: 0.5,
    });
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: 10,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result).toMatchObject({
      passed: false,
      reason: 'referenced-not-key-like',
      evidence: { referencedCardinalityRatio: 0.5 },
    });
  });

  it('passes when the referenced cardinality ratio is 0.96', async () => {
    const keys = eligibleHandles(10);
    const source = profile({
      valueCounts: Object.fromEntries(keys.map(k => [k, 1])),
    });
    const target = profile({
      valueCounts: Object.fromEntries(keys.map(k => [k, 1])),
      cardinalityRatio: 0.96,
    });
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: 10,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result.passed).toBe(true);
  });

  it('checks the source profile ratio in the target-to-source direction', async () => {
    const targetKeys = eligibleHandles(10);
    const sourceKeys = [...targetKeys, ...eligibleHandles(20, 'extra')];
    const source = profile({
      valueCounts: Object.fromEntries(sourceKeys.map(k => [k, 1])),
      cardinalityRatio: 0.5,
    });
    const target = profile({
      valueCounts: Object.fromEntries(targetKeys.map(k => [k, 1])),
      cardinalityRatio: 1,
    });
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: 0,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result).toMatchObject({
      passed: false,
      reason: 'referenced-not-key-like',
      evidence: { referencedCardinalityRatio: 0.5 },
    });
  });
});

describe('applyCandidateGates — counter-collision', () => {
  it('fails when dependent ints sit inside a dense referenced id range', async () => {
    const referencedIds = Array.from({ length: 1000 }, (_, i) => String(i + 1));
    const dependentIds = Array.from({ length: 21 }, (_, i) => String(i + 100));
    const source = profile({
      valueCounts: Object.fromEntries(dependentIds.map(k => [k, 1])),
    });
    const target = profile({
      valueCounts: Object.fromEntries(referencedIds.map(k => [k, 1])),
      cardinalityRatio: 1,
    });
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: dependentIds.length,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result).toEqual({
      passed: false,
      reason: 'counter-collision',
      evidence: {},
    });
  });

  it('passes when the referenced ids are sparse', async () => {
    const referencedIds = Array.from({ length: 20 }, (_, i) => String(i * 100));
    const dependentIds = referencedIds.slice(0, 15);
    const source = profile({
      valueCounts: Object.fromEntries(dependentIds.map(k => [k, 1])),
    });
    const target = profile({
      valueCounts: Object.fromEntries(referencedIds.map(k => [k, 1])),
      cardinalityRatio: 1,
    });
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: dependentIds.length,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result.passed).toBe(true);
  });

  it('skips the gate for non-numeric sides', async () => {
    const { source, target } = passthroughProfiles(eligibleHandles(10));
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: 10,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result.passed).toBe(true);
  });

  it('passes a real many-to-one integer FK into a dense serial key', async () => {
    // Same dense referenced range and within-range dependents as the failing
    // case above, but the dependent is a foreign key that repeats its
    // referenced values (low cardinality ratio) — a genuine many-to-one join,
    // not two coincidentally-overlapping counters, so it must not be gated.
    const referencedIds = Array.from({ length: 1000 }, (_, i) => String(i + 1));
    const dependentIds = Array.from({ length: 21 }, (_, i) => String(i + 100));
    const source = profile({
      valueCounts: Object.fromEntries(dependentIds.map(k => [k, 1])),
      // 21 distinct FK values spread over many rows: each key referenced by
      // many dependents, the signature a counter never has.
      cardinalityRatio: 0.2,
    });
    const target = profile({
      valueCounts: Object.fromEntries(referencedIds.map(k => [k, 1])),
      cardinalityRatio: 1,
    });
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: dependentIds.length,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result.passed).toBe(true);
  });
});

describe('applyCandidateGates — array_contains key-ness', () => {
  it('checks key-ness on the scalar side, not the array side', async () => {
    // A membership join: scalar keys (unique) appear as elements of the other
    // side's array (never unique per row). Containment ties, so direction stays
    // source-to-target — which without matchStrategy awareness would run
    // key-ness on the array field and fail the join as referenced-not-key-like.
    const keys = eligibleHandles(10);
    const valueCounts = Object.fromEntries(keys.map(k => [k, 1]));
    const scalar = profile({
      valueCounts,
      valueContainer: 'scalar',
      cardinalityRatio: 1,
      isIdentifierLike: true,
    });
    const array = profile({
      valueCounts,
      valueContainer: 'array',
      // An array field is not unique per row — its low cardinality ratio is
      // exactly what wrongly tripped the key-ness gate before the fix.
      cardinalityRatio: 0.3,
    });
    const result = await applyCandidateGates(
      candidate({
        matchStrategy: 'array_contains',
        sourceProfile: scalar,
        targetProfile: array,
        distinctMatchedValueCount: keys.length,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result.passed).toBe(true);
  });

  it('still fails when the scalar key side is not key-like', async () => {
    // The fix repoints key-ness at the scalar side — it must not become a
    // blanket exemption: a non-unique scalar side is still a bad key.
    const keys = eligibleHandles(10);
    const valueCounts = Object.fromEntries(keys.map(k => [k, 1]));
    const scalar = profile({
      valueCounts,
      valueContainer: 'scalar',
      cardinalityRatio: 0.3,
    });
    const array = profile({
      valueCounts,
      valueContainer: 'array',
      cardinalityRatio: 0.3,
    });
    const result = await applyCandidateGates(
      candidate({
        matchStrategy: 'array_contains',
        sourceProfile: scalar,
        targetProfile: array,
        distinctMatchedValueCount: keys.length,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result).toMatchObject({
      passed: false,
      reason: 'referenced-not-key-like',
    });
  });
});

describe('applyCandidateGates — success evidence', () => {
  it('reports full evidence on a passing candidate', async () => {
    const keys = eligibleHandles(10);
    const { source, target } = passthroughProfiles(keys);
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: keys.length,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result).toEqual({
      passed: true,
      evidence: {
        containment: 1,
        containmentDirection: 'source-to-target',
        containmentVerified: false,
        referencedCardinalityRatio: 1,
        dependentDistinctCount: keys.length,
      },
    });
  });
});

describe('applyCandidateGates — insufficient-match-support', () => {
  it('fails a 1-value contained domain over corpora with room for more evidence', async () => {
    // The live topics→finalizers junk shape: source is a wide topics-like
    // domain, target's ONLY value everywhere is the literal it shares with the
    // source. Containment 1.0 fires target-to-source, keyness only tests the
    // referenced (source) side — the support gate is what catches it.
    const sourceValues = Object.fromEntries(
      eligibleHandles(40, 'topic').map(k => [k, 1]),
    );
    sourceValues.kubernetes = 1;
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: profile({
          valueCounts: sourceValues,
          rowCount: 214,
          cardinalityRatio: 1,
          isIdentifierLike: true,
        }),
        targetProfile: profile({
          valueCounts: { kubernetes: 85 },
          rowCount: 85,
          cardinalityRatio: 1 / 85,
        }),
        distinctMatchedValueCount: 1,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result).toEqual({
      passed: false,
      reason: 'insufficient-match-support',
      evidence: {},
    });
  });

  it('exempts a tiny corpus where one match is all the evidence there can be', async () => {
    // A 1-row referenced datasource (an org, a cluster): a single match IS the
    // complete evidence — leave the judgment to FS scoring.
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: profile({
          valueCounts: Object.fromEntries(
            eligibleHandles(6, 'team').map(k => [k, 1]),
          ),
          rowCount: 6,
          cardinalityRatio: 1,
          isIdentifierLike: true,
        }),
        targetProfile: profile({
          valueCounts: { team0alpha: 1 },
          rowCount: 1,
          cardinalityRatio: 1,
          isIdentifierLike: true,
        }),
        distinctMatchedValueCount: 1,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result.passed).toBe(true);
  });

  it('counts staged-verification matches so a verified small-key join is not suppressed', async () => {
    // A small key source (4 distinct) vs a partial target sample holding only 2
    // of them: in-sample support is 2 (< MIN_MATCH_SUPPORT), but staged
    // verification confirms the other 2 on the full table — exactly the case
    // verification exists to rescue. The support gate must count those too.
    const sourceProfile = profile({
      valueCounts: { alphaKey: 1, betaKey: 1, gammaKey: 1, deltaKey: 1 },
      rowCount: 4,
      cardinalityRatio: 1,
      isIdentifierLike: true,
    });
    const targetProfile = profile({
      // Key-like referenced side (many distinct), only alpha/beta in the sample.
      valueCounts: Object.fromEntries(
        ['alphaKey', 'betaKey', ...eligibleHandles(98, 'noise')].map(k => [
          k,
          1,
        ]),
      ),
      rowCount: 100,
      cardinalityRatio: 1,
      isIdentifierLike: true,
    });
    const result = await applyCandidateGates(
      candidate({
        sourceProfile,
        targetProfile,
        distinctMatchedValueCount: 2,
      }),
      {
        targetCorpusPartial: true,
        // gamma/delta are absent from the target SAMPLE but present on the full
        // table — verification confirms both.
        verifyValuesPresent: async values =>
          new Set(values.filter(v => v === 'gammaKey' || v === 'deltaKey')),
      },
    );
    // Containment is rescued to 1.0 by verification, and support counts the 2
    // verified values (2 in-sample + 2 verified = 4 ≥ MIN_MATCH_SUPPORT).
    expect(result.passed).toBe(true);
  });

  it('counts accumulator evidence when the literal intersection is empty (alias matches)', async () => {
    // person_name_alias matches share no literal values across the domains,
    // so support must come from distinctMatchedValueCount, not intersection.
    const { source } = passthroughProfiles(eligibleHandles(10, 'alias'));
    const target = profile({
      valueCounts: Object.fromEntries(
        eligibleHandles(10, 'different').map(k => [k, 1]),
      ),
      rowCount: 10,
      cardinalityRatio: 1,
      isIdentifierLike: true,
    });
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: source,
        targetProfile: target,
        distinctMatchedValueCount: 9,
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result.passed).toBe(true);
  });
});

describe('applyCandidateGates — honest alias containment', () => {
  it('intersects alias-variant matches with the source domain and gates on the relaxed alias floor', async () => {
    // The live GitHub↔Sentry shape: 11 distinct source names, 8 people
    // matched, but the accumulator recorded 23 matched values (every alias
    // variant counts). Raw coverage was 23/11 = 2.09 — an impossible
    // containment that saturated the top score bucket. Honest coverage is
    // 8/11 ≈ 0.73: below the standard 0.85 gate, above the alias floor.
    const sourceNames = eligibleHandles(11, 'person');
    const matchedPeople = sourceNames.slice(0, 8);
    const variants = matchedPeople.flatMap(name => [
      name,
      `${name}xupper`,
      `${name}xalias`,
    ]);
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: profile({
          valueCounts: Object.fromEntries(sourceNames.map(k => [k, 1])),
          rowCount: 12,
          cardinalityRatio: 1,
        }),
        targetProfile: profile({
          valueCounts: Object.fromEntries(
            eligibleHandles(10, 'sentryname').map(k => [k, 1]),
          ),
          rowCount: 10,
          cardinalityRatio: 1,
        }),
        distinctMatchedValueCount: variants.length,
        matchedValues: variants,
        matchStrategy: 'person_name_alias',
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result.passed).toBe(true);
    if (result.passed) {
      // Honest fraction, never > 1 — and low enough that the containment
      // signal group does not fire, so a fuller-coverage rule outranks it.
      expect(result.evidence.containment).toBeCloseTo(8 / 11, 5);
    }
  });

  it('fails a non-alias candidate whose honest coverage is below the standard gate', async () => {
    // Same inflated-variant shape but exact-match strategy: no relaxed floor,
    // so 0.73 honest coverage fails containment (with the transform hint).
    const sourceNames = eligibleHandles(11, 'ident');
    const variants = sourceNames
      .slice(0, 8)
      .flatMap(name => [name, `${name}xvariant`, `${name}xother`]);
    const result = await applyCandidateGates(
      candidate({
        sourceProfile: profile({
          valueCounts: Object.fromEntries(sourceNames.map(k => [k, 1])),
          rowCount: 12,
          cardinalityRatio: 1,
          isIdentifierLike: true,
        }),
        targetProfile: profile({
          valueCounts: Object.fromEntries(
            eligibleHandles(10, 'other').map(k => [k, 1]),
          ),
          rowCount: 10,
          cardinalityRatio: 1,
          isIdentifierLike: true,
        }),
        distinctMatchedValueCount: variants.length,
        matchedValues: variants,
        matchStrategy: 'exact',
      }),
      NO_VERIFY_CONTEXT,
    );
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toBe('containment-below-threshold');
      expect(result.evidence.containment).toBeLessThanOrEqual(1);
    }
  });
});
