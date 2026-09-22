import { describe, expect, it } from 'vitest';
import { authLabel, errorMessage } from './helpers';

describe('setup helpers', () => {
  it('labels auth types in the words the wizard shows', () => {
    expect(authLabel('none')).toBe('managed');
    expect(authLabel('header')).toBe('token');
    expect(authLabel('bearer-token')).toBe('token');
    expect(authLabel('oauth2-jwt-bearer')).toBe('oauth jwt');
    expect(authLabel('oauth2-client-credentials')).toBe('oauth');
  });

  it('formats non-CliError values without assuming an Error instance', () => {
    expect(errorMessage(new Error('network down'))).toBe('network down');
    expect(errorMessage('plain failure')).toBe('plain failure');
  });
});
