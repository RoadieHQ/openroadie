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
import { SharedSecretVerifier } from './SharedSecretVerifier';

describe('SharedSecretVerifier', () => {
  it('accepts the configured secret', async () => {
    const v = new SharedSecretVerifier('s3cret-value');
    expect(await v.verify('s3cret-value')).toEqual({
      workspaceId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('rejects a different secret of the same length', async () => {
    const v = new SharedSecretVerifier('s3cret-value');
    expect(await v.verify('OTHERvalue!!')).toBeNull();
  });

  it('rejects a longer secret without throwing on the length mismatch', async () => {
    const v = new SharedSecretVerifier('s3cret-value');
    expect(await v.verify('s3cret-value-extra')).toBeNull();
  });

  it('rejects a shorter secret without throwing on the length mismatch', async () => {
    const v = new SharedSecretVerifier('s3cret-value');
    expect(await v.verify('short')).toBeNull();
  });

  it('rejects empty input', async () => {
    const v = new SharedSecretVerifier('s3cret-value');
    expect(await v.verify('')).toBeNull();
  });

  it('refuses to construct with an empty configured secret', () => {
    expect(() => new SharedSecretVerifier('')).toThrow(
      /must be a non-empty string/,
    );
  });

  it('handles unicode in both the secret and the input', async () => {
    const v = new SharedSecretVerifier('café-🔑');
    expect(await v.verify('café-🔑')).toEqual({
      workspaceId: '00000000-0000-4000-8000-000000000001',
    });
    expect(await v.verify('cafe-🔑')).toBeNull();
  });
});
