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
 * The verbs that can appear in a scope. A scope is `resource:action[:target]`.
 *
 * - `get`      — read a single resource
 * - `query`    — a read that changes nothing (search / list, incl. read-only POSTs)
 * - `create`   — create or mutate a resource
 * - `delete`   — delete a resource
 * - `dry-run`  — simulate/preview without persisting
 * - `execute`  — run/apply/restore an existing resource
 */
export const SCOPE_ACTIONS = [
  'get',
  'query',
  'create',
  'delete',
  'dry-run',
  'execute',
] as const;

export type ScopeAction = (typeof SCOPE_ACTIONS)[number];

/**
 * Builds a scope string. When `target` is supplied the scope is narrowed to a
 * single resource instance (e.g. `action:execute:action-1`); a grant of the
 * un-narrowed scope (`action:execute`) covers every target.
 */
export function scope(
  resource: string,
  action: ScopeAction,
  target?: string,
): string {
  return target ? `${resource}:${action}:${target}` : `${resource}:${action}`;
}

/** Object-property name each verb is exposed under (`dry-run` → `dryRun`). */
const ACTION_KEYS = {
  get: 'get',
  query: 'query',
  create: 'create',
  delete: 'delete',
  'dry-run': 'dryRun',
  execute: 'execute',
} as const satisfies Record<ScopeAction, string>;

type ScopeKey<A extends ScopeAction> = (typeof ACTION_KEYS)[A];

/**
 * Builds the scope strings for a resource, exposing only the verbs it actually
 * uses. A resource lists the actions it wires to a REST route or MCP tool;
 * verbs it never enforces are intentionally absent so an unenforced scope can't
 * be granted (see the per-resource lists below).
 */
const resourceScopes = <
  R extends string,
  const A extends readonly ScopeAction[],
>(
  resource: R,
  actions: A,
): { [K in A[number] as ScopeKey<K>]: string } => {
  const out = {} as Record<string, string>;
  for (const action of actions) {
    out[`${ACTION_KEYS[`${action}`]}`] = scope(resource, action);
  }
  return out as { [K in A[number] as ScopeKey<K>]: string };
};

/**
 * The single source of truth for scope names, shared by the REST API middleware
 * (`requireScopes`) and the MCP tool registry. Each resource exposes only the
 * verbs wired to a real guard/tool; a scope that gates nothing is not defined,
 * so it can neither be granted nor silently drift. The scope-enforcement e2e
 * suite (`packages/e2e/tests/scopes`) asserts every entry here is exercised.
 */
export const SCOPES = {
  catalogDatastore: resourceScopes('catalog-datastore', [
    'get',
    'query',
    'create',
    'delete',
    'execute',
  ]),
  datasource: resourceScopes('datasource', ['query', 'create']),
  relationshipRule: resourceScopes('relationship-rule', [
    'get',
    'query',
    'create',
    'delete',
    'dry-run',
    'execute',
  ]),
  relationship: resourceScopes('relationship', [
    'get',
    'query',
    'create',
    'delete',
  ]),
  capability: resourceScopes('capability', [
    'get',
    'query',
    'create',
    'delete',
  ]),
  integration: resourceScopes('integration', [
    'get',
    'query',
    'create',
    'delete',
    'execute',
  ]),
  action: resourceScopes('action', [
    'get',
    'query',
    'create',
    'delete',
    'execute',
  ]),
  contextGroup: resourceScopes('context-group', [
    'query',
    'create',
    'delete',
    'dry-run',
    'execute',
  ]),
  secretsSettings: resourceScopes('secrets-settings', [
    'get',
    'query',
    'create',
    'delete',
  ]),
  catalogWorkflow: resourceScopes('catalog-workflow', [
    'get',
    'query',
    'create',
    'delete',
    'dry-run',
    'execute',
  ]),
  ai: resourceScopes('ai', ['get', 'create', 'execute']),
  // The target slot narrows a workspace create to a *type* rather than an
  // instance id (every other resource's targets are ids): a grant of
  // `workspace:create:personal` is self-serve space, while minting an
  // organization workspace requires the un-narrowed `workspace:create`.
  workspace: resourceScopes('workspace', ['get', 'query', 'create', 'delete']),
  team: resourceScopes('team', ['get', 'query', 'create', 'delete']),
  mcpSettings: resourceScopes('mcp-settings', ['query', 'create']),
  mcp: resourceScopes('mcp', ['query']),
  // Write-only session-telemetry ingestion. Deliberately its own resource with
  // a single `create` verb: the token baked into IDE telemetry hooks carries
  // only this scope, so a leaked hook config can post telemetry and nothing
  // else (no MCP tools, no reads — telemetry reads use `mcp:query`).
  mcpTelemetry: resourceScopes('mcp-telemetry', ['create']),
} as const;
