import { describe, expect, it } from 'vitest';
import {
  buildFieldExpression,
  isAdvancedExpression,
  parseAccessorPath,
  resolveHighlightPath,
} from './field-expression';

describe('parseAccessorPath', () => {
  it('parses plain object paths', () => {
    expect(parseAccessorPath('$.commit.sha')).toEqual([
      { kind: 'key', name: 'commit' },
      { kind: 'key', name: 'sha' },
    ]);
  });

  it('parses numeric indices and wildcards', () => {
    expect(parseAccessorPath('$.items[0].id')).toEqual([
      { kind: 'key', name: 'items' },
      { kind: 'index', value: 0 },
      { kind: 'key', name: 'id' },
    ]);
    expect(parseAccessorPath('$.teams[*].slug')).toEqual([
      { kind: 'key', name: 'teams' },
      { kind: 'wildcard' },
      { kind: 'key', name: 'slug' },
    ]);
  });

  it('rejects filters, functions and operators as non-accessor paths', () => {
    expect(parseAccessorPath('$.teams[role="maintainer"].slug')).toBeNull();
    expect(parseAccessorPath('$sum($.items.count)')).toBeNull();
    expect(parseAccessorPath('$.a & $.b')).toBeNull();
  });
});

describe('isAdvancedExpression', () => {
  it('treats empty and plain paths as not advanced', () => {
    expect(isAdvancedExpression('')).toBe(false);
    expect(isAdvancedExpression('  ')).toBe(false);
    expect(isAdvancedExpression('$.full_name')).toBe(false);
    expect(isAdvancedExpression('$.items[0].id')).toBe(false);
  });

  it('treats wildcards, filters and functions as advanced', () => {
    expect(isAdvancedExpression('$.teams[*].slug')).toBe(true);
    expect(isAdvancedExpression('$.teams[role="x"].slug')).toBe(true);
    expect(isAdvancedExpression('$string($.id)')).toBe(true);
  });
});

describe('resolveHighlightPath', () => {
  const response = {
    total_count: 2,
    items: [{ full_name: 'octocat/hello' }, { full_name: 'roadie/backstage' }],
  };

  it('resolves a plain path against the data', () => {
    expect(resolveHighlightPath('$.total_count', response)).toEqual([
      'total_count',
    ]);
  });

  it('resolves a wildcard to the element that matches the joined value', () => {
    expect(
      resolveHighlightPath(
        '$.items[*].full_name',
        response,
        'roadie/backstage',
      ),
    ).toEqual(['items', '1', 'full_name']);
  });

  it('falls back to the first element when no matched value is given', () => {
    expect(resolveHighlightPath('$.items[*].full_name', response)).toEqual([
      'items',
      '0',
      'full_name',
    ]);
  });

  it('returns undefined for empty and non-accessor expressions', () => {
    expect(resolveHighlightPath('', response)).toBeUndefined();
    expect(
      resolveHighlightPath('$.items[full_name="x"]', response),
    ).toBeUndefined();
  });
});

describe('buildFieldExpression', () => {
  it('joins object keys with dots', () => {
    expect(
      buildFieldExpression([
        { key: 'commit', inArray: false },
        { key: 'sha', inArray: false },
      ]),
    ).toBe('$.commit.sha');
  });

  it('collapses array elements to a wildcard', () => {
    expect(
      buildFieldExpression([
        { key: 'items', inArray: false },
        { key: '0', inArray: true },
        { key: 'full_name', inArray: false },
      ]),
    ).toBe('$.items[*].full_name');
  });

  // `[*]` is a JSONata *predicate*, not an array-element wildcard: `*` selects
  // the property values of each element, so `$.images[*]` on an array of
  // strings evaluates to `undefined` and the rule matches nothing. Picking an
  // element of an array of primitives has to target the array itself, which
  // JSONata already compares elementwise.
  it('targets the array itself when the picked value is the array element', () => {
    expect(
      buildFieldExpression([
        { key: 'images', inArray: false },
        { key: '0', inArray: true },
      ]),
    ).toBe('$.images');
  });

  it('targets a nested array itself when the element is the picked value', () => {
    expect(
      buildFieldExpression([
        { key: 'spec', inArray: false },
        { key: 'images', inArray: false },
        { key: '2', inArray: true },
      ]),
    ).toBe('$.spec.images');
  });
});
