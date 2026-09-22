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
import { timingSafeEqual } from 'crypto';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import { BearerVerifier } from './types';

/**
 * Bearer verifier that compares the incoming token against a single
 * long-lived shared secret provisioned out-of-band (typically resolved
 * from SSM into config at startup). Useful when webhook callers and this
 * plugin share the same trust boundary rather than minting per-token
 * credentials.
 *
 * The comparison is constant-time to avoid leaking length / prefix info
 * to a network attacker. Both sides are encoded as UTF-8 bytes and
 * length-checked first because timingSafeEqual itself throws on mismatched
 * lengths (which would itself be a timing oracle).
 */
export class SharedSecretVerifier implements BearerVerifier {
  private readonly expected: Buffer;

  constructor(sharedSecret: string) {
    if (!sharedSecret || sharedSecret.length === 0) {
      throw new Error(
        'SharedSecretVerifier: sharedSecret must be a non-empty string',
      );
    }
    this.expected = Buffer.from(sharedSecret, 'utf8');
  }

  async verify(plaintext: string): Promise<{ workspaceId: string } | null> {
    const provided = Buffer.from(plaintext, 'utf8');
    if (provided.length !== this.expected.length) return null;
    try {
      return timingSafeEqual(provided, this.expected)
        ? { workspaceId: DEFAULT_WORKSPACE_ID }
        : null;
    } catch {
      return null;
    }
  }
}
