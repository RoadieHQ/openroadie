/*
 * Copyright 2024 The Backstage Authors
 * Modifications copyright 2026 Larder Software Limited
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
 *
 * Derived from Backstage (https://github.com/backstage/backstage),
 * packages/backend-defaults/src/entrypoints/httpAuth/httpAuthServiceFactory.ts at v1.47.1, and modified.
 */

import {
  RoadieCredentials,
  RoadiePrincipalTypes,
  coreServices,
  createServiceFactory,
  HttpAuthService,
} from '@roadiehq/extensions-api';
import { Request, Response } from 'express';

/** The identity every caller has when no real authentication is wired in.
 *  Single-user by construction: a deployment without an identity provider has
 *  one user, so everything a guest owns is visible to the next guest. */
const GUEST_USER_ID = 'guest';

class RoadieAuthService implements HttpAuthService {
  async credentials<TAllowed extends keyof RoadiePrincipalTypes = 'unknown'>(
    _req: Request,
    _options?: { allow?: Array<TAllowed>; allowLimitedAccess?: boolean },
  ): Promise<RoadieCredentials<RoadiePrincipalTypes[TAllowed]>> {
    return {
      $$type: '@roadiehq/RoadieCredentials',
      principal: { type: 'user', userId: GUEST_USER_ID },
    } as RoadieCredentials<RoadiePrincipalTypes[TAllowed]>;
  }

  async issueUserCookie(
    _res: Response,
    _options?: { credentials?: RoadieCredentials },
  ): Promise<{ expiresAt: Date }> {
    return { expiresAt: new Date(0) };
  }
}
export const httpAuthServiceFactory = createServiceFactory({
  service: coreServices.httpAuth,
  deps: {
    discovery: coreServices.discovery,
  },
  async factory() {
    return new RoadieAuthService();
  },
});
