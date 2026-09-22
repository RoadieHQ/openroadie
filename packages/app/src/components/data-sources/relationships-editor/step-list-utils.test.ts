import { describe, expect, it } from 'vitest';
import {
  isAdvancedIntegrationRequestPath,
  resolveLookupPath,
  valueAtPath,
} from './step-list-utils';

describe('valueAtPath', () => {
  it('reads a scalar value', () => {
    expect(valueAtPath({ spec: { owner: 'team-a' } }, ['spec', 'owner'])).toBe(
      'team-a',
    );
    expect(valueAtPath({ replicas: 3 }, ['replicas'])).toBe('3');
  });

  // An array field is a legitimate match target (the rule engine flattens it
  // and compares elementwise), so reading one as "no value" makes a populated
  // field look empty — which drives a false "this field is empty" warning.
  it('reads an array of primitives as its first value', () => {
    expect(
      valueAtPath({ images: ['ecr.io/a:1', 'ecr.io/b:2'] }, ['images']),
    ).toBe('ecr.io/a:1');
  });

  it('has no value for objects, empty arrays and missing keys', () => {
    expect(valueAtPath({ spec: { owner: 'x' } }, ['spec'])).toBeUndefined();
    expect(valueAtPath({ images: [] }, ['images'])).toBeUndefined();
    expect(
      valueAtPath({ images: [{ name: 'a' }] }, ['images']),
    ).toBeUndefined();
    expect(valueAtPath({}, ['nope'])).toBeUndefined();
  });
});

describe('resolveLookupPath', () => {
  it('URL-encodes source values using the backend template contract', () => {
    expect(
      resolveLookupPath('/repos/{value}/teams', 'RoadieHQ/roadie?active#team'),
    ).toBe('/repos/RoadieHQ%2Froadie%3Factive%23team/teams');
  });
});

describe('isAdvancedIntegrationRequestPath', () => {
  it('only flags a non-empty backend path expression', () => {
    expect(isAdvancedIntegrationRequestPath({ pathExpression: '  ' })).toBe(
      false,
    );
    expect(
      isAdvancedIntegrationRequestPath({
        pathExpression: '"/repos/" & sourceValue',
      }),
    ).toBe(true);
  });
});
