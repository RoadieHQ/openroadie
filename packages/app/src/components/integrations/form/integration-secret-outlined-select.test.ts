import { describe, expect, it } from 'vitest';
import {
  getSuggestedCreateSecretName,
  getUnavailableSecretNames,
} from './integration-secret-outlined-select';

describe('getUnavailableSecretNames', () => {
  it('merges visible and reserved names without duplicates', () => {
    expect(
      getUnavailableSecretNames(
        ['VISIBLE_SECRET', ' RESERVED_SECRET '],
        ['RESERVED_SECRET', 'GITHUB_APP_PRIVATE_KEY'],
      ),
    ).toEqual(['VISIBLE_SECRET', 'RESERVED_SECRET', 'GITHUB_APP_PRIVATE_KEY']);
  });
});

describe('getSuggestedCreateSecretName', () => {
  it('avoids reserved scoped secret refs when suggesting a new name', () => {
    expect(
      getSuggestedCreateSecretName(
        'GITHUB_APP_PRIVATE_KEY',
        ['VISIBLE_SECRET'],
        ['GITHUB_APP_PRIVATE_KEY'],
      ),
    ).toBe('GITHUB_APP_PRIVATE_KEY_2');
  });
});
