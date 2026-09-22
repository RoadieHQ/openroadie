import * as React from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Input } from '@roadiehq/ui/input';
import { OverviewToolbarSearchField } from '@roadiehq/ui/toolbar';
import { cn } from '@roadiehq/ui/utils';

export type OverviewListingSearchFieldLayout = 'default' | 'pageHeader';

function overviewSearchFieldWrapperClass(
  layout: OverviewListingSearchFieldLayout,
): string {
  switch (layout) {
    case 'pageHeader':
      return 'relative w-full max-w-md min-w-[9rem] sm:w-56 md:min-w-[12rem] md:w-64';
    default:
      return 'relative max-w-md min-w-0';
  }
}

export interface OverviewListingSearchFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  /** Use `pageHeader` when rendered in `OverviewListingPageHeader`'s toolbar. */
  layout?: OverviewListingSearchFieldLayout;
  disabled?: boolean;
}

export function OverviewListingSearchField({
  value,
  onValueChange,
  placeholder,
  ariaLabel,
  layout = 'default',
  disabled = false,
}: OverviewListingSearchFieldProps) {
  const hasValue = value.length > 0;

  return (
    <div className={overviewSearchFieldWrapperClass(layout)}>
      {layout === 'pageHeader' ? (
        <OverviewToolbarSearchField
          value={value}
          onValueChange={onValueChange}
          placeholder={placeholder}
          ariaLabel={ariaLabel}
          disabled={disabled}
          inputClassName="min-w-0 overflow-hidden text-ellipsis"
        />
      ) : (
        <>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            role="searchbox"
            enterKeyHint="search"
            autoComplete="off"
            placeholder={placeholder}
            value={value}
            disabled={disabled}
            onChange={e => onValueChange(e.target.value)}
            className={cn(
              'min-w-0 overflow-hidden pl-9 text-xs text-ellipsis sm:text-sm',
              '[&::placeholder]:overflow-hidden [&::placeholder]:text-ellipsis [&::placeholder]:whitespace-nowrap',
              hasValue && 'pr-9',
            )}
            aria-label={ariaLabel}
          />
          {hasValue && !disabled ? (
            <Button
              type="button"
              variant="ghost"
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 size-7 -translate-y-1/2 rounded-sm p-0 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => onValueChange('')}
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
