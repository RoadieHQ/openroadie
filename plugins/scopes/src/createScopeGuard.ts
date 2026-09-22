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
import type { RequestHandler } from 'express';
import { createScopeChecker } from './checker';
import type { ScopeRetriever } from './service';

/**
 * A route guard bound to a {@link ScopeRetriever}: given the scopes a route
 * requires, returns the Express middleware that enforces them. This is the
 * shape supplied by `scopeGuardServiceRef`, so plugins receive it ready-made
 * rather than constructing it per router.
 */
export type RequireScopes = (...required: string[]) => RequestHandler;

/**
 * A family guard: given a base scope, returns middleware admitting any caller
 * who holds that scope's family (`resource:action` itself or any narrowed
 * `resource:action:target`). Used by collection endpoints that admit at the
 * family level and then filter rows to the caller's granted targets — a caller
 * holding only `action:query:foo` reaches the list but sees only `foo`.
 */
export type RequireScopeFamily = (baseScope: string) => RequestHandler;

/**
 * Builds a `requireScopes` guard bound to a {@link ScopeRetriever}. This is the
 * primitive behind {@link createScopeService}; plugins normally consume the
 * ready-made guard as `scopeService.requireScopes` rather than calling this.
 *
 * Each returned guard requires the caller to hold every one of `required`. The
 * caller's scopes come from the bound retriever; a request missing any required
 * scope gets `403` with `{ error: 'insufficient scope', missing }`. Enforcement
 * is a no-op only when the retriever itself grants everything (the OSS
 * {@link allowAllScopeService} default).
 */
export function createScopeGuard(retriever: ScopeRetriever): RequireScopes {
  return (...required: string[]): RequestHandler => {
    return (req, res, next) => {
      Promise.resolve(retriever.getGrantedScopes(req))
        .then(granted => {
          const checker = createScopeChecker(granted);
          const missing = required.filter(s => !checker.allows(s));
          if (missing.length) {
            res.status(403).json({ error: 'insufficient scope', missing });
            return;
          }
          next();
        })
        .catch(next);
    };
  };
}

/**
 * Builds a {@link RequireScopeFamily} guard bound to a {@link ScopeRetriever}.
 * Admits the request when the caller holds any scope in `baseScope`'s family;
 * the handler is then responsible for filtering results to the granted targets
 * (see {@link ScopeChecker.allowedTargets}). A request holding nothing in the
 * family gets `403` with `{ error: 'insufficient scope', missing: [baseScope] }`.
 */
export function createScopeFamilyGuard(
  retriever: ScopeRetriever,
): RequireScopeFamily {
  return (baseScope: string): RequestHandler => {
    return (req, res, next) => {
      Promise.resolve(retriever.getGrantedScopes(req))
        .then(granted => {
          const checker = createScopeChecker(granted);
          if (!checker.allowsFamily(baseScope)) {
            res
              .status(403)
              .json({ error: 'insufficient scope', missing: [baseScope] });
            return;
          }
          next();
        })
        .catch(next);
    };
  };
}
