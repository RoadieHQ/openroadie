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
import {
  createServiceRef,
  createServiceFactory,
} from '@roadiehq/extensions-api';
import type { Request } from 'express';
import { ALL_SCOPES, createScopeChecker, type GrantedScopes } from './checker';
import {
  createScopeGuard,
  createScopeFamilyGuard,
  type RequireScopes,
  type RequireScopeFamily,
} from './createScopeGuard';

/**
 * Resolves the scopes granted to the caller of a request — typically by
 * inspecting its bearer token or the ambient request context. Returning
 * {@link ALL_SCOPES} grants everything. This is the single primitive a SaaS
 * overlay implements; both usage modes on {@link ScopeService} derive from it.
 */
export interface ScopeRetriever {
  getGrantedScopes(req: Request): GrantedScopes | Promise<GrantedScopes>;
}

/**
 * The scopes dependency plugins receive from {@link scopeServiceRef}. One
 * service, two ways to use it:
 * - `requireScopes(...scopes)` — Express middleware, for guarding REST routes.
 * - `getGrantedScopes(req)` — the raw scopes, for MCP enforcement that builds a
 *   {@link createScopeChecker} per tool-call rather than per route.
 * - `requireScopeFamily(base)` — Express middleware for collection endpoints
 *   that admit the whole family of a scope and then filter rows themselves.
 */
export interface ScopeService extends ScopeRetriever {
  requireScopes: RequireScopes;
  requireScopeFamily: RequireScopeFamily;
}

/**
 * Builds a {@link ScopeService} from the one primitive an implementer supplies:
 * a function resolving a request's granted scopes. The REST guard is derived
 * from it here, so consumers never construct it themselves.
 */
export function createScopeService(
  getGrantedScopes: ScopeRetriever['getGrantedScopes'],
): ScopeService {
  return {
    getGrantedScopes,
    requireScopes: createScopeGuard({ getGrantedScopes }),
    requireScopeFamily: createScopeFamilyGuard({ getGrantedScopes }),
  };
}

/**
 * Resolve the instance targets a request's caller may see within a scope's
 * family, for row-level filtering behind a {@link ScopeService.requireScopeFamily}
 * guard. Returns `undefined` when there is no restriction — the caller holds the
 * un-narrowed `baseScope` (or everything) — otherwise the list of granted
 * targets. A list endpoint passes the result straight to its DAO as an
 * allow-list; `undefined` means "return all rows", `[]` means "return none".
 */
export async function resolveAllowedTargets(
  retriever: ScopeRetriever,
  req: Request,
  baseScope: string,
): Promise<string[] | undefined> {
  const granted = await retriever.getGrantedScopes(req);
  const allowed = createScopeChecker(granted).allowedTargets(baseScope);
  return allowed === ALL_SCOPES ? undefined : [...allowed];
}

/**
 * The single-instance counterpart to {@link resolveAllowedTargets}: whether a
 * request may act on one specific instance under `baseScope`. Pass **all** of
 * the instance's identifiers (e.g. `[id, slug]`) — the caller is authorized if
 * they hold the un-narrowed `baseScope` (or everything) or a narrowed grant for
 * any of those identifiers. This is the controller half of the two-place check
 * for instance routes: a cheap `requireScopeFamily(baseScope)` guard admits any
 * execute grant at the route, then the handler — which has already loaded the
 * entity — calls this to enforce the specific target, resolving id-vs-slug
 * without a second lookup.
 */
export async function isTargetAllowed(
  retriever: ScopeRetriever,
  req: Request,
  baseScope: string,
  identifiers: string[],
): Promise<boolean> {
  const allowed = await resolveAllowedTargets(retriever, req, baseScope);
  return allowed === undefined || identifiers.some(id => allowed.includes(id));
}

/** Default service: grants every scope, so enforcement is a no-op. */
export const allowAllScopeService: ScopeService = createScopeService(
  () => ALL_SCOPES,
);

/**
 * Backend service supplying the {@link ScopeService} for a plugin, used by both
 * REST route guards and MCP enforcement. The OSS default grants all scopes, so
 * enforcement is a no-op until a SaaS overlay registers a factory (via
 * `backend.add`) whose `getGrantedScopes` derives scopes from the caller's
 * token — pass it through {@link createScopeService} and the guard comes for
 * free.
 */
export const scopeServiceRef = createServiceRef<ScopeService>({
  id: 'scopes.service',
  scope: 'plugin',
  defaultFactory: async service =>
    createServiceFactory({
      service,
      deps: {},
      async factory() {
        return allowAllScopeService;
      },
    }),
});
