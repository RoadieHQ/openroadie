import React from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@roadiehq/ui/dialog';
import { Button } from '@roadiehq/ui/button';
import { Form } from '@roadiehq/ui/form';

export interface FormDialogProps<
  TFieldValues extends FieldValues,
  TTransformedValues = TFieldValues,
> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  form: UseFormReturn<TFieldValues, unknown, TTransformedValues>;
  onSubmit: (values: TTransformedValues) => void | Promise<void>;
  submitLabel: string;
  cancelLabel?: string;
  submitDisabled?: boolean;
  footerExtra?: React.ReactNode;
  children: React.ReactNode;
}

export function FormDialog<
  TFieldValues extends FieldValues,
  TTransformedValues = TFieldValues,
>({
  open,
  onOpenChange,
  title,
  description,
  form,
  onSubmit,
  submitLabel,
  cancelLabel = 'Cancel',
  submitDisabled = false,
  footerExtra,
  children,
}: FormDialogProps<TFieldValues, TTransformedValues>) {
  const { isSubmitting } = form.formState;
  const rootError = form.formState.errors.root?.message;

  const handleOpenChange = (next: boolean) => {
    if (!next && form.formState.isSubmitting) {
      return;
    }
    onOpenChange(next);
  };

  const handleSubmit = form.handleSubmit(
    async values => {
      // Enter submits the form natively, bypassing the disabled submit button —
      // honour the same guard here so a not-ready form can't be submitted.
      if (submitDisabled) {
        return;
      }
      // Drop any root error from a previous failed attempt before retrying.
      form.clearErrors('root');
      try {
        await onSubmit(values);
      } catch (e: unknown) {
        form.setError('root', {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    // A submit that fails schema validation isn't a save attempt — clear any
    // stale root error from a prior failed save so it doesn't linger behind the
    // field errors.
    () => form.clearErrors('root'),
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        {...(description ? {} : { 'aria-describedby': undefined })}
        // DialogContent is surface-coloured; mask the Outlined* label notches to
        // match so no dialog form has to set --field-bg itself.
        style={{ '--field-bg': 'var(--color-surface)' } as React.CSSProperties}
      >
        <Form {...form}>
          <form
            onSubmit={event => {
              event.stopPropagation();
              void handleSubmit(event);
            }}
            className="contents"
            noValidate
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <DialogDescription>{description}</DialogDescription>
              )}
            </DialogHeader>
            <fieldset disabled={isSubmitting} className="contents">
              {children}
            </fieldset>
            {rootError && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {rootError}
              </p>
            )}
            <DialogFooter>
              {footerExtra && (
                <div className="flex items-center sm:mr-auto">
                  {footerExtra}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => handleOpenChange(false)}
              >
                {cancelLabel}
              </Button>
              <Button type="submit" disabled={isSubmitting || submitDisabled}>
                {submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
