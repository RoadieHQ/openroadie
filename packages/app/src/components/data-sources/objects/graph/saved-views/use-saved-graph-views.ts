import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  EMPTY_SAVED_VIEWS_FILE,
  savedGraphViewsFileSchema,
  type SavedGraphView,
} from './saved-view-schema';
import { pickRandomSavedGraphViewIconKey } from './saved-view-icons';
import { getWorkspaceStorageScopeKey } from '../../../../../api/workspace-scope';

const STORAGE_KEY = 'roadie.datastore.graph.saved-views.v1';
const CHANGE_EVENT = 'roadie:saved-graph-views-change';

function parseStored(value: string | null): SavedGraphView[] {
  if (!value) return [];

  try {
    const parsed = savedGraphViewsFileSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data.views : [];
  } catch {
    return [];
  }
}

function scopedStorageKey(workspaceKey: string): string {
  return workspaceKey === '__organization__'
    ? STORAGE_KEY
    : `${STORAGE_KEY}.${workspaceKey}`;
}

function scopedChangeEvent(workspaceKey: string): string {
  return workspaceKey === '__organization__'
    ? CHANGE_EVENT
    : `${CHANGE_EVENT}:${workspaceKey}`;
}

function subscribe(
  storageKey: string,
  changeEvent: string,
  listener: () => void,
): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) listener();
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(changeEvent, listener);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(changeEvent, listener);
  };
}

function writeViews(
  storageKey: string,
  changeEvent: string,
  views: SavedGraphView[],
): void {
  window.localStorage.setItem(
    storageKey,
    JSON.stringify({ version: 1, views }),
  );
  window.dispatchEvent(new Event(changeEvent));
}

export interface SavedGraphViewInput {
  name: string;
  params: Record<string, string>;
  objectState?: SavedGraphView['objectState'];
  camera: SavedGraphView['camera'];
}

/**
 * The graph page's named view snapshots, in localStorage (v1; a backend
 * home can come later). Reads are schema-validated with an empty fallback;
 * every mounted consumer subscribes to the same browser store.
 */
export function useSavedGraphViews(): {
  views: SavedGraphView[];
  saveView: (input: SavedGraphViewInput) => SavedGraphView;
  deleteView: (id: string) => void;
} {
  const workspaceKey = getWorkspaceStorageScopeKey();
  const storageKey = scopedStorageKey(workspaceKey);
  const changeEvent = scopedChangeEvent(workspaceKey);
  const subscribeToStore = useCallback(
    (listener: () => void) => subscribe(storageKey, changeEvent, listener),
    [changeEvent, storageKey],
  );
  const getSnapshot = useCallback(
    () => window.localStorage.getItem(storageKey),
    [storageKey],
  );
  const stored = useSyncExternalStore(subscribeToStore, getSnapshot, () =>
    JSON.stringify(EMPTY_SAVED_VIEWS_FILE),
  );
  const views = useMemo(() => parseStored(stored), [stored]);

  const saveView = useCallback(
    (input: SavedGraphViewInput): SavedGraphView => {
      const view: SavedGraphView = {
        id: crypto.randomUUID(),
        name: input.name,
        createdAt: new Date().toISOString(),
        params: input.params,
        objectState: input.objectState,
        camera: input.camera,
        iconKey: pickRandomSavedGraphViewIconKey(),
      };
      writeViews(storageKey, changeEvent, [
        ...parseStored(getSnapshot()),
        view,
      ]);
      return view;
    },
    [changeEvent, getSnapshot, storageKey],
  );

  const deleteView = useCallback(
    (id: string) => {
      writeViews(
        storageKey,
        changeEvent,
        parseStored(getSnapshot()).filter(view => view.id !== id),
      );
    },
    [changeEvent, getSnapshot, storageKey],
  );

  return { views, saveView, deleteView };
}
