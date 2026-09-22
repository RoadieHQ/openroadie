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

/**
 * Verifies an incoming `Authorization: Bearer <plaintext>` header against
 * whatever scheme this deployment uses for OSS-plugin authentication.
 *
 * The wire contract (see catalog-backend-module-openroadie's
 * UpstreamSubscriptionClient) is scheme-agnostic — only what counts as a
 * valid bearer changes. Implementations:
 *
 * - PublicVerifier: skips the webhook-specific bearer token check for
 *   deployments that already authenticate /api before this router.
 * - DbTokenVerifier: SHA-256-hashed tokens minted via the admin UI and
 *   stored in webhook_tokens. Works well for local or single-instance setups.
 * - SharedSecretVerifier: a long-lived value provisioned out-of-band
 *   (SSM, env, KMS-decrypted config). Useful when multiple services share
 *   the same webhook trust boundary.
 *
 * If a future scheme bakes scope info into the bearer differently (e.g. an
 * asymmetric JWT verified with KMS), it just becomes another implementation
 * here.
 */
export interface BearerVerifier {
  requiresBearer?: boolean;
  verify(
    plaintext: string,
    req: Request,
  ): Promise<{ workspaceId: string } | null>;
}
