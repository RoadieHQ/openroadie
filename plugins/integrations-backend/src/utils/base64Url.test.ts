import { describe, expect, it } from 'vitest';
import { base64UrlEncode, base64UrlEncodeBuffer } from './base64Url';

describe('base64Url utils', () => {
  it('encodes string input using URL-safe characters without padding', () => {
    expect(base64UrlEncode('??')).toBe('Pz8');
    expect(base64UrlEncode('a/b+c')).toBe('YS9iK2M');
    expect(base64UrlEncode('f')).toBe('Zg');
  });

  it('encodes buffer input using URL-safe characters without padding', () => {
    const buffer = Buffer.from([251, 255, 255]);
    expect(base64UrlEncodeBuffer(buffer)).toBe('-___');
  });

  it('matches output for equivalent string and buffer inputs', () => {
    const value = 'roadie-github-app';
    expect(base64UrlEncode(value)).toBe(
      base64UrlEncodeBuffer(Buffer.from(value)),
    );
  });

  it('removes all trailing padding characters', () => {
    expect(base64UrlEncode('fo')).toBe('Zm8');
    expect(base64UrlEncode('foo')).toBe('Zm9v');
    expect(base64UrlEncode('foob')).toBe('Zm9vYg');
  });
});
