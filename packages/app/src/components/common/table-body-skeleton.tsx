import { Skeleton } from '@roadiehq/ui/skeleton';
import { TableBody, TableCell, TableRow } from '@roadiehq/ui/table';
import { cn } from '@roadiehq/ui/utils';

export interface TableBodySkeletonProps {
  /** Number of columns — match the sibling `<TableHeader>`. */
  columns: number;
  /** Number of placeholder rows. */
  rows?: number;
  /**
   * Cell padding overrides for denser tables. Skeleton rows must be the height
   * of the real ones or the table shifts when data lands (loading-states #4), so
   * a table whose cells aren't the default `p-2` needs to say so.
   */
  cellClassName?: string;
  /** Bar sizing, for the same reason as {@link cellClassName}. */
  barClassName?: string;
}

/**
 * Skeleton `<tbody>` for a bare `@roadiehq/ui` `<Table>`. Render it as the body
 * of the real table (keep the real `<TableHeader>` so column labels stay put)
 * while data loads. Overview-table listings use `OverviewTableLoadingView`
 * instead. See `.claude/rules/loading-states.md`.
 */
export function TableBodySkeleton({
  columns,
  rows = 4,
  cellClassName,
  barClassName,
}: TableBodySkeletonProps) {
  return (
    <TableBody>
      {Array.from({ length: rows }, (_, r) => (
        <TableRow key={`tbsk-r-${r}`} className="hover:bg-transparent">
          {Array.from({ length: columns }, (_, c) => (
            <TableCell key={`tbsk-c-${r}-${c}`} className={cellClassName}>
              <Skeleton
                className={cn('h-4 w-full max-w-[12rem] rounded', barClassName)}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}
