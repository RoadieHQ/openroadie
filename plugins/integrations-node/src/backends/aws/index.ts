import { z } from 'zod';
import type { RequestOptions } from '../../index';
import {
  awsAccountSelectionConfigSchema,
  parseAwsSourceConfig,
} from './schemas';
import type { PaginationConfig } from '../http';
import { getAwsServiceRequestDefaults } from './metadata';
import { deriveAwsDataKey } from '@roadiehq/types';

export interface AwsAccountConfig {
  accountId: string;
  roleName?: string;
  externalId?: string;
  region?: string;
}

export type AwsOperation = 'get' | 'delete' | 'update' | 'create';
export type AwsRequestKind =
  | 'cloud-control-resource'
  | 'cloud-control-pages'
  | 'service-api-request'
  | 'service-api-pages'
  | 'organizations-account-preview'
  | 'configured-accounts';

const awsRequestResourceOptionsSchema = z.object({
  backendType: z.literal('aws'),
  mode: z.literal('cloud-control'),
  requestKind: z.literal('cloud-control-resource'),
  resourceType: z.string(),
  accountId: z.string(),
  accountConfig: z.object({
    accountId: z.string(),
    roleName: z.string().optional(),
    externalId: z.string().optional(),
    region: z.string().optional(),
  }),
  region: z.string(),
  operation: z.enum(['get', 'delete', 'update', 'create']).optional(),
  identifier: z.string().optional(),
  desiredState: z.string().optional(),
  patchDocument: z.string().optional(),
  stsRegion: z.string().optional(),
});

const awsRequestOptionsSchema = z.object({
  backendType: z.literal('aws'),
  mode: z.literal('service-api'),
  requestKind: z.literal('service-api-request'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
  profile: z.string(),
  service: z.string(),
  operation: z.string().optional(),
  region: z.string(),
  path: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
});

export type AwsRequestApiOptions = z.infer<typeof awsRequestOptionsSchema> &
  RequestOptions;

export type AwsRequestResourceOptions = z.infer<
  typeof awsRequestResourceOptionsSchema
> &
  RequestOptions;

const awsCloudControlRequestPagesOptionsSchema = z
  .object({
    backendType: z.literal('aws'),
    mode: z.literal('cloud-control'),
    requestKind: z.literal('cloud-control-pages'),
    resourceType: z.string(),
    accountIds: z.array(z.string()).optional(),
    accountSelection: awsAccountSelectionConfigSchema.optional(),
    regions: z.array(z.string()).optional(),
    resourceModel: z.string().optional(),
    roleName: z.string().optional(),
    externalId: z.string().optional(),
    authRegion: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.accountIds?.length && !value.accountSelection) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either accountIds or accountSelection is required',
        path: ['accountIds'],
      });
    }
  });

const awsServiceApiRequestPagesOptionsSchema = z
  .object({
    backendType: z.literal('aws'),
    mode: z.literal('service-api'),
    requestKind: z.literal('service-api-pages'),
    accountIds: z.array(z.string()).optional(),
    accountSelection: awsAccountSelectionConfigSchema.optional(),
    service: z.string(),
    operation: z.string().optional(),
    regions: z.array(z.string()).optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
    path: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    arrayPath: z.string().optional(),
    pagination: z.custom<PaginationConfig>().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.accountIds?.length && !value.accountSelection) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either accountIds or accountSelection is required',
        path: ['accountIds'],
      });
    }
  });

const awsOrganizationsAccountPreviewOptionsSchema = z.object({
  backendType: z.literal('aws'),
  requestKind: z.literal('organizations-account-preview'),
  accountSelection: awsAccountSelectionConfigSchema.optional(),
});

const awsConfiguredAccountsRequestPagesOptionsSchema = z.object({
  backendType: z.literal('aws'),
  mode: z.literal('configured-accounts'),
  requestKind: z.literal('configured-accounts'),
});

export type AwsCloudControlRequestPagesOptions = z.infer<
  typeof awsCloudControlRequestPagesOptionsSchema
> &
  RequestOptions;

export type AwsServiceApiRequestPagesOptions = z.infer<
  typeof awsServiceApiRequestPagesOptionsSchema
> &
  RequestOptions;

export type AwsConfiguredAccountsRequestPagesOptions = z.infer<
  typeof awsConfiguredAccountsRequestPagesOptionsSchema
> &
  RequestOptions;

export type AwsRequestPagesOptions =
  | AwsCloudControlRequestPagesOptions
  | AwsServiceApiRequestPagesOptions
  | AwsConfiguredAccountsRequestPagesOptions;

export type AwsOrganizationsAccountPreviewOptions = z.infer<
  typeof awsOrganizationsAccountPreviewOptionsSchema
> &
  RequestOptions;

export type AwsTrustSetupOptions = RequestOptions & {
  backendType: 'aws';
  requestKind: 'trust-setup';
};

export function parseAwsRequestResourceOptions(
  options: RequestOptions,
): AwsRequestResourceOptions {
  const normalized = {
    ...options,
    mode: 'cloud-control',
    requestKind: 'cloud-control-resource',
  };
  const result = awsRequestResourceOptionsSchema.safeParse(normalized);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join(', ');
    throw new Error(`Invalid AWS request options: ${issues}`);
  }
  return normalized as AwsRequestResourceOptions;
}

export function parseAwsRequestApiOptions(
  options: RequestOptions,
): AwsRequestApiOptions {
  const normalized = {
    ...options,
    mode: 'service-api' as const,
    requestKind: 'service-api-request' as const,
  };
  const result = awsRequestOptionsSchema.safeParse(normalized);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join(', ');
    throw new Error(`Invalid AWS API request options: ${issues}`);
  }
  return normalized as AwsRequestApiOptions;
}

export function parseAwsRequestPagesOptions(
  options: RequestOptions,
): AwsRequestPagesOptions {
  const optionsRecord = Object(options) as Record<string, unknown>;
  if (
    optionsRecord.mode === 'configured-accounts' ||
    optionsRecord.requestKind === 'configured-accounts'
  ) {
    const normalized = {
      ...options,
      mode: 'configured-accounts' as const,
      requestKind: 'configured-accounts' as const,
    };
    const result =
      awsConfiguredAccountsRequestPagesOptionsSchema.safeParse(normalized);
    if (!result.success) {
      const issues = result.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      throw new Error(`Invalid AWS request pages options: ${issues}`);
    }
    return normalized as AwsConfiguredAccountsRequestPagesOptions;
  }
  const isServiceApiMode =
    options.backendType === 'aws' &&
    ((optionsRecord.mode as string | undefined) === 'service-api' ||
      (typeof optionsRecord.service === 'string' &&
        (Array.isArray(optionsRecord.accountIds) ||
          typeof optionsRecord.accountSelection === 'object')));
  const normalized = {
    ...options,
    mode: isServiceApiMode ? 'service-api' : 'cloud-control',
    requestKind: isServiceApiMode ? 'service-api-pages' : 'cloud-control-pages',
  };
  const result = isServiceApiMode
    ? awsServiceApiRequestPagesOptionsSchema.safeParse(normalized)
    : awsCloudControlRequestPagesOptionsSchema.safeParse(normalized);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join(', ');
    throw new Error(`Invalid AWS request pages options: ${issues}`);
  }
  return normalized as AwsRequestPagesOptions;
}

export function parseAwsOrganizationsAccountPreviewOptions(
  options: RequestOptions,
): AwsOrganizationsAccountPreviewOptions {
  const normalized = {
    ...options,
    requestKind: 'organizations-account-preview' as const,
  };
  const result =
    awsOrganizationsAccountPreviewOptionsSchema.safeParse(normalized);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join(', ');
    throw new Error(`Invalid AWS organization preview options: ${issues}`);
  }
  return normalized as AwsOrganizationsAccountPreviewOptions;
}

export function buildAwsRequestOptions(
  config: Record<string, unknown>,
  signal?: AbortSignal,
): { objectIdExpression: string; requestOptions: AwsRequestPagesOptions } {
  const parsed = parseAwsSourceConfig(config);
  if (parsed.mode === 'configured-accounts') {
    return {
      objectIdExpression: parsed.objectIdExpression ?? 'Id',
      requestOptions: {
        backendType: 'aws',
        mode: 'configured-accounts',
        requestKind: 'configured-accounts',
        signal,
      },
    };
  }
  if (parsed.mode === 'service-api') {
    const defaults = getAwsServiceRequestDefaults(
      parsed.service,
      parsed.operation,
    );
    return {
      objectIdExpression:
        parsed.objectIdExpression ?? defaults?.objectIdExpression ?? 'id',
      requestOptions: {
        backendType: 'aws',
        mode: 'service-api',
        requestKind: 'service-api-pages',
        accountIds: parsed.accountIds,
        accountSelection: parsed.accountSelection,
        service: parsed.service,
        operation: parsed.operation,
        regions: parsed.regions,
        method: parsed.method ?? defaults?.method ?? 'POST',
        path: parsed.path ?? defaults?.path ?? '/',
        headers: parsed.headers ?? defaults?.headers,
        body: parsed.body ?? defaults?.body,
        arrayPath: parsed.arrayExpression ?? defaults?.arrayExpression ?? '$',
        pagination: parsed.pagination ??
          defaults?.pagination ?? { type: 'none' },
        signal,
      },
    };
  }
  return {
    objectIdExpression: parsed.objectIdExpression ?? 'id',
    requestOptions: {
      backendType: 'aws',
      mode: 'cloud-control',
      requestKind: 'cloud-control-pages',
      resourceType: parsed.resourceType,
      accountIds: parsed.accountIds,
      accountSelection: parsed.accountSelection,
      regions: parsed.regions,
      resourceModel: parsed.resourceModel,
      roleName: parsed.roleName,
      externalId: parsed.externalId,
      authRegion: parsed.authRegion,
      signal,
    },
  };
}

export { AwsBackend } from './Backend';
export type { AwsBackendOptions } from './Backend';
export {
  AWS_READ_ONLY_SESSION_POLICY_ARN,
  awsAssumeRolePolicyKey,
  createLegacyAwsAssumeRolePolicy,
  createMigratingAwsAssumeRolePolicy,
  createStrictAwsAssumeRolePolicy,
  deriveExternalId,
  toSourceIdentity,
  withTrustSetupFrom,
} from './assume-role-policy';
export type {
  AwsAssumeRoleContext,
  AwsAssumeRoleDecision,
  AwsAssumeRolePolicy,
  AwsTrustSetup,
  AwsTrustSetupContext,
  MigratingAwsAssumeRolePolicyOptions,
  StrictAwsAssumeRolePolicyOptions,
} from './assume-role-policy';
export {
  getAwsServiceRequestDefaults,
  listAwsServiceMetadata,
} from './metadata';
export { awsSourceConfigSchema } from './schemas';
export { deriveAwsDataKey };
