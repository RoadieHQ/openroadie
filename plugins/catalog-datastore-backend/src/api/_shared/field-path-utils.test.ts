import { describe, it, expect } from 'vitest';
import { pathSegments } from './field-path-utils';

describe('pathSegments', () => {
  it('strips a leading $. prefix', () => {
    expect(pathSegments('$.metadata.name')).toEqual(['metadata', 'name']);
  });

  it('lowercases segments', () => {
    expect(pathSegments('Spec.OwnerRef')).toEqual(['spec', 'ownerref']);
  });

  it('splits on any non-alphanumeric/underscore character', () => {
    expect(pathSegments('foo.bar-baz_qux/quux')).toEqual([
      'foo',
      'bar',
      'baz_qux',
      'quux',
    ]);
  });

  it('drops empty segments', () => {
    expect(pathSegments('..foo...bar..')).toEqual(['foo', 'bar']);
  });

  it('returns an empty array for an empty string', () => {
    expect(pathSegments('')).toEqual([]);
  });
});
