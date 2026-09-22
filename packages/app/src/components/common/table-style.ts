import { cn } from '@roadiehq/ui/utils';

/**
 * Canonical listing-table styling, anchored on the **Data Sources overview
 * table** (the reference table). `OverviewTable`, its loading view, and any
 * listing that must match all pull their class strings from here so the header
 * treatment, cell rhythm, actions gutter, and empty state cannot drift apart.
 *
 * These are structural/spacing tokens only — they intentionally preserve the
 * existing color scheme (`text-foreground/80`, `border-border`, `bg-background`).
 */

/** `<table>` base: fixed layout + a min width so declared column widths are
 * honoured and the table scrolls horizontally rather than squashing. */
const LISTING_TABLE_ELEMENT_BASE = 'w-full caption-bottom text-sm table-fixed';

/** Full `<table>` class for a listing. `minWidthClass` tunes the horizontal
 * scroll threshold per feature (column count varies); everything else is fixed. */
export function listingTableElementClassName(
  minWidthClass = 'min-w-[60rem]',
): string {
  return cn(minWidthClass, LISTING_TABLE_ELEMENT_BASE);
}

/** `<tr>` in the sticky header. */
export const LISTING_TABLE_HEADER_ROW =
  'group/header border-border hover:bg-transparent';

/** `<th>` base. */
export const LISTING_TABLE_HEAD_CELL =
  'group h-10 py-1 text-sm font-medium text-foreground/80';

/** `<td>` base vertical rhythm. */
export const LISTING_TABLE_BODY_CELL = 'py-1.5 sm:py-2';

/** Trailing per-row actions column, head and cell. */
export const LISTING_TABLE_ACTIONS_CELL =
  'w-14 shrink-0 py-0 pr-2 pl-0 text-right';

/** Empty-state cell (spans all columns). */
export const LISTING_TABLE_EMPTY_CELL = 'h-40 text-center align-middle';

/** Ghost sort-toggle button in a sortable header. */
export const LISTING_TABLE_SORT_BUTTON =
  '-ml-2 h-8 data-[state=open]:bg-accent sm:-ml-3';
