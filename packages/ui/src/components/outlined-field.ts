/**
 * Shared styling for the Outlined* field family (input, number input, select,
 * textarea) so the floating label stays identical across all of them.
 *
 * The label masks the field's top border with `--field-bg`; the fallback is
 * `--color-card` because these fields most often sit on a card. Surfaces that
 * aren't card-colored (e.g. a full-page editor on the page background) must set
 * `--field-bg` on an ancestor so the notch matches.
 */
export const outlinedFieldLabelClass =
  'pointer-events-none absolute top-0 left-[10px] -translate-y-1/2 max-w-[calc(100%-20px)] truncate bg-[var(--field-bg,var(--color-card))] px-1 text-xs font-normal leading-snug text-muted-foreground';

/**
 * Extra label classes for a field whose label rests inside the control until
 * it is focused or filled (OutlinedInput). Requires a sibling `.peer` control.
 */
export const outlinedFieldLabelFloatClass =
  'motion-all peer-placeholder-shown:top-1/2 peer-placeholder-shown:text-base peer-focus:top-0 peer-focus:text-xs';
