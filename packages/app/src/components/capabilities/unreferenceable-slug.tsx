import { AlertTriangle } from 'lucide-react';
import { isValidSlug, type CapabilityReferenceType } from './editor/references';

/**
 * Flags a slug that predates slug validation and can never be `@`-referenced.
 *
 * Validation now rejects these on write, but existing rows keep whatever they
 * were saved with — and a resource nobody can reference from a capability is
 * silently useless. Both halves render in an editor's header slug trigger,
 * which is the only place a slug is shown.
 */

export function unreferenceableSlugMessage(
  type: CapabilityReferenceType,
  slug: string,
): string {
  return `"${slug}" can't be referenced — @${type}:${slug} won't resolve in a capability. Rename it to lowercase letters, numbers and single hyphens.`;
}

/** The tooltip for a slug trigger: the normal hint, or why the slug is broken. */
export function slugTriggerTooltip(
  type: CapabilityReferenceType,
  slug: string | null | undefined,
  fallback: string,
): string {
  if (!slug || isValidSlug(slug)) return fallback;
  return unreferenceableSlugMessage(type, slug);
}

export function UnreferenceableSlugIcon({
  type,
  slug,
}: {
  type: CapabilityReferenceType;
  slug: string | null | undefined;
}) {
  if (!slug || isValidSlug(slug)) return null;
  return (
    <AlertTriangle
      data-testid="unreferenceable-slug"
      className="size-3.5 text-warning"
      aria-label={unreferenceableSlugMessage(type, slug)}
    />
  );
}
