import * as React from 'react';
import { flushSync } from 'react-dom';
import { ChevronsUpDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { Popover, PopoverContent, PopoverAnchor } from './popover';
import { Input } from './input';

export interface AutocompleteOption {
  value: string;
  label?: string;
  description?: string;
  /** Options with the same group render under a shared heading. */
  group?: string;
  /** Muted text right-aligned in the option row (e.g. a type or count). */
  trailing?: string;
}

export interface AutocompleteProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value'
> {
  value: string;
  onChange: (value: string) => void;
  options: AutocompleteOption[];
  /** Override the text displayed in the input when not focused (e.g. show a leaf instead of the full path). */
  displayValue?: (value: string) => string;
  /** Show the full option list when the input is focused and value exactly matches one option. Default: true. */
  showAllWhenMatched?: boolean;
}

/**
 * Free-text suggestions over a bare `Input` — any typed value is valid, options
 * are hints. It supports option groups and trailing text, which `Combobox` does
 * not; `Combobox` is also free text but wears the floating-label field styling,
 * so prefer it inside forms. For a closed set of values use `Select`, and for
 * multi-select use `MultiCombobox`.
 */
const Autocomplete = React.forwardRef<HTMLInputElement, AutocompleteProps>(
  (
    {
      value,
      onChange,
      options,
      className,
      onKeyDown,
      onFocus,
      onBlur,
      displayValue,
      showAllWhenMatched = true,
      ...props
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    const [focusIndex, setFocusIndex] = React.useState(-1);
    const listRef = React.useRef<HTMLUListElement>(null);
    const listId = React.useId();
    // The onBlur close is deferred so a click on an option lands first. Track
    // it so we can cancel it on unmount — otherwise the timer fires a
    // setState on an unmounted tree (and blows up under test teardown when
    // `window` is already gone).
    const blurCloseTimeout = React.useRef<ReturnType<typeof setTimeout>>();

    React.useEffect(
      () => () => {
        if (blurCloseTimeout.current) clearTimeout(blurCloseTimeout.current);
      },
      [],
    );

    const exactMatch = React.useMemo(
      () => options.some(o => o.value === value),
      [options, value],
    );

    const filtered = React.useMemo(() => {
      if (!value) return options;
      if (showAllWhenMatched && exactMatch) return options;
      const q = value.toLowerCase();
      return options.filter(
        o =>
          o.value.toLowerCase().includes(q) ||
          o.label?.toLowerCase().includes(q) ||
          o.description?.toLowerCase().includes(q) ||
          o.group?.toLowerCase().includes(q) ||
          o.trailing?.toLowerCase().includes(q),
      );
    }, [value, options, exactMatch, showAllWhenMatched]);

    const grouped = React.useMemo(() => {
      const hasGroup = filtered.some(o => o.group !== undefined);
      if (!hasGroup) {
        return [{ heading: undefined, items: filtered }];
      }
      const map = new Map<string, AutocompleteOption[]>();
      const order: string[] = [];
      for (const opt of filtered) {
        const key = opt.group ?? '';
        if (!map.has(key)) {
          map.set(key, []);
          order.push(key);
        }
        map.get(key)!.push(opt);
      }
      return order.map(key => ({
        heading: key || undefined,
        items: map.get(key)!,
      }));
    }, [filtered]);

    const flatIndex = React.useMemo(
      () => grouped.flatMap(g => g.items),
      [grouped],
    );

    const handleSelect = React.useCallback(
      (opt: AutocompleteOption) => {
        onChange(opt.value);
        setOpen(false);
        setFocusIndex(-1);
      },
      [onChange],
    );

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        setOpen(true);
        setFocusIndex(0);
        e.preventDefault();
      } else if (open) {
        switch (e.key) {
          case 'ArrowDown':
            setFocusIndex(i =>
              flatIndex.length ? (i + 1) % flatIndex.length : -1,
            );
            e.preventDefault();
            break;
          case 'ArrowUp':
            setFocusIndex(i =>
              flatIndex.length
                ? (flatIndex.length + i - 1) % flatIndex.length
                : -1,
            );
            e.preventDefault();
            break;
          case 'Enter': {
            if (focusIndex < 0) break;
            const item = flatIndex.at(focusIndex);
            if (item) {
              handleSelect(item);
              e.preventDefault();
            }
            break;
          }
          case 'Escape':
            setOpen(false);
            setFocusIndex(-1);
            e.preventDefault();
            break;
        }
      }
      onKeyDown?.(e);
    };

    React.useEffect(() => {
      const list = listRef.current;
      if (!list || focusIndex < 0) return;
      const child = list
        .querySelectorAll<HTMLElement>('[role="option"]')
        .item(focusIndex);
      if (typeof child?.scrollIntoView === 'function') {
        child.scrollIntoView({ block: 'nearest' });
      }
    }, [focusIndex]);

    React.useEffect(() => {
      setFocusIndex(-1);
    }, [flatIndex.length]);

    const inputDisplay = displayValue && !focused ? displayValue(value) : value;

    return (
      <Popover open={open && flatIndex.length > 0}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Input
              ref={ref}
              role="combobox"
              aria-expanded={open}
              aria-autocomplete="list"
              aria-controls={listId}
              autoComplete="off"
              className={cn('pr-8', className)}
              value={inputDisplay}
              onChange={e => {
                onChange(e.target.value);
                if (!open) setOpen(true);
              }}
              onFocus={e => {
                // Commit `focused` synchronously so the input swaps to the
                // raw value before select() runs and before the user can
                // type — otherwise `e.target.value` carries the truncated
                // display string back through onChange and clobbers the
                // stored value.
                flushSync(() => {
                  setFocused(true);
                  setOpen(true);
                });
                e.currentTarget.select();
                onFocus?.(e);
              }}
              onBlur={e => {
                setFocused(false);
                blurCloseTimeout.current = setTimeout(
                  () => setOpen(false),
                  150,
                );
                onBlur?.(e);
              }}
              onKeyDown={handleKeyDown}
              {...props}
            />
            <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground opacity-50" />
          </div>
        </PopoverAnchor>
        <PopoverContent
          // Radix renders the popover as role="dialog", which needs a name;
          // Autocomplete has no label prop, so it is generic.
          aria-label="Suggestions"
          className="max-h-72 w-[var(--radix-popover-trigger-width)] overflow-auto p-1"
          side="bottom"
          sideOffset={4}
          align="start"
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
        >
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="flex flex-col"
          >
            {grouped.map((g, gi) => {
              const startIdx = grouped
                .slice(0, gi)
                .reduce((acc, x) => acc + x.items.length, 0);
              return (
                <React.Fragment key={g.heading ?? `__group_${gi}`}>
                  {g.heading !== undefined && (
                    <li
                      role="presentation"
                      className="px-2 py-1.5 text-xs font-medium text-muted-foreground"
                    >
                      {g.heading}
                    </li>
                  )}
                  {g.items.map((opt, i) => {
                    const index = startIdx + i;
                    return (
                      <li
                        key={opt.value}
                        role="option"
                        aria-selected={index === focusIndex}
                        title={opt.description ?? opt.value}
                        className={cn(
                          'flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none',
                          index === focusIndex
                            ? 'bg-accent text-accent-foreground'
                            : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                        )}
                        onMouseDown={e => {
                          e.preventDefault();
                          handleSelect(opt);
                        }}
                        onMouseEnter={() => setFocusIndex(index)}
                      >
                        <span className="truncate">
                          {opt.label ?? opt.value}
                        </span>
                        {opt.trailing && (
                          <span className="ml-auto pl-2 text-xs text-muted-foreground">
                            {opt.trailing}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
    );
  },
);
Autocomplete.displayName = 'Autocomplete';

export { Autocomplete };
