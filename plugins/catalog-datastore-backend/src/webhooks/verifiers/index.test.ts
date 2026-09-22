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
import { vi } from 'vitest';
import { createBearerVerifier } from './index';
import { DbTokenVerifier } from './DbTokenVerifier';
import { PublicVerifier } from './PublicVerifier';
import { SharedSecretVerifier } from './SharedSecretVerifier';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

function config(input?: { public?: boolean; sharedSecret?: string }) {
  return {
    getOptionalBoolean: (key: string) =>
      key === 'roadie.webhooks.auth.public' ? input?.public : undefined,
    getOptionalString: (key: string) =>
      key === 'roadie.webhooks.auth.sharedSecret'
        ? input?.sharedSecret
        : undefined,
  };
}

describe('createBearerVerifier', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses public auth when configured', () => {
    const verifier = createBearerVerifier({
      config: config({ public: true, sharedSecret: 'shared-secret' }) as any,
      tokenDao: {} as any,
      logger: logger as any,
    });

    expect(verifier).toBeInstanceOf(PublicVerifier);
  });

  it('uses shared-secret auth when configured', () => {
    const verifier = createBearerVerifier({
      config: config({ sharedSecret: 'shared-secret' }) as any,
      tokenDao: {} as any,
      logger: logger as any,
    });

    expect(verifier).toBeInstanceOf(SharedSecretVerifier);
  });

  it('uses DB-token auth by default', () => {
    const verifier = createBearerVerifier({
      config: config() as any,
      tokenDao: {} as any,
      logger: logger as any,
    });

    expect(verifier).toBeInstanceOf(DbTokenVerifier);
  });
});
