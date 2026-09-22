import * as React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { outlinedFieldLabelClass } from './outlined-field';

const inputClass =
  'flex h-9 w-full rounded-sm border border-input-border bg-transparent px-input-x py-input-y text-base shadow-sm motion-colors placeholder:text-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:border-input-border-focus hover:border-input-border-hover disabled:cursor-not-allowed disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none group-hover:pr-8 group-focus-within:pr-8';

const stepperClass =
  'absolute right-0 top-0 flex h-full flex-col border-l border-input-border opacity-0 motion-opacity group-hover:opacity-100 group-focus-within:opacity-100';

const stepBtnClass =
  'flex flex-1 items-center justify-center px-1.5 text-muted-foreground motion-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50';

export interface OutlinedNumberInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange'
> {
  label: string;
  /** Kept as a string so partial input (empty, "-", "1e") survives typing; parse at the form boundary. */
  value: string;
  onChange: (value: string) => void;
  step?: number;
  min?: number;
  max?: number;
}

/**
 * Floating-label number field with stepper buttons that appear on
 * hover/focus (the native browser spinners are suppressed). Same label-notch
 * contract as OutlinedInput: the label masks the border with `--field-bg`,
 * which the surrounding surface (Card, Dialog, Popover, StepNode) provides.
 */
const OutlinedNumberInput = React.forwardRef<
  HTMLInputElement,
  OutlinedNumberInputProps
>(
  (
    { className, label, value, onChange, step = 1, min, max, id, ...props },
    ref,
  ) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;

    const increment = () => {
      const num = Number(value) || 0;
      const next = num + step;
      if (max !== undefined && next > max) return;
      onChange(String(next));
    };

    const decrement = () => {
      const num = Number(value) || 0;
      const next = num - step;
      if (min !== undefined && next < min) return;
      onChange(String(next));
    };

    return (
      <div className={cn('group relative', className)}>
        <input
          id={inputId}
          ref={ref}
          type="number"
          inputMode="numeric"
          value={value}
          onChange={e => onChange(e.target.value)}
          min={min}
          max={max}
          step={step}
          className={inputClass}
          {...props}
        />
        <label htmlFor={inputId} className={outlinedFieldLabelClass}>
          {label}
        </label>
        <div className={stepperClass}>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Increase"
            className={cn(stepBtnClass, 'rounded-tr-[3px]')}
            onClick={increment}
            disabled={props.disabled}
          >
            <ChevronUp className="size-3.5" />
          </button>
          <div className="border-t border-input-border" />
          <button
            type="button"
            tabIndex={-1}
            aria-label="Decrease"
            className={cn(stepBtnClass, 'rounded-br-[3px]')}
            onClick={decrement}
            disabled={props.disabled}
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      </div>
    );
  },
);
OutlinedNumberInput.displayName = 'OutlinedNumberInput';

export { OutlinedNumberInput };
