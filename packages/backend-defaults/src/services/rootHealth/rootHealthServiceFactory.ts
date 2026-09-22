/*
 * Copyright 2024 The Backstage Authors
 * Modifications copyright 2024 Larder Software Limited
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
 * packages/backend-defaults/src/entrypoints/rootHealth/rootHealthServiceFactory.ts at v1.47.1, and modified.
 */

import {
  coreServices,
  createServiceFactory,
  RootHealthService,
  RootLifecycleService,
} from '@roadiehq/extensions-api';

type HealthState = 'init' | 'up' | 'down';

interface HealthResponse {
  status: number;
  payload: { status: 'ok' | 'error'; message?: string };
}

/**
 * Default root health service implementation.
 * Tracks backend lifecycle state for health checks.
 */
class DefaultRootHealthService implements RootHealthService {
  #state: HealthState = 'init';

  constructor(options: { lifecycle: RootLifecycleService }) {
    options.lifecycle.addStartupHook(async () => {
      this.#state = 'up';
    });
    options.lifecycle.addBeforeShutdownHook(async () => {
      this.#state = 'down';
    });
  }

  async getLiveness(): Promise<HealthResponse> {
    return { status: 200, payload: { status: 'ok' } };
  }

  async getReadiness(): Promise<HealthResponse> {
    if (this.#state === 'init') {
      return {
        status: 503,
        payload: { message: 'Backend has not started yet', status: 'error' },
      };
    }
    if (this.#state === 'down') {
      return {
        status: 503,
        payload: { message: 'Backend is shutting down', status: 'error' },
      };
    }
    return { status: 200, payload: { status: 'ok' } };
  }
}

/**
 * Root health service factory.
 * Provides liveness and readiness health check endpoints.
 */
export const rootHealthServiceFactory = createServiceFactory({
  service: coreServices.rootHealth,
  deps: {
    lifecycle: coreServices.rootLifecycle,
  },
  async factory({ lifecycle }) {
    return new DefaultRootHealthService({ lifecycle });
  },
});
