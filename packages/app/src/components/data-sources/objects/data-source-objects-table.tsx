/*
 * Copyright 2025 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { PaginationFooter } from '@roadiehq/ui/pagination';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  flexRender,
  type ColumnSizingState,
  type ExpandedState,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { TableBody, TableCell, TableHead, TableRow } from '@roadiehq/ui/table';
import { TooltipProvider } from '@roadiehq/ui/tooltip';
import { cn } from '@roadiehq/ui/utils';
import {
  LISTING_TABLE_BODY_CELL,
  LISTING_TABLE_HEAD_CELL,
  OverviewListingTableCard,
  OverviewListingTableScrollBody,
  OverviewListingTableStickyHeader,
  RefreshingPill,
  TableBodySkeleton,
} from '../../common';
import { rowClickFromInteractiveTarget } from '../../overview';
import type { IndexConfiguration } from '../../../api/datastore/datastore-client';
import type { DataSourceItem } from '../types';
import {
  CELL_TOOLTIP_DELAY_MS,
  ObjectPeekPanel,
  dataSourceObjectsColumns,
} from './table';
import type { DataSourceObjectRow } from './use-data-source-objects';
import {
  isIndexTableColumn,
  presentationIndex,
  resolvePresentationColumnLabels,
  resolveSubtitleFieldNamesByRow,
} from './resolve-presentation-field-names';
import {
  dataSourceObjectsColumnCellClass,
  dataSourceObjectsColumnHeadClass,
  dataSourceObjectsTableElementClassName,
} from './data-source-objects-table-layout';

interface DataSourceObjectsTableProps {
  /**
   * Selected data source, used by the filter typeahead. In All mode this is
   * the sentinel and never reaches the API — rows carry their own
   * `datasourceId` for the detail panel and relationship dialogs.
   */
  datasourceId: string;
  /** Cross-source view: adds the Data source column, no index columns. */
  allMode: boolean;
  dataSources: DataSourceItem[];
  rows: DataSourceObjectRow[];
  indexes: IndexConfiguration[];
  total: number;
  loading: boolean;
  /**
   * A refetch is in flight with rows already on screen (sort, filter, paginate).
   * Overlays the shared pill on the table rather than swapping in a skeleton —
   * see loading-states rule #5.
   */
  refreshing?: boolean;
  /** When searching, results are relevance-ranked so column sorting is disabled. */
  searchActive: boolean;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  /** Active exact-match filters keyed by index name. */
  filters: Map<string, string>;
  /** Called when the user applies or clears a single column's filter. */
  onSetFilter: (key: string, value: string) => void;
  /** Per-data-source index-column visibility (persisted by the page). */
  columnVisibility: VisibilityState;
  onColumnVisibilityChange: OnChangeFn<VisibilityState>;
  /** Open the object in the detail drawer (row click + chevron). */
  onOpenObject: (row: DataSourceObjectRow) => void;
}

export function DataSourceObjectsTable({
  datasourceId,
  allMode,
  dataSources,
  rows,
  indexes,
  total,
  loading,
  refreshing = false,
  searchActive,
  sorting,
  onSortingChange,
  pagination,
  onPaginationChange,
  filters,
  onSetFilter,
  columnVisibility,
  onColumnVisibilityChange,
  onOpenObject,
}: DataSourceObjectsTableProps) {
  // Visibility-aware: with every index column hidden via the Columns menu,
  // the layout should behave like a table without index columns.
  const hasIndexColumns = indexes.some(
    index =>
      isIndexTableColumn(index) && columnVisibility[`${index.key}`] !== false,
  );
  const titleIndex = presentationIndex(indexes, 'title');
  const subtitleIndex = presentationIndex(indexes, 'subtitle');
  // Both of these scan every row against the candidate field lists, so they are
  // memoized on the data rather than recomputed on each render — this component
  // re-renders on every expand toggle and on each column-resize frame.
  const { titleLabel, subtitleLabel } = useMemo(
    () => resolvePresentationColumnLabels(rows, indexes, allMode),
    [rows, indexes, allMode],
  );
  const subtitleFieldNamesByRow = useMemo(
    () => resolveSubtitleFieldNamesByRow(rows, indexes),
    [rows, indexes],
  );
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  // The column set the current pixel widths were measured against. A ref, not
  // state: it only ever guards the measurement effect below, so writing it must
  // not itself trigger a render.
  const measuredColumnsKeyRef = useRef('');
  const headerRefs = useRef<Record<string, HTMLTableCellElement | null>>({});

  // Collapse any expanded rows when the underlying page of objects changes.
  const rowIdsKey = useMemo(() => rows.map(row => row.id).join('|'), [rows]);
  useEffect(() => {
    setExpanded({});
  }, [rowIdsKey]);

  const columns = useMemo(
    () =>
      dataSourceObjectsColumns({
        datasourceId,
        allMode,
        dataSources,
        indexes,
        searchActive,
        filters,
        onSetFilter,
        titleLabel,
        subtitleLabel,
        subtitleFieldNamesByRow,
        titleIndex,
        subtitleIndex,
      }),
    [
      indexes,
      searchActive,
      filters,
      onSetFilter,
      datasourceId,
      allMode,
      dataSources,
      titleLabel,
      subtitleLabel,
      subtitleFieldNamesByRow,
      titleIndex,
      subtitleIndex,
    ],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, pagination, expanded, columnVisibility, columnSizing },
    onSortingChange,
    onPaginationChange,
    onColumnVisibilityChange,
    onColumnSizingChange: updater => {
      setColumnSizing(prev =>
        typeof updater === 'function' ? updater(prev) : updater,
      );
    },
    onExpandedChange: setExpanded,
    getRowCanExpand: () => true,
    manualSorting: true,
    manualPagination: true,
    columnResizeMode: 'onChange',
    rowCount: total,
    getRowId: row => row.id,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  const { pageIndex, pageSize } = pagination;
  const pageCount = table.getPageCount();
  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const visibleColumnIdsKey = table
    .getVisibleLeafColumns()
    .map(column => column.id)
    .join('|');
  const hasMeasuredColumnSizing = Object.keys(columnSizing).length > 0;

  // Seed TanStack's sizing state from whatever the layout classes produced: the
  // classes own the column proportions, but `columnResizeMode: 'onChange'` needs
  // concrete pixels to drag from.
  //
  // Two passes, and both are load-bearing — when the visible column set changes,
  // the pixel widths have to come off first so the next render lays out from the
  // classes again; measuring while they are still applied would only read them
  // back. The key ref is what stops the pair from looping.
  useEffect(() => {
    if (
      !visibleColumnIdsKey ||
      measuredColumnsKeyRef.current === visibleColumnIdsKey
    ) {
      return;
    }

    if (hasMeasuredColumnSizing) {
      setColumnSizing({});
      headerRefs.current = {};
      return;
    }

    const frame = requestAnimationFrame(() => {
      const nextSizing: ColumnSizingState = {};
      for (const column of table.getVisibleLeafColumns()) {
        const element = headerRefs.current[column.id];
        const width = element?.getBoundingClientRect().width;
        if (width && width > 0) {
          nextSizing[column.id] = Math.round(width);
        }
      }
      if (Object.keys(nextSizing).length > 0) {
        measuredColumnsKeyRef.current = visibleColumnIdsKey;
        setColumnSizing(nextSizing);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [hasMeasuredColumnSizing, table, visibleColumnIdsKey]);

  return (
    <TooltipProvider
      delayDuration={CELL_TOOLTIP_DELAY_MS}
      skipDelayDuration={0}
    >
      <div className="flex min-h-0 w-full flex-1 flex-col gap-2 sm:gap-3">
        <OverviewListingTableCard className="relative">
          {/* Anchored to the table, matching how the graph views overlay the same
              pill on their canvas. Bottom-right rather than the graph's top-right:
              the thead is sticky, so a top overlay would cover a column header. */}
          {refreshing ? (
            <RefreshingPill className="absolute right-3 bottom-3 z-20" />
          ) : null}
          <OverviewListingTableScrollBody>
            <table className={dataSourceObjectsTableElementClassName()}>
              <OverviewListingTableStickyHeader>
                {table.getHeaderGroups().map(headerGroup => (
                  <TableRow
                    key={headerGroup.id}
                    className="group/header border-border hover:bg-transparent"
                  >
                    {headerGroup.headers.map(headerCell => (
                      <TableHead
                        key={headerCell.id}
                        data-table-column-id={headerCell.column.id}
                        ref={element => {
                          headerRefs.current[headerCell.column.id] = element;
                        }}
                        className={cn(
                          LISTING_TABLE_HEAD_CELL,
                          'relative',
                          headerCell.column.getCanResize() && 'pr-3',
                          dataSourceObjectsColumnHeadClass(
                            headerCell.column.id,
                            {
                              hasIndexColumns,
                              hasDataSourceColumn: allMode,
                            },
                          ),
                        )}
                        style={
                          hasMeasuredColumnSizing
                            ? {
                                width: headerCell.getSize(),
                                minWidth: headerCell.getSize(),
                                maxWidth: headerCell.getSize(),
                              }
                            : undefined
                        }
                      >
                        {headerCell.isPlaceholder
                          ? null
                          : flexRender(
                              headerCell.column.columnDef.header,
                              headerCell.getContext(),
                            )}
                        {headerCell.column.getCanResize() ? (
                          // A pointer-drag affordance, not a control: it was a
                          // ghost Button, which put one unusable tab stop per
                          // column in the header (there is no keyboard resize)
                          // and needed half a dozen utilities to undo the
                          // variant's own styling. Columns auto-size to their
                          // content, so hiding this from assistive tech loses
                          // nothing.
                          <span
                            aria-hidden
                            onDoubleClick={() => headerCell.column.resetSize()}
                            onMouseDown={headerCell.getResizeHandler()}
                            onTouchStart={headerCell.getResizeHandler()}
                            className={cn(
                              'absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize touch-none select-none',
                              'after:absolute after:top-1/2 after:right-0 after:h-5 after:w-px after:-translate-y-1/2 after:bg-border/70',
                              headerCell.column.getIsResizing() &&
                                'after:bg-primary',
                            )}
                          />
                        ) : null}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </OverviewListingTableStickyHeader>
              {loading ? (
                <TableBodySkeleton
                  columns={visibleColumnCount}
                  rows={Math.max(1, pageSize)}
                  // This table's rows are denser than the primitive's default,
                  // so pass its own padding and bar height through — otherwise
                  // the table shifts when the data lands.
                  cellClassName={LISTING_TABLE_BODY_CELL}
                  barClassName="sm:h-5"
                />
              ) : (
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={visibleColumnCount}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No objects found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    table.getRowModel().rows.map(row => (
                      <Fragment key={row.id}>
                        <TableRow
                          className="group/row cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                          data-row-id={row.id}
                          tabIndex={0}
                          onClick={event => {
                            // Let the row's own controls (expand chevron, title
                            // link, column filters) handle their own clicks; open
                            // the drawer only from the row body.
                            if (rowClickFromInteractiveTarget(event.target)) {
                              return;
                            }
                            onOpenObject(row.original);
                          }}
                          // Same contract as OverviewTable: the row body is
                          // focusable and Enter/Space open the drawer, so the
                          // detail view isn't mouse-only.
                          onKeyDown={event => {
                            if (
                              rowClickFromInteractiveTarget(event.target) ||
                              (event.key !== 'Enter' && event.key !== ' ')
                            ) {
                              return;
                            }
                            event.preventDefault();
                            onOpenObject(row.original);
                          }}
                        >
                          {row.getVisibleCells().map(cell => (
                            <TableCell
                              key={cell.id}
                              data-table-column-id={cell.column.id}
                              className={cn(
                                LISTING_TABLE_BODY_CELL,
                                dataSourceObjectsColumnCellClass(
                                  cell.column.id,
                                  {
                                    hasDataSourceColumn: allMode,
                                  },
                                ),
                                'min-w-0',
                              )}
                              style={
                                hasMeasuredColumnSizing
                                  ? {
                                      width: cell.column.getSize(),
                                      minWidth: cell.column.getSize(),
                                      maxWidth: cell.column.getSize(),
                                    }
                                  : undefined
                              }
                            >
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext(),
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                        {row.getIsExpanded() ? (
                          <TableRow
                            data-expanded-row-id={row.id}
                            className="hover:bg-transparent"
                          >
                            <TableCell
                              colSpan={row.getVisibleCells().length}
                              className="bg-muted/30 p-0"
                            >
                              <ObjectPeekPanel
                                object={row.original.object}
                                createdAt={row.original.createdAt}
                                updatedAt={row.original.updatedAt}
                              />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    ))
                  )}
                </TableBody>
              )}
            </table>
          </OverviewListingTableScrollBody>
        </OverviewListingTableCard>
        <PaginationFooter
          filteredRowCount={total}
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageCount={pageCount}
          onPreviousPage={() => table.previousPage()}
          onNextPage={() => table.nextPage()}
          canPreviousPage={table.getCanPreviousPage()}
          canNextPage={table.getCanNextPage()}
          paginationTestId="data-source-objects-table-pagination"
        />
      </div>
    </TooltipProvider>
  );
}
