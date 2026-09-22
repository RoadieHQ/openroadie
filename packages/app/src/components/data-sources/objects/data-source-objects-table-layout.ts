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

/**
 * Column sizing for the data source objects table. Built-in columns take fixed
 * widths; index columns (any other id) share the remaining space and the table
 * scrolls horizontally once there are many of them.
 */

function isCompactIdentifierColumn(columnId: string): boolean {
  const normalized = columnId.trim();
  return (
    normalized === 'id' ||
    normalized === 'key' ||
    normalized === 'slug' ||
    normalized.endsWith('Id') ||
    normalized.endsWith('_id')
  );
}

export function dataSourceObjectsTableElementClassName(): string {
  return 'w-full min-w-[32rem] caption-bottom text-sm table-fixed';
}

export function dataSourceObjectsColumnHeadClass(
  columnId: string,
  {
    hasIndexColumns,
    hasDataSourceColumn = false,
  }: { hasIndexColumns: boolean; hasDataSourceColumn?: boolean },
): string {
  switch (columnId) {
    case 'expand':
      return 'w-8 shrink-0 p-0 pl-1';
    case 'title':
      // Cap the title whenever another flexible column needs the slack (index
      // columns, or the Data source column in the All view); otherwise it is
      // the primary flexible column and `table-fixed` hands it remaining width.
      if (hasDataSourceColumn) {
        return 'w-[26%] min-w-0 max-w-[26%] pl-1 sm:pl-2';
      }
      return hasIndexColumns
        ? 'w-[32%] min-w-0 max-w-[32%] pl-1 sm:pl-2'
        : 'min-w-0 pl-1 sm:pl-2';
    case 'subtitle':
      return hasDataSourceColumn
        ? 'w-[11rem] min-w-[9rem] max-w-[11rem]'
        : 'w-[14rem] min-w-[10rem] max-w-[14rem]';
    case 'dataSource':
      return 'w-[13rem] min-w-[11rem] max-w-[13rem]';
    case 'contextGroups':
      return 'w-[16rem] min-w-[12rem] max-w-[16rem]';
    case 'relationshipCount':
      return hasDataSourceColumn
        ? 'w-[10rem] min-w-[10rem] max-w-[10rem] shrink-0 text-left'
        : 'w-36 min-w-[9rem] max-w-[9rem] text-left';
    default:
      if (isCompactIdentifierColumn(columnId)) {
        return 'w-[8.5rem] min-w-[8.5rem]';
      }
      return 'min-w-[10rem]';
  }
}

/** Built-in columns, in render order, for each of the two view modes. */
const SINGLE_SOURCE_COLUMN_IDS = [
  'expand',
  'title',
  'subtitle',
  'contextGroups',
  'relationshipCount',
];
const CROSS_SOURCE_COLUMN_IDS = [
  'expand',
  'title',
  'subtitle',
  'dataSource',
  'contextGroups',
  'relationshipCount',
];

/**
 * Widths for the route-level Suspense skeleton, taken from the same class
 * strings the live header uses so the two line up.
 *
 * Built-in columns only: index columns depend on the data source's index
 * configurations, which aren't known until after the page's chunk has loaded and
 * fetched them, so the skeleton can't anticipate them.
 */
export function dataSourceObjectsColumnWidths(crossSource: boolean): string[] {
  const columnIds = crossSource
    ? CROSS_SOURCE_COLUMN_IDS
    : SINGLE_SOURCE_COLUMN_IDS;
  return columnIds.map(columnId =>
    dataSourceObjectsColumnHeadClass(columnId, {
      hasIndexColumns: false,
      hasDataSourceColumn: crossSource,
    }),
  );
}

export function dataSourceObjectsColumnCellClass(
  columnId: string,
  { hasDataSourceColumn = false }: { hasDataSourceColumn?: boolean } = {},
): string {
  switch (columnId) {
    case 'expand':
      return 'w-8 shrink-0 p-0 pl-1 align-middle';
    case 'title':
      return 'min-w-0 max-w-full overflow-hidden pl-1 sm:pl-2 align-middle';
    case 'subtitle':
      return hasDataSourceColumn
        ? 'min-w-0 max-w-[11rem] overflow-hidden align-middle'
        : 'min-w-0 max-w-[14rem] overflow-hidden align-middle';
    case 'dataSource':
      return 'min-w-0 max-w-full overflow-hidden align-middle';
    case 'contextGroups':
      return 'min-w-0 max-w-full overflow-hidden align-middle';
    case 'relationshipCount':
      return 'overflow-hidden text-left align-middle tabular-nums';
    default:
      if (isCompactIdentifierColumn(columnId)) {
        return 'align-middle font-mono tabular-nums';
      }
      return 'align-middle';
  }
}
