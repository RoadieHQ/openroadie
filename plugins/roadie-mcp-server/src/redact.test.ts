import { redactSensitiveValues, redactValue } from './redact';

describe('redactSensitiveValues', () => {
  it('should return undefined for undefined input', () => {
    expect(redactSensitiveValues(undefined)).toBeUndefined();
  });

  it('should redact sensitive top-level keys', () => {
    expect(redactSensitiveValues({ query: 'pods', token: 'abc' })).toEqual({
      query: 'pods',
      token: '[REDACTED]',
    });
  });

  it('should redact sensitive keys nested in objects', () => {
    expect(
      redactSensitiveValues({ headers: { authorization: 'Bearer x' } }),
    ).toEqual({ headers: { authorization: '[REDACTED]' } });
  });

  it('should redact sensitive keys inside arrays', () => {
    expect(
      redactSensitiveValues({ items: [{ password: 'hunter2', id: 1 }] }),
    ).toEqual({ items: [{ password: '[REDACTED]', id: 1 }] });
  });
});

describe('redactValue', () => {
  it('should pass through primitives', () => {
    expect(redactValue('plain')).toBe('plain');
    expect(redactValue(42)).toBe(42);
  });

  it('should walk arrays of content blocks', () => {
    expect(redactValue([{ type: 'text', text: 'ok', secret: 's' }])).toEqual([
      { type: 'text', text: 'ok', secret: '[REDACTED]' },
    ]);
  });
});
