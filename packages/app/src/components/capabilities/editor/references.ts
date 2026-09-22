/**
 * `@`-references in capability instructions.
 *
 * The reference *grammar* (token shape, `extractReferences`, keys) now lives in
 * `@roadiehq/scopes-common` so the capabilities editor and the service-token
 * scope picker parse references identically — the picker uses it to suggest the
 * scopes a capability's references require. This module re-exports that grammar
 * and adds the app-side resolution/display concepts (`CapabilityReference`,
 * `REFERENCE_TYPE_LABELS`).
 */

export {
  extractReferences,
  createReferenceRegex,
  referenceKey,
  rewriteReferences,
  isValidSlug,
  REFERENCE_TOKEN_SOURCE,
  SLUG_RE,
  type CapabilityReferenceType,
  type ParsedReference,
} from '@roadiehq/scopes-common';

import type { CapabilityReferenceType } from '@roadiehq/scopes-common';

export interface CapabilityReference {
  type: CapabilityReferenceType;
  slug: string;
  name: string;
  /** The referenced resource's id, for linking to its detail. */
  id: string;
}

/** Human-readable group labels, used for the autocomplete sections. */
export const REFERENCE_TYPE_LABELS: Record<CapabilityReferenceType, string> = {
  datasource: 'Data sources',
  action: 'Actions',
  'context-group': 'Context groups',
  capability: 'Capabilities',
};
