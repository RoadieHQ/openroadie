import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import React, { useState } from 'react';
import { z } from 'zod';
import { useSecrets, useAlert } from '../../api';
import { invalidationKeys } from '../../api/queries';
import { useInvalidatingMutation } from '../../api/query-hooks';
import type { Secret } from '../../api/secrets';
import { Button } from '@roadiehq/ui/button';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from '@roadiehq/ui/form';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@roadiehq/ui/dropdown-menu';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { OutlinedTextarea } from '@roadiehq/ui/outlined-textarea';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useSecretSettings } from './secret-settings-context';
import { FormDialog, useResetFormOnOpen, useZodForm } from '../common';
import { helpUrlSchema, secretFieldMetaClassName } from './secret-schema';

const editSecretSchema = z.object({
  description: z.string().trim(),
  helpUrl: helpUrlSchema,
  value: z.string(),
});

type EditButtonProps = {
  secret: Secret;
  refreshData: () => Promise<void>;
  open: boolean;
  handleClickOpen: () => void;
  handleClose: () => void;
};

function secretDefaultValues(secret: Secret) {
  return {
    description: secret.description || '',
    helpUrl: secret.helpUrl || '',
    value: '',
  };
}

export function EditSecretButton({
  secret,
  refreshData,
  open,
  handleClickOpen,
  handleClose,
}: EditButtonProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const alertApi = useAlert();
  const secretsApi = useSecrets();
  const { readOnly } = useSecretSettings();

  // Same delete operation as required-secrets-panel — invalidate the shared
  // secret keys + metadata caches so every secrets view refreshes.
  const deleteMutation = useInvalidatingMutation({
    mutationFn: async () => {
      await secretsApi.deleteSecret(secret.name);
      if (secret.isCustom) {
        await secretsApi.deleteSecretMetadata(secret.name);
      }
    },
    invalidates: invalidationKeys.secretCatalog(),
  });

  const form = useZodForm({
    schema: editSecretSchema,
    defaultValues: secretDefaultValues(secret),
  });

  useResetFormOnOpen(form, open, () => secretDefaultValues(secret));

  if (readOnly) {
    return null;
  }

  const onSubmit = async (values: z.output<typeof editSecretSchema>) => {
    const metaChanged =
      Boolean(secret.isCustom) &&
      (values.description !== (secret.description || '') ||
        values.helpUrl !== (secret.helpUrl || ''));

    if (metaChanged) {
      await secretsApi.editSecret(secret.name, {
        description: values.description || null,
        helpUrl: values.helpUrl || null,
      });
    }
    if (values.value) {
      try {
        await secretsApi.setSecret(secret.name, values.value);
      } catch (e: unknown) {
        await refreshData();
        const reason = e instanceof Error ? e.message : String(e);
        throw new Error(
          metaChanged
            ? `The description and help URL were saved, but updating the secret value failed: ${reason}`
            : `Updating the secret value failed: ${reason}`,
        );
      }
    }
    await refreshData();
    handleClose();
  };

  const handleDeleteConfirmed = async () => {
    try {
      await deleteMutation.mutateAsync();
      await refreshData();
      setConfirmingDelete(false);
      handleClose();
    } catch (e: unknown) {
      alertApi.post({
        message: e instanceof Error ? e.message : 'Failed to delete secret',
        severity: 'error',
      });
      throw e;
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
            aria-label="Actions"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={handleClickOpen}>
            <Pencil />
            <span>Edit</span>
          </DropdownMenuItem>
          {secret.isCustom ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
                onSelect={() => setConfirmingDelete(true)}
              >
                <Trash2 />
                <span>Delete</span>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <FormDialog
        open={open}
        onOpenChange={val => !val && handleClose()}
        title={secret.name}
        description={secret.description || undefined}
        form={form}
        submitLabel="Save"
        submitDisabled={!form.formState.isDirty}
        onSubmit={onSubmit}
      >
        <div className="flex flex-col gap-4">
          {secret.isCustom && (
            <>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <OutlinedInput
                        label="Description"
                        placeholder="What is this secret used for?"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className={secretFieldMetaClassName} />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="helpUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <OutlinedInput
                        label="Help URL"
                        placeholder="https://docs.example.com/secrets/..."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className={secretFieldMetaClassName} />
                  </FormItem>
                )}
              />
            </>
          )}
          <FormField
            control={form.control}
            name="value"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <OutlinedTextarea
                    label="Secret Value"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    autoComplete="off"
                    {...field}
                  />
                </FormControl>
                <FormDescription className={secretFieldMetaClassName}>
                  Leave blank to keep the current value.
                </FormDescription>
                <FormMessage className={secretFieldMetaClassName} />
              </FormItem>
            )}
          />
        </div>
      </FormDialog>

      <ConfirmationDialog
        open={confirmingDelete}
        title={`Delete ${secret.name}?`}
        contentText="This permanently removes the secret and its value. Integrations using it will stop working until a replacement is configured."
        isDelete
        confirmButtonText="Delete"
        confirmingText="Deleting..."
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
