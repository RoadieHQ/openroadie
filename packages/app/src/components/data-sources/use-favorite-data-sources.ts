import { useCallback, useMemo, useRef } from 'react';
import { useLocalStorage } from 'react-use';
import { getWorkspaceStorageScopeKey } from '../../api/workspace-scope';

interface UseFavoriteDataSourcesResult {
  favoriteIds: ReadonlySet<string>;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  setFavorites: (ids: string[], favorited: boolean) => void;
}

// Encapsulates persisted favorite data source state plus a workaround for a
// known stale-closure bug in `react-use`'s `useLocalStorage`: its functional
// setter receives a `state` captured at hook-creation time rather than the
// latest, so toggling row A then row B in quick succession would clobber A.
// We sidestep it by reading via a ref and writing whole arrays.
export function useFavoriteDataSources(
  storageKey: string,
): UseFavoriteDataSourcesResult {
  const workspaceKey = getWorkspaceStorageScopeKey();
  const scopedStorageKey =
    workspaceKey === '__organization__'
      ? storageKey
      : `${storageKey}.${workspaceKey}`;
  const [stored, setStored] = useLocalStorage<string[]>(scopedStorageKey, []);
  const ref = useRef<string[]>(stored ?? []);
  ref.current = stored ?? [];

  const favoriteIds = useMemo(() => new Set(stored ?? []), [stored]);

  const isFavorite = useCallback(
    (id: string) => favoriteIds.has(id),
    [favoriteIds],
  );

  const toggleFavorite = useCallback(
    (id: string) => {
      const next = new Set(ref.current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      setStored(Array.from(next));
    },
    [setStored],
  );

  const setFavorites = useCallback(
    (ids: string[], favorited: boolean) => {
      const next = new Set(ref.current);
      if (favorited) {
        ids.forEach(id => next.add(id));
      } else {
        ids.forEach(id => next.delete(id));
      }
      setStored(Array.from(next));
    },
    [setStored],
  );

  return { favoriteIds, isFavorite, toggleFavorite, setFavorites };
}
