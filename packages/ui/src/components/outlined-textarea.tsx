import * as React from 'react';
import { cn } from '../lib/utils';
import { outlinedFieldLabelClass } from './outlined-field';

export interface OutlinedTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

/**
 * Floating-label multi-line field — the form-field variant of Textarea
 * (prefer it in forms so fields match OutlinedInput). Same label-notch
 * contract as the other outlined fields: the label masks the border with
 * `--field-bg`, provided by the surrounding surface (Card, Dialog, Popover,
 * StepNode).
 */
const OutlinedTextarea = React.forwardRef<
  HTMLTextAreaElement,
  OutlinedTextareaProps
>(({ className, label, id, ...props }, ref) => {
  const generatedId = React.useId();
  const textareaId = id || generatedId;
  return (
    <div className="relative">
      <textarea
        id={textareaId}
        ref={ref}
        placeholder=" "
        className={cn(
          'motion-colors flex min-h-[140px] w-full rounded-sm border border-input-border bg-transparent px-input-x py-input-y text-base shadow-sm placeholder:text-transparent hover:border-input-border-hover focus-visible:border-input-border-focus focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
      <label htmlFor={textareaId} className={outlinedFieldLabelClass}>
        {label}
      </label>
    </div>
  );
});
OutlinedTextarea.displayName = 'OutlinedTextarea';

export { OutlinedTextarea };
