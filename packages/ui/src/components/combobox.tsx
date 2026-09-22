import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { Popover, PopoverContent, PopoverAnchor } from './popover';
import { inputBaseClass, labelBaseClass } from './outlined-input';

export interface ComboboxOption {
  value: string;
  label?: string;
  description?: string;
}

export interface ComboboxProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  className?: string;
  'data-testid'?: string;
  disabled?: boolean;
}

/**
 * Floating-label filterable single-select input, styled to match the outlined
 * form fields (OutlinedInput/OutlinedSelect). The value is free text, filtered
 * against `options` as the user types. For multiple selections use
 * MultiCombobox; for free text where options are only suggestions use
 * Autocomplete.
 */
const Combobox = React.forwardRef<HTMLDivElement, ComboboxProps>(
  (
    {
      label,
      value,
      onChange,
      options,
      placeholder,
      className,
      'data-testid': testId,
      disabled = false,
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const [focusIndex, setFocusIndex] = React.useState(-1);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const listRef = React.useRef<HTMLUListElement>(null);
    const inputId = React.useId();
    const listboxId = React.useId();

    const filtered = React.useMemo(() => {
      if (!value) return options;
      const q = value.toLowerCase();
      return options.filter(
        o =>
          o.value.toLowerCase().includes(q) ||
          o.label?.toLowerCase().includes(q) ||
          o.description?.toLowerCase().includes(q),
      );
    }, [value, options]);

    const handleSelect = React.useCallback(
      (option: ComboboxOption) => {
        onChange(option.value);
        setOpen(false);
        setFocusIndex(-1);
        inputRef.current?.focus();
      },
      [onChange],
    );

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent) => {
        if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          setOpen(true);
          setFocusIndex(0);
          e.preventDefault();
          return;
        }

        if (!open) return;

        switch (e.key) {
          case 'ArrowDown':
            setFocusIndex(i => (i + 1) % filtered.length);
            e.preventDefault();
            break;
          case 'ArrowUp':
            setFocusIndex(i => (filtered.length + i - 1) % filtered.length);
            e.preventDefault();
            break;
          case 'Enter': {
            // Guard against negative focusIndex: focusIndex initializes to
            // -1 and resets to -1 when the filtered list changes. Bracket
            // notation `filtered[-1]` returned undefined, but `.at(-1)`
            // returns the *last* element, which would unintentionally
            // select an item on Enter before any arrowing.
            const item = focusIndex >= 0 ? filtered.at(focusIndex) : undefined;
            if (item) {
              handleSelect(item);
            }
            e.preventDefault();
            break;
          }
          case 'Escape':
            setOpen(false);
            setFocusIndex(-1);
            e.preventDefault();
            break;
        }
      },
      [open, filtered, focusIndex, handleSelect],
    );

    React.useEffect(() => {
      const list = listRef.current;
      if (!list || focusIndex < 0) return;
      const child = list.children.item(focusIndex);
      if (child instanceof HTMLElement) {
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
          <div ref={ref} className="relative w-full min-w-0">
            <input
              ref={inputRef}
              id={inputId}
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              autoComplete="off"
              placeholder={placeholder || ' '}
              value={value}
              onChange={e => {
                if (disabled) {
                  return;
                }
                onChange(e.target.value);
                if (!open) setOpen(true);
              }}
              onFocus={() => {
                if (!disabled) {
                  setOpen(true);
                }
              }}
              onBlur={() => {
                // Delay to allow click on option
                setTimeout(() => setOpen(false), 150);
              }}
              onKeyDown={e => {
                if (!disabled) {
                  handleKeyDown(e);
                }
              }}
              data-testid={testId}
              className={cn(inputBaseClass, 'pr-8', className)}
              disabled={disabled}
            />
            {label && (
              <label htmlFor={inputId} className={labelBaseClass}>
                {label}
              </label>
            )}
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
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
          <ul ref={listRef} id={listboxId} role="listbox">
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
                  handleSelect(option);
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
Combobox.displayName = 'Combobox';

export { Combobox };
