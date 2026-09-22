import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Fragment } from 'react';
import { Input } from '@roadiehq/ui/input';
import { Checkbox } from '@roadiehq/ui/checkbox';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { cn } from '@roadiehq/ui/utils';
import type {
  PickerComboboxGroup,
  PickerComboboxOption,
} from './picker-combobox';

export interface FacetListProps {
  /** Grouped, checkable options. A group with an `id` renders a selectable
   *  tri-state heading (a "select all" / tree parent) that toggles that id. */
  groups: PickerComboboxGroup[];
  /** Currently selected option/group ids. */
  selectedIds: string[];
  /** Toggle a single option or selectable-group id. */
  onToggle: (id: string) => void;
  /** Search box placeholder. */
  placeholder?: string;
  ariaLabel?: string;
  /** Focus the search box once on mount (e.g. when opened in a popover). */
  autoFocusSearch?: boolean;
  /** Hide the search box (e.g. for a short, fixed set of options). Default true. */
  showSearch?: boolean;
  className?: string;
}

/**
 * The shared searchable multi-select facet: a filter box over a grouped,
 * checkable tree (selectable group headings + indented option rows) with
 * keyboard navigation. This is the single engine behind every dropdown filter —
 * the relationships-editor header facets (via {@link PickerCombobox} multi mode)
 * and the overview column-header filters. Callers own the surface (which
 * popover/trigger wraps it) and the selection state; this only renders the list.
 */
export function FacetList({
  groups,
  selectedIds,
  onToggle,
  placeholder,
  ariaLabel,
  autoFocusSearch,
  showSearch = true,
  className,
}: FacetListProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [focusIndex, setFocusIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const disabledReasonBaseId = useId();

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const filteredGroups = useMemo(() => {
    const q = query.toLowerCase();
    return (
      groups
        .map(group => ({
          ...group,
          options: q
            ? group.options.filter(o => o.label.toLowerCase().includes(q))
            : group.options,
        }))
        // Keep a group whose heading matches even if its options are filtered
        // out, so a selectable heading stays reachable by name.
        .filter(
          group =>
            group.options.length > 0 ||
            (!!group.label && group.label.toLowerCase().includes(q)),
        )
    );
  }, [groups, query]);

  // Keyboard focus indexes selectable group headings and leaf options in DOM
  // order.
  const flatNavigableItems = useMemo(
    () =>
      filteredGroups.flatMap(group => {
        const items: { id: string }[] = [];
        if (group.id) items.push({ id: group.id });
        for (const option of group.options) {
          if (!option.disabledReason) items.push({ id: option.id });
        }
        return items;
      }),
    [filteredGroups],
  );

  const navIndexById = useMemo(() => {
    const map = new Map<string, number>();
    flatNavigableItems.forEach((item, index) => map.set(item.id, index));
    return map;
  }, [flatNavigableItems]);

  useEffect(() => {
    setFocusIndex(0);
  }, [flatNavigableItems.length, query]);

  useEffect(() => {
    if (autoFocusSearch) inputRef.current?.focus();
  }, [autoFocusSearch]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || focusIndex < 0) return;
    const child = list.querySelector(
      `:scope > li[role="option"][data-nav-index="${focusIndex}"]`,
    ) as HTMLElement | null;
    child?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const count = flatNavigableItems.length;
      switch (e.key) {
        case 'ArrowDown':
          if (count > 0) setFocusIndex(i => (i + 1) % count);
          e.preventDefault();
          break;
        case 'ArrowUp':
          if (count > 0) setFocusIndex(i => (count + i - 1) % count);
          e.preventDefault();
          break;
        case 'Enter': {
          const item = flatNavigableItems.at(focusIndex);
          if (item) onToggle(item.id);
          e.preventDefault();
          break;
        }
      }
    },
    [flatNavigableItems, focusIndex, onToggle],
  );

  const renderOption = (option: PickerComboboxOption, indented: boolean) => {
    const index = navIndexById.get(option.id);
    const isFocused = index === focusIndex;
    const isChecked = selectedIdSet.has(option.id);
    const disabled = !!option.disabledReason;
    const disabledReasonId = option.disabledReason
      ? `${disabledReasonBaseId}-disabled-${option.id}`
      : undefined;
    const row = (
      <li
        role="option"
        aria-label={option.label}
        aria-selected={isChecked}
        aria-disabled={disabled || undefined}
        aria-describedby={disabledReasonId}
        data-nav-index={index}
        data-focused={isFocused || undefined}
        className={cn(
          'motion-colors flex items-center gap-2 rounded-sm py-1 pr-2 text-sm text-foreground outline-none select-none hover:bg-accent hover:text-accent-foreground',
          indented ? 'pl-7' : 'px-2 py-1.5',
          isFocused && 'bg-accent/50 text-accent-foreground',
          disabled &&
            'cursor-not-allowed text-muted-foreground opacity-60 hover:bg-transparent hover:text-muted-foreground',
        )}
        onMouseDown={e => {
          e.preventDefault();
          if (!disabled) onToggle(option.id);
        }}
        onMouseEnter={() => {
          if (index !== undefined) setFocusIndex(index);
        }}
      >
        <Checkbox checked={isChecked} disabled={disabled} tabIndex={-1} />
        {option.icon}
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        {option.trailing}
        {option.disabledReason && (
          <span id={disabledReasonId} className="sr-only">
            {option.disabledReason}
          </span>
        )}
      </li>
    );
    return option.disabledReason ? (
      <Tooltip key={option.id}>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent side="left">{option.disabledReason}</TooltipContent>
      </Tooltip>
    ) : (
      <Fragment key={option.id}>{row}</Fragment>
    );
  };

  return (
    <div className={className}>
      {showSearch && (
        <div className="p-1">
          <Input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? 'Filter…'}
            aria-label={ariaLabel ?? 'Filter'}
            // Compact, with a neutral (not primary) hover/focus border.
            className="h-8 border-input-border shadow-none hover:border-input-border-hover focus-visible:border-input-border-hover focus-visible:ring-0"
          />
        </div>
      )}
      <TooltipProvider delayDuration={300}>
        <ul
          ref={listRef}
          role="listbox"
          aria-multiselectable
          className="max-h-64 overflow-y-auto overscroll-contain"
        >
          {filteredGroups.map((group, groupIdx) => (
            <Fragment key={group.label ?? group.id ?? `group-${groupIdx}`}>
              {group.label &&
                (group.id ? (
                  <li
                    role="option"
                    aria-selected={group.checked === true}
                    data-nav-index={navIndexById.get(group.id)}
                    data-focused={
                      navIndexById.get(group.id) === focusIndex || undefined
                    }
                    className={cn(
                      'motion-colors flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-medium text-foreground outline-none select-none hover:bg-accent hover:text-accent-foreground',
                      navIndexById.get(group.id) === focusIndex &&
                        'bg-accent/50 text-accent-foreground',
                    )}
                    onMouseDown={e => {
                      e.preventDefault();
                      onToggle(group.id!);
                    }}
                    onMouseEnter={() =>
                      setFocusIndex(navIndexById.get(group.id!)!)
                    }
                  >
                    <Checkbox checked={group.checked ?? false} tabIndex={-1} />
                    {group.icon}
                    <span className="min-w-0 flex-1 truncate">
                      {group.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {group.options.length}
                    </span>
                  </li>
                ) : (
                  <li
                    role="presentation"
                    className={cn(
                      'px-2 py-1 text-xs font-medium tracking-wide text-muted-foreground',
                      groupIdx > 0 && 'mt-1 border-t border-border pt-2',
                    )}
                  >
                    {group.label}
                  </li>
                ))}
              {group.options.map(option => renderOption(option, !!group.id))}
            </Fragment>
          ))}
          {filteredGroups.every(
            group => !group.id && group.options.length === 0,
          ) && (
            <li
              role="presentation"
              className="px-2 py-1.5 text-sm text-muted-foreground"
            >
              No options
            </li>
          )}
        </ul>
      </TooltipProvider>
    </div>
  );
}
