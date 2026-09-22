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

/**
 * Sentinel returned by a resolver to grant every scope. Used by the default
 * allow-all resolver so enforcement is a no-op until a real resolver is injected.
 */
export const ALL_SCOPES = '*' as const;

/**
 * The scopes granted to the caller of a request: either an explicit set of scope
 * strings or {@link ALL_SCOPES} for "everything".
 */
export type GrantedScopes = Iterable<string> | typeof ALL_SCOPES;

/**
 * Answers scope questions for a single resolved request. Two questions are
 * distinguished because a resource can be gated at two moments:
 *
 * - `allows(scope)` — call/request time. Is this exact scope granted? A grant of
 *   the un-narrowed `resource:action` also covers any `resource:action:target`.
 * - `allowsFamily(baseScope)` — listing time. Is *any* scope in the base's family
 *   granted (`resource:action` itself or any `resource:action:target`)? Controls
 *   whether an MCP tool is advertised in `tools/list` at all.
 * - `allowedTargets(baseScope)` — row-filtering time. Which instances of a
 *   collection may the caller see? Returns {@link ALL_SCOPES} when the un-narrowed
 *   `baseScope` (or everything) is granted — i.e. no restriction — otherwise the
 *   set of targets `t` for which `baseScope:t` is granted. A list endpoint uses
 *   this to return only the rows the caller holds a narrowed grant for.
 */
export interface ScopeChecker {
  allows(requiredScope: string): boolean;
  allowsFamily(baseScope: string): boolean;
  allowedTargets(baseScope: string): typeof ALL_SCOPES | Set<string>;
}

/**
 * Builds a {@link ScopeChecker} from a set of granted scopes. {@link ALL_SCOPES}
 * produces a checker that allows everything (the allow-all default).
 */
export function createScopeChecker(granted: GrantedScopes): ScopeChecker {
  if (granted === ALL_SCOPES) {
    return {
      allows: () => true,
      allowsFamily: () => true,
      allowedTargets: () => ALL_SCOPES,
    };
  }

  const set = granted instanceof Set ? granted : new Set(granted);

  return {
    allows: requiredScope => {
      if (set.has(requiredScope)) return true;
      // A grant of `resource:action` covers any narrowed `resource:action:target`.
      const lastColon = requiredScope.lastIndexOf(':');
      if (lastColon === -1) return false;
      const parent = requiredScope.slice(0, lastColon);
      return parent.includes(':') && set.has(parent);
    },
    allowsFamily: baseScope => {
      if (set.has(baseScope)) return true;
      const prefix = `${baseScope}:`;
      for (const s of set) {
        if (s.startsWith(prefix)) return true;
      }
      return false;
    },
    allowedTargets: baseScope => {
      // The un-narrowed grant covers every target: no restriction.
      if (set.has(baseScope)) return ALL_SCOPES;
      const prefix = `${baseScope}:`;
      const targets = new Set<string>();
      for (const s of set) {
        if (s.startsWith(prefix)) {
          targets.add(s.slice(prefix.length));
        }
      }
      return targets;
    },
  };
}
