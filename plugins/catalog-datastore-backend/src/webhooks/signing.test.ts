/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { execSync } from 'child_process';
import { signBody, SIGNATURE_HEADER } from './signing';

describe('signBody', () => {
  it('uses the x-roadie-signature-256 header name', () => {
    expect(SIGNATURE_HEADER).toBe('x-roadie-signature-256');
  });

  it('produces sha256=<hex> matching openssl dgst -sha256 -hmac', () => {
    const secret = 'test-secret';
    const body = JSON.stringify({
      event: 'datasource-updated',
      metadata: {
        datasourceId: '00000000-0000-0000-0000-000000000001',
        status: 'success',
      },
      timestamp: '2026-04-28T12:00:00.000Z',
    });
    const signature = signBody(secret, body);

    const opensslHex = execSync(
      `printf '%s' '${body.replace(/'/g, "'\\''")}' | openssl dgst -sha256 -hmac '${secret}' -hex`,
    )
      .toString()
      .trim()
      .replace(/^.*=\s*/, '');

    expect(signature).toBe(`sha256=${opensslHex}`);
  });

  it('produces a different signature when the body changes by one byte', () => {
    const a = signBody('s', 'hello');
    const b = signBody('s', 'hellp');
    expect(a).not.toBe(b);
  });

  it('produces a different signature when the secret changes', () => {
    const a = signBody('one', 'body');
    const b = signBody('two', 'body');
    expect(a).not.toBe(b);
  });
});
