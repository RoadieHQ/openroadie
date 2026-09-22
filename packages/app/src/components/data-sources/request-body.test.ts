import { parseRequestBodyText } from './request-body';

describe('parseRequestBodyText', () => {
  it('treats undefined as an intentionally empty body', () => {
    expect(parseRequestBodyText(undefined)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('treats whitespace-only text as an empty body', () => {
    expect(parseRequestBodyText('  \n ')).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('parses a JSON object', () => {
    expect(parseRequestBodyText('{"query": "status:active"}')).toEqual({
      ok: true,
      value: { query: 'status:active' },
    });
  });

  it('parses a JSON array (any JSON value is allowed, unlike GraphQL variables)', () => {
    expect(parseRequestBodyText('[1, 2]')).toEqual({ ok: true, value: [1, 2] });
  });

  it('returns the parser message for malformed JSON', () => {
    const result = parseRequestBodyText('{oops');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });
});
