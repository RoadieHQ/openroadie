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

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Handler, Request } from 'express';
import { createServiceRef } from './createServiceRef';
import { createServiceFactory } from './createServiceFactory';
import { coreServices } from './coreServices';
import type { AuthService } from './types';

/**
 * The inbound headers copied onto internal backend-to-backend calls.
 * `authorization` carries the caller's identity/scopes; `x-scope-id` is the
 * tenant partition key resolved by internal overlays (inert in OSS, but
 * dropping it on an internal hop would cross-tenant a narrowed caller).
 */
export const INTERNAL_FORWARDED_HEADERS = [
  'authorization',
  'x-scope-id',
  'x-openroadie-workspace-id',
] as const;

/**
 * The credentials an internal call should carry, resolved at call time.
 * `headers` is the complete set to attach (possibly empty); `token` is the
 * bare bearer token for clients that need it without the header framing.
 */
export interface InternalCallCredentials {
  token?: string;
  headers: Record<string, string>;
}

/**
 * The minimal fetch-carrying handle internal clients and option types accept.
 * `InternalFetchService` satisfies it, so services can declare this shape and
 * be handed the credential-resolving fetch without depending on the full
 * service interface.
 */
export interface InternalFetchApi {
  fetch: typeof fetch;
}

/**
 * Fetch for internal backend-to-backend HTTP calls. `fetch` injects the
 * resolved credentials into every request; `credentials()` exposes the same
 * resolution for hand-rolled clients that cannot take a fetch implementation.
 *
 * Resolution is ambient and per-call: inside an inbound request (see
 * `internalRequestContextMiddleware`) the caller's own credentials are
 * forwarded, so internal calls stay bounded by the caller's grants. Outside
 * any request (schedulers, event handlers, workflow executions) a service
 * token is minted via the `core.auth` service — which OSS backends leave
 * blank, so background calls carry no header there by design.
 */
export interface InternalFetchService extends InternalFetchApi {
  credentials(options?: {
    targetPluginId?: string;
    /** Resolve as the backend's own service identity, never the ambient caller. */
    asService?: boolean;
  }): Promise<InternalCallCredentials>;

  /**
   * A fetch pinned to the backend's own service identity: the ambient
   * caller's credentials are never forwarded, only a minted service token
   * (no header at all in OSS, where those are blank). For hops that were
   * historically anonymous and must not be narrowed by whichever caller
   * happens to be in async scope — e.g. a workflow run's datastore writes,
   * which outlive the request that triggered them.
   */
  asService(): InternalFetchApi;
}

const requestStorage = new AsyncLocalStorage<Request>();

/**
 * Captures each inbound request into async-local context so
 * `InternalFetchService` can resolve the caller's credentials at call time.
 * Install once, ahead of the plugin routers (the `createRoadieBackend`
 * `extendApi` callback runs in the right place).
 */
export function internalRequestContextMiddleware(): Handler {
  return (req, _res, next) => {
    requestStorage.run(req, next);
  };
}

/** The inbound request the current async chain is serving, if any. */
export function getCurrentInternalRequest(): Request | undefined {
  return requestStorage.getStore();
}

/**
 * Runs `fn` outside any inbound-request context. Async-local context
 * propagates into timers and queues created during a request, so background
 * machinery scheduled from a request path (coalescers, work queues) must
 * escape explicitly — otherwise its internal calls would ride on that one
 * caller's possibly narrow, possibly long-expired credentials.
 */
export function runWithoutRequestContext<T>(fn: () => T): T {
  return requestStorage.exit(fn);
}

function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) {
    return undefined;
  }
  const [scheme, token, ...rest] = authorization.split(' ');
  return rest.length === 0 && scheme?.toLowerCase() === 'bearer' && token
    ? token
    : undefined;
}

/**
 * Discovery base URLs take the shape `<host>/api/<pluginId>`, so the target
 * plugin for a service token can be read off the URL. Custom discovery
 * endpoints that break this shape just skip the service-token fallback.
 */
function pluginIdFromUrl(url: string): string | undefined {
  try {
    const match = new URL(url).pathname.match(/\/api\/([^/]+)(?:\/|$)/);
    return match ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

export function createInternalFetch(options: {
  auth: AuthService;
}): InternalFetchService {
  const { auth } = options;

  const credentials = async (opts?: {
    targetPluginId?: string;
    asService?: boolean;
  }): Promise<InternalCallCredentials> => {
    const req = opts?.asService ? undefined : getCurrentInternalRequest();
    if (req) {
      const headers: Record<string, string> = {};
      for (const name of INTERNAL_FORWARDED_HEADERS) {
        const value = req.header(name);
        if (value) {
          headers[`${name}`] = value;
        }
      }
      return { token: bearerToken(headers.authorization), headers };
    }

    if (opts?.targetPluginId) {
      const { token } = await auth.getPluginRequestToken({
        onBehalfOf: await auth.getOwnServiceCredentials(),
        targetPluginId: opts.targetPluginId,
      });
      // OSS backends mint blank service tokens — send nothing rather than a
      // malformed `Bearer ` header.
      if (token) {
        return { token, headers: { authorization: `Bearer ${token}` } };
      }
    }

    return { headers: {} };
  };

  const makeFetch =
    (asService: boolean): typeof fetch =>
    async (input, init) => {
      let url: string;
      if (typeof input === 'string') {
        url = input;
      } else if (input instanceof URL) {
        url = input.href;
      } else {
        url = input.url;
      }

      const resolved = await credentials({
        targetPluginId: pluginIdFromUrl(url),
        asService,
      });

      const headers = new Headers(
        init?.headers ??
          (typeof input === 'object' && !(input instanceof URL)
            ? input.headers
            : undefined),
      );
      for (const [name, value] of Object.entries(resolved.headers)) {
        // A header set explicitly by the caller wins over the ambient one.
        if (!headers.has(name)) {
          headers.set(name, value);
        }
      }

      // eslint-disable-next-line no-restricted-syntax -- the canonical wrapper: the one place internal calls are allowed to reach the real global fetch.
      return fetch(input, { ...init, headers });
    };

  const serviceFetch: InternalFetchApi = { fetch: makeFetch(true) };

  return {
    fetch: makeFetch(false),
    credentials,
    asService: () => serviceFetch,
  };
}

/**
 * Credential-resolving fetch for internal backend-to-backend calls. The
 * default factory forwards the ambient caller's credentials and falls back
 * to minted service tokens; deployments swap the factory (the way
 * `scopeServiceRef` is swapped in `packages/backend/src/index.ts`) to change
 * how internal calls authenticate.
 */
export const internalFetchServiceRef = createServiceRef<InternalFetchService>({
  id: 'core.internalFetch',
  defaultFactory: async service =>
    createServiceFactory({
      service,
      deps: { auth: coreServices.auth },
      async factory({ auth }) {
        return createInternalFetch({ auth });
      },
    }),
});

export const internalFetchServiceFactory = createServiceFactory({
  service: internalFetchServiceRef,
  deps: { auth: coreServices.auth },
  async factory({ auth }) {
    return createInternalFetch({ auth });
  },
});
