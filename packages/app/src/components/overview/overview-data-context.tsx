import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { OverviewGroupsSnapshot } from './overview-config';

/**
 * Lightweight context for publishing the active page's overview groups UP to the
 * sidebar. The provider wraps both the sidebar and the routed page (siblings in
 * `root.tsx`). The active page publishes its {@link OverviewGroupsSnapshot} via
 * {@link usePublishOverviewData}; the sidebar reads it via
 * {@link useOverviewGroups}, keyed by `routeKey`.
 *
 * Snapshots are **retained per route** (not cleared on navigate-away), so the
 * sidebar keeps showing a section's count-driven categories instantly on return
 * (stale-while-revalidate): the cached counts render immediately and the page
 * republishes fresh ones on its next mount.
 */

interface OverviewDataContextValue {
  snapshotsByRoute: Record<string, OverviewGroupsSnapshot>;
  publish: (snapshot: OverviewGroupsSnapshot) => void;
}

const OverviewDataContext = createContext<OverviewDataContextValue | null>(
  null,
);

export function OverviewDataProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [snapshotsByRoute, setSnapshotsByRoute] = useState<
    Record<string, OverviewGroupsSnapshot>
  >({});

  // Stable publisher so effects keyed on the snapshot don't re-fire on identity.
  const publish = useCallback((next: OverviewGroupsSnapshot) => {
    setSnapshotsByRoute(prev => ({ ...prev, [next.routeKey]: next }));
  }, []);

  const value = useMemo<OverviewDataContextValue>(
    () => ({ snapshotsByRoute, publish }),
    [snapshotsByRoute, publish],
  );

  return (
    <OverviewDataContext.Provider value={value}>
      {children}
    </OverviewDataContext.Provider>
  );
}

/**
 * Page side: publish this page's groups so the sidebar can render them. Pass
 * `null` while the page has no meaningful data yet (e.g. still loading) to avoid
 * overwriting previously-cached counts. Retained across navigation. No-op if
 * there is no provider.
 */
export function usePublishOverviewData(
  snapshot: OverviewGroupsSnapshot | null,
): void {
  const ctx = useContext(OverviewDataContext);
  const publish = ctx?.publish;

  // Serialize so the effect only re-publishes on real content changes and never
  // loops on referentially-new-but-equal snapshots. `publish` is stable.
  const serialized = JSON.stringify(snapshot);

  useEffect(() => {
    if (!publish || !snapshot) return;
    publish(snapshot);
    // Intentionally no cleanup: counts are retained per route so the sidebar
    // shows them instantly on return.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `serialized` (stable serialization); `publish` is stable.
  }, [serialized, publish]);
}

/**
 * Sidebar side: read the retained groups snapshot for a given `routeKey`, or
 * `null` if that route hasn't published yet this session.
 */
export function useOverviewGroups(
  routeKey: string,
): OverviewGroupsSnapshot | null {
  const ctx = useContext(OverviewDataContext);
  // eslint-disable-next-line security/detect-object-injection -- routeKey is a fixed nav route path
  return ctx?.snapshotsByRoute[routeKey] ?? null;
}
