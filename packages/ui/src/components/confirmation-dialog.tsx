import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './dialog';
import { Button } from './button';

interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  contentText?: React.ReactNode;
  /**
   * Extra body content, rendered below the prompt and OUTSIDE the accessible
   * description. Put anything interactive here — a checkbox in `contentText`
   * lands inside the element `aria-describedby` points at, so a screen reader
   * announces the control as part of the dialog's description.
   */
  children?: React.ReactNode;
  isDelete?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  confirmButtonText?: string;
  confirmingText?: string;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
}

/**
 * Standard confirm/cancel prompt — use this for any "are you sure" flow
 * instead of composing Dialog by hand. If `onConfirm` returns a promise, both
 * buttons stay disabled (and the confirm label swaps to `confirmingText`)
 * until it settles; rejections are swallowed — surface errors at the call
 * site. `isDelete` styles the confirm button as destructive.
 */
export function ConfirmationDialog({
  open,
  title,
  contentText,
  children,
  isDelete = false,
  onConfirm,
  onCancel,
  confirmButtonText = 'Confirm',
  confirmingText,
  confirmDisabled = false,
  cancelDisabled = false,
}: ConfirmationDialogProps) {
  const [pending, setPending] = React.useState(false);

  // Reset pending whenever the dialog closes so a reopen never starts with
  // Confirm/Cancel stuck disabled — e.g. if it was closed while a prior
  // onConfirm was still in flight.
  React.useEffect(() => {
    if (!open) setPending(false);
  }, [open]);

  const handleConfirm = () => {
    const result = onConfirm();
    if (result && typeof result.then === 'function') {
      setPending(true);
      // Rejections are swallowed on purpose: callers surface their own errors,
      // the dialog only resets its pending state and stays open.
      Promise.resolve(result).then(
        () => setPending(false),
        () => setPending(false),
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={o => !o && !cancelDisabled && !pending && onCancel()}
    >
      <DialogContent
        data-testid="confirmation-dialog"
        {...(contentText ? {} : { 'aria-describedby': undefined })}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {contentText && <DialogDescription>{contentText}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={cancelDisabled || pending}
          >
            Cancel
          </Button>
          <Button
            variant={isDelete ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={confirmDisabled || pending}
            data-testid="delete-btn-confirmation-dialog"
          >
            {pending
              ? (confirmingText ?? confirmButtonText)
              : confirmButtonText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
