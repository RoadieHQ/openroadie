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
import type { Request } from 'express';
import { PublicVerifier } from './PublicVerifier';

describe('PublicVerifier', () => {
  it('does not require a bearer token', () => {
    const verifier = new PublicVerifier();

    expect(verifier.requiresBearer).toBe(false);
  });

  it('accepts requests', async () => {
    const verifier = new PublicVerifier();

    await expect(verifier.verify('', {} as Request)).resolves.toEqual({
      workspaceId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('uses the workspace established by upstream authentication', async () => {
    const request = {} as Request;
    const resolveWorkspaceId = vi
      .fn()
      .mockResolvedValue('22222222-2222-4222-8222-222222222222');
    const verifier = new PublicVerifier(resolveWorkspaceId);

    await expect(verifier.verify('', request)).resolves.toEqual({
      workspaceId: '22222222-2222-4222-8222-222222222222',
    });
    expect(resolveWorkspaceId).toHaveBeenCalledWith(request);
  });
});
