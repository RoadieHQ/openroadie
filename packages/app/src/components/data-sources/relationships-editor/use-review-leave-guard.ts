import { useCallback, useState } from 'react';

interface UseReviewLeaveGuardResult {
  /**
   * Wrap any exit from the review editor. Runs it straight away when there is
   * nothing to lose; otherwise holds it until the user answers.
   */
  guard: (proceed: () => void) => void;
  /** Whether the confirmation is currently asking about a held exit. */
  isAsking: boolean;
  /** Leave anyway: run the held exit. */
  confirm: () => void;
  /** Stay: drop the held exit. */
  cancel: () => void;
}

/**
 * Stops the user leaving the suggestion review with retypes half-applied.
 *
 * A pending retype is a partially-completed save: the review knows which direct
 * edges still sit under the previous relationship type, and that record exists
 * nowhere else. Every exit — the drawer's ✕, Escape, a pane click, the
 * breadcrumb, switching out of Suggest mode — has to pass through here, or one
 * of them silently discards it.
 */
export function useReviewLeaveGuard(
  pendingRetypeCount: number,
): UseReviewLeaveGuardResult {
  const [heldExit, setHeldExit] = useState<(() => void) | null>(null);

  const guard = useCallback(
    (proceed: () => void) => {
      if (pendingRetypeCount === 0) {
        proceed();
        return;
      }
      // Stored as a thunk-returning setter: setState treats a bare function as
      // an updater and would call it immediately — i.e. leave anyway.
      setHeldExit(() => proceed);
    },
    [pendingRetypeCount],
  );

  // The count is re-read every render, so a background refetch that drops the
  // suggestion mid-dialog takes the dialog with it rather than leaving it
  // claiming there is something to lose.
  const isAsking = heldExit !== null && pendingRetypeCount > 0;

  const confirm = useCallback(() => {
    setHeldExit(current => {
      current?.();
      return null;
    });
  }, []);

  const cancel = useCallback(() => setHeldExit(null), []);

  return { guard, isAsking, confirm, cancel };
}
