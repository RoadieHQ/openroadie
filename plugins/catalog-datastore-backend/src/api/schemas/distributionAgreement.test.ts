import { describe, expect, it } from 'vitest';
import {
  bhattacharyyaAgreement,
  QUANTILE_BUCKET_COUNT,
} from './distributionAgreement';

describe('QUANTILE_BUCKET_COUNT', () => {
  it('is 20', () => {
    expect(QUANTILE_BUCKET_COUNT).toBe(20);
  });
});

describe('bhattacharyyaAgreement', () => {
  it('returns ~1 for identical distributions', () => {
    const counts: Record<string, number> = {};
    for (let i = 1; i <= 20; i += 1) {
      counts[String(i)] = i;
    }
    const result = bhattacharyyaAgreement({
      referencedValueCounts: counts,
      dependentValueCounts: counts,
    });
    expect(result).toBeDefined();
    expect(Math.abs(result! - 1)).toBeLessThan(1e-9);
  });

  it('returns < 0.5 when the dependent mass concentrates in a single referenced bucket', () => {
    const referencedValueCounts: Record<string, number> = {};
    for (let i = 0; i < 20; i += 1) {
      referencedValueCounts[`v${i}`] = 1;
    }
    const result = bhattacharyyaAgreement({
      referencedValueCounts,
      dependentValueCounts: { v0: 100 },
    });
    expect(result).toBeDefined();
    expect(result!).toBeLessThan(0.5);
    expect(result!).toBeCloseTo(Math.sqrt(1 / 20), 9);
  });

  it('lands in the middle ground for a partial overlap between uniform dependent and skewed referenced coverage', () => {
    const referencedValueCounts: Record<string, number> = {};
    for (let i = 1; i <= 40; i += 1) {
      referencedValueCounts[String(i)] = 1;
    }
    const dependentValueCounts: Record<string, number> = {};
    for (let i = 1; i <= 20; i += 1) {
      dependentValueCounts[String(i)] = 1;
    }
    const result = bhattacharyyaAgreement({
      referencedValueCounts,
      dependentValueCounts,
    });
    expect(result).toBeDefined();
    expect(result!).toBeGreaterThan(0.5);
    expect(result!).toBeLessThan(1);
    expect(result!).toBeCloseTo(10 * Math.sqrt(0.005), 9);
  });

  it('returns undefined when referenced distinct values are below the bucket count', () => {
    const referencedValueCounts: Record<string, number> = {};
    for (let i = 1; i <= 19; i += 1) {
      referencedValueCounts[String(i)] = 1;
    }
    const result = bhattacharyyaAgreement({
      referencedValueCounts,
      dependentValueCounts: { '1': 1 },
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when the referenced input is empty', () => {
    const result = bhattacharyyaAgreement({
      referencedValueCounts: {},
      dependentValueCounts: { a: 1 },
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when the dependent input is empty', () => {
    const referencedValueCounts: Record<string, number> = {};
    for (let i = 0; i < 20; i += 1) {
      referencedValueCounts[`v${i}`] = 1;
    }
    const result = bhattacharyyaAgreement({
      referencedValueCounts,
      dependentValueCounts: {},
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when the dependent input has entries but zero total mass', () => {
    // A non-empty Record whose only key carries a 0 occurrence count — a
    // plausible upstream tally, not a hypothetical. This must not divide by
    // zero into NaN when normalizing into a probability vector.
    const referencedValueCounts: Record<string, number> = {};
    for (let i = 0; i < 20; i += 1) {
      referencedValueCounts[`v${i}`] = 1;
    }
    const result = bhattacharyyaAgreement({
      referencedValueCounts,
      dependentValueCounts: { a: 0 },
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when the referenced input has entries but zero total mass', () => {
    const referencedValueCounts: Record<string, number> = {};
    for (let i = 0; i < 20; i += 1) {
      referencedValueCounts[`v${i}`] = 0;
    }
    const result = bhattacharyyaAgreement({
      referencedValueCounts,
      dependentValueCounts: { v0: 1 },
    });
    expect(result).toBeUndefined();
  });

  it('sorts numerically when every value on both sides is numeric, changing "9" vs "10" bucket assignment relative to a lexicographic fixture', () => {
    // 21 distinct referenced values 9..29: with uniform weight, the excess
    // value over the 20-bucket count always merges into the very first
    // sorted bucket. Numeric order starts at "9" (merging it with "10");
    // lexicographic order ("10","11",...,"19","20",...,"29","9") starts at
    // "10" (merging it with "11") and strands "9" alone in the last bucket.
    const referencedValueCounts: Record<string, number> = {};
    for (let i = 9; i <= 29; i += 1) {
      referencedValueCounts[String(i)] = 1;
    }

    const numericResult = bhattacharyyaAgreement({
      referencedValueCounts,
      dependentValueCounts: { '9': 10, '10': 1, '11': 1 },
    });
    const lexicographicResult = bhattacharyyaAgreement({
      referencedValueCounts,
      // The non-numeric "x" value forces the whole comparison into
      // lexicographic mode, per the "every value on both sides" rule.
      dependentValueCounts: { '9': 10, '10': 1, '11': 1, x: 1 },
    });

    expect(numericResult).toBeDefined();
    expect(lexicographicResult).toBeDefined();
    expect(numericResult!).toBeCloseTo(0.3584624989775106, 9);
    expect(lexicographicResult!).toBeCloseTo(0.3217767703992587, 9);
    expect(numericResult!).not.toBeCloseTo(lexicographicResult!, 3);
  });

  it('is deterministic across repeated calls', () => {
    const referencedValueCounts: Record<string, number> = {};
    for (let i = 1; i <= 40; i += 1) {
      referencedValueCounts[String(i)] = (i % 5) + 1;
    }
    const dependentValueCounts: Record<string, number> = {
      '3': 4,
      '17': 9,
      '38': 2,
    };
    const first = bhattacharyyaAgreement({
      referencedValueCounts,
      dependentValueCounts,
    });
    const second = bhattacharyyaAgreement({
      referencedValueCounts,
      dependentValueCounts,
    });
    expect(first).toBeDefined();
    expect(second).toStrictEqual(first);
  });
});
