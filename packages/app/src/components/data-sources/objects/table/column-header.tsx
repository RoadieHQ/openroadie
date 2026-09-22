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

import { TableColumnHeaderMenu } from '../../../common';
import { ColumnFilterPopover } from './column-filter-popover';

/**
 * The shared header menu is sized for the listing tables (`px-3` gutters). This
 * table is denser — its cells are `p-2` — so the trigger's padding comes down to
 * match, which also keeps its hover background inside the column rather than
 * overhanging the neighbour. `sm:-ml-2` is needed to beat the shared token's
 * `sm:-ml-3`, which would otherwise win at that breakpoint.
 */
const DENSE_HEADER_TRIGGER = '-ml-2 px-2 sm:-ml-2';

/**
 * A header with no controls at all still has to look like its neighbours: the
 * menu trigger is a `size="sm"` Button, so its label renders `text-xs` in a 32px
 * box while a bare label would inherit the `th`'s `text-sm` in an 18px one.
 */
const DATASTORE_TABLE_HEADER_LABEL =
  'flex h-8 min-w-0 items-center pr-1 text-xs';

function ColumnHeaderLabel({
  label,
  fieldName,
}: {
  label: string;
  fieldName?: string;
}) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="truncate">{label}</span>
      {fieldName ? (
        <span className="truncate font-mono text-2xs font-normal text-muted-foreground">
          · {fieldName}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Header for one column: the shared column-header menu (sort, and hide where
 * the column allows it) plus, when the column is filterable, this table's own
 * filter popover beside it.
 *
 * The filter deliberately stays outside the menu, where the listing tables put
 * theirs. Their `ColumnFilterFacet` filters a static option list client-side;
 * index values here are unbounded, so the filter is a server-backed typeahead
 * (`/indexes/:datasourceId/:key/values?q=`) that can't be expressed as a facet.
 * Sharing the menu still gets the parts that were drifting — trigger metrics,
 * hover treatment, and a "Clear sorting" row the local toggle never had.
 */
export function ColumnHeader({
  label,
  fieldName,
  sortable,
  isSorted,
  onSort,
  onClearSort,
  hideable = false,
  onHide,
  filterable,
  filterValue,
  onFilterChange,
  datasourceId,
  indexKey,
  useContextGroupSuggestions = false,
}: {
  label: string;
  /** Optional source field shown beside the role label (e.g. title → `title`). */
  fieldName?: string;
  sortable: boolean;
  isSorted: false | 'asc' | 'desc';
  onSort: (descending: boolean) => void;
  onClearSort: () => void;
  /** Index columns can be hidden from the header; built-in columns cannot. */
  hideable?: boolean;
  onHide?: () => void;
  filterable: boolean;
  filterValue: string | undefined;
  onFilterChange: (next: string) => void;
  /** Required when {@link filterable} is true so the typeahead can fetch values. */
  datasourceId?: string;
  /** Index key passed through to the filter popover. */
  indexKey?: string;
  useContextGroupSuggestions?: boolean;
}) {
  const canHide = hideable && onHide !== undefined;
  const hasFilter = filterable && !!datasourceId && !!indexKey;

  if (!sortable && !canHide && !hasFilter) {
    return (
      <span className={DATASTORE_TABLE_HEADER_LABEL}>
        <ColumnHeaderLabel label={label} fieldName={fieldName} />
      </span>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {sortable || canHide ? (
        <TableColumnHeaderMenu
          title={<ColumnHeaderLabel label={label} fieldName={fieldName} />}
          label={fieldName ? `${label} · ${fieldName}` : label}
          className={DENSE_HEADER_TRIGGER}
          sorted={sortable ? isSorted : false}
          onSort={sortable ? onSort : undefined}
          onClearSort={sortable ? onClearSort : undefined}
          onHide={canHide ? onHide : undefined}
        />
      ) : (
        <span className={DATASTORE_TABLE_HEADER_LABEL}>
          <ColumnHeaderLabel label={label} fieldName={fieldName} />
        </span>
      )}
      {hasFilter ? (
        <ColumnFilterPopover
          label={fieldName ? `${label} (${fieldName})` : label}
          value={filterValue}
          onChange={onFilterChange}
          datasourceId={datasourceId}
          indexKey={indexKey}
          useContextGroupSuggestions={useContextGroupSuggestions}
        />
      ) : null}
    </div>
  );
}
