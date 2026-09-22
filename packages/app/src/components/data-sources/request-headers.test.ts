import { hydrateConfigHeaders, toHeaderPairs } from './request-headers';

describe('toHeaderPairs', () => {
  it('converts a saved header map into ordered pairs', () => {
    expect(
      toHeaderPairs({ Authorization: 'Bearer t', Accept: 'application/json' }),
    ).toEqual([
      { key: 'Authorization', value: 'Bearer t' },
      { key: 'Accept', value: 'application/json' },
    ]);
  });

  it('keeps pairs that are already in editor shape', () => {
    expect(
      toHeaderPairs([{ key: 'Accept', value: 'application/json' }]),
    ).toEqual([{ key: 'Accept', value: 'application/json' }]);
  });

  it('preserves a blank row the user just added', () => {
    expect(toHeaderPairs([{ key: '', value: '' }])).toEqual([
      { key: '', value: '' },
    ]);
  });

  it('drops array entries that are not key/value pairs', () => {
    expect(toHeaderPairs([null, 'Accept', { value: 'orphan' }])).toEqual([]);
  });

  it('coerces non-string values to strings', () => {
    expect(toHeaderPairs({ 'X-Page-Size': 100, 'X-Empty': null })).toEqual([
      { key: 'X-Page-Size', value: '100' },
      { key: 'X-Empty', value: '' },
    ]);
  });

  it('returns an empty list for absent headers', () => {
    expect(toHeaderPairs(undefined)).toEqual([]);
    expect(toHeaderPairs(null)).toEqual([]);
    expect(toHeaderPairs('Accept: */*')).toEqual([]);
  });
});

describe('hydrateConfigHeaders', () => {
  it('converts a header map in place', () => {
    expect(
      hydrateConfigHeaders({
        path: '/users',
        headers: { Accept: 'application/json' },
      }),
    ).toEqual({
      path: '/users',
      headers: [{ key: 'Accept', value: 'application/json' }],
    });
  });

  it('returns the same config when headers are already pairs', () => {
    const config = {
      path: '/users',
      headers: [{ key: 'Accept', value: 'application/json' }],
    };
    expect(hydrateConfigHeaders(config)).toBe(config);
  });

  it('returns the same config when there are no headers', () => {
    const config = { resourceType: 'AWS::S3::Bucket' };
    expect(hydrateConfigHeaders(config)).toBe(config);
  });
});
