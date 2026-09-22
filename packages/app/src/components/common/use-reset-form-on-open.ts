import { useEffect } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

/**
 * Resets a form to its initial values whenever a dialog transitions to open.
 *
 * This is the "reset-on-open is the caller's job" pattern from the forms rule,
 * factored into one place so the several dialogs that need it don't each
 * hand-roll the same effect. `getValues` is read only on the open transition
 * (not on every render), so it is intentionally excluded from the effect deps —
 * pass a thunk that computes the current defaults.
 */
export function useResetFormOnOpen<
  TFieldValues extends FieldValues,
  TTransformedValues = TFieldValues,
>(
  form: UseFormReturn<TFieldValues, unknown, TTransformedValues>,
  open: boolean,
  getValues: () => TFieldValues,
): void {
  useEffect(() => {
    if (open) {
      form.reset(getValues());
    }
    // getValues is intentionally omitted: reset only on the open transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form]);
}
