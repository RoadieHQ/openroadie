import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';
import { cn } from '../lib/utils';

export interface PaginationFooterProps {
  /** Total row count after filtering — drives the "Showing X–Y of Z" line, not the page count. */
  filteredRowCount: number;
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
  canPreviousPage: boolean;
  canNextPage: boolean;
  paginationTestId?: string;
}

/**
 * Prev/next pagination footer with "Page X of Y" and a showing-range line.
 * Purely controlled — wire it to whatever owns the page state (`pageIndex`
 * is zero-based).
 */
export function PaginationFooter({
  filteredRowCount,
  pageIndex,
  pageSize,
  pageCount,
  onPreviousPage,
  onNextPage,
  canPreviousPage,
  canNextPage,
  paginationTestId,
}: PaginationFooterProps) {
  const showingFrom = filteredRowCount === 0 ? 0 : pageIndex * pageSize + 1;
  const showingTo = Math.min((pageIndex + 1) * pageSize, filteredRowCount);

  return (
    <div
      data-testid={paginationTestId}
      className={cn(
        'flex shrink-0 touch-manipulation flex-col items-center gap-1.5 bg-transparent py-1.5 sm:flex-row sm:justify-center sm:gap-4 sm:py-2',
      )}
    >
      <div className="flex items-center justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
          disabled={!canPreviousPage}
          onClick={onPreviousPage}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-[5.5rem] text-center text-xs text-muted-foreground tabular-nums sm:text-sm">
          Page {pageIndex + 1} of {Math.max(pageCount, 1)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
          disabled={!canNextPage}
          onClick={onNextPage}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground sm:text-sm">
        Showing{' '}
        <span className="text-foreground tabular-nums">{showingFrom}</span>–
        <span className="text-foreground tabular-nums">{showingTo}</span> of{' '}
        <span className="text-foreground tabular-nums">{filteredRowCount}</span>
      </p>
    </div>
  );
}
