import * as React from 'react';
import { cn } from '../lib/utils';
import {
  outlinedFieldLabelClass,
  outlinedFieldLabelFloatClass,
} from './outlined-field';

const inputBaseClass =
  'peer flex h-9 w-full rounded-sm border border-input-border bg-transparent px-input-x py-input-y text-base shadow-sm motion-colors placeholder:text-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:border-input-border-focus hover:border-input-border-hover disabled:cursor-not-allowed disabled:opacity-50';

const labelBaseClass = cn(
  outlinedFieldLabelClass,
  outlinedFieldLabelFloatClass,
);

export interface OutlinedInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Extra classes applied to the floating label (e.g. for shifted placeholder position) */
  labelClassName?: string;
  /** Content rendered inside the relative container (e.g. an icon or picker) */
  startAdornment?: React.ReactNode;
}

/**
 * Floating-label text input — the standard single-line field for forms
 * (prefer it over the bare Input there). The label sits over the top border
 * and masks it with `--field-bg`, which must match the surface behind the
 * field; surface primitives (Card, Dialog, Popover, StepNode) set it, so
 * don't set it by hand.
 */
const OutlinedInput = React.forwardRef<HTMLInputElement, OutlinedInputProps>(
  ({ className, label, labelClassName, startAdornment, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;
    return (
      <div className="relative w-full min-w-0">
        <input
          id={inputId}
          ref={ref}
          placeholder=" "
          className={cn(inputBaseClass, className)}
          {...props}
        />
        <label htmlFor={inputId} className={cn(labelBaseClass, labelClassName)}>
          {label}
        </label>
        {startAdornment}
      </div>
    );
  },
);
OutlinedInput.displayName = 'OutlinedInput';

export { OutlinedInput, inputBaseClass, labelBaseClass };
