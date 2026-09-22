import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roadiehq/ui/select';
import { cn } from '@roadiehq/ui/utils';
import { INTEGRATION_TYPES } from '../integrations/constants';
import type { CategoryFilter } from './integration-category-filter';
import { OverviewListingSearchField } from './overview-listing-search-field';

const categorySelectTriggerClassName =
  'h-9 w-full max-w-full shrink-0 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm focus-visible:border-foreground/25 focus-visible:ring-0 focus-visible:outline-none sm:w-[272px] sm:max-w-[272px] [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:opacity-50';

export type OverviewListingToolbarVariant = 'default' | 'pageHeader';

export interface IntegrationCategoryFilterSelectProps {
  value: CategoryFilter;
  onValueChange: (value: CategoryFilter) => void;
}

export function IntegrationCategoryFilterSelect({
  value,
  onValueChange,
}: IntegrationCategoryFilterSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={v => onValueChange(v as CategoryFilter)}
    >
      <SelectTrigger
        aria-label="Filter by category"
        className={categorySelectTriggerClassName}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All categories</SelectItem>
        {INTEGRATION_TYPES.map(t => (
          <SelectItem key={t.value} value={t.value}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface OverviewListingToolbarProps {
  /** Renders before the category control (e.g. state toggle). */
  leading?: React.ReactNode;
  /** When both are set, the integration category select is shown. */
  category?: CategoryFilter;
  onCategoryChange?: (value: CategoryFilter) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchAriaLabel: string;
  searchPlaceholder: string;
  /** Use `pageHeader` when embedded in `OverviewListingPageHeader` beside the primary CTA. */
  variant?: OverviewListingToolbarVariant;
}

export function OverviewListingToolbar({
  leading,
  category,
  onCategoryChange,
  searchValue,
  onSearchChange,
  searchAriaLabel,
  searchPlaceholder,
  variant = 'default',
}: OverviewListingToolbarProps) {
  const isPageHeader = variant === 'pageHeader';

  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-3',
        isPageHeader && 'sm:flex-nowrap sm:gap-2 md:gap-3',
      )}
    >
      {leading}
      {category !== undefined && onCategoryChange !== undefined ? (
        <IntegrationCategoryFilterSelect
          value={category}
          onValueChange={onCategoryChange}
        />
      ) : null}
      <OverviewListingSearchField
        layout={isPageHeader ? 'pageHeader' : 'default'}
        value={searchValue}
        onValueChange={onSearchChange}
        placeholder={searchPlaceholder}
        ariaLabel={searchAriaLabel}
      />
    </div>
  );
}
