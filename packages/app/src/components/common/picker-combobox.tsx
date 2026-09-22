import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent } from '@roadiehq/ui/popover';
import { Input } from '@roadiehq/ui/input';
import { Button } from '@roadiehq/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { cn } from '@roadiehq/ui/utils';
import { FacetList } from './facet-list';

export interface PickerComboboxOption {
  id: string;
  label: string;
  /** Leading visual, e.g. an integration or data source logo. */
  icon?: React.ReactNode;
  /** Leading visual used only for the selected, closed field value. */
  selectedIcon?: React.ReactNode;
  /** Trailing content, e.g. capability or status badges. */
  trailing?: React.ReactNode;
  disabledReason?: string;
}

export interface PickerComboboxGroup {
  /** Optional heading rendered above the group's options. */
  label?: string;
  /** Multi-select only: when set, the heading becomes a selectable checkbox row
   *  that toggles this id — e.g. an integration "select all", or a facet's
   *  relationship "type". Left unset, the heading stays a presentational label. */
  id?: string;
  /** Multi-select only: checkbox state for a selectable ({@link id}) heading. */
  checked?: boolean | 'indeterminate';
  /** Multi-select only: leading visual on a selectable heading (e.g. a logo). */
  icon?: React.ReactNode;
  options: PickerComboboxOption[];
}

export interface PickerComboboxFooterAction {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
}

interface PickerComboboxProps {
  groups: PickerComboboxGroup[];
  selectedId?: string;
  onSelect: (id: string) => void;
  /** Floating label rendered on the input border. */
  label?: string;
  /** Plain placeholder; only visible when no floating label is set. */
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Focus the input (and open the list) once on mount. */
  autoFocusOnMount?: boolean;
  /** Pinned action below the options, e.g. "Create new integration". */
  footerAction?: PickerComboboxFooterAction;
  /** Shown instead of an empty value when selectedId has no matching option. */
  unknownSelectionLabel?: string;
  className?: string;
  popoverContentClassName?: string;
  'data-testid'?: string;

  // ── Multi-select mode ──
  // When true, options render checkboxes, clicking toggles without closing, and
  // the trigger is a filter-style button instead of the search input. Used by
  // the relationships-editor header facets.
  multiple?: boolean;
  /** Multi-select: currently selected option/group ids. */
  selectedIds?: string[];
  /** Multi-select: toggle a single option or group id. */
  onToggle?: (id: string) => void;
  /** Multi trigger: count shown in the pill. Defaults to `selectedIds.length`;
   *  override when selection spans more than the row ids (e.g. types + rules). */
  selectedCount?: number;
  /** Multi trigger: leading icon (muted to match the filter Select). */
  triggerIcon?: React.ReactNode;
  /** Multi trigger: label shown when something is selected. */
  triggerLabel?: string;
  /** Multi trigger: label shown when nothing is selected. */
  triggerEmptyLabel?: string;
}

function getOptionClassName(
  isSelected: boolean,
  isFocused: boolean,
  disabled: boolean,
) {
  return cn(
    'flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none',
    isSelected &&
      'bg-accent text-accent-foreground ring-1 ring-primary/90 ring-inset',
    isFocused && !isSelected && 'bg-accent/50 text-accent-foreground',
    !isSelected && !isFocused && !disabled && 'text-foreground',
    disabled
      ? 'cursor-not-allowed text-muted-foreground opacity-60'
      : 'hover:bg-accent/50 hover:text-accent-foreground',
  );
}

function getFooterActionClassName(isFocused: boolean) {
  return cn(
    'flex items-center gap-2 rounded-sm px-4 py-2 text-sm font-medium text-primary outline-none select-none',
    isFocused && 'bg-accent text-accent-foreground',
    'hover:bg-accent hover:text-accent-foreground',
  );
}

// Matches the app's canonical filter control (`IntegrationCategoryFilterSelect`
// in overview-listing-toolbar.tsx): a card-colored trigger with a subtle border,
// foreground text, and muted (opacity) icons — no accent/brand color, so the
// multi-select trigger reads like the other filters.
const multiTriggerClass =
  'h-9 justify-start gap-2 border-border bg-card px-3 font-normal text-foreground hover:border-foreground/25 hover:bg-card hover:text-foreground focus-visible:border-foreground/25 focus-visible:ring-0 focus-visible:ring-offset-0';

/**
 * The one dropdown: a searchable popover combobox with icons, grouped
 * options, keyboard navigation and an optional pinned footer action. Supports a
 * single-select input trigger (default) and a `multiple` checkbox mode with a
 * filter-style button trigger. Integration/data source pickers and the
 * relationships-editor facets are thin wrappers over this.
 */
export function PickerCombobox({
  groups,
  selectedId,
  onSelect,
  label,
  placeholder,
  ariaLabel,
  disabled,
  autoFocusOnMount,
  footerAction,
  unknownSelectionLabel,
  className,
  popoverContentClassName,
  'data-testid': dataTestId,
  multiple = false,
  selectedIds,
  onToggle,
  selectedCount: selectedCountProp,
  triggerIcon,
  triggerLabel,
  triggerEmptyLabel,
}: PickerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focusIndex, setFocusIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputId = React.useId();

  const clearBlurTimeout = useCallback(() => {
    if (blurTimeoutRef.current !== null) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  }, []);

  // Cancel any pending blur-close when the combobox unmounts so we don't call
  // setState on an unmounted component.
  useEffect(() => clearBlurTimeout, [clearBlurTimeout]);

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
        // Keep a group whose heading matches even if its options are filtered out,
        // so a selectable heading (multi mode) stays reachable by name.
        .filter(
          group =>
            group.options.length > 0 ||
            (!!group.label && group.label.toLowerCase().includes(q)),
        )
    );
  }, [groups, query]);

  const flatOptions = useMemo(
    () => filteredGroups.flatMap(group => group.options),
    [filteredGroups],
  );

  // Keyboard focus and scroll-into-view index selectable group headings (multi)
  // and leaf options in DOM order — not flatOptions alone.
  const flatNavigableItems = useMemo(
    () =>
      filteredGroups.flatMap(group => {
        const items: { id: string }[] = [];
        if (multiple && group.id) {
          items.push({ id: group.id });
        }
        for (const option of group.options) {
          if (!option.disabledReason) {
            items.push({ id: option.id });
          }
        }
        return items;
      }),
    [filteredGroups, multiple],
  );

  const navIndexById = useMemo(() => {
    const map = new Map<string, number>();
    flatNavigableItems.forEach((item, index) => {
      map.set(item.id, index);
    });
    return map;
  }, [flatNavigableItems]);

  const selectedOption = useMemo(() => {
    for (const group of groups) {
      const match = group.options.find(o => o.id === selectedId);
      if (match) return match;
    }
    return undefined;
  }, [groups, selectedId]);

  const openList = useCallback(() => {
    clearBlurTimeout();
    setOpen(true);
    setQuery('');
    // Focus the current selection (or the first option) so Enter confirms
    // immediately after reopening, without requiring ArrowDown/hover first.
    const selectedIndex = flatNavigableItems.findIndex(
      option => option.id === selectedId,
    );
    setFocusIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [flatNavigableItems, selectedId, clearBlurTimeout]);

  const closeList = useCallback(() => {
    clearBlurTimeout();
    setOpen(false);
    setQuery('');
    setFocusIndex(-1);
    inputRef.current?.blur();
  }, [clearBlurTimeout]);

  const openMultiList = useCallback(() => {
    clearBlurTimeout();
    setOpen(true);
    setQuery('');
    setFocusIndex(0);
  }, [clearBlurTimeout]);

  const closeMultiList = useCallback(() => {
    clearBlurTimeout();
    setOpen(false);
    setQuery('');
    setFocusIndex(-1);
  }, [clearBlurTimeout]);

  const handleMultiOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        openMultiList();
      } else {
        closeMultiList();
      }
    },
    [openMultiList, closeMultiList],
  );

  const handleSelect = useCallback(
    (id: string) => {
      const option = groups
        .flatMap(group => group.options)
        .find(candidate => candidate.id === id);
      if (option?.disabledReason) return;
      onSelect(id);
      closeList();
    },
    [groups, onSelect, closeList],
  );

  // Multi-select: toggle without closing so several can be picked in one pass.
  const handleToggle = useCallback(
    (id: string) => {
      onToggle?.(id);
    },
    [onToggle],
  );

  const handleFooterAction = useCallback(() => {
    footerAction?.onSelect();
    closeList();
  }, [footerAction, closeList]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const optionCount = flatNavigableItems.length + (footerAction ? 1 : 0);
      if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        if (multiple) {
          openMultiList();
        } else {
          setOpen(true);
          setFocusIndex(0);
        }
        e.preventDefault();
        return;
      }
      if (!open) return;

      switch (e.key) {
        case 'ArrowDown':
          if (optionCount > 0) setFocusIndex(i => (i + 1) % optionCount);
          e.preventDefault();
          break;
        case 'ArrowUp':
          if (optionCount > 0) {
            setFocusIndex(i => (optionCount + i - 1) % optionCount);
          }
          e.preventDefault();
          break;
        case 'Enter': {
          if (multiple) {
            const item = flatNavigableItems.at(focusIndex);
            if (item) handleToggle(item.id);
          } else if (footerAction && focusIndex === flatNavigableItems.length) {
            handleFooterAction();
          } else {
            const item = flatNavigableItems.at(focusIndex);
            if (item) handleSelect(item.id);
          }
          e.preventDefault();
          break;
        }
        case 'Escape':
          if (multiple) {
            closeMultiList();
          } else {
            closeList();
          }
          e.preventDefault();
          break;
      }
    },
    [
      open,
      multiple,
      flatNavigableItems,
      footerAction,
      focusIndex,
      handleSelect,
      handleToggle,
      handleFooterAction,
      closeList,
      closeMultiList,
      openMultiList,
    ],
  );

  useEffect(() => {
    const list = listRef.current;
    if (!list || focusIndex < 0) return;
    const child = list.querySelector(
      `:scope > li[role="option"][data-nav-index="${focusIndex}"]`,
    ) as HTMLElement | null;
    child?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex]);

  useEffect(() => {
    setFocusIndex(0);
  }, [flatNavigableItems.length, query]);

  const hasAutoFocusedRef = useRef(false);
  useEffect(() => {
    if (hasAutoFocusedRef.current) return;
    if (!autoFocusOnMount || disabled) return;
    hasAutoFocusedRef.current = true;
    inputRef.current?.focus();
  }, [autoFocusOnMount, disabled]);

  const displayValue = open
    ? query
    : (selectedOption?.label ??
      (selectedId ? (unknownSelectionLabel ?? '') : ''));

  const selectedCount = selectedCountProp ?? selectedIds?.length ?? 0;

  return (
    <div className={className}>
      <Popover
        open={open}
        onOpenChange={multiple ? handleMultiOpenChange : undefined}
      >
        <PopoverAnchor asChild>
          {multiple ? (
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              aria-expanded={open}
              data-testid={dataTestId}
              className={cn(multiTriggerClass, 'w-full')}
              onClick={() => handleMultiOpenChange(!open)}
            >
              {triggerIcon && (
                <span className="shrink-0 opacity-50">{triggerIcon}</span>
              )}
              <span className="truncate">
                {selectedCount > 0
                  ? (triggerLabel ?? label ?? '')
                  : (triggerEmptyLabel ?? placeholder ?? '')}
              </span>
              {selectedCount > 0 && (
                <span className="rounded-full bg-muted px-1.5 text-2xs font-medium text-muted-foreground tabular-nums">
                  {selectedCount}
                </span>
              )}
              <ChevronDown className="ml-auto shrink-0 opacity-50" />
            </Button>
          ) : (
            <div className="relative">
              {(selectedOption?.selectedIcon ?? selectedOption?.icon) &&
                !open && (
                  <div className="pointer-events-none absolute top-1/2 left-3 flex h-5 -translate-y-1/2 items-center">
                    {selectedOption.selectedIcon ?? selectedOption.icon}
                  </div>
                )}
              <Input
                ref={inputRef}
                id={inputId}
                role="combobox"
                aria-expanded={open}
                aria-autocomplete="list"
                // A visible floating `label` already names the field; only fall
                // back to a generic label when the caller supplies neither.
                aria-label={ariaLabel ?? (label ? undefined : 'Search')}
                autoComplete="off"
                data-testid={dataTestId}
                disabled={disabled}
                placeholder={label ? ' ' : placeholder}
                value={displayValue}
                onChange={e => {
                  if (!open) openList();
                  setQuery(e.target.value);
                  setFocusIndex(0);
                }}
                onFocus={openList}
                onBlur={() => {
                  // A click on an option calls `preventDefault` on mousedown so
                  // the input never blurs mid-selection; this deferred close only
                  // fires for a genuine focus-out. Tracked in a ref so an
                  // in-flight close can be cancelled on unmount or reopen.
                  clearBlurTimeout();
                  blurTimeoutRef.current = setTimeout(() => {
                    blurTimeoutRef.current = null;
                    setOpen(false);
                    setQuery('');
                  }, 150);
                }}
                onKeyDown={handleKeyDown}
                className={cn(
                  'peer rounded-sm border-input-border py-input-y pr-8 text-base hover:border-input-border-hover focus-visible:border-input-border-focus focus-visible:ring-inset',
                  label && 'placeholder:text-transparent',
                  (selectedOption?.selectedIcon ?? selectedOption?.icon) &&
                    !open
                    ? 'pl-10'
                    : 'pl-input-x',
                )}
              />
              {label && (
                <label
                  htmlFor={inputId}
                  className="pointer-events-none absolute top-0 left-[10px] -translate-y-1/2 bg-[var(--field-bg,var(--color-card))] px-1 text-xs leading-none font-normal text-muted-foreground"
                >
                  {label}
                </label>
              )}
              <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          )}
        </PopoverAnchor>
        <PopoverContent
          className={cn(
            'max-w-[min(24rem,var(--radix-popover-content-available-width))] min-w-[var(--radix-popover-trigger-width)] p-1',
            // Multi mode delegates scrolling to the FacetList's option list so
            // its filter box stays pinned — a scrollable popover around it
            // would stack a second scrollbar once the list outgrows both caps.
            multiple ? 'overflow-hidden' : 'max-h-72 overflow-auto',
            popoverContentClassName,
          )}
          side="bottom"
          sideOffset={4}
          align="start"
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
        >
          {multiple ? (
            <FacetList
              groups={groups}
              selectedIds={selectedIds ?? []}
              onToggle={id => onToggle?.(id)}
              placeholder={placeholder}
              ariaLabel={ariaLabel}
            />
          ) : (
            <TooltipProvider delayDuration={300}>
              <ul ref={listRef} role="listbox">
                {filteredGroups.map((group, groupIdx) => (
                  <React.Fragment key={group.label ?? `group-${groupIdx}`}>
                    {group.label && (
                      <li
                        role="presentation"
                        className={cn(
                          'px-2 py-1 text-xs font-medium tracking-wide text-muted-foreground',
                          groupIdx > 0 && 'mt-1 border-t border-border pt-2',
                        )}
                      >
                        {group.label}
                      </li>
                    )}
                    {group.options.map(option => {
                      const index = navIndexById.get(option.id);
                      const isFocused = index === focusIndex;
                      const isSelected = option.id === selectedId;
                      const disabled = !!option.disabledReason;
                      const disabledReasonId = option.disabledReason
                        ? `${inputId}-disabled-${option.id}`
                        : undefined;
                      const row = (
                        <li
                          role="option"
                          aria-label={option.label}
                          aria-selected={isSelected}
                          aria-disabled={disabled || undefined}
                          aria-describedby={disabledReasonId}
                          data-nav-index={index}
                          data-focused={isFocused || undefined}
                          className={getOptionClassName(
                            isSelected,
                            isFocused,
                            disabled,
                          )}
                          onMouseDown={e => {
                            e.preventDefault();
                            if (!disabled) handleSelect(option.id);
                          }}
                          onMouseEnter={() => {
                            if (index !== undefined) setFocusIndex(index);
                          }}
                        >
                          {option.icon}
                          <span className="min-w-0 flex-1 truncate">
                            {option.label}
                          </span>
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
                          <TooltipContent side="left">
                            {option.disabledReason}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <React.Fragment key={option.id}>{row}</React.Fragment>
                      );
                    })}
                  </React.Fragment>
                ))}
                {flatOptions.length === 0 && !footerAction && (
                  <li
                    role="presentation"
                    className="px-2 py-1.5 text-sm text-muted-foreground"
                  >
                    No options
                  </li>
                )}
                {footerAction && (
                  <>
                    <li
                      role="separator"
                      className={cn(
                        'my-1 h-px bg-divider',
                        flatOptions.length > 0 && 'mt-1',
                      )}
                      aria-hidden
                    />
                    <li
                      key="__footer_action__"
                      role="option"
                      // The footer is an action, never a selected value — reflect
                      // only keyboard focus, not selection.
                      aria-selected={false}
                      data-nav-index={flatNavigableItems.length}
                      data-focused={
                        focusIndex === flatNavigableItems.length || undefined
                      }
                      className={getFooterActionClassName(
                        focusIndex === flatNavigableItems.length,
                      )}
                      onMouseDown={e => {
                        e.preventDefault();
                        handleFooterAction();
                      }}
                      onMouseEnter={() =>
                        setFocusIndex(flatNavigableItems.length)
                      }
                    >
                      {footerAction.icon}
                      <span className="flex-1 truncate">
                        {footerAction.label}
                      </span>
                    </li>
                  </>
                )}
              </ul>
            </TooltipProvider>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
