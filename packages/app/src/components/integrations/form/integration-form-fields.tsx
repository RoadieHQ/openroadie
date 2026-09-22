import React from 'react';
import { AdvancedSection } from '@roadiehq/ui/advanced-section';
import { SelectItem } from '@roadiehq/ui/select';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { OutlinedNumberInput } from '@roadiehq/ui/outlined-number-input';
import { OutlinedSelect } from '@roadiehq/ui/outlined-select';
import {
  FormField,
  FormItem,
  FormControl,
  FormDescription,
  FormMessage,
} from '@roadiehq/ui/form';
import { cn } from '@roadiehq/ui/utils';
import type { UseFormReturn } from 'react-hook-form';
import type { LogoEntry } from '../../../api/workflow/workflow-client';
import { INTEGRATION_TYPES, INTEGRATION_BACKEND_TYPES } from '../constants';
import type { IntegrationFormValues } from './integration-schema';
import { AwsConfigFields } from './aws-config-fields';
import {
  HttpConnectionFields,
  HttpAuthFields,
  HttpPaginationDefaultFields,
  HttpDefaultHeadersFields,
  HttpCaCertificateField,
} from './http-config-fields';
import { PrebuiltHttpReadonlyDetails } from './integration-prebuilt-readonly-details';
import { LogoPicker } from './logo-picker';
import { RequiredSecretsPanel } from './required-secrets-panel';

/**
 * Shell-agnostic body of the integration form — every field, the metadata row,
 * the backend-specific sections, and the Advanced disclosure. Rendered by both
 * {@link IntegrationFormDialog} (inside a `DialogContent` scroll region) and the
 * routed `IntegrationEditor` page (inside a page scroll region). The parent shell
 * owns the surrounding `<Form>` provider, the scroll container, the header, and
 * the footer/save actions; this component only renders the fields so the dialog
 * and the page stay byte-for-byte identical in behaviour.
 */
export interface IntegrationFormFieldsProps {
  form: UseFormReturn<IntegrationFormValues>;
  isEdit: boolean;
  autoSlug: boolean;
  onSlugEdited: () => void;
  secretOptions: string[];
  reservedSecretNames: string[];
  refreshSecretList: () => void;
  secretsListReadOnly: boolean;
  logoCatalog: LogoEntry[];
  onSecretsChanged?: () => void;
  readOnly: boolean;
  isPreBuiltReadOnly: boolean;
  metadataReadOnly: boolean;
  advancedReadOnly: boolean;
  nameReadOnly: boolean;
  requiredSecretRefs: string[];
  logoPickerPopoverContainer: HTMLElement | null;
  nameFieldInputRef: React.MutableRefObject<HTMLInputElement | null>;
  advancedOpen: boolean;
  onAdvancedOpenChange: (next: boolean) => void;
  /** Absent while creating — the AWS trust setup values need a persisted id. */
  integrationId?: string;
}

export function IntegrationFormFields({
  form,
  isEdit,
  autoSlug,
  onSlugEdited,
  secretOptions,
  reservedSecretNames,
  refreshSecretList,
  secretsListReadOnly,
  logoCatalog,
  onSecretsChanged,
  readOnly,
  isPreBuiltReadOnly,
  metadataReadOnly,
  advancedReadOnly,
  nameReadOnly,
  requiredSecretRefs,
  logoPickerPopoverContainer,
  nameFieldInputRef,
  advancedOpen,
  onAdvancedOpenChange,
  integrationId,
}: IntegrationFormFieldsProps) {
  const backendType = form.watch('backendType');

  return (
    <>
      {requiredSecretRefs.length > 0 && (
        <div className="mb-5">
          <RequiredSecretsPanel
            secretRefs={requiredSecretRefs}
            onSecretsChanged={onSecretsChanged}
          />
        </div>
      )}

      {isPreBuiltReadOnly ? (
        <div className="flex min-w-0 flex-col gap-5">
          {backendType === 'http' && (
            <PrebuiltHttpReadonlyDetails control={form.control} />
          )}
        </div>
      ) : (
        <>
          <fieldset className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
            <div className="flex min-w-0 flex-row-reverse items-center gap-3">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="min-w-0 flex-1">
                    <FormControl>
                      <OutlinedInput
                        label="Name *"
                        disabled={nameReadOnly}
                        {...field}
                        ref={el => {
                          nameFieldInputRef.current = el;
                          field.ref(el);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="logoSlug"
                render={({ field }) => (
                  <div
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-input-border bg-[var(--field-bg,var(--color-card))] shadow-sm',
                      metadataReadOnly && 'opacity-70',
                    )}
                  >
                    <LogoPicker
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      disabled={metadataReadOnly}
                      logos={logoCatalog}
                      popoverContainer={logoPickerPopoverContainer}
                    />
                  </div>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <OutlinedInput
                      label="Slug *"
                      disabled={isEdit || metadataReadOnly}
                      {...field}
                      onChange={e => {
                        field.onChange(e);
                        onSlugEdited();
                      }}
                    />
                  </FormControl>
                  {autoSlug && (
                    <FormDescription>Auto-generated from name</FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-3">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <OutlinedSelect
                        label="Type"
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={metadataReadOnly}
                      >
                        {INTEGRATION_TYPES.map(t => (
                          <SelectItem
                            key={t.value}
                            value={t.value}
                            className="px-4 py-1.5 text-base"
                          >
                            {t.label}
                          </SelectItem>
                        ))}
                      </OutlinedSelect>
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="backendType"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <OutlinedSelect
                        label="Backend"
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={metadataReadOnly}
                      >
                        {INTEGRATION_BACKEND_TYPES.map(t => (
                          <SelectItem
                            key={t.value}
                            value={t.value}
                            className="px-4 py-1.5 text-base"
                          >
                            {t.label}
                          </SelectItem>
                        ))}
                      </OutlinedSelect>
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            {backendType === 'http' && (
              <HttpConnectionFields
                control={form.control}
                readOnly={readOnly}
              />
            )}

            {backendType === 'aws' && (
              <AwsConfigFields
                control={form.control}
                readOnly={readOnly}
                integrationId={integrationId}
              />
            )}

            {backendType === 'http' && (
              <HttpAuthFields
                control={form.control}
                secretOptions={secretOptions}
                reservedSecretNames={reservedSecretNames}
                readOnly={readOnly}
                onSecretListChanged={refreshSecretList}
                secretsListReadOnly={secretsListReadOnly}
                onSecretsChanged={onSecretsChanged}
              />
            )}
          </fieldset>

          <AdvancedSection
            className="mt-5"
            open={advancedOpen}
            onOpenChange={onAdvancedOpenChange}
          >
            <div className="flex min-w-0 flex-col gap-4">
              <fieldset
                disabled={advancedReadOnly}
                className={`m-0 flex min-w-0 flex-col gap-4 border-0 p-0 ${advancedReadOnly ? 'opacity-70' : ''}`}
              >
                <span className="text-sm font-medium text-muted-foreground">
                  Rate Limiting
                </span>
                <div className="flex gap-3">
                  <FormField
                    control={form.control}
                    name="requestsPerHour"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <OutlinedNumberInput
                            label="Requests / hour"
                            value={field.value ?? ''}
                            onChange={field.onChange}
                            min={0}
                            disabled={readOnly}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="requestsPerSecond"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <OutlinedNumberInput
                            label="Requests / second"
                            value={field.value ?? ''}
                            onChange={field.onChange}
                            min={0}
                            disabled={readOnly}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="burstCapacity"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <OutlinedNumberInput
                            label="Burst capacity"
                            value={field.value ?? ''}
                            onChange={field.onChange}
                            min={0}
                            disabled={readOnly}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </fieldset>

              {backendType === 'http' && (
                <HttpPaginationDefaultFields
                  control={form.control}
                  readOnly={readOnly}
                />
              )}

              {backendType === 'http' && (
                <HttpDefaultHeadersFields
                  control={form.control}
                  readOnly={readOnly}
                />
              )}

              {backendType === 'http' && (
                <HttpCaCertificateField
                  control={form.control}
                  readOnly={readOnly}
                />
              )}
            </div>
          </AdvancedSection>
        </>
      )}
    </>
  );
}
