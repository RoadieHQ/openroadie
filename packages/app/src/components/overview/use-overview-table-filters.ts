import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  functionalUpdate,
  type ColumnFiltersState,
  type OnChangeFn,
} from '@tanstack/react-table';
import type { ColumnConfig } from './overview-config';
import { compoundTableFilterValue } from './overview-config';

const FILTER_PARAM_PREFIX = 'filter.';

function filterParam<T>(column: ColumnConfig<T>): string {
  return column.filter?.urlParam ?? `${FILTER_PARAM_PREFIX}${column.id}`;
}

function allowedFilterValues<T>(column: ColumnConfig<T>): Set<string> {
  const filter = column.filter;
  if (!filter) return new Set();
  if (filter.kind === 'enum' || filter.kind === 'range') {
    return new Set(filter.options.map(option => option.value));
  }
  if (filter.kind === 'compound') {
    return new Set(
      filter.sections.flatMap(section =>
        section.options.map(option =>
          compoundTableFilterValue(section.id, option.value),
        ),
      ),
    );
  }
  return new Set(['true', 'false']);
}

export function useOverviewTableFilters<T>(columns: ColumnConfig<T>[]): {
  columnFilters: ColumnFiltersState;
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>;
} {
  const [searchParams, setSearchParams] = useSearchParams();

  const filterableColumns = useMemo(
    () => columns.filter(column => column.filter !== undefined),
    [columns],
  );

  const columnFilters = useMemo<ColumnFiltersState>(
    () =>
      filterableColumns.flatMap(column => {
        const filter = column.filter;
        if (!filter) return [];

        const allowed = allowedFilterValues(column);
        const values = searchParams
          .getAll(filterParam(column))
          .filter(value => allowed.has(value));
        return values.length > 0 ? [{ id: column.id, value: values }] : [];
      }),
    [filterableColumns, searchParams],
  );

  const onColumnFiltersChange = useCallback<OnChangeFn<ColumnFiltersState>>(
    updater => {
      const nextFilters = functionalUpdate(updater, columnFilters);

      setSearchParams(
        current => {
          const next = new URLSearchParams(current);
          filterableColumns.forEach(column => next.delete(filterParam(column)));

          nextFilters.forEach(({ id, value }) => {
            const column = filterableColumns.find(
              candidate => candidate.id === id,
            );
            const filter = column?.filter;
            if (!filter || !Array.isArray(value)) {
              return;
            }

            const allowed = allowedFilterValues(column);
            const values = value.filter(
              (item): item is string =>
                typeof item === 'string' && allowed.has(item),
            );
            const selected =
              filter.kind === 'compound' ||
              (filter.kind === 'enum' && filter.multiple)
                ? values
                : values.slice(-1);
            selected.forEach(item => next.append(filterParam(column), item));
          });

          return next;
        },
        { replace: true },
      );
    },
    [columnFilters, filterableColumns, setSearchParams],
  );

  return { columnFilters, onColumnFiltersChange };
}
