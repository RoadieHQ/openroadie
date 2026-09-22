import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../button';
import { Input } from '../input';

// `type="search"` triggers the browser's native clear control (the inner blue
// "X" in WebKit / Chromium). We render our own clear Button, so suppress the
// native one to avoid two overlapping affordances.
const inputClassName =
  'h-8 w-full min-w-0 rounded-md border-border bg-card py-0 pl-9 text-sm leading-8 text-foreground shadow-sm placeholder:text-muted-foreground/80 focus-visible:border-foreground/25 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:appearance-none';

const iconClassName =
  'pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-foreground/60';

const clearButtonClassName =
  'absolute top-1/2 right-1.5 size-6 -translate-y-1/2 rounded-sm p-0 text-muted-foreground hover:bg-accent hover:text-foreground';

export interface OverviewToolbarSearchFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}

/**
 * Compact search/filter input for overview page toolbars: search icon, and
 * a clear button that appears once there's a value (the native WebKit clear
 * control is suppressed in its favor). Purely controlled — debounce in the
 * caller if the filter is server-side.
 */
export function OverviewToolbarSearchField({
  value,
  onValueChange,
  placeholder = 'Filter...',
  ariaLabel = 'Filter',
  disabled = false,
  className,
  inputClassName: inputClassNameProp,
}: OverviewToolbarSearchFieldProps) {
  const hasValue = value.length > 0;

  return (
    <div className={cn('relative flex items-center', className)}>
      <Search className={iconClassName} />
      <Input
        type="search"
        role="searchbox"
        enterKeyHint="search"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={e => onValueChange(e.target.value)}
        className={cn(inputClassName, hasValue && 'pr-9', inputClassNameProp)}
        aria-label={ariaLabel}
      />
      {hasValue && !disabled ? (
        <Button
          type="button"
          variant="ghost"
          aria-label="Clear search"
          className={clearButtonClassName}
          onClick={() => onValueChange('')}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
