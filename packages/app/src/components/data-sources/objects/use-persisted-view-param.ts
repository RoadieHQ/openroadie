import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { ALL_DATA_SOURCES_ID } from './use-data-source-objects';
import { getWorkspaceStorageScopeKey } from '../../../api/workspace-scope';

/** Each view remembers its own data-source scope; the URL remains authoritative. */
const DATASTORE_TABLE_SCOPE_STORAGE_KEY = 'roadie.datastore.table.scope';
const DATASTORE_GRAPH_SCOPE_STORAGE_KEY = 'roadie.datastore.graph.scope';
/** Object search (`?q=`) belongs to the Datastore table. */
const DATASTORE_SEARCH_STORAGE_KEY = 'roadie.datastore.search';
/** Last graph view mode (`?view=`) — graph page only. */
const DATASTORE_GRAPH_VIEW_STORAGE_KEY = 'roadie.datastore.graph.view';
/** Context-group collapse choice (`?groups=`) — graph page only. */
const DATASTORE_GRAPH_GROUPS_STORAGE_KEY = 'roadie.datastore.graph.groups';

function readStored(storageKey: string): string {
  try {
    return window.sessionStorage.getItem(storageKey) ?? '';
  } catch {
    return '';
  }
}

function scopedStorageKey(storageKey: string, workspaceKey: string): string {
  return workspaceKey === '__organization__'
    ? storageKey
    : `${storageKey}.${workspaceKey}`;
}

/** Last search the user typed in the Datastore table (empty when cleared). */
export function readStoredDatastoreSearch(): string {
  return readStored(
    scopedStorageKey(
      DATASTORE_SEARCH_STORAGE_KEY,
      getWorkspaceStorageScopeKey(),
    ),
  );
}

function persist(storageKey: string, value: string | null) {
  try {
    window.sessionStorage.setItem(storageKey, value ?? '');
  } catch {
    // Session storage unavailable (private mode); persistence is best-effort.
  }
}

/**
 * Remembers each view's `?ds=` scope independently via sessionStorage: the
 * sidebar switches views with a bare path, so each view restores its own last
 * selection. The URL stays the source of truth — absent params are restored
 * from storage once on mount, and every later change is written back.
 *
 * Also owns normalizing legacy `?dataSourceId=` deep links to `?ds=` (`all`
 * meaning the empty scope). All mount-time URL fixups happen in one
 * `setSearchParams` navigation: functional updates read the location at call
 * time, so two calls in the same commit would clobber each other.
 */
export function usePersistedDatastoreViewParams(options?: {
  /** The table and graph remember separate data-source selections. */
  scope?: 'table' | 'graph';
  /** Graph page only: also mirror the `?view=` mode. A bare `?focus=` deep
   * link names the object view implicitly, so it blocks the restore. */
  view?: boolean;
  /** Graph page only: also mirror the `?groups=` context-group collapse
   * choice. */
  groups?: boolean;
  /** Set false on views without a `?q=` search (the graph page) so they
   * neither restore the stored search into their URL nor clear it. */
  search?: boolean;
}): void {
  const includeView = options?.view ?? false;
  const includeGroups = options?.groups ?? false;
  const includeSearch = options?.search ?? true;
  const workspaceKey = getWorkspaceStorageScopeKey();
  const scopeStorageKey = scopedStorageKey(
    options?.scope === 'graph'
      ? DATASTORE_GRAPH_SCOPE_STORAGE_KEY
      : DATASTORE_TABLE_SCOPE_STORAGE_KEY,
    workspaceKey,
  );
  const searchStorageKey = scopedStorageKey(
    DATASTORE_SEARCH_STORAGE_KEY,
    workspaceKey,
  );
  const graphViewStorageKey = scopedStorageKey(
    DATASTORE_GRAPH_VIEW_STORAGE_KEY,
    workspaceKey,
  );
  const graphGroupsStorageKey = scopedStorageKey(
    DATASTORE_GRAPH_GROUPS_STORAGE_KEY,
    workspaceKey,
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = searchParams.get('ds');
  const search = searchParams.get('q');
  const view = searchParams.get('view');
  const groups = searchParams.get('groups');
  const focus = searchParams.get('focus');
  const legacyScope = searchParams.get('dataSourceId');
  const restoreAttemptedRef = useRef(false);

  useEffect(() => {
    if (restoreAttemptedRef.current) {
      return;
    }
    restoreAttemptedRef.current = true;

    // The URL wins: restore from storage only when it names no scope at all
    // (the legacy param counts as naming one, `all` as naming the empty one).
    const restoredScope =
      scope === null && legacyScope === null
        ? readStored(scopeStorageKey) || null
        : null;
    const restoredSearch =
      includeSearch && search === null
        ? readStored(searchStorageKey) || null
        : null;
    const restoredView =
      includeView && view === null && focus === null
        ? readStored(graphViewStorageKey) || null
        : null;
    // An absent `?groups=` IS the default (collapsed), so only a stored
    // non-default choice restores anything.
    const restoredGroups =
      includeGroups && groups === null
        ? readStored(graphGroupsStorageKey) || null
        : null;

    if (
      legacyScope === null &&
      restoredScope === null &&
      restoredSearch === null &&
      restoredView === null &&
      restoredGroups === null
    ) {
      return;
    }

    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (legacyScope !== null) {
          next.delete('dataSourceId');
          if (legacyScope !== ALL_DATA_SOURCES_ID && !next.get('ds')) {
            next.set('ds', legacyScope);
          }
        }
        if (restoredScope !== null) {
          next.set('ds', restoredScope);
        }
        if (restoredSearch !== null) {
          next.set('q', restoredSearch);
        }
        if (restoredView !== null) {
          next.set('view', restoredView);
        }
        if (restoredGroups !== null) {
          next.set('groups', restoredGroups);
        }
        return next;
      },
      { replace: true },
    );
  }, [
    scope,
    search,
    view,
    groups,
    focus,
    includeView,
    includeGroups,
    includeSearch,
    scopeStorageKey,
    searchStorageKey,
    graphViewStorageKey,
    graphGroupsStorageKey,
    legacyScope,
    setSearchParams,
  ]);

  useEffect(() => {
    // Before the legacy param is normalized it still names the scope; don't
    // let the not-yet-rewritten URL clear the stored value.
    if (legacyScope !== null) {
      return;
    }
    persist(scopeStorageKey, scope);
  }, [scope, legacyScope, scopeStorageKey]);

  useEffect(() => {
    if (!includeSearch) {
      return;
    }
    persist(searchStorageKey, search);
  }, [includeSearch, search, searchStorageKey]);

  useEffect(() => {
    if (!includeView) {
      return;
    }
    persist(graphViewStorageKey, view);
  }, [graphViewStorageKey, includeView, view]);

  useEffect(() => {
    if (!includeGroups) {
      return;
    }
    persist(graphGroupsStorageKey, groups);
  }, [graphGroupsStorageKey, includeGroups, groups]);
}
