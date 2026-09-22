import { useCallback, useMemo, useState } from 'react';
import type { AutocompleteOption } from '@roadiehq/ui/autocomplete';
import {
  deriveReciprocal,
  relationshipTypeOptionsFrom,
} from './relationship-type';

export interface UseRelationshipTypeFieldOptions {
  /** Type to seed with (defaults to `dependsOn`, matching the rule editor). */
  initialType?: string;
  /** Reciprocal to seed with; falls back to the derived reverse of the type. */
  initialReciprocal?: string;
  /** Types already in use, merged into the combobox options. */
  existingTypes?: string[];
}

export interface RelationshipTypeFieldValue {
  relationshipType: string;
  reciprocalRelationshipType: string;
  handleRelationshipTypeChange: (next: string) => void;
  handleReciprocalChange: (next: string) => void;
  relationshipTypeOptions: AutocompleteOption[];
  /** Re-seed both verbs (e.g. reopening the editor on a different edge). */
  reset: (next?: { type?: string; reciprocal?: string }) => void;
}

const DEFAULT_TYPE = 'dependsOn';

function isOverride(reciprocal: string, type: string): boolean {
  return reciprocal !== '' && reciprocal !== deriveReciprocal(type);
}

/**
 * The relationship-type + reciprocal-verb state shared by the rule editor and
 * the manual single-edge editor. Owns the same auto-derivation the rule editor
 * uses: a type with a known inverse always shows its derived reverse verb (and
 * hides the field); a custom type keeps whatever reverse the user typed. Lifted
 * out of {@link useRelationshipRuleEditor} so both editors behave identically.
 */
export function useRelationshipTypeField({
  initialType = DEFAULT_TYPE,
  initialReciprocal,
  existingTypes,
}: UseRelationshipTypeFieldOptions = {}): RelationshipTypeFieldValue {
  const seedReciprocal = initialReciprocal ?? deriveReciprocal(initialType);
  const [relationshipType, setRelationshipType] = useState(initialType);
  const [reciprocalRelationshipType, setReciprocalRelationshipType] =
    useState(seedReciprocal);
  const [reciprocalOverridden, setReciprocalOverridden] = useState(
    isOverride(seedReciprocal, initialType),
  );

  const handleRelationshipTypeChange = useCallback(
    (next: string) => {
      setRelationshipType(next);
      const derived = deriveReciprocal(next);
      // A type with a known inverse always uses the derived reverse verb (the
      // reverse field is hidden for it), so a previously-overridden reverse must
      // not linger invisibly. Only preserve a manual override for a custom type
      // that has no standard inverse.
      if (derived !== '' || !reciprocalOverridden) {
        setReciprocalRelationshipType(derived);
        if (derived !== '') {
          setReciprocalOverridden(false);
        }
      }
    },
    [reciprocalOverridden],
  );

  const handleReciprocalChange = useCallback(
    (next: string) => {
      setReciprocalRelationshipType(next);
      setReciprocalOverridden(isOverride(next, relationshipType));
    },
    [relationshipType],
  );

  const relationshipTypeOptions = useMemo(
    () => relationshipTypeOptionsFrom(existingTypes ?? []),
    [existingTypes],
  );

  const reset = useCallback((next?: { type?: string; reciprocal?: string }) => {
    const type = next?.type ?? DEFAULT_TYPE;
    const reciprocal = next?.reciprocal ?? deriveReciprocal(type);
    setRelationshipType(type);
    setReciprocalRelationshipType(reciprocal);
    setReciprocalOverridden(isOverride(reciprocal, type));
  }, []);

  return {
    relationshipType,
    reciprocalRelationshipType,
    handleRelationshipTypeChange,
    handleReciprocalChange,
    relationshipTypeOptions,
    reset,
  };
}
