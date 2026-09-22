/*
 * Copyright 2025 Larder Software Limited
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
import type { HttpAuthService, RoadieUserPrincipal } from './types';

/** Recorded in place of a user id when a write has no human behind it. */
export const UNATTRIBUTED = 'unattributed';

/**
 * The one way to read who a request acts as. Every caller that needs an
 * identity goes through this rather than reaching for credentials itself:
 * the six copies this replaced had each grown their own fallback
 * (`undefined`, `'unknown'`, `'service'`, `'service-principal'`,
 * `'unauthenticated'`), so the same unidentified caller was recorded five
 * different ways depending on which route it entered by.
 *
 * `undefined` means no human — an unauthenticated caller or a service token.
 * Authorization must treat that as owning nothing; `callerAttribution` is the
 * accessor for audit trails, which need a string either way.
 */
export async function callerPrincipal(
  httpAuth: HttpAuthService,
  req: Request,
): Promise<RoadieUserPrincipal | undefined> {
  try {
    const { principal } = await httpAuth.credentials<'user'>(req);
    return principal.type === 'user' ? principal : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Who to record for an audited write. A service token is attributed to its own
 * subject rather than collapsed into `UNATTRIBUTED`, so a token-driven change
 * remains traceable to the token that made it.
 */
export async function callerAttribution(
  httpAuth: HttpAuthService,
  req: Request,
): Promise<string> {
  try {
    const { principal } = await httpAuth.credentials(req);
    const typed = principal as
      | RoadieUserPrincipal
      | { type: 'service'; subject: string }
      | { type: 'none' };
    if (typed.type === 'user') {
      return typed.userId;
    }
    if (typed.type === 'service') {
      return `service:${typed.subject}`;
    }
    return UNATTRIBUTED;
  } catch {
    return UNATTRIBUTED;
  }
}
