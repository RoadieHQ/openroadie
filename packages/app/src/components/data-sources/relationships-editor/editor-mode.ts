// Editor modes for the Relationships Editor toolbar. The two modes are
// mutually exclusive.
//
//   edit    — default working mode: focus/dim, drag-create relationships,
//             editable inspector for nodes and rules
//   suggest — suggestions drawer, approve/dismiss flow
export type EditorMode = 'edit' | 'suggest';

export const EDITOR_MODE_STORAGE_KEY = 'graph-editor-mode';
export const DEFAULT_EDITOR_MODE: EditorMode = 'edit';

// Migrate now-removed values ('select', 'visibility', 'object-graph' — the
// object graph moved to the Datastore graph page) to 'edit' for users with a
// previous mode persisted in localStorage.
export function migrateEditorMode(
  value: string | null | undefined,
): EditorMode {
  if (value === 'edit' || value === 'suggest') {
    return value;
  }
  return DEFAULT_EDITOR_MODE;
}
