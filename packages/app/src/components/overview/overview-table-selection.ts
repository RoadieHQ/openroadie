import type { Row, RowSelectionState, Table } from '@tanstack/react-table';

/**
 * Generic selection helpers for {@link OverviewTable}. Lifted from the Data
 * Sources table and genericized over the row type `T` — they operate purely on
 * the TanStack `Table<T>` / `Row<T>` APIs and stable row ids, so no per-feature
 * knowledge is required.
 */

/**
 * Rows between anchor and clicked row in visible table order (inclusive).
 * Uses `getRowModel()` row order — the sorted, paginated rows on screen.
 */
export function getRowRange<T>(
  rows: Row<T>[],
  clickedRowId: string,
  anchorRowId: string,
): Row<T>[] {
  if (!anchorRowId) {
    return [];
  }

  const clickedIndex = rows.findIndex(row => row.id === clickedRowId);
  const anchorIndex = rows.findIndex(row => row.id === anchorRowId);
  if (clickedIndex === -1 || anchorIndex === -1) {
    return [];
  }

  const start = Math.min(clickedIndex, anchorIndex);
  const end = Math.max(clickedIndex, anchorIndex);
  return rows.slice(start, end + 1);
}

/**
 * Handle a per-row checkbox click, supporting shift-click range selection
 * (Finder / Gmail pattern) anchored on the last plain click.
 */
export function handleOverviewRowCheckboxClick<T>(
  table: Table<T>,
  row: Row<T>,
  shiftKey: boolean,
  anchorRowIdRef: { current: string },
): void {
  if (shiftKey) {
    const { rows } = table.getRowModel();
    const anchorRowId = rows.some(
      candidate => candidate.id === anchorRowIdRef.current,
    )
      ? anchorRowIdRef.current
      : '';

    if (!anchorRowId) {
      return;
    }

    const rowsInRange = getRowRange(rows, row.id, anchorRowId);
    if (rowsInRange.length === 0) {
      return;
    }

    // Replace selection with the anchor→target range (Finder / Gmail pattern).
    const nextSelection: RowSelectionState = {};
    for (const rangeRow of rowsInRange) {
      nextSelection[rangeRow.id] = true;
    }
    table.setRowSelection(nextSelection);
    return;
  }

  row.toggleSelected();
  anchorRowIdRef.current = row.id;
}
