import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roadiehq/ui/table';
import { cn } from '@roadiehq/ui/utils';
import { TableBodySkeleton } from '../table-body-skeleton';

// Clicks on these (or a `[data-no-row-click]` element) keep their own behaviour;
// the whole-row navigation only fires from the row body. Mirrors OverviewTable.
const ROW_CLICK_IGNORE_SELECTOR =
  'a, button, input, select, textarea, [role="button"], [role="menuitem"], [role="dialog"], [data-no-row-click]';

export interface PreviewColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
}

export interface PreviewTableProps<T> {
  columns: PreviewColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  loading?: boolean;
  /** Placeholder rows while loading. */
  skeletonRows?: number;
  emptyMessage?: ReactNode;
  /**
   * When set, the whole row navigates here on click (a real in-cell `<Link>`
   * remains the keyboard/accessible affordance). Return `undefined` to leave a
   * row non-navigable.
   */
  rowHref?: (row: T) => string | undefined;
  className?: string;
}

/**
 * A compact, read-only "preview" table for a detail drawer — e.g. the first few
 * objects of a data source. Keeps the real header while loading and swaps the
 * body for {@link TableBodySkeleton}, matching the loading-states rule.
 * Pass `rowHref` to make whole rows navigate to a related entity's detail.
 */
export function PreviewTable<T>({
  columns,
  rows,
  getRowId,
  loading = false,
  skeletonRows = 5,
  emptyMessage = 'Nothing to preview yet.',
  rowHref,
  className,
}: PreviewTableProps<T>) {
  const navigate = useNavigate();
  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-divider',
        className,
      )}
    >
      {/* Fixed layout so the column widths below are honoured and long,
          unbreakable values (ids, hashes) truncate instead of collapsing or
          stretching the table. */}
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="border-b border-divider bg-muted/50 hover:bg-muted/50">
            {columns.map(col => (
              <TableHead
                key={col.key}
                // `col.className` carries body-cell hints like `align-top`;
                // force the header to stay vertically centred in its row.
                className={cn('h-9 text-xs', col.className, 'align-middle')}
              >
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        {loading ? (
          <TableBodySkeleton columns={columns.length} rows={skeletonRows} />
        ) : rows.length === 0 ? (
          <TableBody>
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length}
                className="py-6 text-center text-sm text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          </TableBody>
        ) : (
          <TableBody>
            {rows.map(row => {
              const href = rowHref?.(row);
              return (
                <TableRow
                  key={getRowId(row)}
                  className={href ? 'cursor-pointer' : undefined}
                  // Intentionally no `data-row-id`: unlike overview rows, preview
                  // rows live inside the drawer body, so tagging them would make
                  // them match the drawer's default `keepOpenSelector` — a
                  // coupling they don't need (they navigate on click instead).
                  onClick={
                    href
                      ? event => {
                          if (
                            (event.target as HTMLElement).closest(
                              ROW_CLICK_IGNORE_SELECTOR,
                            )
                          ) {
                            return;
                          }
                          navigate(href);
                        }
                      : undefined
                  }
                >
                  {columns.map(col => (
                    <TableCell key={col.key} className={col.className}>
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        )}
      </Table>
    </div>
  );
}
