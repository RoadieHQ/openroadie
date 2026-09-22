import { describe, expect, it } from 'vitest';
import { fuzzySimilarity, jaroWinkler, tokenSetRatio } from './fuzzyComparison';

describe('jaroWinkler', () => {
  it('returns 1 for identical strings', () => {
    expect(jaroWinkler('alpha', 'alpha')).toBe(1);
  });

  it('returns 0 when there are no common characters', () => {
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
  });

  it('handles empty strings', () => {
    expect(jaroWinkler('', 'alpha')).toBe(0);
    expect(jaroWinkler('alpha', '')).toBe(0);
  });

  it('rates a near-duplicate handle highly', () => {
    expect(jaroWinkler('alice.smith', 'alicesmith')).toBeGreaterThan(0.94);
  });

  it('rates a name with a one-character variation highly', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeGreaterThan(0.94);
  });

  it('weights shared prefixes via the Winkler boost', () => {
    expect(jaroWinkler('martin', 'martian')).toBeGreaterThan(
      jaroWinkler('martin', 'tinmar'),
    );
  });
});

describe('tokenSetRatio', () => {
  it('returns 1 when token sets match regardless of delimiter style', () => {
    expect(tokenSetRatio('payment-svc', 'payment_svc')).toBe(1);
    expect(tokenSetRatio('payment service', 'payment-service')).toBe(1);
  });

  it('returns the Jaccard ratio when one side has extra tokens', () => {
    expect(tokenSetRatio('payment service v2', 'payment service')).toBeCloseTo(
      2 / 3,
      2,
    );
  });

  it('returns 0 when token sets are disjoint', () => {
    expect(tokenSetRatio('alpha bravo', 'charlie delta')).toBe(0);
  });
});

describe('fuzzySimilarity', () => {
  it('returns null for exact matches', () => {
    expect(fuzzySimilarity('alpha', 'alpha', 'handle')).toBeNull();
  });

  it('clears the threshold for near-duplicate handles', () => {
    const score = fuzzySimilarity('alice.smith', 'alicesmith', 'handle');
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThanOrEqual(0.94);
  });

  it('clears the threshold for name variations', () => {
    expect(fuzzySimilarity('Martha', 'Marhta', 'person_name')).not.toBeNull();
  });

  it('rejects unrelated handles', () => {
    expect(fuzzySimilarity('alpha', 'omega', 'handle')).toBeNull();
  });

  it('rejects fuzzy comparison for uuid type', () => {
    // single-char UUID variations are different identifiers, not typos.
    expect(
      fuzzySimilarity(
        '550e8400-e29b-41d4-a716-446655440000',
        '550e8400-e29b-41d4-a716-446655440001',
        'uuid',
      ),
    ).toBeNull();
  });

  it('rejects fuzzy comparison for email type', () => {
    expect(fuzzySimilarity('alice@a.com', 'alice@b.com', 'email')).toBeNull();
  });
});
