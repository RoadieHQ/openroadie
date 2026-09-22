import { describe, expect, it } from 'vitest';
import {
  NAME_SIMILARITY_MIN,
  buildTokenIdf,
  nameSimilarity,
  tokenizeFieldPath,
} from './nameSimilarity';

describe('tokenizeFieldPath', () => {
  it('splits on dots and underscores', () => {
    expect(tokenizeFieldPath('$.owner_id')).toEqual(['owner', 'id']);
  });

  it('splits on brackets and quotes and hyphens', () => {
    expect(tokenizeFieldPath('$.metadata.labels["team-name"]')).toEqual([
      'metadata',
      'labels',
      'team',
      'name',
    ]);
  });

  it('splits on camelCase humps', () => {
    expect(tokenizeFieldPath('accountId')).toEqual(['account', 'id']);
  });

  it('drops pure-integer tokens (array indices)', () => {
    expect(tokenizeFieldPath('items[0].id')).toEqual(['items', 'id']);
  });

  it('drops empty tokens from repeated delimiters', () => {
    expect(tokenizeFieldPath('$..account__id')).toEqual(['account', 'id']);
  });

  it('lowercases every token', () => {
    expect(tokenizeFieldPath('AWS-Accounts')).toEqual(['aws', 'accounts']);
  });

  it('returns an empty array for a bare "$"', () => {
    expect(tokenizeFieldPath('$')).toEqual([]);
  });
});

describe('buildTokenIdf', () => {
  // 'id' appears in every one of the 3 distinct field paths (df = N = 3);
  // 'a' appears in exactly one (df = 1). N is fixed by these 3 field paths.
  const idf = buildTokenIdf({
    fieldPathsByDatasource: {
      ds1: ['$.id'],
      ds2: ['$.a.id'],
      ds3: ['$.b.id'],
    },
  });

  it('weights a token present in every path close to log2(2) = 1', () => {
    expect(idf.get('id')).toBeCloseTo(1, 5);
  });

  it('weights a token present in exactly one path close to log2(1 + N)', () => {
    expect(idf.get('a')).toBeCloseTo(Math.log2(1 + 3), 5);
  });

  it('folds container names into document frequency without them', () => {
    const withContainer = buildTokenIdf({
      fieldPathsByDatasource: {
        ds1: ['$.id'],
        ds2: ['$.a.id'],
        ds3: ['$.b.id'],
      },
      containerNamesByDatasourceId: { ds1: 'widgets' },
    });
    // N stays the distinct-field-path count (3); 'widgets' only appears in
    // the container-name document, so its idf reflects df = 1 against N = 3.
    expect(withContainer.get('widgets')).toBeCloseTo(Math.log2(1 + 3), 5);
    expect(withContainer.get('id')).toBeCloseTo(1, 5);
  });

  it('is deterministic across repeated calls with the same input', () => {
    const params = {
      fieldPathsByDatasource: { ds1: ['$.owner_id', '$.name'] },
      containerNamesByDatasourceId: { ds1: 'owners' },
    };
    const first = buildTokenIdf(params);
    const second = buildTokenIdf(params);
    expect(Array.from(second.entries())).toEqual(Array.from(first.entries()));
  });
});

describe('nameSimilarity', () => {
  // A small run: an "accounts" table, a "widgets" table with a parent_id and
  // owner_id, and a "buckets" table — gives 'account'/'widget'/'owner'/
  // 'parent'/'bucket' each a rare (single-path) idf, and 'id' a common one
  // (5 of the 8 distinct paths), matching the brief's "generic id" case.
  const idf = buildTokenIdf({
    fieldPathsByDatasource: {
      'ds-accounts': ['$.account_id', '$.name', '$.region', '$.created_at'],
      'ds-widgets': ['$.widget_id', '$.owner_id', '$.name', '$.parent_id'],
      'ds-buckets': ['$.bucket_id', '$.name', '$.region'],
    },
    containerNamesByDatasourceId: {
      'ds-accounts': 'aws-accounts',
      'ds-widgets': 'aws-widgets',
      'ds-buckets': 'aws-buckets',
    },
  });

  it('clears NAME_SIMILARITY_MIN via the singular/plural container bridge', () => {
    // account_id vs a container literally named "aws-accounts": 'account'
    // only matches 'accounts' through the plural bridge; 'id' has no
    // counterpart on the referenced side, so the bridge alone must carry it.
    const score = nameSimilarity({
      dependentFieldPath: '$.account_id',
      referencedFieldPath: '$.name',
      referencedContainerName: 'aws-accounts',
      idf,
    });
    expect(score).toBeGreaterThanOrEqual(NAME_SIMILARITY_MIN);
  });

  it('the plural bridge is what clears the threshold: without the container name, the same fields score 0', () => {
    const score = nameSimilarity({
      dependentFieldPath: '$.account_id',
      referencedFieldPath: '$.name',
      idf,
    });
    expect(score).toBe(0);
  });

  it('bridges the plural in the other direction (referenced singular vs dependent plural)', () => {
    const score = nameSimilarity({
      dependentFieldPath: '$.widgets',
      referencedFieldPath: '$.widget_id',
      idf,
    });
    expect(score).toBeGreaterThan(0);
  });

  it('scores low when the only overlap is the generic "id" token amid unmatched context', () => {
    // parent_id vs a bare id field: 'id' matches exactly, but its idf weight
    // is small relative to the unmatched, rare 'parent' token, so the
    // generic overlap alone can't carry the score anywhere near the threshold.
    const score = nameSimilarity({
      dependentFieldPath: '$.parent_id',
      referencedFieldPath: '$.id',
      idf,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(NAME_SIMILARITY_MIN);
  });

  it('returns 0 for disjoint token sets', () => {
    const score = nameSimilarity({
      dependentFieldPath: '$.color',
      referencedFieldPath: '$.region',
      idf,
    });
    expect(score).toBe(0);
  });

  it('returns 0 when the dependent field path tokenizes to nothing', () => {
    const score = nameSimilarity({
      dependentFieldPath: '$',
      referencedFieldPath: '$.id',
      idf,
    });
    expect(score).toBe(0);
  });

  it('returns 0 when every dependent token is missing from the idf map (fallback weight is non-informative)', () => {
    // A missing token falls back to the generic idf (1), whose informative
    // contribution is 0 — so an all-missing dependent path has a
    // zero denominator, not a spuriously perfect score.
    const emptyIdf = new Map<string, number>();
    const score = nameSimilarity({
      dependentFieldPath: '$.id',
      referencedFieldPath: '$.id',
      idf: emptyIdf,
    });
    expect(score).toBe(0);
  });

  it('scores 0 for identical fully-generic paths (idf(id) ≈ 1, informative(id) = 0)', () => {
    // A dedicated corpus where 'id' appears in every one of the 3 distinct
    // field paths, so idf(id) = log2(2) = 1 exactly and informative(id) = 0.
    // $.id vs $.id is then a zero-denominator case, not the trivial 1.0 a
    // raw-idf ratio would give for an identical token set.
    const genericOnlyIdf = buildTokenIdf({
      fieldPathsByDatasource: {
        ds1: ['$.id'],
        ds2: ['$.a.id'],
        ds3: ['$.b.id'],
      },
    });
    expect(genericOnlyIdf.get('id')).toBeCloseTo(1, 5);
    const score = nameSimilarity({
      dependentFieldPath: '$.id',
      referencedFieldPath: '$.id',
      idf: genericOnlyIdf,
    });
    expect(score).toBe(0);
  });

  it('is deterministic across repeated calls with the same input', () => {
    const params = {
      dependentFieldPath: '$.account_id',
      referencedFieldPath: '$.name',
      referencedContainerName: 'aws-accounts',
      idf,
    };
    expect(nameSimilarity(params)).toBe(nameSimilarity(params));
  });
});
