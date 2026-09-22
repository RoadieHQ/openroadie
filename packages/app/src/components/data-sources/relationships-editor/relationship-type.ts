import type { AutocompleteOption } from '@roadiehq/ui/autocomplete';

/**
 * Known relationship verbs and their inverse. The reciprocal (reverse) verb of
 * a relationship with a known inverse is derived automatically — the reverse
 * field is hidden for these types. Shared by the rule editor and the manual
 * single-edge editor so both offer the same verbs and the same auto-derivation.
 */
export const RECIPROCAL_PAIRS: Record<string, string> = {
  dependsOn: 'hasDependency',
  hasDependency: 'dependsOn',
  partOf: 'hasPart',
  hasPart: 'partOf',
  relatedTo: 'relatesTo',
  relatesTo: 'relatedTo',
  ownedBy: 'owns',
  owns: 'ownedBy',
  producedBy: 'produces',
  produces: 'producedBy',
  consumedBy: 'consumes',
  consumes: 'consumedBy',
  parentOf: 'childOf',
  childOf: 'parentOf',
};

// Shown under the relationship / reciprocal type fields when the current
// settings collide with an existing rule. Shared so the wording stays in sync
// across the field-matching and integration-backed editors.
export const DUPLICATE_RULE_MESSAGE =
  'A rule with these settings already exists';

export function deriveReciprocal(relationshipType: string): string {
  return RECIPROCAL_PAIRS[relationshipType.trim()] ?? '';
}

/**
 * The narrow slice of editor state that {@link RelationshipTypeField} and
 * {@link ReciprocalField} actually read. Both the rule editor's
 * `RelationshipRuleEditorState` and the manual-edge type-field hook satisfy this
 * — so the same two controls (and their reciprocal auto-derivation, options and
 * duplicate styling) render identically in both editors.
 */
export interface RelationshipTypeFieldState {
  relationshipType: string;
  handleRelationshipTypeChange: (next: string) => void;
  reciprocalRelationshipType: string;
  handleReciprocalChange: (next: string) => void;
  relationshipTypeOptions: AutocompleteOption[];
  isDuplicate: boolean;
  isReciprocalDuplicate: boolean;
}

/**
 * Build the relationship-type combobox options: every known verb, plus any type
 * already in use (existing rules or existing relationships), sorted.
 */
export function relationshipTypeOptionsFrom(
  existingTypes: Iterable<string>,
): AutocompleteOption[] {
  const set = new Set<string>(Object.keys(RECIPROCAL_PAIRS));
  for (const type of existingTypes) {
    if (type) {
      set.add(type);
    }
  }
  return [...set].sort().map(value => ({ value }));
}
