import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Popover, PopoverAnchor, PopoverContent } from './popover';
import type { ComboboxOption } from './combobox';

export interface MultiComboboxProps {
  label?: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: ComboboxOption[];
  placeholder?: string;
  /** When true, Enter on free text adds it as a token. Default: false. */
  allowCustomValues?: boolean;
  /** When provided, typed or pasted custom values split on this pattern into chips. */
  customValueSplitPattern?: RegExp;
  /** Custom chip label. Defaults to the matching option's label, or the value. */
  renderChipLabel?: (value: string) => React.ReactNode;
  className?: string;
  disabled?: boolean;
  'data-testid'?: string;
}

const containerClass =
  'group relative flex w-full min-w-0 min-h-9 flex-wrap items-center gap-1 rounded-sm border border-input-border bg-transparent px-[6px] py-[3px] text-base shadow-sm motion-colors hover:border-input-border-hover focus-within:border-input-border-focus focus-within:outline-none focus-within:ring-1 focus-within:ring-inset focus-within:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

// Mirrors `labelBaseClass` from outlined-input.tsx so a label-bearing
// MultiCombobox animates between the empty/placeholder position and the
// docked top-left position the same way an OutlinedInput does. Used only
// when there are no chips — once a chip exists the label stays docked.
const floatingLabelClass =
  'pointer-events-none absolute top-0 left-[10px] -translate-y-1/2 max-w-[calc(100%-20px)] truncate bg-[var(--field-bg,var(--color-card))] px-1 text-xs font-normal leading-snug text-muted-foreground motion-all peer-placeholder-shown:top-1/2 peer-placeholder-shown:text-base peer-focus:top-0 peer-focus:text-xs';

const dockedLabelClass =
  'pointer-events-none absolute top-0 left-[10px] -translate-y-1/2 max-w-[calc(100%-20px)] truncate bg-[var(--field-bg,var(--color-card))] px-1 text-xs font-normal leading-snug text-muted-foreground';

const chipClass =
  'inline-flex items-center gap-0.5 rounded-full border border-primary bg-primary/10 py-0 pr-1 pl-2 text-xs leading-4 font-medium text-primary';

const chipRemoveClass =
  'inline-flex size-4 items-center justify-center rounded-full text-primary motion-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

const innerInputClass =
  'peer min-w-[8ch] flex-1 border-0 bg-transparent p-0 text-base outline-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground disabled:cursor-not-allowed';

function defaultChipLabel(
  value: string,
  options: ComboboxOption[],
): React.ReactNode {
  const match = options.find(option => option.value === value);
  return match?.label ?? value;
}

function splitCustomValues(
  rawValue: string,
  separatorPattern: RegExp,
): { completedValues: string[]; remainder: string } {
  const splitValues = rawValue.split(separatorPattern);
  const pieces = splitValues.map(value => value.trim()).filter(Boolean);

  if (pieces.length === 0) {
    return { completedValues: [], remainder: '' };
  }

  if (splitValues.at(-1) === '') {
    return { completedValues: pieces, remainder: '' };
  }

  return {
    completedValues: pieces.slice(0, -1),
    remainder: pieces.at(-1) ?? '',
  };
}

/**
 * Multi-select combobox: picked values render as removable chips inside the
 * field, with a filtering suggestion list below. Use it for choosing several
 * values from a known option set (Combobox is the single-value sibling);
 * `allowCustomValues` additionally turns free text into chips. When `label` is
 * set it floats like an OutlinedInput label, so the surrounding surface must
 * provide a matching `--field-bg` (Card/Dialog/Popover already do).
 */
const MultiCombobox = React.forwardRef<HTMLDivElement, MultiComboboxProps>(
  (
    {
      label,
      values,
      onChange,
      options,
      placeholder,
      allowCustomValues = false,
      customValueSplitPattern,
      renderChipLabel,
      className,
      disabled = false,
      'data-testid': testId,
    },
    ref,
  ) => {
    const [inputValue, setInputValue] = React.useState('');
    const [open, setOpen] = React.useState(false);
    const [focusIndex, setFocusIndex] = React.useState(-1);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const listRef = React.useRef<HTMLUListElement>(null);
    const inputId = React.useId();
    const listboxId = React.useId();

    const filtered = React.useMemo(() => {
      const remaining = options.filter(
        option => !values.includes(option.value),
      );
      if (!inputValue) return remaining;
      const q = inputValue.toLowerCase();
      return remaining.filter(
        option =>
          option.value.toLowerCase().includes(q) ||
          option.label?.toLowerCase().includes(q) ||
          option.description?.toLowerCase().includes(q),
      );
    }, [inputValue, options, values]);

    const appendValues = React.useCallback(
      (nextValues: string[]) => {
        const additions = nextValues
          .map(value => value.trim())
          .filter(value => value.length > 0 && !values.includes(value));
        if (additions.length === 0) {
          return;
        }
        onChange([...values, ...additions]);
      },
      [onChange, values],
    );

    const appendValue = React.useCallback(
      (next: string) => {
        appendValues([next]);
      },
      [appendValues],
    );

    const removeValue = React.useCallback(
      (target: string) => {
        onChange(values.filter(value => value !== target));
      },
      [onChange, values],
    );

    const handleSelectOption = React.useCallback(
      (option: ComboboxOption) => {
        appendValue(option.value);
        setInputValue('');
        setFocusIndex(-1);
        setOpen(true);
        inputRef.current?.focus();
      },
      [appendValue],
    );

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace') {
          if (inputValue === '' && values.length > 0) {
            onChange(values.slice(0, -1));
            e.preventDefault();
          }
          return;
        }

        if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          if (filtered.length === 0) return;
          setOpen(true);
          setFocusIndex(0);
          e.preventDefault();
          return;
        }

        if (!open && e.key !== 'Enter') return;

        switch (e.key) {
          case 'ArrowDown':
            if (filtered.length === 0) return;
            setFocusIndex(i => (i + 1) % filtered.length);
            e.preventDefault();
            break;
          case 'ArrowUp':
            if (filtered.length === 0) return;
            setFocusIndex(i => (filtered.length + i - 1) % filtered.length);
            e.preventDefault();
            break;
          case 'Enter': {
            const item = focusIndex >= 0 ? filtered.at(focusIndex) : undefined;
            if (item) {
              handleSelectOption(item);
            } else if (allowCustomValues && inputValue.trim()) {
              appendValue(inputValue);
              setInputValue('');
              setFocusIndex(-1);
            }
            e.preventDefault();
            break;
          }
          case 'Escape':
            setOpen(false);
            setFocusIndex(-1);
            e.preventDefault();
            break;
          default:
            break;
        }
      },
      [
        allowCustomValues,
        appendValue,
        filtered,
        focusIndex,
        handleSelectOption,
        inputValue,
        onChange,
        open,
        values,
      ],
    );

    React.useEffect(() => {
      const list = listRef.current;
      if (!list || focusIndex < 0) return;
      const child = list.children.item(focusIndex);
      if (
        child instanceof HTMLElement &&
        typeof child.scrollIntoView === 'function'
      ) {
        child.scrollIntoView({ block: 'nearest' });
      }
    }, [focusIndex]);

    React.useEffect(() => {
      setFocusIndex(-1);
    }, [filtered.length]);

    React.useEffect(() => {
      if (disabled) {
        setOpen(false);
        setFocusIndex(-1);
      }
    }, [disabled]);

    return (
      <Popover open={!disabled && open && filtered.length > 0}>
        <PopoverAnchor asChild>
          <div
            ref={ref}
            className={cn(containerClass, className)}
            aria-disabled={disabled || undefined}
            data-testid={testId}
          >
            {values.map(value => (
              <span key={value} className={chipClass}>
                <span className="truncate">
                  {renderChipLabel
                    ? renderChipLabel(value)
                    : defaultChipLabel(value, options)}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${value}`}
                  className={chipRemoveClass}
                  disabled={disabled}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => removeValue(value)}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              id={inputId}
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              autoComplete="off"
              placeholder={placeholder ?? ' '}
              value={inputValue}
              disabled={disabled}
              onChange={e => {
                const nextValue = e.target.value;
                if (allowCustomValues && customValueSplitPattern) {
                  const { completedValues, remainder } = splitCustomValues(
                    nextValue,
                    customValueSplitPattern,
                  );
                  if (completedValues.length > 0) {
                    appendValues(completedValues);
                  }
                  setInputValue(remainder);
                } else {
                  setInputValue(nextValue);
                }
                if (!open) setOpen(true);
              }}
              onFocus={() => {
                if (!disabled) {
                  setOpen(true);
                }
              }}
              onBlur={() => {
                setTimeout(() => setOpen(false), 150);
              }}
              onKeyDown={handleKeyDown}
              className={cn(
                innerInputClass,
                label && 'placeholder:text-transparent',
              )}
            />
            {label && (
              <label
                htmlFor={inputId}
                className={
                  values.length > 0 ? dockedLabelClass : floatingLabelClass
                }
              >
                {label}
              </label>
            )}
          </div>
        </PopoverAnchor>

        <PopoverContent
          // Radix renders the popover as role="dialog", which needs a name.
          aria-label={label ? `${label} options` : 'Options'}
          className="max-h-72 w-[var(--radix-popover-trigger-width)] overflow-auto p-1"
          side="bottom"
          sideOffset={4}
          align="start"
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
        >
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
          >
            {filtered.map((option, index) => (
              <li
                key={option.value}
                role="option"
                aria-selected={index === focusIndex}
                className={cn(
                  'flex flex-col rounded-sm px-2 py-1.5 text-sm outline-none select-none',
                  index === focusIndex
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                )}
                onMouseDown={e => {
                  e.preventDefault();
                  handleSelectOption(option);
                }}
                onMouseEnter={() => setFocusIndex(index)}
              >
                <span className="truncate">{option.label || option.value}</span>
                {option.description && (
                  <span className="truncate text-xs text-muted-foreground">
                    {option.description}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    );
  },
);
MultiCombobox.displayName = 'MultiCombobox';

export { MultiCombobox };
