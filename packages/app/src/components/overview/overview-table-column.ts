import { createElement, type ReactNode } from 'react';
import {
  type ColumnDef,
  type FilterFn,
  type ColumnHelper,
  type HeaderContext,
} from '@tanstack/react-table';
import type { ColumnConfig, TableFilterConfig } from './overview-config';
import { compoundTableFilterValue } from './overview-config';
import { OverviewColumnHeader } from './overview-column-header';

/**
 * Inputs the header menu needs, carried on the column `meta` so the compiled
 * `header` can be a single stable component (see {@link OverviewColumnHeaderCell}).
 */
interface OverviewHeaderRender<T> {
  title: ColumnConfig<T>['header'];
  filter?: TableFilterConfig<T>;
  align?: 'left' | 'center' | 'right';
}

/**
 * Layout hints a {@link ColumnConfig} contributes to its compiled
 * `ColumnDef`. Read by `OverviewTable` when rendering `<th>` / `<td>` so the
 * app-level config drives sizing/alignment without the table knowing per-column
 * details.
 */
export interface OverviewColumnMeta<T = unknown> {
  label?: string;
  defaultVisible?: boolean;
  width?: string;
  headClassName?: string;
  cellClassName?: string;
  align?: 'left' | 'center' | 'right';
  /** Header-menu inputs, read by the stable header component. */
  headerRender?: OverviewHeaderRender<T>;
}

/**
 * The compiled `header` for every actionable column. Kept as ONE stable
 * component (not a per-column closure) because TanStack's `flexRender` uses the
 * `columnDef.header` value itself as the React component type — a fresh closure
 * on each `columns` rebuild would change that type and remount the header,
 * destroying any open sort/filter dropdown mid-interaction. All per-column data
 * is read from `meta.headerRender` at render time, so rebuilding `columns`
 * updates the content without remounting.
 */
function OverviewColumnHeaderCell<T>({
  column,
}: HeaderContext<T, unknown>): ReactNode {
  const meta = column.columnDef.meta as OverviewColumnMeta<T> | undefined;
  const render = meta?.headerRender;
  if (!render) return null;
  const sorted = column.getIsSorted();
  const title =
    typeof render.title === 'function'
      ? render.title({ sorted })
      : render.title;
  return createElement(OverviewColumnHeader<T>, {
    column,
    title,
    label: meta?.label ?? column.id,
    filter: render.filter,
    align: render.align,
  });
}

function columnFilterFn<T>(config: ColumnConfig<T>): FilterFn<T> | undefined {
  const filter = config.filter;
  if (!filter) return undefined;

  return (row, _columnId, value) => {
    if (!Array.isArray(value)) return true;
    const selected = value.filter(
      (item): item is string => typeof item === 'string',
    );
    if (selected.length === 0) return true;
    if (filter.kind === 'enum') {
      if (filter.matches) {
        return filter.matches(row.original, selected);
      }
      return selected.includes(filter.value(row.original));
    }
    if (filter.kind === 'boolean') {
      return selected.includes(String(filter.value(row.original)));
    }
    if (filter.kind === 'range') {
      const option = filter.options.find(item => item.value === selected[0]);
      if (!option) return true;
      const candidate = filter.value(row.original);
      if (candidate === undefined) {
        return option.missing === 'include' || option.missing === 'only';
      }
      if (option.missing === 'only') return false;
      const min = typeof option.min === 'function' ? option.min() : option.min;
      const max = typeof option.max === 'function' ? option.max() : option.max;
      return (
        (min === undefined || candidate >= min) &&
        (max === undefined || candidate <= max)
      );
    }
    if (filter.kind === 'compound') {
      return filter.sections.every(section => {
        const selectedOptions = section.options.filter(option =>
          selected.includes(compoundTableFilterValue(section.id, option.value)),
        );
        return (
          selectedOptions.length === 0 ||
          selectedOptions.some(option => option.matches(row.original))
        );
      });
    }
    return true;
  };
}

/**
 * Compile an app-level {@link ColumnConfig} into a TanStack `ColumnDef<T>`.
 *
 * - Actionable columns render one header menu for sorting, filtering, and
 *   visibility; inert columns render their raw `header`.
 * - A custom `sortingFn(a, b)` over row originals takes precedence; otherwise
 *   `accessor` feeds `accessorFn` and TanStack's default comparator.
 * - `width` / `headClassName` / `cellClassName` / `align` are surfaced via
 *   `meta` for the table to apply to `<th>` / `<td>`.
 */
export function toColumnDef<T>(
  config: ColumnConfig<T>,
  helper: ColumnHelper<T>,
): ColumnDef<T, unknown> {
  const filterFn = columnFilterFn(config);
  const meta: OverviewColumnMeta<T> = {
    label:
      config.label ??
      (typeof config.header === 'string' ? config.header : config.id),
    defaultVisible: config.defaultVisible,
    width: config.width,
    headClassName: config.headClassName,
    cellClassName: config.cellClassName,
    align: config.align,
    // Header-menu inputs travel on `meta`; the compiled `header` is the shared
    // stable component so a `columns` rebuild never remounts the header.
    headerRender: {
      title: config.header,
      filter: config.filter,
      align: config.align,
    },
  };

  const header = OverviewColumnHeaderCell<T>;

  const cell = ({ row }: { row: { original: T } }): ReactNode =>
    config.cell(row.original);

  // Custom comparator over originals wins; else default sort off the accessor.
  if (config.sortingFn) {
    const sortingFn = config.sortingFn;
    return helper.accessor(row => config.accessor?.(row) ?? null, {
      id: config.id,
      header,
      cell,
      enableSorting: config.sortable ?? false,
      enableHiding: config.enableHiding ?? false,
      enableGlobalFilter: config.searchable ?? false,
      enableColumnFilter: config.filter !== undefined,
      filterFn,
      sortingFn: (rowA, rowB) => sortingFn(rowA.original, rowB.original),
      meta,
    }) as ColumnDef<T, unknown>;
  }

  if (config.accessor) {
    const accessor = config.accessor;
    return helper.accessor(row => accessor(row), {
      id: config.id,
      header,
      cell,
      enableSorting: config.sortable ?? false,
      enableHiding: config.enableHiding ?? false,
      enableGlobalFilter: config.searchable ?? false,
      enableColumnFilter: config.filter !== undefined,
      filterFn,
      meta,
    }) as ColumnDef<T, unknown>;
  }

  return helper.display({
    id: config.id,
    header,
    cell,
    enableSorting: config.sortable ?? false,
    enableHiding: config.enableHiding ?? false,
    enableGlobalFilter: config.searchable ?? false,
    enableColumnFilter: config.filter !== undefined,
    filterFn,
    meta,
  }) as ColumnDef<T, unknown>;
}
