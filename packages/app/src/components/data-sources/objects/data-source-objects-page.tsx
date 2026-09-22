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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type {
  OnChangeFn,
  PaginationState,
  SortingState,
} from '@tanstack/react-table';
import { Box, Plus, Share2, Users, Waypoints, X } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { useDatastore } from '../../../api';
import { contextGroupRulesQuery } from '../../../api/queries';
import { dataSourcesNewDialog } from '../../../config/paths';
import { OverviewListingStandaloneBody, useDetailDrawer } from '../../common';
import {
  GhostTablePreview,
  ghostSettleAt,
  OverviewEmptyPreview,
  type GhostRow,
} from '../../overview';
import { useDataSources } from '../use-data-sources';
import { ColumnVisibilityPicker } from './column-visibility-picker';
import { ContextGroupInstanceDrawer } from './context-group-instance-drawer';
import { isContextGroupScopeId } from './context-group-scope';
import { DataSourceContextHeader } from './data-source-context-header';
import { DataSourceObjectsTable } from './data-source-objects-table';
import { readDatastoreScopeFromParams } from './datastore-scope-param';
import {
  datastoreSortParam,
  readDatastoreSortFromParams,
} from './datastore-sort-param';
import { DatastoreViewHeader } from './datastore-view-header';
import { ObjectDetailDrawer } from './object-detail-drawer';
import {
  objectDrawerParam,
  parseObjectDrawerParam,
} from './object-drawer-param';
import { isIndexTableColumn } from './resolve-presentation-field-names';
import {
  ALL_DATA_SOURCES_ID,
  useDataSourceObjects,
  type DataSourceObjectRow,
} from './use-data-source-objects';
import { useObjectColumnVisibility } from './use-object-column-visibility';
import {
  readStoredDatastoreSearch,
  usePersistedDatastoreViewParams,
} from './use-persisted-view-param';

const FILTER_PARAM_PREFIX = 'filter.';

const GHOST_HEADERS = ['Title', 'Data source', 'Relationships'];
const GHOST_COLUMNS = '2.5rem minmax(0,1fr) 9rem 7.5rem';
const GHOST_ROWS: GhostRow[] = [
  [
    { kind: 'icon', icon: Box },
    { kind: 'title', text: 'payments-service' },
    { kind: 'badge', text: 'GitHub Repos' },
    { kind: 'text', text: '12 links' },
  ],
  [
    { kind: 'icon', icon: Box },
    { kind: 'title', text: 'Platform Team' },
    { kind: 'badge', text: 'Teams' },
    { kind: 'text', text: '8 links' },
  ],
  [
    { kind: 'icon', icon: Box },
    { kind: 'title', text: 'checkout-latency-142' },
    { kind: 'badge', text: 'PagerDuty' },
    { kind: 'text', text: '3 links' },
  ],
];

/** Parse `filter.<key>=<value>` query params into a Map of active filters. */
function readFiltersFromParams(params: URLSearchParams): Map<string, string> {
  const next = new Map<string, string>();
  params.forEach((value, key) => {
    if (key.startsWith(FILTER_PARAM_PREFIX) && value) {
      next.set(key.slice(FILTER_PARAM_PREFIX.length), value);
    }
  });
  return next;
}

/** Stable identity for URL-driven list inputs that should reset pagination. */
function listResultKey(
  scopedDataSourceIds: string[],
  filters: Map<string, string>,
  sorting: SortingState,
  search: string,
): string {
  const filterParts = Array.from(filters.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`);
  return [
    scopedDataSourceIds.join(','),
    filterParts.join('|'),
    datastoreSortParam(sorting) ?? '',
    search,
  ].join('\0');
}

const DEFAULT_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

function resolveObjectDrawerIds(
  openObjectId: string,
  rows: DataSourceObjectRow[],
  pageDatasourceId: string | undefined,
  allMode: boolean,
): { datasourceId: string; objectId: string } | undefined {
  const row = rows.find(
    item =>
      item.id === openObjectId ||
      objectDrawerParam(item.datasourceId, item.objectId) === openObjectId,
  );
  if (row) {
    return { datasourceId: row.datasourceId, objectId: row.objectId };
  }

  const parsed = parseObjectDrawerParam(openObjectId);
  if (parsed) return parsed;

  if (!allMode && pageDatasourceId) {
    return { datasourceId: pageDatasourceId, objectId: openObjectId };
  }

  return undefined;
}

/** Drop every `filter.*` entry from a URLSearchParams (mutates). */
function stripFilterParams(params: URLSearchParams) {
  Array.from(params.keys())
    .filter(key => key.startsWith(FILTER_PARAM_PREFIX))
    .forEach(key => params.delete(key));
}

/**
 * Drop the params a text search invalidates: `/search` is relevance-ranked and
 * takes neither an order nor exact-match filters.
 */
function stripSearchIncompatibleParams(params: URLSearchParams) {
  params.delete('sort');
  stripFilterParams(params);
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-card px-4 py-16 text-center shadow-sm">
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function DataSourceObjectsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Multi-select scope (`?ds=<csv>`), matching the Relationships page: empty
  // means every data source. Legacy `?dataSourceId=` deep links still resolve
  // (`all` → empty scope); the persisted-view hook normalizes them to `?ds=`
  // and remembers this table's scope independently from the graph.
  usePersistedDatastoreViewParams();
  const scopedDataSourceIds = useMemo(
    () => readDatastoreScopeFromParams(searchParams),
    [searchParams],
  );
  // Exactly one selected source unlocks the per-datasource features (index
  // columns, exact-match filters, column visibility). A context-group entry in
  // the scope is never "single" — group rows span data sources.
  const single =
    scopedDataSourceIds.length === 1 &&
    !isContextGroupScopeId(scopedDataSourceIds[0])
      ? scopedDataSourceIds[0]
      : undefined;
  const allMode = !single;

  const {
    dataSources,
    loading: dataSourcesLoading,
    error: dataSourcesError,
  } = useDataSources();
  const selectedDataSource = single
    ? dataSources.find(ds => ds.id === single)
    : undefined;
  const pickerDataSources = useMemo(
    () => dataSources.filter(ds => (ds.objectCount ?? 0) > 0),
    [dataSources],
  );

  // Context-group rules join the scope picker as their own top-level group;
  // each rule scopes the table to its materialized groups.
  const api = useDatastore();
  const { data: contextGroupRulesData } = useQuery(contextGroupRulesQuery(api));
  const pickerContextGroupRules = useMemo(
    () =>
      (contextGroupRulesData?.items ?? []).map(rule => ({
        id: rule.id,
        name: rule.name,
      })),
    [contextGroupRulesData],
  );

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  // Search and filters are read from the URL rather than mirrored into state.
  // Every write already goes through `setSearchParams`, so a second copy in
  // `useState` bought nothing and could disagree with the URL: `?object=` pushes
  // a history entry while these replace, so a Back out of an open drawer landed
  // on an entry whose params no longer matched what the table was showing.
  //
  // `usePersistedDatastoreViewParams` restores a bare visit's stored search into
  // `?q=` in a mount effect — after the first render — so seed from storage for
  // that one-shot window. Once the URL has named `q` (including after clear/Back
  // leave it absent), the URL wins alone; a continuous storage fallback would
  // resurrect the still-persisted value until the write-back effect ran.
  const urlSearch = searchParams.get('q');
  const [storedSearchSeed, setStoredSearchSeed] = useState(() =>
    urlSearch === null ? readStoredDatastoreSearch() : '',
  );
  // Retired as soon as the URL names `q` — or as soon as the user edits the
  // box (see handleSearchChange), whichever comes first. Keying it only on the
  // URL leaves a hole: clearing a seeded box deletes a `q` that was never
  // there, so the URL doesn't change and the seed would keep driving the
  // input. Sub-frame in practice, since the restore effect writes `?q=` right
  // after the first paint, but the seed's lifetime should end when the user
  // takes over, not when a navigation happens to occur.
  const retireStoredSeed = useCallback(() => setStoredSearchSeed(''), []);
  useEffect(() => {
    if (urlSearch !== null) {
      retireStoredSeed();
    }
  }, [urlSearch, retireStoredSeed]);
  const searchInput = urlSearch ?? storedSearchSeed;
  const filters = useMemo(
    () => readFiltersFromParams(searchParams),
    [searchParams],
  );
  // Same reasoning for the sort, which additionally makes a sorted view
  // shareable and stops it resetting whenever the page remounts — switching to
  // the graph view and back used to silently drop it.
  const sorting = useMemo(
    () => readDatastoreSortFromParams(searchParams),
    [searchParams],
  );

  // Debounce keystrokes so each character doesn't hit the server, but apply
  // immediately when `?q=` changes without going through the search box (Back,
  // persisted-view restore, filter writes that clear search). `searchTypingRef`
  // is set by handleSearchChange and consumed once per URL update.
  const searchTypingRef = useRef(false);
  const [debouncedSearch, setDebouncedSearch] = useState(searchInput);
  useEffect(() => {
    if (searchTypingRef.current) {
      searchTypingRef.current = false;
      const timer = setTimeout(() => {
        // Apply the query and drop the sort/filters it invalidates in the same
        // batch. Stripping them in `handleSearchChange` instead left a window
        // where the sort was already gone but the query hadn't landed, so the
        // fetch below ran with neither — the plain listing, which resolved
        // inside the debounce and painted rows matching no active input.
        setDebouncedSearch(searchInput);
        if (searchInput.trim()) {
          setSearchParams(
            prev => {
              const next = new URLSearchParams(prev);
              stripSearchIncompatibleParams(next);
              return next;
            },
            { replace: true },
          );
        }
      }, SEARCH_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }
    setDebouncedSearch(searchInput);
  }, [searchInput, setSearchParams]);

  const searchActive = debouncedSearch.trim().length > 0;

  // Pagination stays local (not in the URL), so reset it whenever the
  // URL-driven result identity changes — including Back/forward, which never
  // go through the click handlers that used to reset pageIndex alone.
  // Adjust during render so the fetch below never runs with a stale offset.
  const resultKey = listResultKey(
    scopedDataSourceIds,
    filters,
    sorting,
    debouncedSearch,
  );
  const [paginationResultKey, setPaginationResultKey] = useState(resultKey);
  let listPagination = pagination;
  if (paginationResultKey !== resultKey) {
    setPaginationResultKey(resultKey);
    if (pagination.pageIndex !== 0) {
      listPagination = { ...pagination, pageIndex: 0 };
      setPagination(listPagination);
    }
  }

  // Column visibility persists per data source. The 'none' key exists but is
  // never written: the picker only renders for a single selection with index
  // columns.
  const { columnVisibility, onColumnVisibilityChange, setColumnVisible } =
    useObjectColumnVisibility(single ?? 'none');

  const { rows, total, indexes, loading, refreshing, error } =
    useDataSourceObjects({
      datasourceIds: scopedDataSourceIds,
      pageIndex: listPagination.pageIndex,
      pageSize: listPagination.pageSize,
      sorting,
      search: debouncedSearch,
      filters,
    });

  // Row click / chevron open the object in a detail drawer (URL-driven via
  // `?object=<row id>`), replacing the old navigate-to-full-page + inline
  // expand. Resolve the clicked row from the loaded page to get its
  // datasource + object id (All mode rows span data sources).
  const {
    openId: openObjectId,
    open: openObject,
    close: closeObject,
  } = useDetailDrawer('object');
  const drawerObjectIds = openObjectId
    ? resolveObjectDrawerIds(openObjectId, rows, single, allMode)
    : undefined;
  // A `cg:`-scoped datasource id marks a materialized-group row; it opens the
  // context-group drawer rather than the object one.
  const drawerContextGroupId =
    drawerObjectIds && isContextGroupScopeId(drawerObjectIds.datasourceId)
      ? drawerObjectIds.objectId
      : undefined;
  const handleOpenObject = useCallback(
    (row: DataSourceObjectRow) =>
      openObject(objectDrawerParam(row.datasourceId, row.objectId)),
    [openObject],
  );

  const handleScopeChange = useCallback(
    (ids: string[]) => {
      const nextSingle =
        ids.length === 1 && !isContextGroupScopeId(ids[0]) ? ids[0] : undefined;
      // Sorting and exact-match filters are bound to one source's index
      // schema, so any change of the single-source identity (including
      // entering or leaving a multi-source scope) invalidates them. The text
      // search applies to any scope and survives. Page reset is handled by
      // the resultKey render adjustment above.
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (ids.length > 0) {
            next.set('ds', ids.join(','));
          } else {
            next.delete('ds');
          }
          if (nextSingle !== single) {
            stripFilterParams(next);
            next.delete('sort');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, single],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      // Only `?q=` moves here. The sort and filters a search invalidates are
      // dropped by the debounce effect above, alongside the query itself, so
      // the two never disagree for the length of a keystroke.
      retireStoredSeed();
      searchTypingRef.current = true;
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (value) {
            next.set('q', value);
          } else {
            next.delete('q');
          }
          return next;
        },
        { replace: true },
      );
    },
    [retireStoredSeed, setSearchParams],
  );

  const handleSetFilter = useCallback(
    (key: string, value: string) => {
      // Applying a filter clears any search (mutually exclusive). Removing one
      // (empty value) leaves the search alone. Page reset is via resultKey.
      setSearchParams(
        prev => {
          const updated = new URLSearchParams(prev);
          const paramKey = `${FILTER_PARAM_PREFIX}${key}`;
          if (value) {
            updated.set(paramKey, value);
            updated.delete('q');
          } else {
            updated.delete(paramKey);
          }
          return updated;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleClearAllFilters = useCallback(() => {
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        stripFilterParams(next);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  // TanStack hands us either the next state or a function of the previous one,
  // so resolve it against the URL's current value before writing it back.
  // Page reset is via resultKey when `?sort=` changes.
  const handleSortingChange = useCallback<OnChangeFn<SortingState>>(
    updater => {
      setSearchParams(
        prev => {
          const current = readDatastoreSortFromParams(prev);
          const nextSort =
            typeof updater === 'function' ? updater(current) : updater;
          const value = datastoreSortParam(nextSort);
          const next = new URLSearchParams(prev);
          if (value) {
            next.set('sort', value);
          } else {
            next.delete('sort');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Page header description stays generic; per-data-source facts (name, count,
  // last run) live in the slim context strip below.
  const description = 'Browse the records your data sources have ingested.';

  // A bare visit to a catalog with nothing ingested — no scope, search, or
  // filter narrowing things down. A scoped/filtered zero keeps the table's
  // inline "No objects found." instead.
  const datastoreEmpty =
    allMode &&
    !searchActive &&
    filters.size === 0 &&
    !loading &&
    !dataSourcesLoading &&
    !error &&
    !dataSourcesError &&
    total === 0;

  let body: React.ReactNode;
  if (dataSourcesError && dataSources.length === 0) {
    body = (
      <EmptyState
        message={`Failed to load data sources: ${dataSourcesError.message}`}
      />
    );
  } else if (single && !selectedDataSource && !dataSourcesLoading) {
    body = <EmptyState message="That data source could not be found." />;
  } else if (error) {
    body = <EmptyState message={`Failed to load objects: ${error.message}`} />;
  } else if (datastoreEmpty) {
    body = (
      <OverviewEmptyPreview
        actionDelay={ghostSettleAt(GHOST_ROWS.length, 4)}
        title="Nothing in the datastore yet"
        description={
          <>
            The{' '}
            <strong className="font-medium text-foreground">datastore</strong>{' '}
            is the object catalog everything else builds on: data sources sync
            records from your tools — repositories, services, people, incidents
            — into live, structured objects that agents query over MCP instead
            of guessing. Once objects land here, the rest of the system layers
            on top:
          </>
        }
        bullets={[
          {
            icon: Share2,
            term: 'Data sources',
            text: 'connect a tool and sync its records into the catalog as structured objects.',
          },
          {
            icon: Waypoints,
            term: 'Relationships',
            text: 'rules that link objects across data sources into one navigable graph.',
          },
          {
            icon: Users,
            term: 'Context groups',
            text: 'cross-cutting business concepts layered over the object graph that no single object names.',
          },
        ]}
        preview={
          <GhostTablePreview
            headers={GHOST_HEADERS}
            columns={GHOST_COLUMNS}
            rows={GHOST_ROWS}
          />
        }
        action={
          <Button
            variant="outline"
            onClick={() => navigate(dataSourcesNewDialog())}
          >
            <Plus className="size-4" />
            New Data Source
          </Button>
        }
      />
    );
  } else {
    body = (
      <DataSourceObjectsTable
        datasourceId={single ?? ALL_DATA_SOURCES_ID}
        allMode={allMode}
        dataSources={dataSources}
        rows={rows}
        indexes={indexes}
        total={total}
        loading={loading || dataSourcesLoading}
        refreshing={refreshing}
        searchActive={searchActive}
        sorting={sorting}
        onSortingChange={handleSortingChange}
        pagination={listPagination}
        onPaginationChange={setPagination}
        filters={filters}
        onSetFilter={handleSetFilter}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={onColumnVisibilityChange}
        onOpenObject={handleOpenObject}
      />
    );
  }

  const filterCount = filters.size;
  const showClearFilters = filterCount > 0 && !searchActive && !allMode;
  // Same predicate the table uses to decide which indexes get a column, so the
  // picker can never offer a column that isn't there (or miss one that is).
  const hideableColumnIds = allMode
    ? []
    : indexes.filter(isIndexTableColumn).map(index => index.key);

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <OverviewListingStandaloneBody className="flex min-h-0 flex-1 flex-col space-y-4 sm:space-y-6">
        <div className="shrink-0">
          <DatastoreViewHeader
            title="Datastore"
            description={description}
            dataSources={pickerDataSources}
            contextGroupRules={pickerContextGroupRules}
            scopedDataSourceIds={scopedDataSourceIds}
            onScopeChange={handleScopeChange}
            searchValue={searchInput}
            onSearchChange={handleSearchChange}
            searchAriaLabel={
              allMode
                ? 'Search objects across the selected data sources'
                : 'Search objects in this data source'
            }
            extraToolbar={
              <>
                {hideableColumnIds.length > 0 ? (
                  <ColumnVisibilityPicker
                    columnIds={hideableColumnIds}
                    columnVisibility={columnVisibility}
                    onColumnVisibleChange={setColumnVisible}
                  />
                ) : null}
                {showClearFilters ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={handleClearAllFilters}
                  >
                    <X className="size-3.5" />
                    Clear filter{filterCount === 1 ? '' : 's'} ({filterCount})
                  </Button>
                ) : null}
              </>
            }
          />
        </div>
        {selectedDataSource ? (
          <div className="shrink-0">
            <DataSourceContextHeader
              dataSource={selectedDataSource}
              total={total}
              searchActive={searchActive}
            />
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col gap-4 sm:gap-6">
          {body}
        </div>
      </OverviewListingStandaloneBody>

      <ObjectDetailDrawer
        datasourceId={
          drawerContextGroupId ? undefined : drawerObjectIds?.datasourceId
        }
        objectId={drawerContextGroupId ? undefined : drawerObjectIds?.objectId}
        open={openObjectId != null && !drawerContextGroupId}
        listLoading={openObjectId != null && !drawerObjectIds && loading}
        onOpenChange={o => {
          if (!o) closeObject();
        }}
      />
      <ContextGroupInstanceDrawer
        groupId={drawerContextGroupId}
        open={drawerContextGroupId != null}
        onOpenChange={o => {
          if (!o) closeObject();
        }}
      />
    </div>
  );
}
