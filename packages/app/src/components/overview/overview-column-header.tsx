import type { ReactNode } from 'react';
import type { Column } from '@tanstack/react-table';
import { TableColumnHeaderMenu } from '../common';
import { ColumnFilterFacet } from './column-filter-facet';
import type { TableFilterConfig } from './overview-config';

interface OverviewColumnHeaderProps<T> {
  column: Column<T, unknown>;
  title: ReactNode;
  label: string;
  filter?: TableFilterConfig<T>;
  align?: 'left' | 'center' | 'right';
}

function selectedValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * The one column header: a single combined popover (`TableColumnHeaderMenu`)
 * holding sort, an inline filter facet ({@link ColumnFilterFacet} → the shared
 * searchable `FacetList` used by the relationships-editor header facets), and
 * hide.
 */
export function OverviewColumnHeader<T>({
  column,
  title,
  label,
  filter,
  align,
}: OverviewColumnHeaderProps<T>): JSX.Element {
  const canSort = column.getCanSort();
  const canFilter = column.getCanFilter() && filter !== undefined;
  // Only offer "Hide column" when the author opted in via `enableHiding`, which
  // is paired with the column-display (`⊞`) toggle that can restore it — so a
  // header never strands a column with no way back.
  const canHide = column.getCanHide();

  if (!canSort && !canFilter && !canHide) {
    return <>{title}</>;
  }

  const selected = selectedValues(column.getFilterValue());

  return (
    <TableColumnHeaderMenu
      title={title}
      label={label}
      align={align}
      sorted={canSort ? column.getIsSorted() : false}
      onSort={
        canSort ? descending => column.toggleSorting(descending) : undefined
      }
      onClearSort={canSort ? () => column.clearSorting() : undefined}
      filtered={canFilter ? column.getIsFiltered() : false}
      filterContent={
        canFilter && filter ? (
          <ColumnFilterFacet
            filter={filter}
            selected={selected}
            onChange={next =>
              column.setFilterValue(next.length > 0 ? next : undefined)
            }
          />
        ) : undefined
      }
      onHide={canHide ? () => column.toggleVisibility(false) : undefined}
    />
  );
}
