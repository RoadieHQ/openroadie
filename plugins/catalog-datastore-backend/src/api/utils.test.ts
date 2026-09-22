import { describe, expect, it } from 'vitest';
import { serializeCaughtError } from './utils';

describe('serializeCaughtError', () => {
  it('returns a useful Error message', () => {
    expect(serializeCaughtError(new Error('boom'))).toBe('boom');
  });

  it('includes a non-generic error name', () => {
    expect(serializeCaughtError(new TypeError('x is not a function'))).toBe(
      'TypeError: x is not a function',
    );
  });

  it('JSON-stringifies a thrown plain object', () => {
    expect(
      serializeCaughtError({
        code: '42P01',
        detail: 'missing relation',
      }),
    ).toBe('{"code":"42P01","detail":"missing relation"}');
  });

  it('prefers message on a JSONata-shaped thrown object', () => {
    expect(
      serializeCaughtError({
        code: 'S0201',
        position: 0,
        message: 'Syntax error: "{{"',
      }),
    ).toBe('Syntax error: "{{"');
  });

  it('does not return [object Object] for a thrown object', () => {
    expect(serializeCaughtError({ nested: true })).not.toBe('[object Object]');
  });

  it('falls back when Error.message is [object Object]', () => {
    const error = Object.assign(new Error({} as unknown as string), {
      code: 'ECONNRESET',
    });
    expect(error.message).toBe('[object Object]');
    expect(serializeCaughtError(error)).toContain('ECONNRESET');
    expect(serializeCaughtError(error)).not.toBe('[object Object]');
  });
});
