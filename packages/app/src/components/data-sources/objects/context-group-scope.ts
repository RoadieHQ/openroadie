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
 * Context-group rules share the Datastore's `?ds=` scope with data sources,
 * prefixed so the two id spaces can't collide: `cg:<ruleId>` scopes the view to
 * a rule's materialized groups the way a bare id scopes it to a data source's
 * objects. A standalone module (rather than `datastore-scope-param.ts`) so the
 * objects hook can use it without importing the URL-param layer back into
 * itself.
 */
export const CONTEXT_GROUP_SCOPE_PREFIX = 'cg:';

export function contextGroupScopeId(ruleId: string): string {
  return `${CONTEXT_GROUP_SCOPE_PREFIX}${ruleId}`;
}

export function isContextGroupScopeId(id: string): boolean {
  return id.startsWith(CONTEXT_GROUP_SCOPE_PREFIX);
}

/** The rule id a `cg:`-prefixed scope entry names, or undefined for a plain
 * data-source id. */
export function parseContextGroupScopeId(id: string): string | undefined {
  return isContextGroupScopeId(id)
    ? id.slice(CONTEXT_GROUP_SCOPE_PREFIX.length)
    : undefined;
}

/** Partition a mixed scope into its data-source ids and context-group rule ids. */
export function splitDatastoreScope(scope: string[]): {
  datasourceIds: string[];
  contextGroupRuleIds: string[];
} {
  const datasourceIds: string[] = [];
  const contextGroupRuleIds: string[] = [];
  for (const id of scope) {
    const ruleId = parseContextGroupScopeId(id);
    if (ruleId !== undefined) {
      contextGroupRuleIds.push(ruleId);
    } else {
      datasourceIds.push(id);
    }
  }
  return { datasourceIds, contextGroupRuleIds };
}
