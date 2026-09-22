import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@roadiehq/ui/dialog';
import { Button } from '@roadiehq/ui/button';
import { Spinner } from '@roadiehq/ui/spinner';
import { useIntegrationForm } from './use-integration-form';
import type { IntegrationLike } from './use-integration-form';
import type { Integration } from '../types';
import { getIntegrationRequiredSecretRefs } from '../secret-requirements';
import { IntegrationFormFields } from './integration-form-fields';
import {
  IntegrationFormBody,
  IntegrationDiscardDialog,
  useIntegrationFormShell,
} from './integration-form-shell';
import { Copy, Trash2 } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';

interface IntegrationFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: (integration: Integration) => void;
  onSecretsChanged?: () => void;
  integration?: IntegrationLike;
  template?: Partial<IntegrationLike>;
  /** When creating (not editing), keep the backend type field read-only. */
  lockCreateBackendType?: boolean;
  readOnly?: boolean;
  onRequestDelete?: () => void;
  onRequestDuplicate?: () => void;
  deleteDisabledReason?: string | null;
}

export function IntegrationFormDialog({
  open,
  onClose,
  onSaved,
  onSecretsChanged,
  integration,
  template,
  lockCreateBackendType = false,
  readOnly = false,
  onRequestDelete,
  onRequestDuplicate,
  deleteDisabledReason,
}: IntegrationFormDialogProps) {
  const nameFieldInputRef = React.useRef<HTMLInputElement | null>(null);
  const dialogTitleRef = React.useRef<HTMLHeadingElement | null>(null);
  const formId = React.useId();

  const {
    form,
    isEdit,
    autoSlug,
    markSlugEdited,
    secretOptions,
    reservedSecretNames,
    handleSave,
    refreshSecretList,
    secretsListReadOnly,
    logoCatalog,
  } = useIntegrationForm({ open, onClose, onSaved, integration, template });

  const sourceIntegration = integration ?? template;
  const integrationName = form.watch('name')?.trim() || sourceIntegration?.name;
  const requiredSecretRefs = sourceIntegration
    ? getIntegrationRequiredSecretRefs(sourceIntegration)
    : [];
  const rootError = form.formState.errors.root?.message;

  const showDelete = isEdit && !readOnly && !!onRequestDelete;
  const showDuplicate = isEdit && !readOnly && !!onRequestDuplicate;
  const showHeaderEditActions = showDelete || showDuplicate;
  const deleteDisabled = !!deleteDisabledReason;

  const isSystemIntegration = integration?.createdBy === 'system';
  const isPreBuiltReadOnly = readOnly && isSystemIntegration;
  const metadataReadOnly =
    readOnly || isSystemIntegration || (lockCreateBackendType && !isEdit);
  const nameReadOnly = readOnly;
  const advancedReadOnly = readOnly || isSystemIntegration;

  const dialogContentRef = React.useRef<HTMLDivElement>(null);
  const [logoPickerPopoverContainer, setLogoPickerPopoverContainer] =
    React.useState<HTMLElement | null>(null);

  const {
    scrollContainerRef,
    advancedOpen,
    setAdvancedOpen,
    setAdvancedOpenPreservingScroll,
    handleGuardedSubmit,
    confirmDiscardOpen,
    setConfirmDiscardOpen,
    requestClose,
  } = useIntegrationFormShell({
    form,
    isEdit,
    readOnly,
    isSystemIntegration,
    handleSave,
    onClose,
  });

  React.useLayoutEffect(() => {
    if (open) {
      setLogoPickerPopoverContainer(dialogContentRef.current);
    } else {
      setLogoPickerPopoverContainer(null);
      setAdvancedOpen(false);
      setConfirmDiscardOpen(false);
    }
  }, [open, setAdvancedOpen, setConfirmDiscardOpen]);

  return (
    <>
      <Dialog open={open} onOpenChange={o => !o && requestClose()}>
        <DialogContent
          ref={dialogContentRef}
          aria-describedby={undefined}
          style={
            { '--field-bg': 'var(--color-surface)' } as React.CSSProperties
          }
          className="flex max-h-[calc(100vh-64px)] min-h-0 max-w-[600px] flex-col gap-0 overflow-hidden border-none bg-surface px-0 py-px shadow-md"
          hideCloseButton
          onOpenAutoFocus={e => {
            e.preventDefault();
            if (readOnly || isPreBuiltReadOnly) {
              requestAnimationFrame(() => {
                dialogTitleRef.current?.focus({ preventScroll: true });
              });
              return;
            }
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (nameFieldInputRef.current && !nameReadOnly) {
                  nameFieldInputRef.current.focus({ preventScroll: true });
                } else {
                  dialogTitleRef.current?.focus({ preventScroll: true });
                }
              });
            });
          }}
        >
          <DialogHeader className="shrink-0 space-y-0 px-6 py-4">
            <div className="flex items-start justify-between gap-3">
              <DialogTitle
                ref={dialogTitleRef}
                tabIndex={-1}
                className="min-w-0 flex-1 text-left text-base leading-[1.6] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {readOnly
                  ? integrationName || 'Integration'
                  : isEdit
                    ? 'Edit Integration'
                    : template
                      ? 'Duplicate Integration'
                      : 'New Integration'}
              </DialogTitle>
              {showHeaderEditActions && (
                <TooltipProvider delayDuration={300}>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {showDuplicate && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-foreground"
                            aria-label="Duplicate integration"
                            onClick={() => onRequestDuplicate?.()}
                          >
                            <Copy className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          Duplicate integration
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {showDelete && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              aria-label="Delete integration"
                              disabled={deleteDisabled}
                              onClick={() => onRequestDelete?.()}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {deleteDisabled && deleteDisabledReason
                            ? deleteDisabledReason
                            : 'Delete integration'}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </TooltipProvider>
              )}
            </div>
          </DialogHeader>

          <IntegrationFormBody
            form={form}
            formId={formId}
            onSubmit={handleGuardedSubmit}
            scrollContainerRef={scrollContainerRef}
            formClassName="mt-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            scrollClassName="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-b border-divider px-6 pt-4 pb-[15px]"
            rootError={rootError}
          >
            <IntegrationFormFields
              form={form}
              isEdit={isEdit}
              autoSlug={autoSlug}
              onSlugEdited={markSlugEdited}
              secretOptions={secretOptions}
              reservedSecretNames={reservedSecretNames}
              refreshSecretList={refreshSecretList}
              secretsListReadOnly={secretsListReadOnly}
              logoCatalog={logoCatalog}
              onSecretsChanged={onSecretsChanged}
              readOnly={readOnly}
              isPreBuiltReadOnly={isPreBuiltReadOnly}
              metadataReadOnly={metadataReadOnly}
              advancedReadOnly={advancedReadOnly}
              nameReadOnly={nameReadOnly}
              requiredSecretRefs={requiredSecretRefs}
              logoPickerPopoverContainer={logoPickerPopoverContainer}
              nameFieldInputRef={nameFieldInputRef}
              advancedOpen={advancedOpen}
              onAdvancedOpenChange={setAdvancedOpenPreservingScroll}
              integrationId={integration?.id}
            />
          </IntegrationFormBody>

          <DialogFooter className="z-10 shrink-0 border-t border-divider bg-surface px-6 py-4">
            {readOnly ? (
              <Button
                type="button"
                variant="ghost"
                className="text-primary"
                onClick={onClose}
              >
                Close
              </Button>
            ) : (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="text-primary"
                  onClick={requestClose}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form={formId}
                  disabled={
                    form.formState.isSubmitting ||
                    (isEdit && !form.formState.isDirty)
                  }
                  className="disabled:bg-disabled disabled:text-disabled-foreground"
                >
                  {form.formState.isSubmitting && (
                    <Spinner className="mr-2 size-4" />
                  )}
                  {isEdit ? 'Save Changes' : 'Create'}
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <IntegrationDiscardDialog
        open={confirmDiscardOpen}
        onDiscard={() => {
          setConfirmDiscardOpen(false);
          onClose();
        }}
        onCancel={() => setConfirmDiscardOpen(false)}
      />
    </>
  );
}
