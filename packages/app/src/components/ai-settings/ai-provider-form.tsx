import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { z } from 'zod';
import { Button } from '@roadiehq/ui/button';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from '@roadiehq/ui/form';
import { cn } from '@roadiehq/ui/utils';
import { Check } from 'lucide-react';
import { ProviderLogo } from './provider-logo';
import { useZodForm } from '../common';
import type { AIProvider, ProviderSettings } from './ai-settings-context';

type AIProviderField = {
  key: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  required?: boolean;
};

type AIProviderConfig = {
  id: AIProvider;
  name: string;
  fields: AIProviderField[];
};

export const providers: AIProviderConfig[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'sk-...',
        required: true,
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'sk-ant-...',
        required: true,
      },
    ],
  },
];

function isMaskedValue(value: string | undefined): boolean {
  return !!value && value.length > 0 && /^•+$/.test(value);
}

const providerIds = providers.map(p => p.id);

function createFormSchema(getConfiguredProvider: () => AIProvider | null) {
  return z
    .object({
      provider: z.enum(providerIds).nullable(),
      fields: z.record(z.string(), z.string()),
    })
    .superRefine((values, ctx) => {
      if (!values.provider) {
        ctx.addIssue({
          code: 'custom',
          message: 'Select a provider',
          path: ['provider'],
        });
        return;
      }
      const config = providers.find(p => p.id === values.provider);
      // A masked placeholder only stands in for a stored secret when this
      // provider is the one already configured on the backend.
      const providerIsConfigured = values.provider === getConfiguredProvider();
      for (const fieldConfig of config?.fields ?? []) {
        if (!fieldConfig.required) continue;
        const value = values.fields[`${fieldConfig.key}`] ?? '';
        const masked = isMaskedValue(value);
        const missing = masked
          ? !providerIsConfigured
          : value.trim().length === 0;
        if (missing) {
          ctx.addIssue({
            code: 'custom',
            message: `${fieldConfig.label} is required`,
            path: ['fields', fieldConfig.key],
          });
        }
      }
    });
}

type AIProviderFormValues = z.input<ReturnType<typeof createFormSchema>>;

function defaultFieldValues(
  provider: AIProvider | null,
  initialProvider: AIProvider | null,
  initialSettings: ProviderSettings | null,
): Record<string, string> {
  const config = providers.find(p => p.id === provider);
  const fields: Record<string, string> = {};
  for (const fieldConfig of config?.fields ?? []) {
    fields[`${fieldConfig.key}`] =
      provider !== null && provider === initialProvider
        ? (initialSettings?.[`${fieldConfig.key}`] ?? '')
        : '';
  }
  return fields;
}

export interface AIProviderFormProps {
  initialProvider: AIProvider | null;
  initialSettings: ProviderSettings | null;
  isConfigured?: boolean;
  onSave: (
    provider: AIProvider,
    settings: ProviderSettings,
  ) => void | Promise<void>;
  onCancel?: () => void;
  showCancel?: boolean;
}

export function AIProviderForm({
  initialProvider,
  initialSettings,
  isConfigured = false,
  onSave,
  onCancel,
  showCancel = true,
}: AIProviderFormProps) {
  const configuredProvider = isConfigured ? initialProvider : null;
  const configuredProviderRef = useRef(configuredProvider);
  configuredProviderRef.current = configuredProvider;

  // The schema reads the configured provider through a ref so validation
  // stays current without rebuilding the resolver when props change.
  const schema = useMemo(
    () => createFormSchema(() => configuredProviderRef.current),
    [],
  );

  const form = useZodForm({
    schema,
    defaultValues: {
      provider: initialProvider,
      fields: defaultFieldValues(
        initialProvider,
        initialProvider,
        initialSettings,
      ),
    },
  });

  useEffect(() => {
    form.reset({
      provider: initialProvider,
      fields: defaultFieldValues(
        initialProvider,
        initialProvider,
        initialSettings,
      ),
    });
  }, [form, initialProvider, initialSettings]);

  const selectedProvider = form.watch('provider');
  const currentProviderConfig = providers.find(p => p.id === selectedProvider);
  const providerIsConfigured =
    isConfigured && selectedProvider === initialProvider;

  const { isSubmitting, isDirty } = form.formState;
  const rootError = form.formState.errors.root?.message;

  const handleProviderSelect = useCallback(
    (
      newProvider: AIProvider,
      onChange: (value: AIProviderFormValues['provider']) => void,
    ) => {
      onChange(newProvider);
      form.setValue(
        'fields',
        defaultFieldValues(newProvider, initialProvider, initialSettings),
        { shouldDirty: true, shouldValidate: true },
      );
      form.clearErrors('root');
    },
    [form, initialProvider, initialSettings],
  );

  const handleSubmit = form.handleSubmit(async values => {
    if (!values.provider) return;
    const dirtyFields = form.formState.dirtyFields.fields ?? {};
    const settingsToSave: ProviderSettings = Object.fromEntries(
      Object.entries(values.fields).filter(
        ([key, value]) => dirtyFields[`${key}`] && !isMaskedValue(value),
      ),
    );
    try {
      await onSave(values.provider, settingsToSave);
      form.reset(values);
    } catch (e: unknown) {
      form.setError('root', {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

  const handleCancel = useCallback(() => {
    form.reset({
      provider: initialProvider,
      fields: defaultFieldValues(
        initialProvider,
        initialProvider,
        initialSettings,
      ),
    });
    onCancel?.();
  }, [form, initialProvider, initialSettings, onCancel]);

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        <fieldset disabled={isSubmitting} className="space-y-6">
          <FormField
            control={form.control}
            name="provider"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <span className="text-sm font-medium">Select Provider</span>
                <div className="grid grid-cols-3 gap-3">
                  {providers.map(providerConfig => (
                    <Button
                      key={providerConfig.id}
                      type="button"
                      variant="ghost"
                      aria-pressed={field.value === providerConfig.id}
                      onClick={() =>
                        handleProviderSelect(providerConfig.id, field.onChange)
                      }
                      className={cn(
                        'relative flex h-auto flex-col items-center gap-2 rounded-lg border-2 p-4',
                        'hover:border-primary/50 hover:bg-accent/50',
                        field.value === providerConfig.id
                          ? 'border-primary bg-accent'
                          : 'border-border',
                      )}
                    >
                      {field.value === providerConfig.id && (
                        <div className="absolute top-2 right-2">
                          <Check className="size-4 text-primary" />
                        </div>
                      )}
                      <ProviderLogo
                        provider={providerConfig.id}
                        className="size-10"
                      />
                      <span className="text-sm font-medium">
                        {providerConfig.name}
                      </span>
                    </Button>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {selectedProvider && currentProviderConfig && (
            <div className="space-y-4">
              {currentProviderConfig.fields.map(fieldConfig => (
                <FormField
                  key={fieldConfig.key}
                  control={form.control}
                  name={`fields.${fieldConfig.key}`}
                  render={({ field, fieldState }) => {
                    const showConfiguredHint =
                      providerIsConfigured &&
                      isMaskedValue(field.value) &&
                      !fieldState.isDirty;
                    return (
                      <FormItem>
                        <FormControl>
                          <OutlinedInput
                            label={
                              fieldConfig.required
                                ? `${fieldConfig.label} *`
                                : fieldConfig.label
                            }
                            type={fieldConfig.type}
                            placeholder={fieldConfig.placeholder}
                            {...field}
                            value={field.value ?? ''}
                          />
                        </FormControl>
                        {showConfiguredHint && (
                          <FormDescription className="mt-1 text-xs">
                            Currently configured. Enter a new value to change.
                          </FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              ))}
            </div>
          )}
        </fieldset>

        {rootError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {rootError}
          </p>
        )}

        <div className="flex justify-end gap-2">
          {showCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={!isDirty || isSubmitting}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            Save
          </Button>
        </div>
      </form>
    </Form>
  );
}
