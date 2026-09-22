import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  OVERVIEW_ALL_GROUP,
  OVERVIEW_ALL_STATUS,
  type OverviewConfig,
  type OverviewGroup,
} from './overview-config';

/**
 * Result of {@link useOverviewState}: URL-synced group/status/search state plus
 * the derived, filtered rows and sidebar groups for a config-driven overview.
 */
export interface OverviewStateResult<T> {
  /** Active `?group=` value ({@link OVERVIEW_ALL_GROUP} default). */
  group: string;
  /** Active `?status=` value ({@link OVERVIEW_ALL_STATUS} default). */
  status: string;
  /** Active `?search=` value (`''` default). */
  search: string;
  /** Rows filtered by search ∩ status ∩ group. */
  rows: T[];
  /** Available groups with counts (`href` left undefined; the publisher fills it). */
  groups: OverviewGroup[];
  /**
   * Count per `status.value` over group+search-filtered rows (i.e. excluding the
   * active status filter itself), plus an `all` total.
   */
  statusCounts: Record<string, number>;
  setGroup: (key: string) => void;
  setStatus: (value: string) => void;
  setSearch: (value: string) => void;
  /** Reset group/status/search to their defaults. */
  clear: () => void;
}

/** Case-insensitive substring match over a row's configured search fields. */
function matchesSearch<T>(
  row: T,
  config: OverviewConfig<T>,
  search: string,
): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  const haystack = config
    .searchFields(row)
    .filter((f): f is string => typeof f === 'string')
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

/** Whether a row passes the given status value (`all` always passes). */
function matchesStatus<T>(
  row: T,
  config: OverviewConfig<T>,
  status: string,
): boolean {
  if (status === OVERVIEW_ALL_STATUS) return true;
  const def = config.statuses?.find(s => s.value === status);
  // Unknown status value: treat as no-op filter (pass) rather than hiding all.
  return def ? def.predicate(row) : true;
}

/** Whether a row belongs to the given group key (`all` always passes). */
function matchesGroup<T>(
  row: T,
  config: OverviewConfig<T>,
  group: string,
): boolean {
  if (group === OVERVIEW_ALL_GROUP) return true;
  if (!config.group) return true;
  // Virtual groups (e.g. Favorites) are predicate-based and may overlap the
  // key-based groups, so they take precedence over the partition key.
  const virtual = config.group.virtual?.find(v => v.key === group);
  if (virtual) return virtual.predicate(row);
  return config.group.key(row) === group;
}

export function useOverviewState<T>(
  data: T[],
  config: OverviewConfig<T>,
): OverviewStateResult<T> {
  const [params, setSearchParams] = useSearchParams();

  const group = params.get('group') ?? OVERVIEW_ALL_GROUP;
  const status = params.get('status') ?? OVERVIEW_ALL_STATUS;
  const search = params.get('search') ?? '';

  const setParam = useCallback(
    (key: string, value: string, defaultValue: string) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (value === defaultValue) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setGroup = useCallback(
    (key: string) => setParam('group', key, OVERVIEW_ALL_GROUP),
    [setParam],
  );
  const setStatus = useCallback(
    (value: string) => setParam('status', value, OVERVIEW_ALL_STATUS),
    [setParam],
  );
  const setSearch = useCallback(
    (value: string) => setParam('search', value, ''),
    [setParam],
  );

  const clear = useCallback(() => {
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('group');
        next.delete('status');
        next.delete('search');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const rows = useMemo(() => {
    return data.filter(
      row =>
        matchesSearch(row, config, search) &&
        matchesStatus(row, config, status) &&
        matchesGroup(row, config, group),
    );
  }, [data, config, search, status, group]);

  // Groups: counts derive from the SEARCH-only-filtered data so sidebar counts
  // reflect the whole group regardless of the active status chip and stay stable
  // under status changes. Labels/logos/keys come only from the row's grouping
  // fields (stable identity), never volatile per-row async state.
  const groups = useMemo<OverviewGroup[]>(() => {
    const searchFiltered = data.filter(row =>
      matchesSearch(row, config, search),
    );

    const groupDef = config.group;

    const all: OverviewGroup = {
      key: OVERVIEW_ALL_GROUP,
      label: 'All',
      count: searchFiltered.length,
      icon: groupDef?.allIcon,
    };

    if (!groupDef) return [all];

    // Virtual (predicate-based) groups render after All, before key-based
    // groups. Hidden when empty unless flagged alwaysShow.
    const virtualGroups: OverviewGroup[] = [];
    for (const v of groupDef.virtual ?? []) {
      const count = searchFiltered.filter(v.predicate).length;
      if (v.alwaysShow || count > 0) {
        virtualGroups.push({
          key: v.key,
          label: v.label,
          count,
          logoUrl: v.logoUrl,
          icon: v.icon,
        });
      }
    }

    if (groupDef.kind === 'dynamic') {
      // Preserve first-seen order of buckets.
      const order: string[] = [];
      const buckets = new Map<
        string,
        { label: string; logoUrl?: string; count: number }
      >();
      for (const row of searchFiltered) {
        const key = groupDef.key(row);
        const existing = buckets.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          order.push(key);
          buckets.set(key, {
            label: groupDef.label(row),
            logoUrl: groupDef.logoUrl?.(row),
            count: 1,
          });
        }
      }
      const dynamic = order.map<OverviewGroup>(key => {
        const bucket = buckets.get(key)!;
        return {
          key,
          label: bucket.label,
          count: bucket.count,
          logoUrl: bucket.logoUrl,
        };
      });
      return [all, ...virtualGroups, ...dynamic];
    }

    const counts = new Map<string, number>();
    for (const row of searchFiltered) {
      const key = groupDef.key(row);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const fixed = (groupDef.keys ?? [])
      .map<OverviewGroup>(entry => ({
        key: entry.key,
        label: entry.label,
        count: counts.get(entry.key) ?? 0,
        logoUrl: entry.logoUrl,
      }))
      .filter(g => g.count > 0);
    return [all, ...virtualGroups, ...fixed];
  }, [data, config, search]);

  // statusCounts: count per status.value over search+group-filtered rows
  // (excluding the status filter itself), plus an `all` total.
  const statusCounts = useMemo<Record<string, number>>(() => {
    if (!config.statuses || config.statuses.length === 0) return {};
    const scoped = data.filter(
      row =>
        matchesSearch(row, config, search) && matchesGroup(row, config, group),
    );
    const counts: Record<string, number> = {
      [OVERVIEW_ALL_STATUS]: scoped.length,
    };
    for (const def of config.statuses) {
      counts[def.value] = scoped.filter(row => def.predicate(row)).length;
    }
    return counts;
  }, [data, config, search, group]);

  return {
    group,
    status,
    search,
    rows,
    groups,
    statusCounts,
    setGroup,
    setStatus,
    setSearch,
    clear,
  };
}

/** Target params when migrating a legacy `?tab=` value. */
export interface LegacyTabTarget {
  /** Set/clear `?status=`; omit to leave status untouched. */
  status?: string | null;
  /** Set/clear `?group=`; omit to leave group untouched. */
  group?: string | null;
}

/** Default mapper: `tab`→`status` (Actions and other flat status-tab pages). */
export function legacyTabToStatusTarget(tab: string): LegacyTabTarget {
  switch (tab) {
    case 'all':
      return { status: null };
    default:
      return { status: tab };
  }
}

/** Data Sources: favorites→group; enabled/disabled filters removed. */
export function dataSourceLegacyTabTarget(tab: string): LegacyTabTarget {
  switch (tab) {
    case 'all':
      return { status: null };
    case 'favorites':
      return { group: 'favorites' };
    case 'enabled':
    case 'disabled':
      return { status: null };
    default:
      return { status: null };
  }
}

/**
 * One-shot migration of legacy `?status=` values:
 * - `failed` → Run column filter (`?filter.run=result:failed`)
 * - `needs-setup` → broad setup union (`?status=any-setup`) from before the
 *   integration/source setup split
 */
export function useDataSourceLegacyStatusRedirect(): void {
  const [params, setSearchParams] = useSearchParams();
  const status = params.get('status');
  const hasRunFilter = params.getAll('filter.run').length > 0;

  useEffect(() => {
    if (status !== 'failed' && status !== 'needs-setup') return;

    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (status === 'failed') {
          next.delete('status');
          if (!hasRunFilter) {
            next.append('filter.run', 'result:failed');
          }
          return next;
        }

        next.set('status', 'any-setup');
        return next;
      },
      { replace: true },
    );
  }, [status, hasRunFilter, setSearchParams]);
}

/** Integrations: enabled/disabled status filters removed. */
export function integrationLegacyTabTarget(tab: string): LegacyTabTarget {
  switch (tab) {
    case 'all':
      return { status: null };
    case 'enabled':
    case 'disabled':
      return { status: null };
    default:
      return { status: null };
  }
}

/**
 * One-shot migration of the legacy `?tab=` param to `?status=` / `?group=`.
 * When `?tab=` is present, apply the page-specific mapper (dropping `tab=all`)
 * and remove `tab`. Standalone so a page can opt in without coupling it into
 * {@link useOverviewState}.
 */
export function useLegacyTabRedirect(
  mapTab: (tab: string) => LegacyTabTarget = legacyTabToStatusTarget,
): void {
  const [params, setSearchParams] = useSearchParams();
  const tab = params.get('tab');
  const hasStatus = params.has('status');
  const hasGroup = params.has('group');

  useEffect(() => {
    if (tab === null) return;
    const target = mapTab(tab);
    if (target.status !== undefined && hasStatus) return;
    if (target.group !== undefined && hasGroup) return;

    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('tab');
        if (target.status !== undefined) {
          if (target.status === null) next.delete('status');
          else next.set('status', target.status);
        }
        if (target.group !== undefined) {
          if (target.group === null) next.delete('group');
          else next.set('group', target.group);
        }
        return next;
      },
      { replace: true },
    );
  }, [tab, hasStatus, hasGroup, setSearchParams, mapTab]);
}
