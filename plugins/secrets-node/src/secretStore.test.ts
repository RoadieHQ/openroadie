import { describe, expect, it } from 'vitest';
import { InputError } from '@roadiehq/errors';
import { toStoredSecretRef } from './secretStore';

describe('toStoredSecretRef', () => {
  it('rejects the internal workspace namespace as a logical ref', () => {
    expect(() =>
      toStoredSecretRef(
        'OPENROADIE_WORKSPACE_22222222_2222_4222_8222_222222222222__TOKEN',
      ),
    ).toThrow(InputError);
  });
});
