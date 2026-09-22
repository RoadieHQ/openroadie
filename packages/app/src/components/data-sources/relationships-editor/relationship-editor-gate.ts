/**
 * The save/delete gating contract shared by the relationship-rule editor and
 * the manual single-edge editor — the slice both feed into
 * `RelationshipEditorActions` and `RelationshipEditorShell`.
 *
 * Semantics both editors must agree on: `canSave` means "the current inputs
 * are save-worthy" and never folds in `busy`; the UI composes the two
 * (`disabled={!canSave || busy}`, shortcuts ignored while busy), and the
 * handlers guard re-entry themselves.
 */
export interface RelationshipEditorGate {
  isEdit: boolean;
  canSave: boolean;
  /** Reason the save is gated; shown as a tooltip on the disabled button. */
  saveBlockedReason: string | null;
  busy: boolean;
  saving: boolean;
  deleting: boolean;
  handleSave: () => void | Promise<void>;
  handleDelete: () => void | Promise<void>;
}

/**
 * Maps an editor's gate onto the shared action cluster's props, so both
 * editors wire `RelationshipEditorActions` identically (and satisfying the
 * gate contract is checked at the call site). `onDelete` stays with the
 * caller — the rule inspector wires it conditionally.
 */
export function editorGateActionProps(editor: RelationshipEditorGate) {
  return {
    isEdit: editor.isEdit,
    canSave: editor.canSave,
    busy: editor.busy,
    saving: editor.saving,
    deleting: editor.deleting,
    saveBlockedReason: editor.saveBlockedReason,
    onSave: () => void editor.handleSave(),
  };
}
