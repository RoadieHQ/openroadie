import { describe, expect, it } from 'vitest';
import { normalizeCaCertificate } from './pem-certificate';

describe('normalizeCaCertificate', () => {
  const header = '-----BEGIN CERTIFICATE-----';
  const footer = '-----END CERTIFICATE-----';
  const body64 = 'A'.repeat(128);
  const wrappedBody = body64.match(/.{1,64}/g)!.join('\n');

  it('converts escaped newlines to real LF newlines', () => {
    const escaped = `${header}\\n${wrappedBody.replace(/\n/g, '\\n')}\\n${footer}`;

    expect(normalizeCaCertificate(escaped)).toBe(
      `${header}\n${wrappedBody}\n${footer}`,
    );
  });

  it('normalizes CRLF line endings to LF', () => {
    const crlf = `${header}\r\n${wrappedBody.replace(/\n/g, '\r\n')}\r\n${footer}`;

    expect(normalizeCaCertificate(crlf)).toBe(
      `${header}\n${wrappedBody}\n${footer}`,
    );
  });

  it('reconstructs a flattened single-line PEM', () => {
    const flattened = `${header} ${body64} ${footer}`;

    expect(normalizeCaCertificate(flattened)).toBe(
      `${header}\n${wrappedBody}\n${footer}`,
    );
  });
});
