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

import {
  createServiceRef,
  createServiceFactory,
} from '@roadiehq/extensions-api';

/**
 * Resolves the current scope id for the in-flight request or scheduled
 * task. OSS deployments return the constant string `'default'`; internal
 * overlays can provide a resolver backed by request context.
 */
export interface CurrentScopeIdResolver {
  getCurrentScopeId(): string | Promise<string>;
}

export const DEFAULT_SCOPE_ID = 'default';

export const defaultCurrentScopeIdResolver: CurrentScopeIdResolver = {
  getCurrentScopeId: () => DEFAULT_SCOPE_ID,
};

export const currentScopeIdServiceRef =
  createServiceRef<CurrentScopeIdResolver>({
    id: 'integrations.currentScopeId',
    // Root-scoped so the root-scoped IntegrationClient can resolve the caller's
    // scope for AWS assume-role identity. Resolvers read request context at
    // call time, so a single instance is correct. Plugin-scoped factories can
    // still depend on it.
    scope: 'root',
    defaultFactory: async service =>
      createServiceFactory({
        service,
        deps: {},
        async factory() {
          return defaultCurrentScopeIdResolver;
        },
      }),
  });
