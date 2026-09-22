import React, { useEffect, useMemo } from 'react';
import {
  useFieldArray,
  useFormState,
  useWatch,
  type Control,
} from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { SelectItem } from '@roadiehq/ui/select';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { OutlinedSelect } from '@roadiehq/ui/outlined-select';
import { IntegrationSecretOutlinedSelect } from './integration-secret-outlined-select';
import {
  buildIntegrationSecretNamePrefix,
  integrationAuthSecretSuffix,
  joinIntegrationSuggestedSecretName,
  suffixForHeaderAuthSecret,
} from './integration-secret-name-suggestion';
import { Combobox } from '@roadiehq/ui/combobox';
import { OutlinedTextarea } from '@roadiehq/ui/outlined-textarea';
import { FormSection } from '@roadiehq/ui/form-section';
import {
  FormField,
  FormItem,
  FormControl,
  FormDescription,
  FormMessage,
} from '@roadiehq/ui/form';
import {
  INTEGRATION_AUTH_TYPES,
  INTEGRATION_HTTP_BASE_URL_PLACEHOLDER,
} from '../constants';
import type { IntegrationFormValues } from './integration-schema';
import { PaginationSettings } from '../../data-sources/data-source-editor/sources/pagination-settings';

const AUTH_HEADER_NAME_OPTIONS = [
  'Authorization',
  'X-API-Key',
  'Api-Key',
  'X-Auth-Token',
  'X-App-Key',
  'Proxy-Authorization',
].map(name => ({ value: name }));

const DEFAULT_HEADER_NAME_OPTIONS = [
  'Content-Type',
  'Accept',
  'Accept-Language',
  'Accept-Encoding',
  'User-Agent',
  'Cache-Control',
  'X-Request-ID',
  'X-Correlation-ID',
  'If-None-Match',
  'X-Forwarded-For',
  'X-Custom-Header',
].map(name => ({ value: name }));

interface HttpFieldsProps {
  control: Control<IntegrationFormValues>;
  secretOptions: string[];
  reservedSecretNames?: string[];
  readOnly?: boolean;
  onSecretListChanged?: () => void | Promise<void>;
  secretsListReadOnly?: boolean;
  onSecretsChanged?: () => void;
}

export { getSecretOptionNames } from './integration-secret-refs';

function AuthHeaderSecretValueSelect({
  control,
  index,
  readOnly,
  secretOptions,
  reservedSecretNames,
  onSecretListChanged,
  secretsListReadOnly,
  onSecretsChanged,
  integrationPrefix,
}: {
  control: Control<IntegrationFormValues>;
  index: number;
  readOnly: boolean;
  secretOptions: string[];
  reservedSecretNames?: string[];
  onSecretListChanged?: () => void | Promise<void>;
  secretsListReadOnly?: boolean;
  onSecretsChanged?: () => void;
  integrationPrefix: string;
}) {
  const headerKey = useWatch({
    control,
    name: `authHeaders.${index}.key`,
  }) as string | undefined;
  const suggestedSecretName = useMemo(
    () =>
      joinIntegrationSuggestedSecretName(
        integrationPrefix,
        suffixForHeaderAuthSecret(headerKey ?? ''),
      ),
    [integrationPrefix, headerKey],
  );
  return (
    <FormField
      control={control}
      name={`authHeaders.${index}.value`}
      render={({ field }) => (
        <FormItem className="min-w-0">
          <IntegrationSecretOutlinedSelect
            label="Header secret"
            value={field.value ?? ''}
            onValueChange={field.onChange}
            disabled={readOnly}
            secretOptions={secretOptions}
            reservedSecretNames={reservedSecretNames}
            onSecretListChanged={onSecretListChanged}
            secretsListReadOnly={secretsListReadOnly}
            onSecretsChanged={onSecretsChanged}
            suggestedSecretName={suggestedSecretName}
          />
          <FormMessage className="mt-1 ml-[14px]" />
        </FormItem>
      )}
    />
  );
}

export function HttpConnectionFields({
  control,
  readOnly = false,
}: Pick<HttpFieldsProps, 'control' | 'readOnly'>) {
  return (
    <>
      <FormSection title="Connection" />
      <FormField
        control={control}
        name="host"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <OutlinedInput
                label="URL *"
                required
                disabled={readOnly}
                placeholder={INTEGRATION_HTTP_BASE_URL_PLACEHOLDER}
                labelClassName="top-0 text-xs peer-placeholder-shown:top-0 peer-placeholder-shown:text-xs"
                {...field}
              />
            </FormControl>
            <FormDescription>
              Example: {INTEGRATION_HTTP_BASE_URL_PLACEHOLDER}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="graphqlPath"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <OutlinedInput
                label="GraphQL path"
                placeholder="/graphql"
                disabled={readOnly}
                {...field}
                value={field.value ?? ''}
              />
            </FormControl>
            <FormDescription>
              Optional. Path (relative to the URL above) of this integration's
              GraphQL endpoint. Setting this enables GraphQL mode on Source
              nodes.
            </FormDescription>
          </FormItem>
        )}
      />
    </>
  );
}

export function HttpAuthFields({
  control,
  secretOptions,
  reservedSecretNames,
  readOnly = false,
  onSecretListChanged,
  secretsListReadOnly,
  onSecretsChanged,
}: HttpFieldsProps) {
  const authType = useWatch({ control, name: 'authType' });
  const slug = useWatch({ control, name: 'slug' });
  const integrationName = useWatch({ control, name: 'name' });
  const integrationPrefix = useMemo(
    () => buildIntegrationSecretNamePrefix(slug, integrationName),
    [slug, integrationName],
  );
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'authHeaders',
  });
  const { errors } = useFormState({ control, name: 'authHeaders' });
  // The form resolver places array-root issues at the container level
  // (errors.authHeaders.message), not RHF's `.root` convention — read both.
  const authHeadersRootError =
    errors.authHeaders?.message ?? errors.authHeaders?.root?.message;

  useEffect(() => {
    if (!readOnly && authType === 'header' && fields.length === 0) {
      append({ key: '', prefix: '', value: '' });
    }
  }, [authType, fields.length, append, readOnly]);

  return (
    <>
      <FormSection title="Authentication" />
      <FormField
        control={control}
        name="authType"
        render={({ field }) => (
          <FormItem className="mb-3">
            <FormControl>
              <OutlinedSelect
                label="Auth Type"
                value={field.value ?? 'none'}
                onValueChange={field.onChange}
                disabled={readOnly}
              >
                {INTEGRATION_AUTH_TYPES.map(t => (
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

      {authType === 'header' && (!readOnly || fields.length > 0) && (
        <div className="space-y-3">
          {typeof authHeadersRootError === 'string' && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {authHeadersRootError}
            </p>
          )}
          {fields.map((item, index) => (
            <div
              key={item.id}
              className={`grid min-w-0 items-start gap-2 ${
                readOnly
                  ? 'grid-cols-[minmax(10.5rem,1fr)_7rem_minmax(0,1fr)]'
                  : 'grid-cols-[minmax(10.5rem,1fr)_7rem_minmax(0,1fr)_auto]'
              }`}
            >
              <FormField
                control={control}
                name={`authHeaders.${index}.key`}
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormControl>
                      <Combobox
                        label="Header name"
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        options={AUTH_HEADER_NAME_OPTIONS}
                        disabled={readOnly}
                      />
                    </FormControl>
                    <FormMessage className="mt-1 ml-[14px]" />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name={`authHeaders.${index}.prefix`}
                render={({ field }) => (
                  <FormItem className="w-full min-w-0">
                    <FormControl>
                      <OutlinedInput
                        label="Prefix"
                        placeholder="token "
                        disabled={readOnly}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <AuthHeaderSecretValueSelect
                control={control}
                index={index}
                readOnly={readOnly}
                secretOptions={secretOptions}
                reservedSecretNames={reservedSecretNames}
                onSecretListChanged={onSecretListChanged}
                secretsListReadOnly={secretsListReadOnly}
                onSecretsChanged={onSecretsChanged}
                integrationPrefix={integrationPrefix}
              />
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={() => remove(index)}
                  disabled={readOnly}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => append({ key: '', prefix: '', value: '' })}
              disabled={readOnly}
            >
              <Plus className="mr-1 size-3.5" />
              Add Header
            </Button>
          )}
        </div>
      )}

      {authType === 'basic' && (
        <div className="space-y-3">
          <span className="block text-xs leading-5 text-muted-foreground">
            Select username/password secrets only. Roadie will create the Basic
            Authorization header and apply Base64 encoding automatically.
          </span>
          <FormField
            control={control}
            name="basicUsername"
            render={({ field }) => (
              <FormItem>
                <IntegrationSecretOutlinedSelect
                  label="Username secret"
                  value={field.value ?? ''}
                  onValueChange={field.onChange}
                  disabled={readOnly}
                  secretOptions={secretOptions}
                  reservedSecretNames={reservedSecretNames}
                  onSecretListChanged={onSecretListChanged}
                  secretsListReadOnly={secretsListReadOnly}
                  onSecretsChanged={onSecretsChanged}
                  suggestedSecretName={joinIntegrationSuggestedSecretName(
                    integrationPrefix,
                    integrationAuthSecretSuffix.httpBasicUsername,
                  )}
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="basicPassword"
            render={({ field }) => (
              <FormItem>
                <IntegrationSecretOutlinedSelect
                  label="Password secret"
                  value={field.value ?? ''}
                  onValueChange={field.onChange}
                  disabled={readOnly}
                  secretOptions={secretOptions}
                  reservedSecretNames={reservedSecretNames}
                  onSecretListChanged={onSecretListChanged}
                  secretsListReadOnly={secretsListReadOnly}
                  onSecretsChanged={onSecretsChanged}
                  suggestedSecretName={joinIntegrationSuggestedSecretName(
                    integrationPrefix,
                    integrationAuthSecretSuffix.httpBasicPassword,
                  )}
                />
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}

      {authType === 'bearer-token' && (
        <div className="space-y-3">
          <span className="block text-xs leading-5 text-muted-foreground">
            Provide a bearer token secret. Roadie will set the Authorization
            header to <code>bearer </code> followed by the chosen secret.
          </span>
          <FormField
            control={control}
            name="bearerToken"
            render={({ field }) => (
              <FormItem>
                <IntegrationSecretOutlinedSelect
                  label="Bearer token secret"
                  value={field.value ?? ''}
                  onValueChange={field.onChange}
                  disabled={readOnly}
                  secretOptions={secretOptions}
                  reservedSecretNames={reservedSecretNames}
                  onSecretListChanged={onSecretListChanged}
                  secretsListReadOnly={secretsListReadOnly}
                  onSecretsChanged={onSecretsChanged}
                  suggestedSecretName={joinIntegrationSuggestedSecretName(
                    integrationPrefix,
                    integrationAuthSecretSuffix.bearerToken,
                  )}
                />
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}

      {authType === 'oauth2-client-credentials' && (
        <div className="space-y-3">
          <span className="block text-xs leading-5 text-muted-foreground">
            Roadie will exchange the client credentials for an access token
            automatically and cache it until expiry.
          </span>
          <FormField
            control={control}
            name="oauth2TokenUrl"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <OutlinedInput
                    label="Token URL *"
                    required
                    placeholder="https://login.example.com/oauth2/token"
                    disabled={readOnly}
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="oauth2ClientId"
            render={({ field }) => (
              <FormItem>
                <IntegrationSecretOutlinedSelect
                  label="Client ID secret *"
                  value={field.value ?? ''}
                  onValueChange={field.onChange}
                  disabled={readOnly}
                  secretOptions={secretOptions}
                  reservedSecretNames={reservedSecretNames}
                  onSecretListChanged={onSecretListChanged}
                  secretsListReadOnly={secretsListReadOnly}
                  onSecretsChanged={onSecretsChanged}
                  suggestedSecretName={joinIntegrationSuggestedSecretName(
                    integrationPrefix,
                    integrationAuthSecretSuffix.oauth2ClientId,
                  )}
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="oauth2ClientSecret"
            render={({ field }) => (
              <FormItem>
                <IntegrationSecretOutlinedSelect
                  label="Client secret *"
                  value={field.value ?? ''}
                  onValueChange={field.onChange}
                  disabled={readOnly}
                  secretOptions={secretOptions}
                  reservedSecretNames={reservedSecretNames}
                  onSecretListChanged={onSecretListChanged}
                  secretsListReadOnly={secretsListReadOnly}
                  onSecretsChanged={onSecretsChanged}
                  suggestedSecretName={joinIntegrationSuggestedSecretName(
                    integrationPrefix,
                    integrationAuthSecretSuffix.oauth2ClientSecret,
                  )}
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="oauth2Audience"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <OutlinedInput
                    label="Audience"
                    placeholder="wiz-api"
                    disabled={readOnly}
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <span className="block text-xs leading-5 text-muted-foreground">
            Provide either a scope or audience, depending on the provider. Leave
            the other blank.
          </span>
          <FormField
            control={control}
            name="oauth2Scope"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <OutlinedInput
                    label="Scope"
                    placeholder="https://api.example.com/.default"
                    disabled={readOnly}
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}

      {authType === 'oauth2-jwt-bearer' && (
        <div className="space-y-3">
          <FormField
            control={control}
            name="jwtIssuer"
            render={({ field }) => (
              <FormItem>
                <IntegrationSecretOutlinedSelect
                  label="Issuer / Client ID secret *"
                  value={field.value ?? ''}
                  onValueChange={field.onChange}
                  disabled={readOnly}
                  secretOptions={secretOptions}
                  reservedSecretNames={reservedSecretNames}
                  onSecretListChanged={onSecretListChanged}
                  secretsListReadOnly={secretsListReadOnly}
                  onSecretsChanged={onSecretsChanged}
                  suggestedSecretName={joinIntegrationSuggestedSecretName(
                    integrationPrefix,
                    integrationAuthSecretSuffix.jwtIssuer,
                  )}
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="jwtPrivateKey"
            render={({ field }) => (
              <FormItem>
                <IntegrationSecretOutlinedSelect
                  label="Private key secret *"
                  value={field.value ?? ''}
                  onValueChange={field.onChange}
                  disabled={readOnly}
                  secretOptions={secretOptions}
                  reservedSecretNames={reservedSecretNames}
                  onSecretListChanged={onSecretListChanged}
                  secretsListReadOnly={secretsListReadOnly}
                  onSecretsChanged={onSecretsChanged}
                  suggestedSecretName={joinIntegrationSuggestedSecretName(
                    integrationPrefix,
                    integrationAuthSecretSuffix.jwtPrivateKey,
                  )}
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="jwtTokenUrl"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <OutlinedInput
                    label="Token URL *"
                    required
                    placeholder="https://oauth2.googleapis.com/token"
                    disabled={readOnly}
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="jwtAudience"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <OutlinedInput
                    label="Audience (optional)"
                    placeholder="Defaults to Token URL"
                    disabled={readOnly}
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="jwtScope"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <OutlinedInput label="Scope" disabled={readOnly} {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="jwtSubject"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <OutlinedInput
                    label="Subject (optional)"
                    placeholder="User / principal for delegated auth"
                    disabled={readOnly}
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
      )}
    </>
  );
}

export function HttpDefaultHeadersFields({
  control,
  readOnly = false,
}: Pick<HttpFieldsProps, 'control' | 'readOnly'>) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'defaultHeaders',
  });

  if (readOnly && fields.length === 0) {
    return null;
  }

  return (
    <>
      <FormSection title="Additional Headers" />
      <span className="mb-2 block text-xs leading-5 text-muted-foreground">
        Additional header values are stored in plain text. Do not put secrets,
        API keys, or tokens here—use Authentication headers for sensitive
        credentials.
      </span>
      <div className="space-y-2">
        {fields.map((item, index) => (
          <div key={item.id} className="flex items-center gap-2">
            <FormField
              control={control}
              name={`defaultHeaders.${index}.key`}
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Combobox
                      label="Header name"
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      options={DEFAULT_HEADER_NAME_OPTIONS}
                      disabled={readOnly}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`defaultHeaders.${index}.value`}
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <OutlinedInput
                      label="Header value"
                      disabled={readOnly}
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                onClick={() => remove(index)}
                disabled={readOnly}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        ))}
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => append({ key: '', value: '' })}
            disabled={readOnly}
          >
            <Plus className="mr-1 size-3.5" />
            Add Header
          </Button>
        )}
      </div>
    </>
  );
}

export function HttpPaginationDefaultFields({
  control,
  readOnly = false,
}: Pick<HttpFieldsProps, 'control' | 'readOnly'>) {
  return (
    <>
      <FormSection title="Default Pagination" />
      <span className="block text-xs leading-5 text-muted-foreground">
        Optional. Sets the default pagination strategy for new HTTP data sources
        using this integration. Data sources can still inherit, override, or
        disable it per endpoint.
      </span>
      <FormField
        control={control}
        name="paginationDefault"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <div className={readOnly ? 'pointer-events-none opacity-70' : ''}>
                <PaginationSettings
                  pagination={field.value}
                  onChange={field.onChange}
                  mode="rest"
                  title={null}
                />
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

export function HttpCaCertificateField({
  control,
  readOnly = false,
}: Pick<HttpFieldsProps, 'control' | 'readOnly'>) {
  const caCertificate = useWatch({ control, name: 'caCertificate' });

  if (readOnly && !caCertificate?.trim()) {
    return null;
  }

  return (
    <>
      <FormSection title="CA Certificate" />
      <span className="text-xs leading-[20px] text-muted-foreground">
        Use this when the target integration endpoint is self-hosted and uses a
        custom HTTPS certificate chain. Roadie will trust this PEM-encoded CA
        when making outbound HTTPS requests to that integration.
      </span>
      <FormField
        control={control}
        name="caCertificate"
        render={({ field }) => (
          <FormItem>
            <OutlinedTextarea
              label="CA certificate (PEM)"
              value={field.value ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
              disabled={readOnly}
              className="min-h-[160px] font-mono text-xs leading-relaxed"
              spellCheck={false}
            />
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
