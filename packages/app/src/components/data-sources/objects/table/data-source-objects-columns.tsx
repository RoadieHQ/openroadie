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

import { createColumnHelper } from '@tanstack/react-table';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import { OverviewTitleCell } from '../../../overview';
import type { IndexConfiguration } from '../../../../api/datastore/datastore-client';
import type { DataSourceItem } from '../../types';
import { contextGroupInstance, objectDetail } from '../../../../config/paths';
import type { DataSourceObjectRow } from '../use-data-source-objects';
import { resolveObjectDisplayName } from '../resolve-object-display-name';
import {
  columnHeaderLabelFromKey,
  isIndexTableColumn,
} from '../resolve-presentation-field-names';
import { CellTooltip } from './cell-tooltip';
import { ColumnHeader } from './column-header';
import { ContextGroupsCell } from './context-groups-cell';

const columnHelper = createColumnHelper<DataSourceObjectRow>();

/** Pseudo index key the backend accepts for filtering by context-group title. */
export const CONTEXT_GROUP_FILTER_KEY = 'contextGroupTitle';

export interface DataSourceObjectsColumnsOptions {
  /** Selected data source; the filter typeahead fetches its candidate values. */
  datasourceId: string;
  /** Cross-source view: adds the Data source column, no index columns. */
  allMode: boolean;
  dataSources: DataSourceItem[];
  indexes: IndexConfiguration[];
  /** Search results are relevance-ranked, so sorting and filtering are off. */
  searchActive: boolean;
  filters: Map<string, string>;
  onSetFilter: (key: string, value: string) => void;
  /** Header labels, resolved once per page by resolvePresentationColumnLabels. */
  titleLabel: string;
  subtitleLabel: string;
  /** Row id -> that row's subtitle field name, for the cell tooltip/pill. */
  subtitleFieldNamesByRow: Map<string, string | undefined>;
  titleIndex: IndexConfiguration | undefined;
  subtitleIndex: IndexConfiguration | undefined;
}

/**
 * Column definitions for the datastore objects table — the counterpart to the
 * other listings' `*-columns.tsx`, though these are TanStack `ColumnDef`s rather
 * than `OverviewTable` `ColumnConfig`s because this table is bespoke.
 *
 * Pure: every input arrives through {@link DataSourceObjectsColumnsOptions}, so
 * the caller owns the memoization. The return type is deliberately inferred —
 * the array mixes accessor and display columns with different value types, and
 * annotating it would need an `any` in the ColumnDef generics.
 */
export function dataSourceObjectsColumns({
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
}: DataSourceObjectsColumnsOptions) {
  return [
    columnHelper.display({
      id: 'expand',
      enableHiding: false,
      enableResizing: false,
      // A `th` with no accessible text is an axe `empty-table-header`
      // violation, and a screen reader reading the row would announce the
      // chevron cell against nothing. The column is unlabelled visually, so
      // the name is sr-only.
      header: () => <span className="sr-only">Expand</span>,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground"
          aria-expanded={row.getIsExpanded()}
          aria-label={row.getIsExpanded() ? 'Collapse object' : 'Expand object'}
          onClick={row.getToggleExpandedHandler()}
        >
          {row.getIsExpanded() ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </Button>
      ),
    }),
    columnHelper.accessor(
      row =>
        resolveObjectDisplayName(row.object, row.objectId, row.presentation),
      {
        id: 'title',
        enableSorting: !searchActive,
        enableHiding: false,
        minSize: 180,
        header: ({ column }) => (
          <ColumnHeader
            label={titleLabel}
            fieldName={undefined}
            sortable={!searchActive}
            isSorted={column.getIsSorted()}
            onSort={descending => column.toggleSorting(descending)}
            onClearSort={() => column.clearSorting()}
            hideable={column.getCanHide()}
            onHide={() => column.toggleVisibility(false)}
            filterable={Boolean(titleIndex) && !searchActive}
            filterValue={titleIndex ? filters.get(titleIndex.key) : undefined}
            onFilterChange={next => {
              if (titleIndex) {
                onSetFilter(titleIndex.key, next);
              }
            }}
            datasourceId={datasourceId}
            indexKey={titleIndex?.key}
          />
        ),
        cell: ({ row, getValue }) => {
          const title = getValue();
          const { objectId, contextGroup } = row.original;
          return (
            <div className="flex min-w-0 flex-col">
              <CellTooltip label={title}>
                <OverviewTitleCell
                  to={
                    contextGroup
                      ? contextGroupInstance(objectId)
                      : objectDetail(row.original.datasourceId, objectId)
                  }
                  className="motion-colors inline-block max-w-full text-sm hover:text-primary"
                >
                  {title}
                </OverviewTitleCell>
              </CellTooltip>
              {contextGroup ? (
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {contextGroup.memberCount} record
                  {contextGroup.memberCount === 1 ? '' : 's'}
                </span>
              ) : (
                title !== objectId && (
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {objectId}
                  </span>
                )
              )}
            </div>
          );
        },
      },
    ),
    columnHelper.accessor(row => row.presentation?.subtitle, {
      id: 'subtitle',
      enableSorting: Boolean(subtitleIndex) && !searchActive,
      enableHiding: false,
      minSize: 120,
      header: ({ column }) => (
        <ColumnHeader
          label={subtitleLabel}
          fieldName={undefined}
          sortable={Boolean(subtitleIndex) && !searchActive}
          isSorted={column.getIsSorted()}
          onSort={descending => column.toggleSorting(descending)}
          onClearSort={() => column.clearSorting()}
          hideable={column.getCanHide()}
          onHide={() => column.toggleVisibility(false)}
          filterable={Boolean(subtitleIndex) && !searchActive}
          filterValue={
            subtitleIndex ? filters.get(subtitleIndex.key) : undefined
          }
          onFilterChange={next => {
            if (subtitleIndex) {
              onSetFilter(subtitleIndex.key, next);
            }
          }}
          datasourceId={datasourceId}
          indexKey={subtitleIndex?.key}
        />
      ),
      cell: ({ row, getValue }) => {
        const subtitle = getValue();
        if (!subtitle) {
          return <span className="text-muted-foreground">—</span>;
        }
        const inferredFieldName = subtitleFieldNamesByRow.get(row.original.id);
        const tooltipLabel = inferredFieldName
          ? `${inferredFieldName}: ${subtitle}`
          : subtitle;
        return allMode ? (
          <CellTooltip label={tooltipLabel}>
            <Badge
              variant="outlineMuted"
              className="inline-flex h-auto max-w-full min-w-0 items-center gap-1 self-start rounded-full px-2 py-0.5 text-2xs font-normal"
            >
              {inferredFieldName ? (
                <span className="shrink-0 font-medium text-foreground/70">
                  {inferredFieldName}:
                </span>
              ) : null}
              <span className="min-w-0 truncate text-muted-foreground">
                {subtitle}
              </span>
            </Badge>
          </CellTooltip>
        ) : (
          <CellTooltip label={subtitle}>
            <span className="block min-w-0 truncate text-sm text-foreground">
              {subtitle}
            </span>
          </CellTooltip>
        );
      },
    }),
    // In All mode each row names its origin; there is no common index schema
    // across data sources, so the id-derived value columns don't apply.
    ...(allMode
      ? [
          columnHelper.accessor(row => row.datasourceId, {
            id: 'dataSource',
            enableSorting: !searchActive,
            enableHiding: false,
            minSize: 140,
            header: ({ column }) => (
              <ColumnHeader
                label="Data source"
                sortable={!searchActive}
                isSorted={column.getIsSorted()}
                onSort={descending => column.toggleSorting(descending)}
                onClearSort={() => column.clearSorting()}
                hideable={column.getCanHide()}
                onHide={() => column.toggleVisibility(false)}
                filterable={false}
                filterValue={undefined}
                onFilterChange={() => {}}
              />
            ),
            cell: ({ row, getValue }) => {
              const id = getValue();
              // A group row's origin is its rule, shown where an object row
              // shows its data source.
              const name =
                row.original.contextGroup?.ruleName ??
                dataSources.find(ds => ds.id === id)?.name;
              return name ? (
                <CellTooltip label={name}>
                  <span className="block truncate text-foreground">{name}</span>
                </CellTooltip>
              ) : (
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {id}
                </span>
              );
            },
          }),
        ]
      : []),
    columnHelper.accessor(row => row.contextGroups ?? [], {
      id: 'contextGroups',
      enableSorting: !searchActive,
      enableHiding: false,
      minSize: 180,
      header: ({ column }) => (
        <ColumnHeader
          label="Context groups"
          sortable={!searchActive}
          isSorted={column.getIsSorted()}
          onSort={descending => column.toggleSorting(descending)}
          onClearSort={() => column.clearSorting()}
          hideable={column.getCanHide()}
          onHide={() => column.toggleVisibility(false)}
          filterable={!allMode && !searchActive}
          filterValue={filters.get(CONTEXT_GROUP_FILTER_KEY)}
          onFilterChange={next => onSetFilter(CONTEXT_GROUP_FILTER_KEY, next)}
          datasourceId={datasourceId}
          indexKey={CONTEXT_GROUP_FILTER_KEY}
          useContextGroupSuggestions
        />
      ),
      cell: ({ getValue }) => <ContextGroupsCell groups={getValue()} />,
    }),
    columnHelper.accessor('relationshipCount', {
      id: 'relationshipCount',
      enableSorting: !searchActive,
      enableHiding: false,
      minSize: 96,
      header: ({ column }) => (
        <ColumnHeader
          label="Relationships"
          sortable={!searchActive}
          isSorted={column.getIsSorted()}
          onSort={descending => column.toggleSorting(descending)}
          onClearSort={() => column.clearSorting()}
          hideable={column.getCanHide()}
          onHide={() => column.toggleVisibility(false)}
          filterable={false}
          filterValue={undefined}
          onFilterChange={() => {}}
        />
      ),
      cell: ({ row, getValue }) => {
        // Group rows aggregate objects; a relationship count doesn't apply.
        if (row.original.contextGroup) {
          return '—';
        }
        const value = getValue();
        if (typeof value === 'number') {
          return value;
        }
        // Full-text search does not compute relationship counts.
        return searchActive ? '—' : 0;
      },
    }),
    // `createdAt` / `updatedAt` are intentionally not columns — they live in
    // the expanded detail panel to keep the row scannable.
    // One column per index, skipping built-in identifier keys and presentation
    // fields already shown as Title / Secondary. The All view spans sources
    // with no shared schema, so it never renders index columns even if stale
    // ones are still in state for a render.
    ...(allMode ? [] : indexes).filter(isIndexTableColumn).map(index =>
      columnHelper.accessor(row => row.indexValues.get(index.key), {
        id: index.key,
        enableSorting: !searchActive,
        minSize: 120,
        header: ({ column }) => (
          <ColumnHeader
            label={columnHeaderLabelFromKey(index.key)}
            sortable={!searchActive}
            isSorted={column.getIsSorted()}
            onSort={descending => column.toggleSorting(descending)}
            onClearSort={() => column.clearSorting()}
            hideable={column.getCanHide()}
            onHide={() => column.toggleVisibility(false)}
            filterable={!searchActive}
            filterValue={filters.get(index.key)}
            onFilterChange={next => onSetFilter(index.key, next)}
            datasourceId={datasourceId}
            indexKey={index.key}
          />
        ),
        cell: ({ getValue }) => {
          const value = getValue();
          return value !== undefined ? (
            <span className="break-all text-foreground">{value}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      }),
    ),
  ];
}
