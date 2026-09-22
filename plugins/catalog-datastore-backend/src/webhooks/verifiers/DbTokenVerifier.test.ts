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
import { DbTokenVerifier } from './DbTokenVerifier';
import type { WebhookTokenDao } from '../../database/WebhookTokenDao';

function fakeDao(behaviour: { valid: string }): WebhookTokenDao {
  return {
    verify: async (plaintext: string) => {
      if (plaintext === behaviour.valid) {
        return {
          id: 'tok-1',
          workspaceId: '00000000-0000-4000-8000-000000000001',
          label: 'test',
          createdAt: '',
          lastUsedAt: null,
        };
      }
      return null;
    },
  } as unknown as WebhookTokenDao;
}

describe('DbTokenVerifier', () => {
  it('returns the token workspace when the DAO recognises the token', async () => {
    const v = new DbTokenVerifier(fakeDao({ valid: 'good-token' }));
    expect(await v.verify('good-token')).toEqual({
      workspaceId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('returns null when the DAO does not recognise the token', async () => {
    const v = new DbTokenVerifier(fakeDao({ valid: 'good-token' }));
    expect(await v.verify('bogus-token')).toBeNull();
  });

  it('returns null when the token workspace was deleted', async () => {
    const workspaceExists = vi.fn().mockResolvedValue(false);
    const v = new DbTokenVerifier(
      fakeDao({ valid: 'good-token' }),
      workspaceExists,
    );

    expect(await v.verify('good-token')).toBeNull();
    expect(workspaceExists).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
    );
  });
});
