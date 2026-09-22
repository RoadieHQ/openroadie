import React, { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useAlert, useSecrets } from '../../../api';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from '@roadiehq/ui/form';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { OutlinedSelect } from '@roadiehq/ui/outlined-select';
import { OutlinedTextarea } from '@roadiehq/ui/outlined-textarea';
import { SelectItem, SelectSeparator } from '@roadiehq/ui/select';
import {
  getSecretOptionNames,
  toSecretVariable,
} from './integration-secret-refs';
import { uniqueSuggestedSecretName } from './integration-secret-name-suggestion';
import {
  FormDialog,
  PickerCombobox,
  useResetFormOnOpen,
  useZodForm,
} from '../../common';
import { createSecretSchema } from '../../secrets/secret-schema';

const CREATE_SECRET_SENTINEL = '__roadie_integration_create_secret__';

const SEARCHABLE_SECRET_THRESHOLD = 10;

const createIntegrationSecretDefaultValues = {
  name: '',
  description: '',
  helpUrl: '',
  value: '',
};

export function getUnavailableSecretNames(
  existingSecretNames: readonly string[] = [],
  reservedSecretNames: readonly string[] = [],
): string[] {
  return Array.from(
    new Set(
      [...existingSecretNames, ...reservedSecretNames]
        .map(name => name.trim())
        .filter(name => name.length > 0),
    ),
  );
}

export function getSuggestedCreateSecretName(
  suggestedSecretName: string,
  existingSecretNames: readonly string[] = [],
  reservedSecretNames: readonly string[] = [],
): string {
  return uniqueSuggestedSecretName(
    suggestedSecretName.trim(),
    getUnavailableSecretNames(existingSecretNames, reservedSecretNames),
  );
}

function CreateIntegrationSecretDialog({
  open,
  onOpenChange,
  onCreated,
  initialSecretName,
  existingSecretNames = [],
  reservedSecretNames = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (secretName: string) => void | Promise<void>;
  initialSecretName: string;
  existingSecretNames?: readonly string[];
  reservedSecretNames?: readonly string[];
}) {
  const alertApi = useAlert();
  const secretsApi = useSecrets();

  const schema = useMemo(
    () =>
      createSecretSchema({
        existingNames: existingSecretNames,
        reservedNames: reservedSecretNames,
      }),
    [existingSecretNames, reservedSecretNames],
  );

  const form = useZodForm({
    schema,
    defaultValues: createIntegrationSecretDefaultValues,
  });

  useResetFormOnOpen(form, open, () => ({
    ...createIntegrationSecretDefaultValues,
    name: initialSecretName.trim(),
  }));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add secret"
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
        alertApi.post({
          message: 'Secret saved',
          severity: 'success',
          display: 'transient',
        });
        await onCreated(values.name);
        onOpenChange(false);
      }}
    >
      <div className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <OutlinedInput
                  label="Secret name *"
                  placeholder="MY_INTEGRATION_API_TOKEN"
                  {...field}
                />
              </FormControl>
              <FormDescription className="mt-1 ml-[14px] text-xs leading-[20px]">
                Use uppercase letters with underscores, like an environment
                variable name (for example MY_API_TOKEN).
              </FormDescription>
              <FormMessage className="mt-1 ml-[14px] text-xs leading-[20px]" />
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
              <FormDescription className="mt-1 ml-[14px] text-xs leading-[20px]">
                Say what this credential is for and what scope or access it has,
                so teammates know how to rotate or replace it safely.
              </FormDescription>
              <FormMessage className="mt-1 ml-[14px] text-xs leading-[20px]" />
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
              <FormDescription className="mt-1 ml-[14px] text-xs leading-[20px]">
                Use a full URL including https:// so the link works when opened
                from the secrets list.
              </FormDescription>
              <FormMessage className="mt-1 ml-[14px] text-xs leading-[20px]" />
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
              <FormMessage className="mt-1 ml-[14px] text-xs leading-[20px]" />
            </FormItem>
          )}
        />
      </div>
    </FormDialog>
  );
}

export function IntegrationSecretOutlinedSelect({
  label,
  value,
  onValueChange,
  disabled = false,
  secretOptions,
  reservedSecretNames = [],
  onSecretListChanged,
  secretsListReadOnly = false,
  onSecretsChanged,
  suggestedSecretName,
}: {
  label: string;
  value: string;
  onValueChange: (next: string) => void;
  disabled?: boolean;
  secretOptions: string[];
  reservedSecretNames?: string[];
  onSecretListChanged?: () => void | Promise<void>;
  secretsListReadOnly?: boolean;
  onSecretsChanged?: () => void;
  suggestedSecretName?: string;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createDialogSeedName, setCreateDialogSeedName] = useState('');
  const showPinnedCreate = !disabled && !secretsListReadOnly;

  const optionNames = getSecretOptionNames(secretOptions, value);
  const useSearchable = optionNames.length > SEARCHABLE_SECRET_THRESHOLD;

  const openCreateDialog = () => {
    setCreateDialogSeedName(
      getSuggestedCreateSecretName(
        suggestedSecretName ?? '',
        optionNames,
        reservedSecretNames,
      ),
    );
    setCreateOpen(true);
  };

  const handleValueChange = (next: string) => {
    if (next === CREATE_SECRET_SENTINEL) {
      openCreateDialog();
      return;
    }
    onValueChange(next);
  };

  const pickerGroups = [
    {
      options: optionNames.map(secretName => ({
        id: toSecretVariable(secretName),
        label: secretName,
      })),
    },
  ];

  const handleCreated = async (secretName: string) => {
    await onSecretListChanged?.();
    onSecretsChanged?.();
    onValueChange(toSecretVariable(secretName));
  };

  return (
    <>
      {useSearchable ? (
        <PickerCombobox
          className="w-full min-w-0"
          label={label}
          groups={pickerGroups}
          selectedId={value || undefined}
          onSelect={onValueChange}
          disabled={disabled}
          footerAction={
            showPinnedCreate
              ? {
                  label: 'Create new secret',
                  icon: <Plus className="size-4 shrink-0" aria-hidden />,
                  onSelect: openCreateDialog,
                }
              : undefined
          }
        />
      ) : (
        <OutlinedSelect
          label={label}
          value={value ?? ''}
          onValueChange={handleValueChange}
          disabled={disabled}
          className="w-full min-w-0"
        >
          {showPinnedCreate && (
            <>
              <SelectItem
                value={CREATE_SECRET_SENTINEL}
                className="px-4 py-2 font-medium text-primary focus:text-primary"
                textValue="Create new secret"
              >
                <span className="flex items-center gap-2">
                  <Plus className="size-4 shrink-0" aria-hidden />
                  Create new secret
                </span>
              </SelectItem>
              <SelectSeparator className="bg-divider" />
            </>
          )}
          {optionNames.map(secretName => (
            <SelectItem
              key={secretName}
              value={toSecretVariable(secretName)}
              className="px-4 py-1.5 text-base"
            >
              {secretName}
            </SelectItem>
          ))}
        </OutlinedSelect>
      )}

      <CreateIntegrationSecretDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
        initialSecretName={createDialogSeedName}
        existingSecretNames={optionNames}
        reservedSecretNames={reservedSecretNames}
      />
    </>
  );
}
