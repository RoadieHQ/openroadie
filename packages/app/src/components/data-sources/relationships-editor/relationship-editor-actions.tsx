import type { ReactNode } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Spinner } from '@roadiehq/ui/spinner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';

export interface RelationshipEditorActionsProps {
  isEdit: boolean;
  /** Primary-button label for the create case (edit always reads "Save"). */
  createLabel: string;
  /** Overrides the label entirely, for editors whose primary action isn't a
   *  plain save (the suggestion reviewer's Approve). */
  primaryLabel?: string;
  canSave: boolean;
  busy: boolean;
  saving: boolean;
  deleting: boolean;
  /** Reason the save is gated; shown as a tooltip on the disabled button. */
  saveBlockedReason?: string | null;
  onSave: () => void;
  /** When set (and editing), a destructive icon button is shown. */
  onDelete?: () => void;
  /** What that button actually does. Suggestion reviewers wire it to dismiss
   *  (the rule survives as `inactive`), rule editors to a real delete — so the
   *  label is the caller's to say, not this component's to assume. */
  deleteLabel?: string;
  /**
   * When set, a Cancel button is rendered. Omit it where surrounding chrome
   * already owns the close affordance (a DrawerStack header) — two identical
   * ✕ buttons doing different things is a trap.
   */
  onClose?: () => void;
  /** Extra buttons rendered first (e.g. the rule editor's Approve). */
  leadingActions?: ReactNode;
}

/**
 * The Save / destructive / Cancel action cluster shared by the relationship-rule
 * inspector and the manual single-edge editor: a gated primary button whose
 * blocked reason rides a tooltip, an optional destructive action (when editing,
 * labelled by the caller — Delete or Dismiss), and Cancel.
 * Editor-specific extras (the rule editor's Approve) slot in via `leadingActions`.
 */
export function RelationshipEditorActions({
  isEdit,
  createLabel,
  primaryLabel,
  canSave,
  busy,
  saving,
  deleting,
  saveBlockedReason,
  onSave,
  onDelete,
  deleteLabel = 'Delete',
  onClose,
  leadingActions,
}: RelationshipEditorActionsProps) {
  const saveButton = (
    <Button
      size="sm"
      className="h-7 gap-1 px-2 text-2xs"
      onClick={onSave}
      disabled={!canSave || busy}
    >
      {saving ? <Spinner className="size-3" /> : <Check className="size-3" />}
      {primaryLabel ?? (isEdit ? 'Save' : createLabel)}
    </Button>
  );

  return (
    <TooltipProvider delayDuration={200}>
      {leadingActions}
      {isEdit && onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={deleteLabel}
          title={deleteLabel}
          onClick={onDelete}
          disabled={busy}
        >
          {deleting ? (
            <Spinner className="size-3" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </Button>
      )}
      {/* When save is gated (e.g. no preview yet), the reason rides the button as
          a tooltip. A span wraps the (disabled) button so the tooltip still opens
          on hover. */}
      {saveBlockedReason ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{saveButton}</span>
          </TooltipTrigger>
          <TooltipContent>{saveBlockedReason}</TooltipContent>
        </Tooltip>
      ) : (
        saveButton
      )}
      {/* Close is the last (right-most) action. */}
      {onClose && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Cancel"
          title="Cancel"
          onClick={onClose}
          disabled={busy}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </TooltipProvider>
  );
}
