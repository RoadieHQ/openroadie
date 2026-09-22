import { act, renderHook, waitFor } from '@testing-library/react';
import {
  tablePreferencesStorageKey,
  useTablePreferences,
  type TablePreferenceColumn,
} from './use-table-preferences';

const COLUMNS: TablePreferenceColumn[] = [
  { id: 'name', enableHiding: false },
  { id: 'status' },
  { id: 'updated', defaultVisible: false },
];

describe('useTablePreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts from the configured default column visibility', () => {
    const { result } = renderHook(() =>
      useTablePreferences({ tableId: 'widgets', columns: COLUMNS }),
    );

    expect(result.current.columnVisibility).toEqual({ updated: false });
  });

  it('drops stale, fixed-column, and malformed stored values', () => {
    localStorage.setItem(
      tablePreferencesStorageKey('widgets'),
      JSON.stringify({
        version: 1,
        columnVisibility: {
          name: false,
          status: false,
          stale: false,
          updated: 'hidden',
        },
      }),
    );

    const { result } = renderHook(() =>
      useTablePreferences({ tableId: 'widgets', columns: COLUMNS }),
    );

    expect(result.current.columnVisibility).toEqual({
      status: false,
      updated: false,
    });
  });

  it('persists visibility changes and resets to current defaults', async () => {
    const { result } = renderHook(() =>
      useTablePreferences({ tableId: 'widgets', columns: COLUMNS }),
    );

    act(() => {
      result.current.onColumnVisibilityChange(current => ({
        ...current,
        status: false,
        updated: true,
      }));
    });

    expect(result.current.columnVisibility).toEqual({
      status: false,
      updated: true,
    });
    await waitFor(() => {
      expect(
        JSON.parse(
          localStorage.getItem(tablePreferencesStorageKey('widgets')) ?? '',
        ),
      ).toEqual({
        version: 1,
        columnVisibility: { status: false, updated: true },
      });
    });

    act(() => result.current.resetColumnVisibility());

    expect(result.current.columnVisibility).toEqual({ updated: false });
    expect(
      localStorage.getItem(tablePreferencesStorageKey('widgets')),
    ).toBeNull();
  });

  it('preserves state when equivalent column descriptors get a new identity', () => {
    const { result, rerender } = renderHook(() =>
      useTablePreferences({
        tableId: 'widgets',
        columns: COLUMNS.map(column => ({ ...column })),
      }),
    );

    act(() => {
      result.current.onColumnVisibilityChange({ status: false });
    });
    rerender();

    expect(result.current.columnVisibility).toEqual({
      status: false,
      updated: false,
    });
  });
});
