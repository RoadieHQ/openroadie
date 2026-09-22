import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OnChangeFn, VisibilityState } from '@tanstack/react-table';

const STORAGE_VERSION = 1;
const STORAGE_PREFIX = 'openroadie.table.';

export interface TablePreferenceColumn {
  id: string;
  enableHiding?: boolean;
  defaultVisible?: boolean;
}

export interface UseTablePreferencesOptions {
  tableId: string;
  columns: readonly TablePreferenceColumn[];
}

export interface TablePreferencesResult {
  columnVisibility: VisibilityState;
  onColumnVisibilityChange: OnChangeFn<VisibilityState>;
  resetColumnVisibility: () => void;
}

interface StoredTablePreferences {
  version: typeof STORAGE_VERSION;
  columnVisibility: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStoredTablePreferences(
  value: unknown,
): value is StoredTablePreferences {
  return (
    isRecord(value) &&
    value.version === STORAGE_VERSION &&
    isRecord(value.columnVisibility)
  );
}

function defaultColumnVisibility(
  columns: readonly TablePreferenceColumn[],
): VisibilityState {
  return Object.fromEntries(
    columns
      .filter(
        column =>
          column.enableHiding !== false && column.defaultVisible === false,
      )
      .map(column => [column.id, false]),
  );
}

function resolveColumnVisibility(
  columns: readonly TablePreferenceColumn[],
  candidate?: Record<string, unknown>,
): VisibilityState {
  const next = defaultColumnVisibility(columns);

  for (const column of columns) {
    if (column.enableHiding === false) continue;
    const value = candidate?.[`${column.id}`];
    if (typeof value === 'boolean') {
      next[`${column.id}`] = value;
    }
  }

  return next;
}

function visibilityEquals(
  left: VisibilityState,
  right: VisibilityState,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([id, value]) => right[`${id}`] === value)
  );
}

function preferenceColumnsKey(
  columns: readonly TablePreferenceColumn[],
): string {
  return JSON.stringify(
    columns.map(column => ({
      id: column.id,
      enableHiding: column.enableHiding,
      defaultVisible: column.defaultVisible,
    })),
  );
}

function readPreferences(
  storageKey: string,
  columns: readonly TablePreferenceColumn[],
): VisibilityState {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultColumnVisibility(columns);
    const parsed: unknown = JSON.parse(raw);
    return resolveColumnVisibility(
      columns,
      isStoredTablePreferences(parsed) ? parsed.columnVisibility : undefined,
    );
  } catch {
    return defaultColumnVisibility(columns);
  }
}

export function tablePreferencesStorageKey(tableId: string): string {
  return `${STORAGE_PREFIX}${tableId}.v${STORAGE_VERSION}`;
}

export function useTablePreferences({
  tableId,
  columns,
}: UseTablePreferencesOptions): TablePreferencesResult {
  const storageKey = tablePreferencesStorageKey(tableId);
  const columnsKey = preferenceColumnsKey(columns);
  const stableColumnsRef = useRef({ key: columnsKey, columns });
  if (stableColumnsRef.current.key !== columnsKey) {
    stableColumnsRef.current = { key: columnsKey, columns };
  }
  const preferenceColumns = stableColumnsRef.current.columns;
  const defaults = useMemo(
    () => defaultColumnVisibility(preferenceColumns),
    [preferenceColumns],
  );
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => readPreferences(storageKey, preferenceColumns),
  );

  useEffect(() => {
    setColumnVisibility(readPreferences(storageKey, preferenceColumns));
  }, [storageKey, preferenceColumns]);

  useEffect(() => {
    try {
      if (visibilityEquals(columnVisibility, defaults)) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          version: STORAGE_VERSION,
          columnVisibility,
        }),
      );
    } catch {
      // Storage may be unavailable or full; in-memory preferences still work.
    }
  }, [columnVisibility, defaults, storageKey]);

  const onColumnVisibilityChange = useCallback<OnChangeFn<VisibilityState>>(
    updater => {
      setColumnVisibility(current =>
        resolveColumnVisibility(
          preferenceColumns,
          typeof updater === 'function' ? updater(current) : updater,
        ),
      );
    },
    [preferenceColumns],
  );

  const resetColumnVisibility = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Storage may be unavailable; resetting in-memory state is sufficient.
    }
    setColumnVisibility(defaults);
  }, [defaults, storageKey]);

  return {
    columnVisibility,
    onColumnVisibilityChange,
    resetColumnVisibility,
  };
}
