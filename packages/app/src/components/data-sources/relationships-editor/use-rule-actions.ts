import { useCallback, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import type {
  RelationshipRule,
  RelationshipRuleInput,
} from '../../../api/datastore/datastore-client';

export interface UseRuleActionsOptions {
  canSave: boolean;
  isEdit: boolean;
  isDirty: boolean;
  existingRuleId: string | undefined;
  onClose: () => void;
  onSave: (
    input: RelationshipRuleInput,
  ) => Promise<RelationshipRule | undefined>;
  /** Resolving `false` means the delete did NOT happen (e.g. the user
   *  cancelled a confirmation the callback opened) — the editor stays open. */
  onDelete?: (ruleId: string) => Promise<void | boolean>;
  onApprove?: (ruleId: string) => Promise<void>;
  /** Builds the save payload from the current form values. */
  buildRuleInput: () => RelationshipRuleInput;
  /** Flushes the buffered direct edges against the saved rule's id. */
  flushDirect: (ruleId: string | null) => Promise<{ failed: number }>;
}

/**
 * Save / delete / approve wrap the prop callbacks (which own the write + cache
 * invalidation) in local mutations purely to expose `isPending` — the busy
 * flags — instead of tracking a separate `useState`. `onClose` (a UI
 * side-effect) stays here at the call site, run only after the write settles.
 */
export function useRuleActions({
  canSave,
  isEdit,
  isDirty,
  existingRuleId,
  onClose,
  onSave,
  onDelete,
  onApprove,
  buildRuleInput,
  flushDirect,
}: UseRuleActionsOptions) {
  const saveMutation = useMutation({
    mutationFn: (input: RelationshipRuleInput) => onSave(input),
  });
  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => onDelete!(ruleId),
  });
  const approveMutation = useMutation({
    mutationFn: (ruleId: string) => onApprove!(ruleId),
  });
  const { mutateAsync: runSave } = saveMutation;
  const { mutateAsync: runDelete } = deleteMutation;
  const { mutateAsync: runApprove } = approveMutation;

  // One re-entry latch across all three actions: the save orchestration spans
  // two awaits (the write, then the direct-edge flush) and no single mutation's
  // isPending covers the whole window, so a second invocation in between could
  // double-submit — for a new rule that means a duplicate create. The manual
  // single-edge editor guards the same way (its handlers check `busy`).
  const actionInFlightRef = useRef(false);

  const handleSave = useCallback(async () => {
    if (!canSave || actionInFlightRef.current) {
      return;
    }
    actionInFlightRef.current = true;
    try {
      const saved = await runSave(buildRuleInput());
      // Flush buffered direct edges against the saved rule (its id is only
      // known now for a new rule). Failures are toasted inside flush and kept
      // in the buffer.
      const { failed } = await flushDirect(saved?.id ?? existingRuleId ?? null);
      // Hold the editor open to retry a partial flush failure ONLY when editing
      // an existing rule, where re-saving is an idempotent update. For a new
      // rule the rule was just created and the parent still has no id for it, so
      // a second save would create a DUPLICATE — close instead (the flush
      // failures are already toasted; reopening the now-existing rule lets the
      // user re-add the direct edges).
      if (failed === 0 || !isEdit) {
        onClose();
      }
    } catch {
      // Surfaced via saveMutation.error / a caller toast; don't close the editor.
    } finally {
      actionInFlightRef.current = false;
    }
  }, [
    canSave,
    isEdit,
    runSave,
    buildRuleInput,
    flushDirect,
    existingRuleId,
    onClose,
  ]);

  const handleDelete = useCallback(async () => {
    if (
      existingRuleId === undefined ||
      !onDelete ||
      actionInFlightRef.current
    ) {
      return;
    }
    actionInFlightRef.current = true;
    try {
      const deleted = await runDelete(existingRuleId);
      // `false` = the callback's own confirmation was cancelled; the rule
      // survives, so the editor (and any unsaved edits) must stay open.
      if (deleted !== false) {
        onClose();
      }
    } catch {
      // Surfaced via deleteMutation.error / a caller toast.
    } finally {
      actionInFlightRef.current = false;
    }
  }, [existingRuleId, onDelete, runDelete, onClose]);

  const handleApprove = useCallback(async () => {
    if (
      existingRuleId === undefined ||
      !onApprove ||
      actionInFlightRef.current
    ) {
      return;
    }
    actionInFlightRef.current = true;
    try {
      // Tweak-and-approve: what was previewed is what gets approved. A dirty
      // editor persists its edits first; `canApprove` gates the UI, this is
      // the last line of defense.
      if (isDirty) {
        if (!canSave) {
          return;
        }
        await runSave(buildRuleInput());
      }
      // Staged direct edges ship with the approval either way; a partial
      // failure keeps the editor open for retry (failures already toasted).
      const { failed } = await flushDirect(existingRuleId);
      if (failed > 0) {
        return;
      }
      await runApprove(existingRuleId);
      onClose();
    } catch {
      // Surfaced via the mutations / caller toasts.
    } finally {
      actionInFlightRef.current = false;
    }
  }, [
    existingRuleId,
    onApprove,
    isDirty,
    canSave,
    runSave,
    buildRuleInput,
    flushDirect,
    runApprove,
    onClose,
  ]);

  return {
    handleSave,
    handleDelete,
    handleApprove,
    saving: saveMutation.isPending,
    deleting: deleteMutation.isPending,
    approving: approveMutation.isPending,
  };
}
