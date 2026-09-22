import { describe, expect, it } from 'vitest';
import { getSecretOptionNames } from './http-config-fields';

describe('getSecretOptionNames', () => {
  it('includes the current secret ref when it is missing from the available options', () => {
    expect(
      getSecretOptionNames(['Rootly API key'], '${ROOTLY_API_KEY}'),
    ).toEqual(['ROOTLY_API_KEY', 'Rootly API key']);
  });

  it('does not duplicate the current secret when it already exists', () => {
    expect(
      getSecretOptionNames(['ROOTLY_API_KEY'], '${ROOTLY_API_KEY}'),
    ).toEqual(['ROOTLY_API_KEY']);
  });
});
