import { useCallback, type RefObject } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router';
import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';

interface UnsavedChangesBlockerProps {
  when: boolean;
  contentText?: string;
  allowNavigationRef?: RefObject<boolean>;
}

export function UnsavedChangesBlocker({
  when,
  contentText = 'Your unsaved changes will be lost.',
  allowNavigationRef,
}: UnsavedChangesBlockerProps) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      when &&
      !allowNavigationRef?.current &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash),
  );

  useBeforeUnload(
    useCallback(
      event => {
        if (when && !allowNavigationRef?.current) {
          event.preventDefault();
        }
      },
      [allowNavigationRef, when],
    ),
  );

  return (
    <ConfirmationDialog
      open={blocker.state === 'blocked'}
      title="Discard unsaved changes?"
      contentText={contentText}
      isDelete
      confirmButtonText="Discard"
      onConfirm={() => {
        if (blocker.state === 'blocked') {
          blocker.proceed();
        }
      }}
      onCancel={() => {
        if (blocker.state === 'blocked') {
          blocker.reset();
        }
      }}
    />
  );
}
