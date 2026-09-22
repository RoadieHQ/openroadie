import type { Ref } from 'react';
import {
  OverviewListingTableCard,
  OverviewListingTablePageScrollWrap,
  OverviewListingTableScrollBody,
  OverviewListingTableStickyHeader,
  getViewportListingTablePageSizeGuess,
  LISTING_TABLE_HEADER_ROW,
  LISTING_TABLE_HEAD_CELL,
  LISTING_TABLE_BODY_CELL,
  LISTING_TABLE_ACTIONS_CELL,
  listingTableElementClassName,
} from '../common';
import { TableBody, TableCell, TableHead, TableRow } from '@roadiehq/ui/table';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { cn } from '@roadiehq/ui/utils';

export interface OverviewTableLoadingViewProps {
  /** Number of body columns to render skeleton cells for. */
  columnCount: number;
  /**
   * Per-column width utility classes (e.g. `w-[40%] min-w-0`), matching the real
   * table's `ColumnConfig.width`. `table-fixed` honours them, so the skeleton's
   * columns line up with the rendered table instead of splitting evenly.
   */
  columnWidths?: Array<string | undefined>;
  /** When true, render a trailing row-actions column. */
  hasRowActions?: boolean;
  bodyScrollRef?: Ref<HTMLDivElement>;
  theadRef?: Ref<HTMLTableSectionElement>;
  includePaginationSkeleton?: boolean;
  /** Row count; defaults to the viewport page-size guess (lazy-route fallback). */
  skeletonRowCount?: number;
  /** Page-scroll mode: use the page-scroll shell and drop the pagination skeleton. */
  pageScroll?: boolean;
}

/**
 * Generic loading skeleton for {@link OverviewTable}. Column-count driven so any
 * config-defined table can show a structurally matching placeholder while the
 * first page of data loads.
 */
export function OverviewTableLoadingView({
  columnCount,
  columnWidths,
  hasRowActions = false,
  bodyScrollRef,
  theadRef,
  includePaginationSkeleton = true,
  skeletonRowCount,
  pageScroll = false,
}: OverviewTableLoadingViewProps) {
  const resolvedSkeletonRows = Math.max(
    1,
    skeletonRowCount ?? getViewportListingTablePageSizeGuess(),
  );

  const headClass = LISTING_TABLE_HEAD_CELL;
  const cellClass = cn(LISTING_TABLE_BODY_CELL, 'min-w-0');

  // The role="status" wrapper below already announces "Loading table"; the bars
  // themselves say nothing, so keep them out of the a11y tree rather than
  // inventing names for empty header cells.
  const tableInner = (
    <table className={listingTableElementClassName()} aria-hidden="true">
      <OverviewListingTableStickyHeader ref={theadRef}>
        <TableRow className={LISTING_TABLE_HEADER_ROW}>
          {Array.from({ length: columnCount }, (_, columnIndex) => (
            <TableHead
              key={`sk-ov-h-${columnIndex}`}
              className={cn(headClass, columnWidths?.at(columnIndex))}
            >
              <Skeleton className="h-4 w-20 rounded sm:h-5" />
            </TableHead>
          ))}
          {hasRowActions ? (
            <TableHead className={cn(headClass, LISTING_TABLE_ACTIONS_CELL)} />
          ) : null}
        </TableRow>
      </OverviewListingTableStickyHeader>
      <TableBody>
        {Array.from({ length: resolvedSkeletonRows }, (_, rowIndex) => (
          <TableRow key={`sk-ov-r-${rowIndex}`} className="group/row">
            {Array.from({ length: columnCount }, (_, columnIndex) => (
              <TableCell
                key={`sk-ov-c-${rowIndex}-${columnIndex}`}
                className={cn(cellClass, columnWidths?.at(columnIndex))}
              >
                <Skeleton className="h-4 max-w-[12rem] rounded sm:h-5" />
              </TableCell>
            ))}
            {hasRowActions ? (
              <TableCell className={cn(cellClass, LISTING_TABLE_ACTIONS_CELL)}>
                <Skeleton className="ms-auto inline-flex size-8 min-h-11 min-w-11 shrink-0 rounded-md sm:min-h-8 sm:min-w-8" />
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </table>
  );

  const tableBlock = pageScroll ? (
    <OverviewListingTablePageScrollWrap>
      {tableInner}
    </OverviewListingTablePageScrollWrap>
  ) : (
    <OverviewListingTableCard>
      <OverviewListingTableScrollBody ref={bodyScrollRef}>
        {tableInner}
      </OverviewListingTableScrollBody>
    </OverviewListingTableCard>
  );

  const paginationSkeleton =
    includePaginationSkeleton && !pageScroll ? (
      <div className="flex shrink-0 flex-col items-center gap-1.5 py-1.5 sm:flex-row sm:justify-center sm:gap-4 sm:py-2">
        <div className="flex items-center justify-center gap-2">
          <Skeleton className="size-8 shrink-0 rounded-md sm:min-h-8 sm:min-w-8" />
          <Skeleton className="h-4 w-[5.75rem] shrink-0 rounded sm:h-[1.125rem]" />
          <Skeleton className="size-8 shrink-0 rounded-md sm:min-h-8 sm:min-w-8" />
        </div>
        <Skeleton className="h-4 w-44 shrink-0 rounded sm:h-5" />
      </div>
    ) : null;

  return (
    <div
      role="status"
      aria-busy
      aria-label="Loading table"
      className={
        pageScroll
          ? 'flex min-h-0 w-full min-w-0 flex-1 flex-col'
          : 'flex min-h-0 w-full flex-1 flex-col gap-2 sm:gap-3'
      }
    >
      {tableBlock}
      {paginationSkeleton}
    </div>
  );
}
