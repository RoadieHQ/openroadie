import { useCallback, useMemo } from 'react';
import { getWorkspaceStorageScopeKey } from '../../api/workspace-scope';

export function workspaceEditorDraftKey(
  entity: string,
  id: string | undefined,
): string {
  const workspaceKey = getWorkspaceStorageScopeKey();
  const workspaceSegment =
    workspaceKey === '__organization__' ? '' : `${workspaceKey}:`;
  return `${entity}:editor-draft:${workspaceSegment}${id ?? 'new'}`;
}

/**
 * Shared sessionStorage-backed draft handling for the routed editors
 * (capabilities, context groups). Editors persist in-progress edits so
 * navigating away and back doesn't discard them, scoped per record id / "new"
 * and kept in sessionStorage so it clears when the tab closes.
 *
 * The seed/restore logic differs between editors (each has its own extra
 * useState it must rehydrate), so that stays in the components. What this hook
 * owns is the read/clear/persist plumbing — including the rule that reverting
 * to the saved value CLEARS the draft rather than leaving a stale copy behind.
 */
export interface EditorDraft<T> {
  /** Read + validate the stored draft, or null when absent/malformed. */
  read: () => T | null;
  /** Remove the stored draft (best-effort). */
  clear: () => void;
  /**
   * Persist the current draft, or clear it when there's nothing worth keeping.
   *
   * - `skip` — the form isn't ready (still loading / seeding) or is otherwise
   *   off-limits (e.g. viewing a historical version); leave storage untouched.
   * - `shouldPersist` — the form is new or has unsaved changes; write it.
   * - otherwise — the form matches its saved baseline; clear any stale draft so
   *   it isn't restored on the next visit.
   */
  persist: (value: T, shouldPersist: boolean, skip?: boolean) => void;
}

export function useEditorDraft<T>(
  storageKey: string,
  parse: (raw: unknown) => T | null,
): EditorDraft<T> {
  const read = useCallback((): T | null => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return null;
      return parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }, [storageKey, parse]);

  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // sessionStorage unavailable — nothing to clear.
    }
  }, [storageKey]);

  const persist = useCallback(
    (value: T, shouldPersist: boolean, skip = false) => {
      if (skip) return;
      if (!shouldPersist) {
        clear();
        return;
      }
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        // sessionStorage unavailable / full — persistence is best-effort.
      }
    },
    [storageKey, clear],
  );

  // Memoized so the returned object has a stable identity across renders —
  // consumers put it in effect dependency arrays, and a fresh object each
  // render would re-fire those effects (and, for an unguarded seed effect,
  // loop indefinitely).
  return useMemo(() => ({ read, clear, persist }), [read, clear, persist]);
}
