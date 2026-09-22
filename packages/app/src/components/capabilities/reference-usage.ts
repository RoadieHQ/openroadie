/**
 * Which capabilities reference a given resource.
 *
 * Capability instructions link to catalog resources with literal `@type:slug`
 * tokens, so the slug *is* the link — renaming or deleting a resource silently
 * breaks every capability naming it. This module indexes the tokens in reverse
 * (resource → referencing capabilities) so rename and delete flows can say what
 * they are about to break before they break it.
 *
 * Pure and React-free so the edge cases are unit-testable; `use-reference-usage`
 * wraps it for components.
 */

import {
  extractReferences,
  referenceKey,
  type CapabilityReferenceType,
} from './editor/references';

/** The fields of a capability this module needs. `Capability` satisfies it. */
export interface ReferencingCapability {
  id: string;
  name: string;
  instructions: string;
}

/**
 * Something that might be `@`-referenced. `slug` is nullable because all four
 * types can exist without one — such a resource is simply unreferenceable.
 */
export interface ReferenceTarget {
  type: CapabilityReferenceType;
  name: string;
  slug: string | null | undefined;
}

/** A target at least one capability references. */
export interface ReferencedTarget extends ReferenceTarget {
  slug: string;
  usedBy: ReferencingCapability[];
}

/**
 * Index every `@type:slug` token across the given capabilities' instructions to
 * the capabilities containing it.
 *
 * Keyed by `referenceKey(type, slug)` so a data source and an action that share
 * a slug never collide. Entries hold whole capabilities rather than names: two
 * capabilities may share a display name and both must appear in a warning.
 * `extractReferences` de-duplicates within one capability, so no capability
 * appears twice under one key.
 */
export function buildReferenceUsageIndex(
  capabilities: readonly ReferencingCapability[],
): Map<string, ReferencingCapability[]> {
  const index = new Map<string, ReferencingCapability[]>();
  for (const capability of capabilities) {
    for (const ref of extractReferences(capability.instructions)) {
      const key = referenceKey(ref.type, ref.slug);
      const existing = index.get(key);
      if (existing) {
        existing.push(capability);
      } else {
        index.set(key, [capability]);
      }
    }
  }
  return index;
}

/** Capabilities whose instructions contain `@type:slug`. Empty for a blank slug. */
export function lookupReferenceUsage(
  index: Map<string, ReferencingCapability[]>,
  type: CapabilityReferenceType,
  slug: string | null | undefined,
): ReferencingCapability[] {
  if (!slug) return [];
  return index.get(referenceKey(type, slug)) ?? [];
}

/**
 * The subset of `targets` something references, in input order.
 *
 * `excludeCapabilityIds` drops referencing capabilities that are themselves
 * being deleted — a mutually-referencing pair deleted together must not warn
 * about references that are about to vanish anyway.
 */
export function selectReferencedTargets(
  index: Map<string, ReferencingCapability[]>,
  targets: readonly ReferenceTarget[],
  excludeCapabilityIds?: ReadonlySet<string>,
): ReferencedTarget[] {
  const referenced: ReferencedTarget[] = [];
  for (const target of targets) {
    const { slug } = target;
    if (!slug) continue;
    const usedBy = lookupReferenceUsage(index, target.type, slug).filter(
      capability => !excludeCapabilityIds?.has(capability.id),
    );
    if (usedBy.length > 0) {
      referenced.push({ ...target, slug, usedBy });
    }
  }
  return referenced;
}

/** `A, B and 2 more` — the shared truncation for "used by" prose. */
export function formatUsedByNames(
  names: readonly string[],
  visible = 3,
): string {
  if (names.length <= visible) {
    return names.join(', ');
  }
  return `${names.slice(0, visible).join(', ')} and ${
    names.length - visible
  } more`;
}
