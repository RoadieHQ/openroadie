import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { type UseFormReturn, type SubmitErrorHandler } from 'react-hook-form';
import {
  getPlainText,
  type BaseSuggestionData,
  type SuggestionDataSource,
} from '@roadiehq/ui/mentions-text-field';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Integration } from '../types';
import { useWorkflows, useAlert, useSecrets } from '../../../api';
import type { StorageMode } from '../../../api/secrets';
import {
  logosCatalogQuery,
  secretKeysQuery,
  secretMetadataQuery,
  secretStorageModeQuery,
  queryKeys,
} from '../../../api/queries';
import type {
  IntegrationPaginationDefault,
  LogoEntry,
} from '../../../api/workflow/workflow-client';
import {
  buildAwsConfig,
  getAwsOrganizationsConfig,
  getAwsProfiles,
} from '../aws-config';
import {
  createIntegrationSchema,
  type IntegrationFormValues,
  type IntegrationFormSubmitValues,
  normalizeIntegrationHost,
} from './integration-schema';
import { normalizeCaCertificate } from './pem-certificate';
import { useZodForm } from '../../common';
import { composeAuthHeaderValue } from './auth-header-value';
import {
  getWorkspaceScopeKey,
  workspaceQueryKeyInScope,
} from '../../../api/workspace-scope';

export type IntegrationLike = Pick<
  Integration,
  | 'id'
  | 'name'
  | 'slug'
  | 'type'
  | 'host'
  | 'backendType'
  | 'authType'
  | 'authConfig'
  | 'config'
  | 'createdBy'
> &
  Partial<
    Pick<
      Integration,
      | 'requestsPerHour'
      | 'requestsPerSecond'
      | 'burstCapacity'
      | 'logoSlug'
      | 'graphqlPath'
    >
  >;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const EMPTY_LOGO_CATALOG: LogoEntry[] = [];
// Fallback while the storage-mode query is loading or errored — the secrets
// backend defaults to dotenv (writable, nothing hidden).
const DEFAULT_STORAGE_MODE: StorageMode = {
  mode: 'dotenv',
  readOnly: false,
  hiddenSecretRefs: [],
};
const DEFAULT_REQUESTS_PER_HOUR = '36000';
const HTTP_AUTH_TYPES = [
  'header',
  'basic',
  'bearer-token',
  'oauth2-client-credentials',
  'oauth2-jwt-bearer',
  'none',
] as const;

type HttpAuthType = (typeof HTTP_AUTH_TYPES)[number];

function isHttpAuthType(value: string | undefined): value is HttpAuthType {
  return HTTP_AUTH_TYPES.some(authType => authType === value);
}

function recordToEntries(
  obj: Record<string, string> | undefined,
): Array<{ key: string; value: string }> {
  if (!obj) {
    return [];
  }
  return Object.entries(obj).map(([key, value]) => ({ key, value }));
}

function authRecordToEntries(
  obj: Record<string, string> | undefined,
): Array<{ key: string; prefix: string; value: string }> {
  if (!obj) {
    return [];
  }
  return Object.entries(obj).map(([key, value]) => {
    const match = value.match(/^(.*?)(\$\{[^}]+\})$/s);
    if (match) {
      return { key, prefix: match[1], value: match[2] };
    }
    return { key, prefix: '', value };
  });
}

function getEditableHttpConfig(
  config: IntegrationLike['config'],
): Record<string, unknown> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {};
  }

  const nextConfig = { ...config };
  delete nextConfig.headers;
  delete nextConfig.caCertificate;
  delete nextConfig.paginationDefault;
  return nextConfig;
}

function getPaginationDefaultFromConfig(
  config: IntegrationLike['config'],
): IntegrationPaginationDefault | undefined {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return undefined;
  }

  const paginationDefault = (config as Record<string, unknown>)
    .paginationDefault;
  if (
    !paginationDefault ||
    typeof paginationDefault !== 'object' ||
    Array.isArray(paginationDefault) ||
    typeof (paginationDefault as { type?: unknown }).type !== 'string'
  ) {
    return undefined;
  }

  return paginationDefault as IntegrationPaginationDefault;
}

function isSystemAuthType(
  authType: IntegrationLike['authType'] | undefined,
): boolean {
  return (
    authType !== undefined &&
    authType !== 'header' &&
    authType !== 'basic' &&
    authType !== 'bearer-token' &&
    authType !== 'oauth2-client-credentials' &&
    authType !== 'oauth2-jwt-bearer' &&
    authType !== 'none'
  );
}

function initFormState(
  integration?: Partial<IntegrationLike>,
  options?: { duplicate?: boolean },
): IntegrationFormValues {
  if (integration) {
    const duplicate = options?.duplicate ?? false;
    const cfg = integration.config ?? {};
    const awsProfiles = getAwsProfiles(cfg).map(profile => ({
      name: profile.name ?? '',
      accountId: profile.accountId,
      roleName: profile.roleName ?? '',
      externalId: profile.externalId ?? '',
      region: profile.region ?? '',
    }));
    const awsOrganizations = getAwsOrganizationsConfig(cfg);
    const configHeaders =
      cfg && typeof cfg === 'object' && 'headers' in cfg
        ? (cfg.headers as Record<string, string>)
        : undefined;
    const name = duplicate
      ? `${integration.name} Copy`
      : (integration.name ?? '');
    const slug = duplicate
      ? `${integration.slug}-copy`
      : (integration.slug ?? '');

    const base = {
      name,
      slug,
      type: integration.type ?? '',
      logoSlug: integration.logoSlug ?? '',
      requestsPerHour: integration.requestsPerHour?.toString() ?? '',
      requestsPerSecond: integration.requestsPerSecond?.toString() ?? '',
      burstCapacity: integration.burstCapacity?.toString() ?? '',
    };

    if (integration.backendType === 'aws') {
      return {
        ...base,
        backendType: 'aws',
        host: integration.host ?? '',
        authType: integration.authType === 'header' ? 'header' : 'none',
        authHeaders: authRecordToEntries(
          integration.authConfig && 'headers' in integration.authConfig
            ? (integration.authConfig.headers as Record<string, string>)
            : undefined,
        ),
        basicUsername: '',
        basicPassword: '',
        bearerToken: '',
        oauth2ClientId: '',
        oauth2ClientSecret: '',
        oauth2TokenUrl: '',
        oauth2Audience: '',
        oauth2Scope: '',
        jwtIssuer: '',
        jwtPrivateKey: '',
        jwtTokenUrl: '',
        jwtAudience: '',
        jwtScope: '',
        jwtSubject: '',
        defaultHeaders: recordToEntries(configHeaders),
        caCertificate: normalizeCaCertificate(
          typeof cfg.caCertificate === 'string' ? cfg.caCertificate : '',
        ),
        awsProfiles,
        awsOrganizations: {
          enabled: awsOrganizations?.enabled ?? false,
          managementAccountId: awsOrganizations?.managementAccountId ?? '',
          managementRoleName: awsOrganizations?.managementRoleName ?? '',
          managementExternalId: awsOrganizations?.managementExternalId ?? '',
          managementRegion: awsOrganizations?.managementRegion ?? '',
          defaultRoleName: awsOrganizations?.defaultRoleName ?? '',
          memberExternalIdMode:
            awsOrganizations?.memberExternalIdMode ?? 'static',
          defaultExternalId: awsOrganizations?.defaultExternalId ?? '',
          defaultExternalIdPrefix:
            awsOrganizations?.defaultExternalIdPrefix ?? '',
          defaultRegion: awsOrganizations?.defaultRegion ?? '',
          excludeManagementAccount:
            awsOrganizations?.excludeManagementAccount ?? true,
          excludedAccountIds: awsOrganizations?.excludedAccountIds ?? [],
          requiredTags: awsOrganizations?.requiredTags ?? [],
          excludedTags: awsOrganizations?.excludedTags ?? [],
        },
      };
    }

    const isJwtBearer = integration.authType === 'oauth2-jwt-bearer';
    const jwtConfig =
      isJwtBearer && integration.authConfig
        ? (integration.authConfig as Record<string, string>)
        : {};

    return {
      ...base,
      backendType: 'http',
      host: integration.host ?? '',
      authType: isHttpAuthType(integration.authType)
        ? integration.authType
        : 'none',
      authHeaders: authRecordToEntries(
        integration.authConfig && 'headers' in integration.authConfig
          ? (integration.authConfig.headers as Record<string, string>)
          : undefined,
      ),
      basicUsername:
        integration.authType === 'basic' &&
        integration.authConfig &&
        'username' in integration.authConfig
          ? ((integration.authConfig.username as string) ?? '')
          : '',
      basicPassword:
        integration.authType === 'basic' &&
        integration.authConfig &&
        'password' in integration.authConfig
          ? ((integration.authConfig.password as string) ?? '')
          : '',
      bearerToken:
        integration.authType === 'bearer-token' &&
        integration.authConfig &&
        'token' in integration.authConfig
          ? ((integration.authConfig.token as string) ?? '')
          : '',
      oauth2ClientId:
        integration.authType === 'oauth2-client-credentials' &&
        integration.authConfig &&
        'clientId' in integration.authConfig
          ? ((integration.authConfig.clientId as string) ?? '')
          : '',
      oauth2ClientSecret:
        integration.authType === 'oauth2-client-credentials' &&
        integration.authConfig &&
        'clientSecret' in integration.authConfig
          ? ((integration.authConfig.clientSecret as string) ?? '')
          : '',
      oauth2TokenUrl:
        integration.authType === 'oauth2-client-credentials' &&
        integration.authConfig &&
        'tokenUrl' in integration.authConfig
          ? ((integration.authConfig.tokenUrl as string) ?? '')
          : '',
      oauth2Audience:
        integration.authType === 'oauth2-client-credentials' &&
        integration.authConfig &&
        'audience' in integration.authConfig
          ? ((integration.authConfig.audience as string) ?? '')
          : '',
      oauth2Scope:
        integration.authType === 'oauth2-client-credentials' &&
        integration.authConfig &&
        'scope' in integration.authConfig
          ? ((integration.authConfig.scope as string) ?? '')
          : '',
      jwtIssuer: isJwtBearer ? (jwtConfig.issuer ?? '') : '',
      jwtPrivateKey: isJwtBearer ? (jwtConfig.privateKey ?? '') : '',
      jwtTokenUrl: isJwtBearer ? (jwtConfig.tokenUrl ?? '') : '',
      jwtAudience: isJwtBearer ? (jwtConfig.audience ?? '') : '',
      jwtScope: isJwtBearer ? (jwtConfig.scope ?? '') : '',
      jwtSubject: isJwtBearer ? (jwtConfig.subject ?? '') : '',
      defaultHeaders: recordToEntries(configHeaders),
      caCertificate: normalizeCaCertificate(
        typeof cfg.caCertificate === 'string' ? cfg.caCertificate : '',
      ),
      graphqlPath: integration.graphqlPath ?? '',
      paginationDefault: getPaginationDefaultFromConfig(cfg),
    };
  }

  return {
    name: '',
    slug: '',
    type: 'other',
    backendType: 'http',
    host: '',
    authType: 'none',
    authHeaders: [],
    basicUsername: '',
    basicPassword: '',
    bearerToken: '',
    oauth2ClientId: '',
    oauth2ClientSecret: '',
    oauth2TokenUrl: '',
    oauth2Audience: '',
    oauth2Scope: '',
    jwtIssuer: '',
    jwtPrivateKey: '',
    jwtTokenUrl: '',
    jwtAudience: '',
    jwtScope: '',
    jwtSubject: '',
    defaultHeaders: [],
    requestsPerHour: DEFAULT_REQUESTS_PER_HOUR,
    requestsPerSecond: '',
    burstCapacity: '',
    logoSlug: '',
    caCertificate: '',
    graphqlPath: '',
    paginationDefault: undefined,
  };
}

export function useIntegrationForm({
  open,
  onClose,
  onSaved,
  integration,
  template,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (integration: Integration) => void;
  integration?: IntegrationLike;
  template?: Partial<IntegrationLike>;
}): {
  form: UseFormReturn<IntegrationFormValues>;
  isEdit: boolean;
  autoSlug: boolean;
  markSlugEdited: () => void;
  secretsDataSource: SuggestionDataSource<BaseSuggestionData>;
  secretOptions: string[];
  reservedSecretNames: string[];
  handleSave: (onInvalid?: SubmitErrorHandler<IntegrationFormValues>) => void;
  refreshSecretList: () => void;
  secretsListReadOnly: boolean;
  logoCatalog: LogoEntry[];
} {
  const api = useWorkflows();
  const alertApi = useAlert();
  const secretsApi = useSecrets();
  const queryClient = useQueryClient();
  const workspaceScopeKey = getWorkspaceScopeKey();
  const isEdit = !!integration;
  const sourceIntegration = integration ?? template;
  // A duplicate copies an existing integration (which has an id); a bare
  // template (e.g. a preset backend type for inline create) is not a duplicate.
  const isDuplicate = !integration && !!template?.id;
  const schema = useMemo(
    () =>
      createIntegrationSchema({
        existingIntegrationHost:
          integration?.backendType === 'http' ? integration.host : undefined,
      }),
    [integration],
  );

  // Only consumed by RHF on the initial mount; the reset effect below reseeds
  // on every subject change, so memoizing here just avoids rebuilding the
  // (large) default object on unrelated re-renders.
  const defaultValues = useMemo(
    () => initFormState(sourceIntegration, { duplicate: isDuplicate }),
    [sourceIntegration, isDuplicate],
  );

  const form = useZodForm({
    schema,
    defaultValues,
  });

  const logoCatalogQuery = useQuery({
    ...logosCatalogQuery(api),
    enabled: open,
  });
  const logoCatalog = logoCatalogQuery.data ?? EMPTY_LOGO_CATALOG;

  // Auto-slugify only for blank create forms: edits keep their saved slug and
  // duplicates keep their seeded '-copy' slug.
  const autoSlugRef = useRef(!sourceIntegration);
  const [autoSlug, setAutoSlug] = useState(!sourceIntegration);

  const markSlugEdited = useCallback(() => {
    autoSlugRef.current = false;
    setAutoSlug(false);
  }, []);

  const secretKeysQ = useQuery({
    ...secretKeysQuery(secretsApi),
    enabled: open,
  });
  const secretMetadataQ = useQuery({
    ...secretMetadataQuery(secretsApi),
    enabled: open,
  });
  const secretCatalog = useMemo(
    () =>
      open
        ? {
            keys: secretKeysQ.data ?? [],
            metadata: secretMetadataQ.data ?? [],
          }
        : undefined,
    [open, secretKeysQ.data, secretMetadataQ.data],
  );

  const secretStorageMode =
    useQuery(secretStorageModeQuery(secretsApi)).data ?? DEFAULT_STORAGE_MODE;

  const secretNames = useMemo(
    () =>
      Array.from(
        new Set([
          ...(secretCatalog?.keys ?? []).map(secret => secret.name),
          ...(secretCatalog?.metadata ?? []).map(secret => secret.name),
        ]),
      ).sort((a, b) => a.localeCompare(b)),
    [secretCatalog],
  );

  const secretsDataSource: SuggestionDataSource<BaseSuggestionData> = useMemo(
    () => ({
      trigger: '@',
      markup: '@[__display__](__id__)',
      displayTransform: (id: string, display?: string) =>
        `\${${display || id}}`,
      data: async (query: string) =>
        secretNames
          .filter(name => name.toLowerCase().includes(query.toLowerCase()))
          .map(name => ({ id: name, display: name })),
    }),
    [secretNames],
  );
  const secretOptions = useMemo(() => secretNames, [secretNames]);
  const reservedSecretNames = useMemo(
    () => secretStorageMode?.hiddenSecretRefs ?? [],
    [secretStorageMode],
  );

  // Reset only when the form's subject changes (a different integration or
  // template id, duplicate mode, or the dialog toggling open) — never on
  // object identity alone, or a background refetch that re-derives the same
  // integration would wipe in-progress edits.
  const resetKey = `${integration?.id ?? ''}|${template?.id ?? ''}`;
  const sourceIntegrationRef = useRef(sourceIntegration);
  sourceIntegrationRef.current = sourceIntegration;

  useEffect(() => {
    form.reset(
      initFormState(sourceIntegrationRef.current, {
        duplicate: isDuplicate,
      }),
    );
    autoSlugRef.current = !sourceIntegrationRef.current;
    setAutoSlug(!sourceIntegrationRef.current);
  }, [resetKey, isDuplicate, open, form]);

  useEffect(() => {
    const subscription = form.watch((value, { name }) => {
      if (name === 'name' && autoSlugRef.current) {
        form.setValue('slug', slugify(value.name ?? ''));
      }
    });
    return () => subscription.unsubscribe();
  }, [form]);

  const onSubmit = useCallback(
    async (data: IntegrationFormSubmitValues) => {
      form.clearErrors('root');
      try {
        const authHeadersObj: Record<string, string> = {};
        for (const h of data.authHeaders ?? []) {
          if (h.key.trim()) {
            authHeadersObj[h.key.trim()] = composeAuthHeaderValue(
              h.prefix,
              getPlainText(h.value, [secretsDataSource]),
            );
          }
        }

        const defaultHeadersObj: Record<string, string> = {};
        for (const h of data.defaultHeaders ?? []) {
          if (h.key.trim()) {
            defaultHeadersObj[h.key.trim()] = h.value;
          }
        }

        const isAws = data.backendType === 'aws';

        const preserveSystemAuth =
          sourceIntegration !== undefined &&
          isSystemAuthType(sourceIntegration.authType);

        let authConfig:
          | { headers: Record<string, string> }
          | { username?: string; password: string }
          | { token: string }
          | {
              clientId: string;
              clientSecret: string;
              tokenUrl: string;
              audience?: string;
              scope?: string;
            }
          | {
              issuer: string;
              privateKey: string;
              tokenUrl: string;
              audience?: string;
              scope?: string;
              subject?: string;
            }
          | Record<string, unknown>
          | null
          | undefined;
        if (preserveSystemAuth) {
          authConfig = sourceIntegration.authConfig;
        } else if (!isAws && data.authType === 'header') {
          authConfig = { headers: authHeadersObj };
        } else if (!isAws && data.authType === 'basic') {
          const password = getPlainText(data.basicPassword ?? '', [
            secretsDataSource,
          ]);
          const username = getPlainText(data.basicUsername ?? '', [
            secretsDataSource,
          ]);
          authConfig = {
            ...(username && { username }),
            password,
          };
        } else if (!isAws && data.authType === 'bearer-token') {
          authConfig = {
            token: getPlainText(data.bearerToken ?? '', [secretsDataSource]),
          };
        } else if (!isAws && data.authType === 'oauth2-client-credentials') {
          const audience = data.oauth2Audience?.trim();
          const scope = data.oauth2Scope?.trim();
          authConfig = {
            clientId: getPlainText(data.oauth2ClientId ?? '', [
              secretsDataSource,
            ]),
            clientSecret: getPlainText(data.oauth2ClientSecret ?? '', [
              secretsDataSource,
            ]),
            tokenUrl: data.oauth2TokenUrl ?? '',
            ...(audience && { audience }),
            ...(scope && { scope }),
          };
        } else if (!isAws && data.authType === 'oauth2-jwt-bearer') {
          const issuer = getPlainText(data.jwtIssuer ?? '', [
            secretsDataSource,
          ]);
          const privateKey = getPlainText(data.jwtPrivateKey ?? '', [
            secretsDataSource,
          ]);
          authConfig = {
            issuer,
            privateKey,
            tokenUrl: data.jwtTokenUrl,
            ...(data.jwtAudience && { audience: data.jwtAudience }),
            ...(data.jwtScope && { scope: data.jwtScope }),
            ...(data.jwtSubject && { subject: data.jwtSubject }),
          };
        } else {
          authConfig = null;
        }

        let config: Record<string, unknown> | undefined;
        if (isAws && data.backendType === 'aws') {
          config = buildAwsConfig(
            sourceIntegration?.config,
            data.awsProfiles.map(profile => ({
              ...(profile.name && { name: profile.name }),
              accountId: profile.accountId,
              ...(profile.roleName && { roleName: profile.roleName }),
              ...(profile.externalId && {
                externalId: profile.externalId,
              }),
              ...(profile.region && { region: profile.region }),
            })),
            data.awsOrganizations,
          );
        } else {
          const hasHeaders = Object.keys(defaultHeadersObj).length > 0;
          const caCert = normalizeCaCertificate(data.caCertificate ?? '');
          const baseHttpConfig = getEditableHttpConfig(
            sourceIntegration?.config ?? {},
          );
          const nextHttpConfig = {
            ...baseHttpConfig,
            ...(hasHeaders && { headers: defaultHeadersObj }),
            ...(caCert && { caCertificate: caCert }),
            ...(data.paginationDefault && {
              paginationDefault: data.paginationDefault,
            }),
          };
          config = nextHttpConfig;
        }

        const payload = {
          name: data.name,
          slug: data.slug,
          type: data.type,
          backendType: data.backendType,
          host: isAws ? undefined : normalizeIntegrationHost(data.host),
          authType: preserveSystemAuth
            ? sourceIntegration.authType
            : isAws
              ? ('none' as const)
              : data.authType,
          authConfig,
          config,
          requestsPerHour: data.requestsPerHour
            ? Number(data.requestsPerHour)
            : undefined,
          requestsPerSecond: data.requestsPerSecond
            ? Number(data.requestsPerSecond)
            : undefined,
          burstCapacity: data.burstCapacity
            ? Number(data.burstCapacity)
            : undefined,
          logoSlug: data.logoSlug || undefined,
          graphqlPath: isAws
            ? undefined
            : data.graphqlPath?.trim()
              ? data.graphqlPath.trim()
              : null,
        };

        let result: Integration;
        if (isEdit && integration) {
          result = await api.integrations.update(integration.id, payload);
        } else {
          result = await api.integrations.create(payload);
        }

        alertApi.post({
          message: isDuplicate
            ? 'Integration duplicated'
            : isEdit
              ? 'Integration updated'
              : 'Integration created',
          severity: 'success',
          display: 'transient',
        });
        onSaved(result);
        onClose();
      } catch (error) {
        form.setError('root', {
          message:
            error instanceof Error
              ? error.message
              : 'Failed to save integration',
        });
      }
    },
    [
      form,
      isEdit,
      isDuplicate,
      integration,
      sourceIntegration,
      api,
      alertApi,
      onSaved,
      onClose,
      secretsDataSource,
    ],
  );

  const handleSave = useCallback(
    (onInvalid?: SubmitErrorHandler<IntegrationFormValues>) => {
      form.handleSubmit(onSubmit, onInvalid)();
    },
    [form, onSubmit],
  );

  const refreshSecretList = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.secretKeys,
        workspaceScopeKey,
      ),
    });
    void queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.secretMetadata,
        workspaceScopeKey,
      ),
    });
  }, [queryClient, workspaceScopeKey]);

  return {
    form,
    isEdit,
    autoSlug,
    markSlugEdited,
    secretsDataSource,
    secretOptions,
    reservedSecretNames,
    handleSave,
    refreshSecretList,
    secretsListReadOnly: secretStorageMode?.readOnly ?? false,
    logoCatalog,
  };
}
