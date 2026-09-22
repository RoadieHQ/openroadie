import React, { useState } from 'react';
import { useSecrets } from '../../api';
import { useSecretSettings } from './secret-settings-context';
import { Button } from '@roadiehq/ui/button';
import { toolbarPrimaryCtaButtonClassName } from '@roadiehq/ui/toolbar';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from '@roadiehq/ui/form';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { OutlinedTextarea } from '@roadiehq/ui/outlined-textarea';
import { Plus } from 'lucide-react';
import { FormDialog, useResetFormOnOpen, useZodForm } from '../common';
import { createSecretSchema, secretFieldMetaClassName } from './secret-schema';

const addSecretSchema = createSecretSchema();

const defaultValues = {
  name: '',
  description: '',
  helpUrl: '',
  value: '',
};

export function AddSecretButton({
  refreshData,
}: {
  refreshData: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const secretsApi = useSecrets();
  const { readOnly } = useSecretSettings();

  const form = useZodForm({ schema: addSecretSchema, defaultValues });

  useResetFormOnOpen(form, open, () => defaultValues);

  if (readOnly) {
    return null;
  }

  return (
    <>
      <Button
        size="sm"
        className={toolbarPrimaryCtaButtonClassName}
        onClick={() => setOpen(true)}
      >
        <Plus />
        Add Secret
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Add Secret"
        form={form}
        submitLabel="Save"
        onSubmit={async values => {
          await secretsApi.upsertSecret({
            name: values.name,
            description: values.description || undefined,
            helpUrl: values.helpUrl || undefined,
            internalKeyName: values.name,
            value: values.value,
          });
          await refreshData();
          setOpen(false);
        }}
      >
        <div className="flex flex-col gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <OutlinedInput
                    label="Secret Name *"
                    placeholder="MY_INTEGRATION_API_TOKEN"
                    {...field}
                  />
                </FormControl>
                <FormDescription className={secretFieldMetaClassName}>
                  Use uppercase letters with underscores, like an environment
                  variable name (for example MY_API_TOKEN).
                </FormDescription>
                <FormMessage className={secretFieldMetaClassName} />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <OutlinedInput
                    label="Description (optional)"
                    placeholder="e.g. Read-only GitHub PAT for org repositories"
                    {...field}
                  />
                </FormControl>
                <FormDescription className={secretFieldMetaClassName}>
                  Say what this credential is for and what scope or access it
                  has, so teammates know how to rotate or replace it safely.
                </FormDescription>
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
                    label="Help URL (optional)"
                    placeholder="https://docs.github.com/en/authentication"
                    {...field}
                  />
                </FormControl>
                <FormDescription className={secretFieldMetaClassName}>
                  Use a full URL including https:// so the link works when
                  opened from the secrets list.
                </FormDescription>
                <FormMessage className={secretFieldMetaClassName} />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="value"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <OutlinedTextarea
                    label="Value *"
                    placeholder="Paste the token, API key, or password"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    autoComplete="off"
                    {...field}
                  />
                </FormControl>
                <FormMessage className={secretFieldMetaClassName} />
              </FormItem>
            )}
          />
        </div>
      </FormDialog>
    </>
  );
}
