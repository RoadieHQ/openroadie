import type { RowSelectionState, Table } from '@tanstack/react-table';

/**
 * Generic marquee (drag-select) geometry helpers for {@link OverviewTable}.
 * Lifted from the Data Sources table and genericized over `T`. All DOM geometry
 * is driven off `tbody tr[data-row-id]` markers and `data-table-column-id`
 * attributes, so the helpers stay row-type agnostic.
 */

export type ClientRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type MarqueeRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Minimum pointer travel before a drag counts as marquee selection. */
export const MARQUEE_DRAG_THRESHOLD_PX = 4;

/** Columns with their own click targets — marquee starts everywhere else in tbody. */
const MARQUEE_BLOCKED_COLUMN_IDS = new Set(['select', 'actions']);

function rowIdsToSelectionState(rowIds: readonly string[]): RowSelectionState {
  return Object.fromEntries(rowIds.map(rowId => [rowId, true]));
}

export function shouldBlockMarqueeStart(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }

  if (target.closest('thead')) {
    return true;
  }

  const cell = target.closest('td, th');
  if (!(cell instanceof HTMLElement)) {
    return true;
  }

  const columnId = cell.dataset.tableColumnId;
  return columnId !== undefined && MARQUEE_BLOCKED_COLUMN_IDS.has(columnId);
}

export function rectsIntersect(a: ClientRect, b: ClientRect): boolean {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

export function normalizeMarqueeRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
): ClientRect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

export function clientRectToMarqueeOverlayRect(
  clientRect: ClientRect,
  container: HTMLElement,
): MarqueeRect {
  const containerRect = container.getBoundingClientRect();

  return {
    left: clientRect.left - containerRect.left + container.scrollLeft,
    top: clientRect.top - containerRect.top + container.scrollTop,
    width: clientRect.right - clientRect.left,
    height: clientRect.bottom - clientRect.top,
  };
}

export function getIntersectingRowIds(
  container: HTMLElement,
  marqueeClientRect: ClientRect,
): string[] {
  const rowElements = container.querySelectorAll<HTMLElement>(
    'tbody tr[data-row-id]',
  );
  const rowIds: string[] = [];

  for (const rowElement of rowElements) {
    const rowId = rowElement.dataset.rowId;
    if (!rowId) {
      continue;
    }

    const rowRect = rowElement.getBoundingClientRect();
    if (
      rectsIntersect(marqueeClientRect, {
        left: rowRect.left,
        top: rowRect.top,
        right: rowRect.right,
        bottom: rowRect.bottom,
      })
    ) {
      rowIds.push(rowId);
    }
  }

  return rowIds;
}

export function applyMarqueeRowSelection<T>(
  table: Table<T>,
  rowIds: string[],
  mode: 'replace' | 'add',
): void {
  if (rowIds.length === 0) {
    if (mode === 'replace') {
      table.setRowSelection({});
    }
    return;
  }

  if (mode === 'add') {
    table.setRowSelection(current => ({
      ...current,
      ...rowIdsToSelectionState(rowIds),
    }));
    return;
  }

  table.setRowSelection(rowIdsToSelectionState(rowIds));
}

export function getMarqueeAnchorRowId<T>(
  table: Table<T>,
  rowIds: string[],
): string {
  if (rowIds.length === 0) {
    return '';
  }

  const visibleRowIds = new Set(table.getRowModel().rows.map(row => row.id));
  const orderedSelectedIds = table
    .getRowModel()
    .rows.filter(row => rowIds.includes(row.id) && visibleRowIds.has(row.id))
    .map(row => row.id);

  return orderedSelectedIds.at(-1) ?? rowIds.at(-1) ?? '';
}
