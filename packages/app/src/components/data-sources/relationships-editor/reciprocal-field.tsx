import { useId } from 'react';
import { cn } from '@roadiehq/ui/utils';
import { Autocomplete } from '@roadiehq/ui/autocomplete';
import { Label } from '@roadiehq/ui/label';
import {
  DUPLICATE_RULE_MESSAGE,
  deriveReciprocal,
  type RelationshipTypeFieldState,
} from './relationship-type';

/**
 * Names the reverse direction of the relationship. The reverse edge always
 * exists (it's traversable as an incoming edge regardless), so this is not an
 * on/off switch — it only sets the reverse *verb*.
 *
 * For relationship types with a known inverse (dependsOn ↔ hasDependency,
 * ownedBy ↔ owns, …) the reverse verb is derived automatically and no control
 * is shown. Only a custom type with no standard inverse surfaces an optional
 * field so the reverse can be named (or left unnamed).
 */
export function ReciprocalField({
  editor,
  className,
  duplicateMessage = DUPLICATE_RULE_MESSAGE,
}: {
  editor: RelationshipTypeFieldState;
  className?: string;
  duplicateMessage?: string;
}) {
  const reciprocalTypeId = useId();
  const reciprocalTypeErrorId = useId();

  if (deriveReciprocal(editor.relationshipType) !== '') {
    return null;
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label
        htmlFor={reciprocalTypeId}
        className="block text-xs font-medium text-muted-foreground"
      >
        Reverse verb{' '}
        <span className="font-normal text-muted-foreground/70">(optional)</span>
      </Label>
      <Autocomplete
        id={reciprocalTypeId}
        className={editor.isReciprocalDuplicate ? 'border-destructive' : ''}
        placeholder="Name the reverse direction, or leave blank"
        value={editor.reciprocalRelationshipType}
        onChange={editor.handleReciprocalChange}
        options={editor.relationshipTypeOptions}
        aria-invalid={editor.isReciprocalDuplicate}
        aria-describedby={
          editor.isReciprocalDuplicate ? reciprocalTypeErrorId : undefined
        }
      />
      {editor.isReciprocalDuplicate && (
        <p id={reciprocalTypeErrorId} className="mt-1 text-xs text-destructive">
          {duplicateMessage}
        </p>
      )}
    </div>
  );
}
