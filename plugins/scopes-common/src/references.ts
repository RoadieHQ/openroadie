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
 * Shared grammar for `@`-references in capability instructions.
 *
 * A reference is an inline token of the form `@type:slug`, e.g.
 * `@datasource:sentry-projects`, `@action:create-repository`,
 * `@context-group:payments-team`, `@capability:deploy-service`. The type prefix
 * disambiguates the referenceable resource kinds; the slug is the resource's
 * stable, human-readable identifier.
 *
 * This lives in `scopes-common` (not the app editor) so both the capabilities
 * editor and the service-token scope picker parse references with the *same*
 * grammar — the picker uses it to suggest the scopes a capability's references
 * require. Keep the grammar here as the single source of truth.
 */

export type CapabilityReferenceType =
  | 'datasource'
  | 'action'
  | 'context-group'
  | 'capability';

/**
 * The slug body, unanchored, so it can be embedded in larger patterns.
 * Lowercase alphanumerics joined by single hyphens — no leading, trailing or
 * doubled hyphens.
 */
export const SLUG_SOURCE = '[a-z0-9]+(?:-[a-z0-9]+)*';

/**
 * Anchored slug validator — the grammar every backend enforces on write and the
 * service-token scope picker enforces on a narrowing target. Built from
 * {@link SLUG_SOURCE} so a slug that passes validation is, by construction, one
 * {@link REFERENCE_TOKEN_SOURCE} can match. No `g` flag: this is a stateless
 * predicate, not a scanner.
 */
export const SLUG_RE = new RegExp(`^${SLUG_SOURCE}$`);

/** True when `value` is a well-formed slug, i.e. one that can be `@`-referenced. */
export function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

/**
 * Matches a single reference token. Use a fresh instance (or reset `lastIndex`)
 * when scanning with the global flag.
 */
export const REFERENCE_TOKEN_SOURCE = `@(datasource|action|context-group|capability):(${SLUG_SOURCE})`;

export function createReferenceRegex(): RegExp {
  return new RegExp(REFERENCE_TOKEN_SOURCE, 'g');
}

/** Build the `type:slug` key used to look up a reference. */
export function referenceKey(type: CapabilityReferenceType, slug: string) {
  return `${type}:${slug}`;
}

/** A `@type:slug` reference token parsed out of instruction text. */
export interface ParsedReference {
  type: CapabilityReferenceType;
  slug: string;
}

/**
 * Extract every `@type:slug` reference token from a block of instruction text,
 * de-duplicated by `type:slug`. Used to cross-check which resources a
 * capability depends on (e.g. to flag dangling references, warn before deleting
 * a referenced data source, or suggest the scopes a token needs to run it).
 */
export function extractReferences(text: string): ParsedReference[] {
  if (!text) return [];
  const regex = createReferenceRegex();
  const seen = new Set<string>();
  const refs: ParsedReference[] = [];
  for (const match of text.matchAll(regex)) {
    const type = match[1] as CapabilityReferenceType;
    const slug = match[2];
    const key = referenceKey(type, slug);
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ type, slug });
    }
  }
  return refs;
}

/**
 * Rewrite every `@<type>:<fromSlug>` token in `text` to `@<type>:<toSlug>`.
 *
 * Matching goes through the shared token regex and compares the *captured* slug
 * for exact equality. A substring replace of `@datasource:foo` would corrupt
 * `@datasource:foo-bar` into `@datasource:new-bar`, because the grammar is
 * greedy and `foo-bar` is a single slug rather than `foo` plus a suffix. Tokens
 * of other types, and tokens whose slug merely starts with `fromSlug`, are
 * returned untouched.
 *
 * Returns `text` by identity when nothing matched, so callers can skip the
 * write with `if (next === prev) return;`.
 */
export function rewriteReferences(
  text: string,
  type: CapabilityReferenceType,
  fromSlug: string,
  toSlug: string,
): string {
  if (!text || !fromSlug || fromSlug === toSlug) return text;
  // A function replacement, not a string: a string would interpret `$&`/`$1`
  // in `toSlug` as capture-group references.
  return text.replace(
    createReferenceRegex(),
    (match, matchedType: string, matchedSlug: string) =>
      matchedType === type && matchedSlug === fromSlug
        ? `@${type}:${toSlug}`
        : match,
  );
}
