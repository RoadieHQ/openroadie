import { useEffect, useState } from 'react';
import { isAdvancedExpression } from './field-expression';

export type FieldMode = 'field' | 'expression';

/**
 * Drives a Field | Expression toggle from the value itself rather than a fixed
 * default. An advanced value (a wildcard/filter/function the picker can't
 * represent) forces Expression; a plain value defaults to Field. The user can
 * still toggle, and their choice wins — until the value becomes one that choice
 * can't show, at which point it re-syncs so the toggle never lies about what's
 * shown.
 *
 * Only a *Field* choice can become impossible that way; Expression renders any
 * value. So an Expression choice must survive every value change — dropping it
 * would swap the expression input for the field picker mid-keystroke and blur
 * the field, because a half-typed accessor path crosses the plain/advanced
 * boundary on nearly every character (`.` doesn't parse, `.images` does).
 */
export function useFieldMode(
  value: string,
): [FieldMode, (mode: FieldMode) => void] {
  const advanced = isAdvancedExpression(value);
  const [manual, setManual] = useState<FieldMode | null>(null);

  useEffect(() => {
    if (advanced) {
      setManual(prev => (prev === 'field' ? null : prev));
    }
  }, [advanced]);

  const mode: FieldMode = manual ?? (advanced ? 'expression' : 'field');
  return [mode, setManual];
}
