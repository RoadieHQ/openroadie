/**
 * Decides what Backspace/Delete does on the graph canvas.
 *
 * Split out from the keydown listener so the guards are testable: the listener
 * is bound to `window`, so anything that owns the keyboard — a confirmation
 * dialog, an open inspector, a text field — has to be excluded explicitly or
 * a stray Backspace deletes whatever the canvas still has selected.
 */

export interface DeleteKeyContext {
  key: string;
  targetTagName: string;
  /** True for contenteditable hosts, which take Backspace as text editing. */
  targetIsEditable: boolean;
  /** True while a dialog or inspector owns the keyboard. */
  keyboardBlocked: boolean;
  isEdit: boolean;
  selectedRuleId: string | null;
  focusedNodeId: string | null;
  canDeleteDataSource: boolean;
}

export type DeleteKeyAction =
  | { kind: 'none' }
  | { kind: 'delete-rule'; ruleId: string }
  | { kind: 'delete-datasource'; nodeId: string };

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

const NO_ACTION: DeleteKeyAction = { kind: 'none' };

export function resolveDeleteKeyAction(ctx: DeleteKeyContext): DeleteKeyAction {
  if (ctx.key !== 'Backspace' && ctx.key !== 'Delete') {
    return NO_ACTION;
  }
  if (TEXT_ENTRY_TAGS.has(ctx.targetTagName) || ctx.targetIsEditable) {
    return NO_ACTION;
  }
  if (ctx.keyboardBlocked || !ctx.isEdit) {
    return NO_ACTION;
  }
  if (ctx.selectedRuleId) {
    return { kind: 'delete-rule', ruleId: ctx.selectedRuleId };
  }
  if (ctx.focusedNodeId && ctx.canDeleteDataSource) {
    return { kind: 'delete-datasource', nodeId: ctx.focusedNodeId };
  }
  return NO_ACTION;
}
