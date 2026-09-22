import * as React from 'react';
import { cn } from '@roadiehq/ui/utils';
import { TableHeader } from '@roadiehq/ui/table';

/** Bordered shell for viewport-height listing tables; fill matches main chrome, not `bg-card`. */
export const OverviewListingTableCard = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-md border border-border bg-transparent',
      className,
    )}
    {...props}
  />
));
OverviewListingTableCard.displayName = 'OverviewListingTableCard';

/** Inner scroller paired with {@link OverviewListingTableCard}. */
export const OverviewListingTableScrollBody = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'min-h-0 flex-1 overflow-x-auto overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]',
      className,
    )}
    {...props}
  />
));
OverviewListingTableScrollBody.displayName = 'OverviewListingTableScrollBody';

/**
 * Horizontal scroll wrapper for shorter listings; vertical wheel scrolls the page
 * instead of trapping in a zero-height inner scroller.
 */
export const OverviewListingTablePageScrollWrap = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'w-full overflow-x-auto overflow-y-visible rounded-md border border-border bg-transparent',
      className,
    )}
    {...props}
  />
));
OverviewListingTablePageScrollWrap.displayName =
  'OverviewListingTablePageScrollWrap';

/** Sticky thead styling aligned with app shell. */
export const OverviewListingTableStickyHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.ComponentPropsWithoutRef<typeof TableHeader>
>(({ className, ...props }, ref) => (
  <TableHeader
    ref={ref}
    className={cn('sticky top-0 z-10 bg-background [&_tr]:border-b', className)}
    {...props}
  />
));
OverviewListingTableStickyHeader.displayName =
  'OverviewListingTableStickyHeader';
