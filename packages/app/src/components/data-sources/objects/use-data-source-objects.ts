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

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SortingState } from '@tanstack/react-table';
import { useAlert, useDatastore } from '../../../api';
import { contextGroupRulesQuery, queryKeys } from '../../../api/queries';
import type {
  ContextGroupPreviewGroup,
  ContextGroupRule,
  DatastoreObject,
  IndexConfiguration,
} from '../../../api/datastore/datastore-client';
import {
  contextGroupScopeId,
  splitDatastoreScope,
} from './context-group-scope';
import { resolveObjectDisplayName } from './resolve-object-display-name';

// Stable empty references so consumers memoizing on `indexes`/`rows` don't
// churn while a query is idle or unresolved.
const EMPTY_INDEXES: IndexConfiguration[] = [];
const EMPTY_ROWS: DataSourceObjectRow[] = [];

/**
 * Sentinel meaning "every data source". Retained for the legacy
 * `?dataSourceId=all` URLs (migrated to an empty `?ds=` scope) and as the
 * placeholder datasource id the table receives in cross-source mode.
 */
export const ALL_DATA_SOURCES_ID = 'all';

/** Marks a row as a materialized context group rendered "as though" an object. */
export interface ContextGroupRowInfo {
  ruleId: string;
  /** The producing rule's name — shown where an object row shows its data source. */
  ruleName: string;
  memberCount: number;
}

/** A datastore object plus the display values for each indexed field. */
export interface DataSourceObjectRow extends DatastoreObject {
  relationshipCount?: number;
  /**
   * Index key → rendered value. Stored as a Map (rather than a plain object) to
   * avoid `security/detect-object-injection` on dynamic-key access; absent keys
   * mean the expression yielded nothing.
   */
  indexValues: Map<string, string>;
  /**
   * Present when the row is a materialized context group rather than an object.
   * Group rows link to the context-group instance page instead of the object
   * detail route, and carry the rule name in place of a data source.
   */
  contextGroup?: ContextGroupRowInfo;
}

export interface UseDataSourceObjectsParams {
  /**
   * Data sources to query. Exactly one id uses the per-datasource endpoints
   * (index configurations, dynamic columns, exact-match filters). Empty or
   * multiple ids use the cross-source endpoints, scoped to the ids when any
   * are given — empty means every data source. Cross-source mode has no index
   * configurations, but built-in columns can still sort via backend keys.
   */
  datasourceIds: string[];
  pageIndex: number;
  pageSize: number;
  /** TanStack sorting state; only `[0]` is sent to the API (single-column sort). */
  sorting: SortingState;
  /**
   * Full-text query. When non-empty the hook uses the `/search` endpoint
   * (relevance-ranked, so `sorting` is ignored) instead of `queryObjects`.
   */
  search: string;
  /**
   * Exact-match filters keyed by index name. Ignored while {@link search} is
   * active because the `/search` endpoint does not accept filter clauses.
   */
  filters: Map<string, string>;
}

export interface UseDataSourceObjectsResult {
  rows: DataSourceObjectRow[];
  /** Server-reported total row count, used for pagination. */
  total: number;
  /** Index configurations for the data source — used for dynamic value columns. */
  indexes: IndexConfiguration[];
  loading: boolean;
  /**
   * A fetch is in flight with rows already on screen — paginating, sorting,
   * filtering or refreshing. Distinct from {@link loading}, which is only the
   * first load. Callers should show a subtle inline indicator, never a skeleton
   * (loading-states rule #5).
   */
  refreshing: boolean;
  error: Error | undefined;
}

/** Render a JSONata-extracted index value as a table cell string. */
function formatIndexValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Evaluate every index expression against every object up-front so the table can
 * render index columns synchronously. Index expressions are operator-defined and
 * validated server-side, so plain JSONata (matching the backend) is used here.
 *
 * The parser is imported on demand: it is a heavy dependency needed only for
 * index columns, and the cross-source view has none at all. This function is
 * already async and runs inside the page's `queryFn`, so the import overlaps
 * with the request rather than delaying it.
 */
async function computeRows(
  items: DatastoreObject[],
  indexes: IndexConfiguration[],
): Promise<DataSourceObjectRow[]> {
  if (indexes.length === 0) {
    return items.map(item => ({
      ...item,
      indexValues: new Map<string, string>(),
    }));
  }

  const { default: jsonata } = await import('jsonata');
  const compiled = indexes.map(index => {
    try {
      return { key: index.key, expression: jsonata(index.valueExpression) };
    } catch {
      return { key: index.key, expression: null };
    }
  });

  return Promise.all(
    items.map(async item => {
      const indexValues = new Map<string, string>();
      for (const { key, expression } of compiled) {
        if (!expression) continue;
        try {
          const value: unknown = await expression.evaluate(item.object);
          const formatted = formatIndexValue(value);
          if (formatted !== undefined) {
            indexValues.set(key, formatted);
          }
        } catch {
          // Leave the key absent; the cell renders a placeholder.
        }
      }
      return { ...item, indexValues };
    }),
  );
}

/**
 * Shape a materialized context group as a table row. The row's `object` is a
 * synthesized summary (rule + member titles) so the expand-to-peek panel shows
 * something meaningful; the full group lives on its instance page/drawer.
 */
function contextGroupRow(
  group: ContextGroupPreviewGroup,
  rule: ContextGroupRule,
): DataSourceObjectRow {
  const members = group.members.map(member => ({
    title: resolveObjectDisplayName(
      member.object,
      member.objectId,
      member.presentation,
    ),
    datasourceId: member.datasourceId,
    objectId: member.objectId,
  }));
  return {
    id: `cg-group:${group.id}`,
    datasourceId: contextGroupScopeId(rule.id),
    objectId: group.id,
    object: { group: group.name, rule: rule.name, members },
    presentation: { title: group.name },
    // The rule-groups endpoint carries no timestamps; the peek panel omits them.
    createdAt: '',
    updatedAt: '',
    indexValues: new Map<string, string>(),
    contextGroup: {
      ruleId: rule.id,
      ruleName: rule.name,
      memberCount: group.members.length,
    },
  };
}

/**
 * Server-paginated, server-sorted access to a data source's objects.
 *
 * Index configurations load once per data source and define the dynamic value
 * columns; the object list refetches whenever pagination or sorting changes.
 */
export function useDataSourceObjects({
  datasourceIds,
  pageIndex,
  pageSize,
  sorting,
  search,
  filters,
}: UseDataSourceObjectsParams): UseDataSourceObjectsResult {
  const api = useDatastore();
  const alertApi = useAlert();
  const alertRef = useRef(alertApi);
  alertRef.current = alertApi;
  // The scope mixes data-source ids with `cg:<ruleId>` context-group entries;
  // objects and materialized groups are fetched separately and concatenated.
  const { datasourceIds: datasourceScope, contextGroupRuleIds: ruleScope } =
    splitDatastoreScope(datasourceIds);
  // Exactly one selected source enables the per-datasource endpoints; any
  // other scope (including any context-group selection) goes through the
  // cross-source ones.
  const single =
    datasourceScope.length === 1 && ruleScope.length === 0
      ? datasourceScope[0]
      : undefined;
  // Sorted so the query key (and held-page tag) is insensitive to the order
  // the user ticked sources in.
  const scope = [...datasourceScope].sort();
  const scopeKey = [...datasourceIds].sort().join(',');
  const trimmedSearch = search.trim();
  // The empty scope means everything — every data source's objects *and* every
  // rule's materialized groups. Objects are skipped only for a pure
  // context-group scope. A text search keeps the group sections: a group
  // matches when any of its members matches the query (backend `q` filter).
  const includeAll = datasourceIds.length === 0;
  const includeObjects = includeAll || datasourceScope.length > 0;
  const rulesNeeded = includeAll || ruleScope.length > 0;

  // The rules list resolves which groups the scope names (all of them in the
  // empty scope) and the rule names shown in the Data source column.
  const rulesQuery = useQuery({
    ...contextGroupRulesQuery(api),
    enabled: rulesNeeded,
  });
  // ruleScope is rebuilt each render; its sorted join is the stable identity.
  const ruleScopeKey = [...ruleScope].sort().join(',');
  const includedRules = useMemo(() => {
    if (!rulesNeeded) {
      return [] as ContextGroupRule[];
    }
    const scopedRuleIds = new Set(ruleScopeKey ? ruleScopeKey.split(',') : []);
    const rules = rulesQuery.data?.items ?? [];
    const selected = includeAll
      ? rules
      : rules.filter(rule => scopedRuleIds.has(rule.id));
    return [...selected].sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
  }, [rulesNeeded, includeAll, rulesQuery.data, ruleScopeKey]);
  // Like the index configs: wait for the rules before fetching the page (they
  // shape the group sections and the key), but degrade to objects-only when
  // the rules request fails rather than blocking the rows.
  const rulesSettled =
    !rulesNeeded || rulesQuery.isSuccess || rulesQuery.isError;
  // Serialize filters into a stable key so the query only refetches when the
  // contents change, not on every Map identity change upstream.
  const filtersKey = Array.from(filters.entries())
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('&');
  const sort = sorting[0];

  // Index configurations load once per data source and define the dynamic
  // columns / computed cells. Cross-source scopes span sources with no common
  // schema, so they have no index columns. React Query keys these by data
  // source, so a stale source's response can never repopulate the current one.
  const indexesQuery = useQuery({
    queryKey: queryKeys.dataSourceObjectIndexes(single),
    queryFn: ({ signal }) =>
      api.listIndexConfigurations(single as string, signal),
    enabled: !!single,
  });
  const indexes = indexesQuery.data ?? EMPTY_INDEXES;
  // The configs shape the computed cells and therefore the object-page cache
  // entry, so wait for them before fetching the page. Fetching in parallel
  // instead would run the first page against no indexes and then refetch
  // byte-identical rows once the arriving configs changed the key. A failed
  // config request degrades to no index columns rather than blocking the rows.
  const indexesSettled =
    !single || indexesQuery.isSuccess || indexesQuery.isError;

  const subtitleIndexKey = indexes.find(
    index => index.purpose === 'subtitle',
  )?.key;
  // Map the table's column ids onto the backend's sort keys. Index columns sort
  // by their own key, so they fall through unchanged.
  const apiSortId =
    sort?.id === 'dataSource'
      ? 'datasourceId'
      : sort?.id === 'title'
        ? 'title'
        : sort?.id === 'contextGroups'
          ? 'contextGroupCount'
          : sort?.id === 'subtitle'
            ? (subtitleIndexKey ?? undefined)
            : sort?.id;

  // Part of the object-page key because the cached rows carry index-derived
  // cells: if an operator edits a value expression, the same page of objects
  // must recompute rather than serve stale cells. `indexesSettled` gates the
  // first fetch, so this no longer changes mid-load.
  const indexesKey = indexes
    .map(index => `${index.key}:${index.valueExpression}`)
    .join('|');

  // A search goes to `/search`, which is relevance-ranked and takes neither an
  // order nor filters — so they are not inputs to the result and must stay out
  // of its key. Keying on them anyway split one search across several identical
  // cache entries: the page drops the sort and filters when a search applies,
  // and the router lands that in a second render, so the same query refetched
  // under a second key.
  const sortAndFilterKey = trimmedSearch
    ? ['', '', '']
    : [apiSortId ?? '', sort?.desc ? 'desc' : 'asc', filtersKey];

  // Part of the page key because group rows embed the rule's name; a rename
  // (or a rule created/deleted in the empty scope) must refetch the page.
  const includedRulesKey = includedRules
    .map(rule => `${rule.id}:${rule.name}`)
    .join('|');

  const objectsQuery = useQuery({
    queryKey: queryKeys.dataSourceObjectsPage(
      scopeKey,
      pageIndex,
      pageSize,
      ...sortAndFilterKey,
      trimmedSearch,
      indexesKey,
      includedRulesKey,
    ),
    queryFn: async ({ signal }) => {
      const pageStart = pageIndex * pageSize;
      const pageEnd = pageStart + pageSize;

      // ── Objects section ──
      // Occupies combined indices [0, objects total); a pure context-group
      // scope has no objects section at all.
      let result: { items: DatastoreObject[]; total: number } = {
        items: [],
        total: 0,
      };
      if (trimmedSearch) {
        if (includeObjects) {
          const searchResult = await api.searchObjects(
            {
              q: trimmedSearch,
              // Omitting datasourceIds searches every data source.
              datasourceIds: scope.length > 0 ? scope : undefined,
              limit: pageSize,
              offset: pageStart,
            },
            signal,
          );
          result = {
            // Search hits carry no timestamps; the date columns render a dash.
            items: searchResult.items.map(item => ({
              ...item,
              createdAt: '',
              updatedAt: '',
            })),
            total: searchResult.total,
          };
        }
      } else if (single) {
        result = await api.queryObjects(
          single,
          {
            limit: pageSize,
            offset: pageStart,
            orderBy: apiSortId,
            sortOrder: sort ? (sort.desc ? 'desc' : 'asc') : undefined,
            filter: filters.size > 0 ? Object.fromEntries(filters) : undefined,
          },
          signal,
        );
      } else if (includeObjects) {
        result = await api.queryAllObjects(
          {
            limit: pageSize,
            offset: pageStart,
            orderBy: apiSortId,
            sortOrder: sort ? (sort.desc ? 'desc' : 'asc') : undefined,
            datasourceIds: scope.length > 0 ? scope : undefined,
          },
          signal,
        );
      }
      const objectRows = await computeRows(result.items, indexes);

      // ── Context-group sections ──
      // One section per included rule, appended after the objects in rule-name
      // order. Section totals are fetched first so the page window can be
      // mapped onto each section exactly, then only the slices the window
      // actually covers are fetched. Without a search the cheap group-count
      // endpoint provides the totals; a search needs the rule-groups endpoint,
      // whose `q` filter keeps only groups with a matching member.
      let combinedTotal = result.total;
      const groupFetches: Array<Promise<DataSourceObjectRow[]>> = [];
      if (includedRules.length > 0) {
        const ruleTotals = await Promise.all(
          includedRules.map(async rule => ({
            rule,
            total: trimmedSearch
              ? (
                  await api.getContextGroupRuleGroups(rule.id, {
                    limit: 1,
                    q: trimmedSearch,
                  })
                ).totalGroups
              : (await api.listContextGroups({ ruleId: rule.id, limit: 1 }))
                  .total,
          })),
        );
        for (const { rule, total: ruleTotal } of ruleTotals) {
          const startInSection = Math.max(pageStart - combinedTotal, 0);
          const endInSection = Math.min(ruleTotal, pageEnd - combinedTotal);
          if (endInSection > startInSection) {
            groupFetches.push(
              api
                .getContextGroupRuleGroups(rule.id, {
                  offset: startInSection,
                  limit: endInSection - startInSection,
                  q: trimmedSearch || undefined,
                })
                .then(page =>
                  page.groups.map(group => contextGroupRow(group, rule)),
                ),
            );
          }
          combinedTotal += ruleTotal;
        }
      }
      const groupRows = (await Promise.all(groupFetches)).flat();

      return { rows: [...objectRows, ...groupRows], total: combinedTotal };
    },
    enabled: indexesSettled && rulesSettled,
    // No race guard needed: a stale response lands on its own query key and
    // can't overwrite the active page.
  });

  // Hold the last successfully-loaded page so the table keeps rows on screen
  // while paginating / sorting / filtering / refreshing *and* on a failed
  // refetch — `placeholderData` only spans the loading phase and drops on
  // error, so it can't do the latter. The held page is tagged with its scope
  // and reused only for the matching one, so a scope switch never paints the
  // previous scope's rows (nor suppresses its loading state). The match is
  // evaluated during render on purpose — a reset effect runs only after the
  // switch render has already committed the stale rows.
  const lastGoodRef = useRef<
    | {
        scopeKey: string;
        data: { rows: DataSourceObjectRow[]; total: number };
      }
    | undefined
  >(undefined);
  useEffect(() => {
    if (objectsQuery.data !== undefined) {
      lastGoodRef.current = { scopeKey, data: objectsQuery.data };
    }
  }, [objectsQuery.data, scopeKey]);

  const held = lastGoodRef.current;
  const lastGood = held && held.scopeKey === scopeKey ? held.data : undefined;
  const effectiveData = objectsQuery.data ?? lastGood;
  const hasData = effectiveData !== undefined;

  // A refetch that fails while rows are already on screen (a manual refresh or a
  // pagination change with previous data) keeps the stale rows and warns instead
  // of blanking the table. A cold failure (no prior data) surfaces as `error`.
  const failedWithData = !!objectsQuery.error && hasData;
  useEffect(() => {
    if (failedWithData) {
      alertRef.current.post({
        message: 'Could not refresh objects — showing the previous results.',
        severity: 'warning',
      });
    }
  }, [failedWithData, objectsQuery.error]);

  return {
    rows: effectiveData?.rows ?? EMPTY_ROWS,
    total: effectiveData?.total ?? 0,
    indexes,
    // Only a true first load (nothing to show yet) is "loading"; a refetch with
    // rows still on screen is not. The pre-`enabled` window counts too — the
    // query sits idle there, so `isLoading` alone would read as "loaded empty".
    loading:
      (!indexesSettled || !rulesSettled || objectsQuery.isLoading) && !hasData,
    refreshing: objectsQuery.isFetching && hasData,
    error: hasData ? undefined : (objectsQuery.error ?? undefined),
  };
}
