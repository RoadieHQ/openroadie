import { z } from 'zod';
import { paginationSchema } from '../http/schemas';

const awsAccountConfigSchema = z.object({
  name: z.string().optional(),
  accountId: z.string(),
  roleName: z.string().optional(),
  externalId: z.string().optional(),
  region: z.string().optional(),
});

export type AwsAccountConfig = z.infer<typeof awsAccountConfigSchema>;

const awsTagEntrySchema = z.object({
  key: z.string(),
  value: z.string(),
});

export type AwsTagEntry = z.infer<typeof awsTagEntrySchema>;

const awsProfileConfigSchema = z.object({
  name: z.string().optional(),
  accountId: z.string(),
  roleName: z.string().optional(),
  externalId: z.string().optional(),
  region: z.string().optional(),
});

export type AwsProfileConfig = z.infer<typeof awsProfileConfigSchema>;

const awsOrganizationsDefaultsSchema = z.object({
  roleName: z.string().optional(),
  externalId: z.string().optional(),
  externalIdPrefix: z.string().optional(),
  region: z.string().optional(),
});

export type AwsOrganizationsDefaults = z.infer<
  typeof awsOrganizationsDefaultsSchema
>;

export const awsOrganizationsConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  managementAccount: awsAccountConfigSchema,
  defaults: awsOrganizationsDefaultsSchema.optional(),
  excludeManagementAccount: z.boolean().optional(),
  excludedAccountIds: z.array(z.string()).optional(),
  requiredTags: z.array(awsTagEntrySchema).optional(),
  excludedTags: z.array(awsTagEntrySchema).optional(),
});

export type AwsOrganizationsConfig = z.infer<
  typeof awsOrganizationsConfigSchema
>;

export const awsIntegrationConfigSchema = z.object({
  profiles: z.record(z.string(), awsProfileConfigSchema).optional(),
  organizations: awsOrganizationsConfigSchema.optional(),
});

export type AwsIntegrationConfig = z.infer<typeof awsIntegrationConfigSchema>;

export const awsAccountSelectionConfigSchema = z.object({
  mode: z.literal('all'),
  excludedAccountIds: z.array(z.string()).optional(),
  requiredTags: z.array(awsTagEntrySchema).optional(),
  excludedTags: z.array(awsTagEntrySchema).optional(),
});

export type AwsAccountSelectionConfig = z.infer<
  typeof awsAccountSelectionConfigSchema
>;

export const awsCloudControlSourceConfigSchema = z
  .object({
    backendType: z.literal('aws'),
    integrationId: z.string(),
    mode: z.literal('cloud-control'),
    accountIds: z.array(z.string()).optional(),
    accountSelection: awsAccountSelectionConfigSchema.optional(),
    resourceType: z.string(),
    regions: z.array(z.string()).optional(),
    resourceModel: z.string().optional(),
    objectIdExpression: z.string().optional(),
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

export const awsServiceApiSourceConfigSchema = z
  .object({
    backendType: z.literal('aws'),
    integrationId: z.string(),
    mode: z.literal('service-api'),
    accountIds: z.array(z.string()).optional(),
    accountSelection: awsAccountSelectionConfigSchema.optional(),
    service: z.string(),
    operation: z.string(),
    regions: z.array(z.string()).optional(),
    path: z.string().optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    arrayExpression: z.string().optional(),
    objectIdExpression: z.string().optional(),
    pagination: paginationSchema.optional(),
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

export const awsConfiguredAccountsSourceConfigSchema = z.object({
  backendType: z.literal('aws'),
  integrationId: z.string(),
  mode: z.literal('configured-accounts'),
  objectIdExpression: z.string().optional(),
});

export const awsSourceConfigSchema = z.union([
  awsConfiguredAccountsSourceConfigSchema,
  awsCloudControlSourceConfigSchema,
  awsServiceApiSourceConfigSchema,
]);

export type AwsCloudControlSourceConfig = z.infer<
  typeof awsCloudControlSourceConfigSchema
>;
export type AwsServiceApiSourceConfig = z.infer<
  typeof awsServiceApiSourceConfigSchema
>;
export type AwsConfiguredAccountsSourceConfig = z.infer<
  typeof awsConfiguredAccountsSourceConfigSchema
>;
export type AwsSourceConfig =
  | AwsCloudControlSourceConfig
  | AwsServiceApiSourceConfig
  | AwsConfiguredAccountsSourceConfig;

export function parseAwsSourceConfig(
  config: Record<string, unknown>,
): AwsSourceConfig {
  if (config.mode === 'configured-accounts') {
    return awsConfiguredAccountsSourceConfigSchema.parse({
      ...config,
      backendType: 'aws' as const,
      mode: 'configured-accounts' as const,
    });
  }
  const normalizedMode =
    config.mode === 'service-api' ||
    (config.mode === undefined && typeof config.service === 'string')
      ? 'service-api'
      : 'cloud-control';
  const normalized = {
    ...config,
    backendType: 'aws' as const,
    mode: normalizedMode,
  };
  if (normalizedMode === 'service-api') {
    return awsServiceApiSourceConfigSchema.parse(normalized);
  }
  return awsCloudControlSourceConfigSchema.parse(normalized);
}

export function parseAwsIntegrationConfig(
  config: Record<string, unknown>,
): AwsIntegrationConfig {
  return awsIntegrationConfigSchema.parse(config);
}
