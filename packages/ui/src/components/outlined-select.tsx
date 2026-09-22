import * as React from 'react';
import { Select, SelectTrigger, SelectContent, SelectValue } from './select';
import { cn } from '../lib/utils';
import { outlinedFieldLabelClass } from './outlined-field';

interface OutlinedSelectProps extends Omit<
  React.ComponentPropsWithoutRef<typeof SelectTrigger>,
  'value' | 'children'
> {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  /** SelectItem elements (they populate the dropdown). */
  children: React.ReactNode;
  /** Classes for the outer wrapper; use `triggerClassName` to style the trigger button itself. */
  className?: string;
  triggerClassName?: string;
  hideChevron?: boolean;
  disabled?: boolean;
}

/**
 * Floating-label select — the form-field variant of Select (prefer it in
 * forms so fields match the OutlinedInput look). Pass SelectItem elements as
 * children. Same label-notch contract as the other outlined fields: the label
 * masks the border with `--field-bg`, provided by the surrounding surface
 * (Card, Dialog, Popover, StepNode).
 */
const OutlinedSelect = React.forwardRef<HTMLButtonElement, OutlinedSelectProps>(
  (
    {
      label,
      value,
      onValueChange,
      children,
      className,
      triggerClassName,
      hideChevron,
      disabled,
      id,
      ...triggerProps
    },
    ref,
  ) => {
    const fallbackId = React.useId();
    const triggerId = id ?? fallbackId;

    return (
      <div className={cn('relative', className)}>
        <Select value={value} onValueChange={onValueChange} disabled={disabled}>
          <SelectTrigger
            ref={ref}
            id={triggerId}
            className={cn(
              'rounded-sm border-input-border bg-transparent pr-[7px] pl-[14px] text-base hover:border-input-border-hover focus:ring-inset',
              hideChevron && '[&>svg]:hidden',
              triggerClassName,
            )}
            disabled={disabled}
            {...triggerProps}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-divider bg-surface">
            {children}
          </SelectContent>
        </Select>
        <label htmlFor={triggerId} className={outlinedFieldLabelClass}>
          {label}
        </label>
      </div>
    );
  },
);
OutlinedSelect.displayName = 'OutlinedSelect';

export { OutlinedSelect };
