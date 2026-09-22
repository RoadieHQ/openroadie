import { PaginationFooter } from '@roadiehq/ui/pagination';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  functionalUpdate,
  type Row,
  type RowSelectionState,
  type SortingState,
  type OnChangeFn,
  type VisibilityState,
} from '@tanstack/react-table';
import { TableBody, TableCell, TableHead, TableRow } from '@roadiehq/ui/table';
import { rowClickFromInteractiveTarget } from './row-click-target';
import { Checkbox } from '@roadiehq/ui/checkbox';
import { cn } from '@roadiehq/ui/utils';
import {
  OverviewListingTableCard,
  OverviewListingTablePageScrollWrap,
  OverviewListingTableScrollBody,
  OverviewListingTableStickyHeader,
  useViewportTablePagination,
  useDelayedFlag,
  LISTING_TABLE_HEADER_ROW,
  LISTING_TABLE_HEAD_CELL,
  LISTING_TABLE_BODY_CELL,
  LISTING_TABLE_ACTIONS_CELL,
  LISTING_TABLE_EMPTY_CELL,
  listingTableElementClassName,
  TableViewOptions,
  useTablePreferences,
} from '../common';
import type { ColumnConfig } from './overview-config';
import { toColumnDef, type OverviewColumnMeta } from './overview-table-column';
import { OverviewTableLoadingView } from './overview-table-loading-view';
import { handleOverviewRowCheckboxClick } from './overview-table-selection';
import { useOverviewTableMarqueeSelection } from './use-overview-table-marquee-selection';
import { useOverviewTableFilters } from './use-overview-table-filters';

export interface OverviewSelectionApi<T> {
  /** Called whenever the set of selected row originals changes. */
  onChange?: (selected: T[]) => void;
  /** Hard-reset selection when this changes (route / group scope). */
  resetKey?: string;
  /** Enable drag-select marquee + shift-click range selection. */
  marquee?: boolean;
}

export interface OverviewTableProps<T> {
  data: T[];
  columns: ColumnConfig<T>[];
  getRowId: (row: T) => string;
  /** Primary load: show the skeleton while `data` is still empty. */
  loading?: boolean;
  /** Secondary load: cells still resolving (pass-through for cell renderers). */
  cellsLoading?: boolean;
  defaultSort?: SortingState;
  /** Insert group-header rows keyed off `label(row)` (data should be sorted so groups are contiguous). */
  groupBy?: { enabled: boolean; label: (row: T) => string };
  selection?: OverviewSelectionApi<T>;
  /** Trailing per-row actions cell. */
  rowActions?: (row: T) => ReactNode;
  onRowClick?: (row: T) => void;
  /** Shown when filtered rows === 0 while `data` is non-empty. */
  emptyState: ReactNode;
  skeletonRowCount?: number;
  paginationTestId?: string;
  /**
   * When false, render every filtered row inside a page-scrolling shell with no
   * viewport pagination or footer — for short, fully-rendered listings such as
   * Secrets. Default true (viewport-height card + pagination footer).
   */
  paginate?: boolean;
  /**
   * Opt in to persisted column display preferences. Only columns declaring
   * `enableHiding: true` are offered; all other columns remain fixed.
   */
  columnDisplay?: { tableId: string };
}

interface OverviewTableCoreProps<T> extends Omit<
  OverviewTableProps<T>,
  'columnDisplay'
> {
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>;
  resetColumnVisibility?: () => void;
}

const ACTIONS_COLUMN_ID = 'actions';

function overviewColumnMeta(column: {
  columnDef: { meta?: unknown };
}): OverviewColumnMeta {
  const meta = column.columnDef.meta;
  return (meta as OverviewColumnMeta | undefined) ?? {};
}

function OverviewTableCheckbox({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Checkbox>) {
  return (
    <Checkbox
      className={cn(
        'size-4 border-muted-foreground/50 shadow-none data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        className,
      )}
      {...props}
    />
  );
}

function rowCheckboxRevealClassName({
  isSelected,
  hasAnySelection,
}: {
  isSelected: boolean;
  hasAnySelection: boolean;
}): string {
  const visible = isSelected || hasAnySelection;

  return cn(
    'flex items-center justify-start motion-opacity-fast',
    visible
      ? 'opacity-100'
      : 'pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
  );
}

export function OverviewTable<T>({
  columnDisplay,
  ...props
}: OverviewTableProps<T>): JSX.Element | null {
  if (!columnDisplay) {
    return <OverviewTableCore {...props} />;
  }

  return (
    <OverviewTableWithPreferences {...props} tableId={columnDisplay.tableId} />
  );
}

function OverviewTableWithPreferences<T>({
  tableId,
  columns,
  ...props
}: Omit<OverviewTableCoreProps<T>, 'columnVisibility'> & {
  tableId: string;
}): JSX.Element | null {
  const preferences = useTablePreferences({ tableId, columns });

  return <OverviewTableCore {...props} columns={columns} {...preferences} />;
}

function OverviewTableCore<T>({
  data,
  columns: columnConfigs,
  getRowId,
  loading,
  defaultSort,
  groupBy,
  selection,
  rowActions,
  onRowClick,
  emptyState,
  skeletonRowCount,
  paginationTestId,
  paginate = true,
  columnVisibility,
  onColumnVisibilityChange,
  resetColumnVisibility,
}: OverviewTableCoreProps<T>): JSX.Element | null {
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const getFilteredRowCountRef = useRef<() => number>(() => 0);
  const lastSelectedRowIdRef = useRef('');
  const tableRef = useRef<ReturnType<typeof useReactTable<T>> | null>(null);
  const handleRowSelectRef = useRef<(row: Row<T>, shiftKey: boolean) => void>(
    () => {},
  );

  const hasSelection = !!selection;
  const marqueeEnabled = !!selection?.marquee;
  const selectionResetKey = selection?.resetKey;
  const selectionOnChange = selection?.onChange;

  const [sorting, setSorting] = useState<SortingState>(defaultSort ?? []);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const { columnFilters, onColumnFiltersChange } =
    useOverviewTableFilters(columnConfigs);

  const handleColumnVisibilityChange = useCallback<OnChangeFn<VisibilityState>>(
    updater => {
      if (!onColumnVisibilityChange) {
        return;
      }

      const currentVisibility = columnVisibility ?? {};
      const nextVisibility = functionalUpdate(updater, currentVisibility);
      const hiddenFilterColumnIds = columnConfigs
        .filter(column => column.filter !== undefined)
        .filter(column => {
          const wasVisible = currentVisibility[`${column.id}`] !== false;
          const isVisible = nextVisibility[`${column.id}`] !== false;
          return wasVisible && !isVisible;
        })
        .map(column => column.id);

      if (hiddenFilterColumnIds.length > 0) {
        const hiddenIds = new Set(hiddenFilterColumnIds);
        onColumnFiltersChange(current =>
          current.filter(filter => !hiddenIds.has(filter.id)),
        );
      }

      onColumnVisibilityChange(updater);
    },
    [
      columnConfigs,
      columnVisibility,
      onColumnFiltersChange,
      onColumnVisibilityChange,
    ],
  );

  const showColumnControls = resetColumnVisibility !== undefined;

  // Anti-flicker: only show the loading skeleton once the first-load fetch has
  // run long enough to warrant it, and keep it on screen long enough that it
  // never blinks. Fast loads go straight to the table with no skeleton.
  const loadingEmpty = !!loading && data.length === 0;
  const showSkeleton = useDelayedFlag(loadingEmpty);

  const itemsFingerprint = useMemo(
    () => data.map(getRowId).join('\0'),
    [data, getRowId],
  );

  const columns = useMemo(() => {
    const helper = createColumnHelper<T>();
    const compiled = columnConfigs.map(config => toColumnDef(config, helper));

    // Selection is rendered as an overlay floating on each row's left face
    // (see the first-cell overlay in the body/header render) rather than a
    // dedicated column, so no `select` column is injected here.

    // A single trailing column carries both the per-row actions (`…`) and the
    // column-display toggle (`⊞`) in its header. Rendering the toggle here —
    // rather than as an extra appended `<th>` with no matching body cell —
    // keeps header and body cell counts equal so the actions cell sits flush
    // right instead of one column-width in from the edge.
    if (rowActions || showColumnControls) {
      compiled.push(
        helper.display({
          id: ACTIONS_COLUMN_ID,
          enableHiding: false,
          header: showColumnControls
            ? ({ table }) => (
                <div className="flex justify-end">
                  <TableViewOptions
                    table={table}
                    onReset={resetColumnVisibility}
                  />
                </div>
              )
            : // Without the column-display toggle to name it, this `th` would
              // have no accessible text at all (axe `empty-table-header`), so a
              // screen reader announces each row's action menu against an unnamed
              // column. Listings that opt out of `columnDisplay` still get a name.
              () => <span className="sr-only">Actions</span>,
          cell: rowActions ? ({ row }) => rowActions(row.original) : () => null,
        }),
      );
    }

    return compiled;
  }, [columnConfigs, rowActions, showColumnControls, resetColumnVisibility]);

  const [pagination, setPagination] = useViewportTablePagination({
    itemsFingerprint,
    resetPageIndexKey: itemsFingerprint,
    loading: !!loading,
    bodyScrollRef,
    theadRef,
    getFilteredRowCountRef,
  });

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      pagination,
      rowSelection,
      columnVisibility,
      columnFilters,
    },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: handleColumnVisibilityChange,
    onColumnFiltersChange: updater => {
      onColumnFiltersChange(updater);
      setPagination(current => ({ ...current, pageIndex: 0 }));
    },
    enableRowSelection: hasSelection,
    autoResetPageIndex: false,
    getRowId: (row: T) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // Page-scroll mode renders every filtered row; omit the pagination model.
    getPaginationRowModel: paginate ? getPaginationRowModel() : undefined,
  });

  tableRef.current = table;

  const { marqueeRect, isDragging, scrollBodyProps } =
    useOverviewTableMarqueeSelection<T>({
      scrollBodyRef: bodyScrollRef,
      getTable: () => tableRef.current,
      lastSelectedRowIdRef,
    });

  handleRowSelectRef.current = (row, shiftKey) => {
    const currentTable = tableRef.current;
    if (!currentTable) {
      return;
    }
    handleOverviewRowCheckboxClick(
      currentTable,
      row,
      shiftKey,
      lastSelectedRowIdRef,
    );
  };

  // Auto-prune selection to the ids still present when data changes.
  useEffect(() => {
    if (!hasSelection) {
      return;
    }
    setRowSelection(current => {
      const validIds = new Set(data.map(getRowId));
      const next = Object.fromEntries(
        Object.entries(current).filter(([id]) => validIds.has(id)),
      );
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next;
    });
  }, [data, getRowId, hasSelection]);

  // Hard-reset selection when the scope (route / group) changes.
  useEffect(() => {
    if (!hasSelection) {
      return;
    }
    setRowSelection({});
    lastSelectedRowIdRef.current = '';
  }, [selectionResetKey, hasSelection]);

  const selectedOriginals = useMemo(
    () =>
      Object.keys(rowSelection).length === 0
        ? []
        : table.getFilteredSelectedRowModel().rows.map(row => row.original),
    [rowSelection, table],
  );

  useEffect(() => {
    if (!hasSelection) {
      return;
    }
    selectionOnChange?.(selectedOriginals);
  }, [hasSelection, selectionOnChange, selectedOriginals]);

  getFilteredRowCountRef.current = () =>
    table.getFilteredRowModel().rows.length;

  const filteredRowCount = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();

  const skeletonRows =
    filteredRowCount === 0 ? pageSize : Math.min(pageSize, filteredRowCount);
  const totalColSpan = table.getVisibleLeafColumns().length;

  if (showSkeleton) {
    return (
      <OverviewTableLoadingView
        columnCount={columnConfigs.length}
        columnWidths={columnConfigs.map(config => config.width)}
        hasRowActions={!!rowActions}
        bodyScrollRef={bodyScrollRef}
        theadRef={theadRef}
        skeletonRowCount={skeletonRowCount ?? skeletonRows}
        pageScroll={!paginate}
      />
    );
  }

  // During the pre-skeleton delay window (first load, no data yet) render
  // nothing rather than the empty state, so a fast load never flashes
  // "no results" on its way to the table.
  if (loadingEmpty) {
    return null;
  }

  const rows = table.getRowModel().rows;

  const tableElement = (
    <table className={listingTableElementClassName()}>
      <OverviewListingTableStickyHeader ref={theadRef}>
        {table.getHeaderGroups().map(headerGroup => (
          <TableRow key={headerGroup.id} className={LISTING_TABLE_HEADER_ROW}>
            {headerGroup.headers.map((header, headerIndex) => {
              const meta = overviewColumnMeta(header.column);
              const sortDirection = header.column.getIsSorted();
              const withSelect = hasSelection && headerIndex === 0;
              const hasAnySelection = table.getIsSomeRowsSelected();
              const headerContent = header.isPlaceholder
                ? null
                : flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  );
              return (
                <TableHead
                  key={header.id}
                  aria-sort={
                    sortDirection === 'asc'
                      ? 'ascending'
                      : sortDirection === 'desc'
                        ? 'descending'
                        : undefined
                  }
                  data-table-column-id={header.column.id}
                  className={cn(
                    LISTING_TABLE_HEAD_CELL,
                    header.column.id === ACTIONS_COLUMN_ID &&
                      LISTING_TABLE_ACTIONS_CELL,
                    meta.width,
                    meta.align === 'right' && 'text-right',
                    meta.align === 'center' && 'text-center',
                    meta.headClassName,
                    withSelect && 'relative',
                  )}
                >
                  {withSelect ? (
                    <>
                      <span className="block pl-8">{headerContent}</span>
                      {/* Select-all is always visible (not hover-gated).
                                The `bg-background` chip matches the sticky header
                                and masks the Name sort button's hover highlight
                                that would otherwise run under the checkbox, so
                                the spacing reads cleanly at any gutter width. */}
                      <span className="absolute top-1/2 left-2.5 z-20 flex -translate-y-1/2 items-center bg-background pr-1.5">
                        <OverviewTableCheckbox
                          checked={
                            table.getIsAllRowsSelected()
                              ? true
                              : hasAnySelection
                                ? 'indeterminate'
                                : false
                          }
                          onCheckedChange={value => {
                            table.toggleAllRowsSelected(value === true);
                            lastSelectedRowIdRef.current = '';
                          }}
                          aria-label="Select all"
                        />
                      </span>
                    </>
                  ) : (
                    headerContent
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </OverviewListingTableStickyHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell
              colSpan={totalColSpan}
              className={LISTING_TABLE_EMPTY_CELL}
            >
              {emptyState}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row, index) => {
            const currentGroupLabel = groupBy?.enabled
              ? groupBy.label(row.original)
              : undefined;
            const previousGroupLabel =
              groupBy?.enabled && index > 0
                ? groupBy.label(rows[index - 1]!.original)
                : undefined;
            const showGroupHeader =
              !!groupBy?.enabled && currentGroupLabel !== previousGroupLabel;

            return (
              <Fragment key={row.id}>
                {showGroupHeader ? (
                  <TableRow
                    key={`group-${currentGroupLabel}`}
                    className="hover:bg-transparent"
                  >
                    <TableCell
                      colSpan={totalColSpan}
                      className="bg-muted/40 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
                    >
                      {currentGroupLabel}
                    </TableCell>
                  </TableRow>
                ) : null}
                <TableRow
                  className={cn(
                    'group/row',
                    onRowClick &&
                      'cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                  )}
                  data-row-id={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={
                    onRowClick
                      ? event => {
                          if (rowClickFromInteractiveTarget(event.target)) {
                            return;
                          }
                          onRowClick(row.original);
                        }
                      : undefined
                  }
                  onKeyDown={
                    onRowClick
                      ? event => {
                          if (
                            rowClickFromInteractiveTarget(event.target) ||
                            (event.key !== 'Enter' && event.key !== ' ')
                          ) {
                            return;
                          }
                          event.preventDefault();
                          onRowClick(row.original);
                        }
                      : undefined
                  }
                >
                  {row.getVisibleCells().map((cell, cellIndex) => {
                    const meta = overviewColumnMeta(cell.column);
                    const withSelect = hasSelection && cellIndex === 0;
                    const isSelected = row.getIsSelected();
                    const cellContent = flexRender(
                      cell.column.columnDef.cell,
                      cell.getContext(),
                    );
                    return (
                      <TableCell
                        key={cell.id}
                        data-table-column-id={cell.column.id}
                        className={cn(
                          LISTING_TABLE_BODY_CELL,
                          cell.column.id === ACTIONS_COLUMN_ID &&
                            LISTING_TABLE_ACTIONS_CELL,
                          meta.width,
                          meta.align === 'right' && 'text-right',
                          meta.align === 'center' && 'text-center',
                          meta.cellClassName,
                          'min-w-0',
                          withSelect && 'relative',
                        )}
                      >
                        {withSelect ? (
                          <>
                            {/* Constant left gutter reserves room so the
                                      checkbox floats to the left of the content
                                      (never over it) — a fixed inset, not a
                                      hover shift. */}
                            <span className="block pl-8">{cellContent}</span>
                            {/* Checkbox floats in the gutter, inset from
                                      the card's rounded left edge so it is never
                                      clipped, above the content (z), revealed on
                                      hover / when selection is active. */}
                            <span
                              className={cn(
                                'absolute top-1/2 left-2.5 z-20 -translate-y-1/2',
                                rowCheckboxRevealClassName({
                                  isSelected,
                                  hasAnySelection:
                                    table.getIsSomeRowsSelected(),
                                }),
                              )}
                            >
                              <OverviewTableCheckbox
                                checked={isSelected}
                                aria-label="Select row"
                                onClick={event => {
                                  event.stopPropagation();
                                  event.preventDefault();
                                  handleRowSelectRef.current(
                                    row,
                                    event.shiftKey,
                                  );
                                }}
                              />
                            </span>
                          </>
                        ) : (
                          cellContent
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              </Fragment>
            );
          })
        )}
      </TableBody>
    </table>
  );

  // Page-scroll mode: short listings render every row and scroll with the page
  // (no viewport-height card, no pagination footer). Selection/marquee are not
  // used in this mode.
  if (!paginate) {
    return (
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2">
        <OverviewListingTablePageScrollWrap>
          {tableElement}
        </OverviewListingTablePageScrollWrap>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-2 sm:gap-3">
      <OverviewListingTableCard>
        <OverviewListingTableScrollBody
          ref={bodyScrollRef}
          className={cn('relative', isDragging && 'cursor-crosshair')}
          {...(marqueeEnabled ? scrollBodyProps : {})}
        >
          {marqueeEnabled && marqueeRect ? (
            <div
              aria-hidden
              className="pointer-events-none absolute z-20 rounded-sm border border-primary/40 bg-primary/10"
              style={{
                left: marqueeRect.left,
                top: marqueeRect.top,
                width: marqueeRect.width,
                height: marqueeRect.height,
              }}
            />
          ) : null}
          {tableElement}
        </OverviewListingTableScrollBody>
      </OverviewListingTableCard>
      <PaginationFooter
        filteredRowCount={filteredRowCount}
        pageIndex={pageIndex}
        pageSize={pageSize}
        pageCount={pageCount}
        onPreviousPage={() => table.previousPage()}
        onNextPage={() => table.nextPage()}
        canPreviousPage={table.getCanPreviousPage()}
        canNextPage={table.getCanNextPage()}
        paginationTestId={paginationTestId}
      />
    </div>
  );
}
