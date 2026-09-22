import React from 'react';
import type {
  FieldErrors,
  SubmitErrorHandler,
  UseFormReturn,
} from 'react-hook-form';
import { Button } from '@roadiehq/ui/button';
import { Form } from '@roadiehq/ui/form';
import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { getFirstInvalidIntegrationFieldPath } from './integration-form-focus-field';
import type { IntegrationFormValues } from './integration-schema';

/**
 * Advanced-disclosure field paths. When the first invalid field on a failed
 * save lives here, the Advanced section is expanded before focusing it so the
 * error is visible.
 */
const ADVANCED_FIELD_PATHS = [
  'requestsPerHour',
  'requestsPerSecond',
  'burstCapacity',
  'paginationDefault',
  'defaultHeaders',
  'caCertificate',
];

/**
 * Shared controller for the integration form shells (the admin `IntegrationFormDialog`
 * modal and the routed `IntegrationEditor` page). Owns the pieces both shells
 * duplicated: the scroll-preserving Advanced toggle, the invalid-save handler
 * (advanced-section reveal + focus), the submit guard, and the discard-confirm
 * state / close guard. The surrounding chrome (modal vs page, header, footer)
 * stays with each shell.
 */
export function useIntegrationFormShell({
  form,
  isEdit,
  readOnly,
  isSystemIntegration,
  handleSave,
  onClose,
}: {
  form: UseFormReturn<IntegrationFormValues>;
  isEdit: boolean;
  readOnly: boolean;
  isSystemIntegration: boolean;
  handleSave: (onInvalid?: SubmitErrorHandler<IntegrationFormValues>) => void;
  onClose: () => void;
}) {
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = React.useState(false);

  const setAdvancedOpenPreservingScroll = React.useCallback((next: boolean) => {
    const scrollContainer = scrollContainerRef.current;
    const previousScrollTop = scrollContainer?.scrollTop;
    setAdvancedOpen(next);
    if (scrollContainer && previousScrollTop !== undefined) {
      requestAnimationFrame(() => {
        scrollContainer.scrollTop = previousScrollTop;
      });
    }
  }, []);

  const handleInvalidSave = React.useCallback(
    (errors: FieldErrors<IntegrationFormValues>) => {
      const firstInvalidField = getFirstInvalidIntegrationFieldPath(
        errors,
        form.getValues(),
        { isEdit, systemIntegration: isSystemIntegration, readOnly },
      );
      if (!firstInvalidField) {
        return;
      }
      if (
        ADVANCED_FIELD_PATHS.some(path => firstInvalidField.startsWith(path))
      ) {
        setAdvancedOpen(true);
      }
      requestAnimationFrame(() => {
        form.setFocus(firstInvalidField);
      });
    },
    [form, isEdit, isSystemIntegration, readOnly],
  );

  const handleGuardedSubmit = React.useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (
        readOnly ||
        form.formState.isSubmitting ||
        (isEdit && !form.formState.isDirty)
      ) {
        return;
      }
      handleSave(handleInvalidSave);
    },
    [readOnly, form, isEdit, handleSave, handleInvalidSave],
  );

  // Close is blocked while submitting; a dirty non-read-only form asks for
  // confirmation, everything else closes immediately.
  const requestClose = React.useCallback(() => {
    if (form.formState.isSubmitting) {
      return;
    }
    if (!readOnly && form.formState.isDirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    onClose();
  }, [readOnly, form, onClose]);

  return {
    scrollContainerRef,
    advancedOpen,
    setAdvancedOpen,
    setAdvancedOpenPreservingScroll,
    handleInvalidSave,
    handleGuardedSubmit,
    confirmDiscardOpen,
    setConfirmDiscardOpen,
    requestClose,
  };
}

/**
 * The shared `<Form>` + real `<form>` body used by both integration shells: a
 * hidden submit button for implicit (Enter) submission, the scroll region, the
 * `IntegrationFormFields` (passed as children so each shell keeps its own field
 * wiring), and the root-error alert. Fields are wrapped in a
 * `<fieldset disabled={isSubmitting}>` so the whole body disables during save.
 */
export function IntegrationFormBody({
  form,
  formId,
  onSubmit,
  scrollContainerRef,
  formClassName,
  scrollClassName,
  rootError,
  children,
}: {
  form: UseFormReturn<IntegrationFormValues>;
  formId: string;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  formClassName: string;
  scrollClassName: string;
  rootError?: string;
  children: React.ReactNode;
}) {
  const { isSubmitting } = form.formState;

  return (
    <Form {...form}>
      <form
        id={formId}
        noValidate
        className={formClassName}
        onSubmit={onSubmit}
      >
        {/* Default button for implicit (Enter) submission: the visible Save
            button lives outside the <form> and is only associated via the form
            attribute. */}
        <Button type="submit" hidden tabIndex={-1} />
        <div ref={scrollContainerRef} className={scrollClassName}>
          <fieldset disabled={isSubmitting} className="contents">
            {children}
          </fieldset>
          {rootError && (
            <p
              role="alert"
              className="mt-4 text-sm font-medium text-destructive"
            >
              {rootError}
            </p>
          )}
        </div>
      </form>
    </Form>
  );
}

/** Shared "Discard unsaved changes?" confirmation used by both shells. */
export function IntegrationDiscardDialog({
  open,
  onDiscard,
  onCancel,
}: {
  open: boolean;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmationDialog
      open={open}
      title="Discard unsaved changes?"
      contentText="Your edits to this integration have not been saved and will be lost."
      isDelete
      confirmButtonText="Discard"
      onConfirm={onDiscard}
      onCancel={onCancel}
    />
  );
}
