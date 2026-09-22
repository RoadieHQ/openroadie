import { LoggerService } from '@roadiehq/extensions-api';
import {
  CloudControlClient,
  GetResourceCommand,
  ListResourcesCommand,
  ResourceDescription,
  ThrottlingException,
} from '@aws-sdk/client-cloudcontrol';
import {
  fromNodeProviderChain,
  fromTemporaryCredentials,
} from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentity } from '@smithy/types';
import { v4 as uuid } from 'uuid';
import {
  Integration,
  PageResult,
  RequestLogCallback,
  RequestOptions,
} from '../../index';
import { renderTemplate } from '../../renderTemplate';
import type { IntegrationBackend } from '../index';
import {
  AwsCloudControlRequestPagesOptions,
  AwsOrganizationsAccountPreviewOptions,
  AwsConfiguredAccountsRequestPagesOptions,
  AwsRequestApiOptions,
  AwsRequestResourceOptions,
  AwsServiceApiRequestPagesOptions,
  parseAwsOrganizationsAccountPreviewOptions,
  parseAwsRequestApiOptions,
  parseAwsRequestPagesOptions,
  parseAwsRequestResourceOptions,
} from './index';
import {
  parseAwsIntegrationConfig,
  type AwsIntegrationConfig,
} from './schemas';
import {
  createLegacyAwsAssumeRolePolicy,
  type AwsAssumeRolePolicy,
  type AwsTrustSetup,
} from './assume-role-policy';
import {
  AwsAccountResolutionDeps,
  AwsResolvedAccountTarget,
  previewOrganizationAccounts as previewOrganizationAccountsHelper,
  resolveAwsAccountTargets as resolveAwsAccountTargetsHelper,
  resolveServiceApiAccountConfig as resolveServiceApiAccountConfigHelper,
  toConfiguredAccountCatalogItem,
} from './accounts';
import {
  AwsServiceApiDeps,
  ResolvedAwsServiceRequestOptions,
  requestResolvedServiceApiPages as requestResolvedServiceApiPagesHelper,
  requestServiceApi as requestServiceApiHelper,
  resolveServiceApiRequestOptions,
  statusStringFromAwsFailure,
} from './serviceApi';

const MAX_RETRIES = 5;

function isOperationCancelledError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message === 'Operation cancelled' || err.name === 'AbortError')
  );
}

function formatAllAwsTargetsFailedError(
  targetType: 'Cloud Control' | 'Service API',
  failedErrors: string[],
): string {
  const firstError = failedErrors[0] ?? `All AWS ${targetType} requests failed`;
  if (failedErrors.length <= 1) {
    return firstError;
  }
  return `All AWS ${targetType} account requests failed (${failedErrors.length} total). First error: ${firstError}`;
}
const BASE_DELAY_MS = 1000;

type UnsupportedListResourceTypeConfig = {
  request: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    service: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  };
  mapResponse: (response: unknown) => ResourceDescription[];
};

const UNSUPPORTED_LIST_RESOURCE_TYPES = new Map<
  string,
  UnsupportedListResourceTypeConfig
>([
  [
    'AWS::OpenSearchService::Domain',
    {
      request: {
        method: 'GET',
        service: 'es',
        path: '/2015-01-01/domain',
      },
      mapResponse: (response: unknown) => {
        const data = response as {
          DomainNames?: Array<{ DomainName?: string; EngineType?: string }>;
        };
        const result: ResourceDescription[] = [];
        for (const domain of data.DomainNames ?? []) {
          if (domain.DomainName) {
            result.push({
              Identifier: domain.DomainName,
              Properties: JSON.stringify(domain),
            });
          }
        }
        return result;
      },
    },
  ],
]);

function isThrottlingError(error: unknown): boolean {
  if (ThrottlingException && error instanceof ThrottlingException) {
    return true;
  }
  if (error instanceof Error) {
    if (error.name === 'ThrottlingException') {
      return true;
    }
    return /rate exceeded|throttl/i.test(error.message);
  }
  return false;
}

export interface AwsBackendOptions {
  logger: LoggerService;
  /**
   * Governs what the backend is allowed to assume and what it must present
   * when it does. Defaults to the legacy pass-through policy, which is correct
   * for single-tenant openroadie; multi-tenant deployments must inject a
   * strict policy (see `createStrictAwsAssumeRolePolicy`).
   */
  assumeRolePolicy?: AwsAssumeRolePolicy;
  /**
   * Resolves the scope of the in-flight request from server-side context.
   *
   * The assume-role policy derives per-tenant identity from this rather than
   * from the `scopeId` on the request options: the latter is threaded through
   * from callers, and a caller who could influence it could derive another
   * tenant's external ID.
   */
  getCurrentScopeId?: () => string | undefined | Promise<string | undefined>;
}

export class AwsBackend implements IntegrationBackend {
  private readonly logger: LoggerService;
  private readonly assumeRolePolicy: AwsAssumeRolePolicy;
  private readonly getCurrentScopeId?: AwsBackendOptions['getCurrentScopeId'];
  private readonly clientCache = new Map<string, CloudControlClient>();

  constructor(options: AwsBackendOptions) {
    this.logger = options.logger;
    this.assumeRolePolicy =
      options.assumeRolePolicy ?? createLegacyAwsAssumeRolePolicy();
    this.getCurrentScopeId = options.getCurrentScopeId;
  }

  private normalizeScopeId(scopeId?: string): string | undefined {
    return scopeId ? scopeId : undefined;
  }

  private withAwsAccountSourceTag(
    source: string | undefined,
    accountId: string,
  ): string {
    const base = source?.trim() || 'aws';
    return `${base} [account:${accountId}]`;
  }

  private warnSkippedAccountRequest(options: {
    mode: 'cloud-control' | 'service-api';
    accountId: string;
    region: string;
    target: string;
    error: unknown;
  }) {
    const message =
      options.error instanceof Error
        ? options.error.message
        : String(options.error);
    const status = statusStringFromAwsFailure(options.error);
    const modeLabel =
      options.mode === 'cloud-control' ? 'Cloud Control' : 'Service API';
    this.logger.warn(
      `Skipping AWS ${modeLabel} request for ${options.target} in account ${options.accountId} (${options.region})${status ? ` (HTTP ${status})` : ''}: ${message}`,
    );
  }

  async request(
    integration: Integration,
    options: RequestOptions,
  ): Promise<unknown> {
    const requestKind = (options as { requestKind?: string }).requestKind;
    if (requestKind === 'trust-setup') {
      return this.describeTrustSetup(integration, options);
    }
    if (requestKind === 'organizations-account-preview') {
      const parsed = parseAwsOrganizationsAccountPreviewOptions(options);
      return this.previewOrganizationAccounts(integration, parsed);
    }
    if (
      requestKind === 'cloud-control-resource' ||
      ('resourceType' in options &&
        ((options as { mode?: string }).mode ?? 'cloud-control') ===
          'cloud-control')
    ) {
      return this.requestResource(integration, options);
    }
    const parsed = parseAwsRequestApiOptions(options);
    return this.requestServiceApi(integration, parsed);
  }

  private async createCredentialsProvider(
    accountConfig: {
      accountId: string;
      roleName?: string;
      externalId?: string;
    },
    region: string,
    integrationId: string,
    scopeId?: string,
  ): Promise<() => Promise<AwsCredentialIdentity>> {
    const { accountId, roleName, externalId } = accountConfig;
    const normalizedScopeId =
      this.normalizeScopeId(await this.getCurrentScopeId?.()) ??
      this.normalizeScopeId(scopeId);
    const roleSessionName = normalizedScopeId
      ? `integration-${integrationId}-${normalizedScopeId}`
      : `integration-${integrationId}`;

    let provider: () => Promise<AwsCredentialIdentity>;
    let credentialSource: string;

    if (roleName) {
      const roleArn = roleName.startsWith('arn:')
        ? roleName
        : `arn:aws:iam::${accountId}:role/${roleName}`;
      credentialSource = roleArn;

      const decision = this.assumeRolePolicy.decide({
        accountId,
        roleArn,
        integrationId,
        scopeId: normalizedScopeId,
        configuredExternalId: externalId,
      });

      provider = fromTemporaryCredentials({
        params: {
          RoleArn: roleArn,
          ExternalId: decision.externalId,
          RoleSessionName: roleSessionName,
          ...(decision.sourceIdentity && {
            SourceIdentity: decision.sourceIdentity,
          }),
          ...(decision.sessionPolicyArns?.length && {
            PolicyArns: decision.sessionPolicyArns.map(arn => ({ arn })),
          }),
        },
        clientConfig: { region },
      });
    } else if (this.assumeRolePolicy.allowAmbientCredentials) {
      this.logger.info('Using default AWS credentials');
      credentialSource = `default credentials for account ${accountId}`;
      provider = fromNodeProviderChain({ clientConfig: { region } });
    } else {
      // Without a role there is nothing to assume, so the request would run as
      // the host process — i.e. against the deployment's own AWS account
      // rather than the tenant's.
      throw new Error(
        `AWS integration for account ${accountId} has no role configured, and this deployment does not permit falling back to ambient credentials`,
      );
    }

    return async () => {
      try {
        return await provider();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `AWS credential resolution failed for ${credentialSource}: ${message}`,
        );
      }
    };
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (signal?.aborted) {
          throw new Error('Operation cancelled');
        }
        if (!isThrottlingError(error) || attempt === MAX_RETRIES) {
          throw error;
        }
        const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 500;
        this.logger.info(
          `Rate limited, retrying in ${Math.round(delay)}ms (attempt ${
            attempt + 1
          }/${MAX_RETRIES})`,
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error('Max retries exceeded');
  }

  private createServiceApiDeps(integrationId: string): AwsServiceApiDeps {
    return {
      logger: this.logger,
      integrationId,
      createCredentialsProvider: (
        accountConfig,
        region,
        resolvedIntegrationId,
        scopeId,
      ) =>
        this.createCredentialsProvider(
          accountConfig,
          region,
          resolvedIntegrationId,
          scopeId,
        ),
      withRetry: async <T>(fn: () => Promise<T>, signal?: AbortSignal) =>
        this.withRetry(fn, signal),
    };
  }

  private createAccountResolutionDeps(
    integration: Integration,
  ): AwsAccountResolutionDeps {
    const serviceApiDeps = this.createServiceApiDeps(integration.id);
    return {
      requestServiceApi: async (integrationArg, options) =>
        this.requestServiceApi(integrationArg, options),
      resolveServiceApiRequestOptions,
      requestResolvedServiceApiPages: resolved =>
        requestResolvedServiceApiPagesHelper(serviceApiDeps, resolved),
    };
  }

  private async resolveServiceApiAccountConfig(
    integration: Integration,
    integrationConfig: AwsIntegrationConfig,
    accountId: string,
    options: {
      signal?: AbortSignal;
      scopeId?: string;
      beforeRequest?: () => Promise<void>;
      onRequestLog?: RequestLogCallback;
    },
  ): Promise<AwsResolvedAccountTarget | undefined> {
    return resolveServiceApiAccountConfigHelper(
      this.createAccountResolutionDeps(integration),
      integration,
      integrationConfig,
      accountId,
      options,
    );
  }

  private async resolveAwsAccountTargets(
    integration: Integration,
    integrationConfig: AwsIntegrationConfig,
    options:
      | AwsServiceApiRequestPagesOptions
      | AwsCloudControlRequestPagesOptions,
  ): Promise<AwsResolvedAccountTarget[]> {
    return resolveAwsAccountTargetsHelper(
      this.createAccountResolutionDeps(integration),
      integration,
      integrationConfig,
      options,
    );
  }

  /**
   * The values a customer needs to author their trust policy.
   *
   * Read straight off the assume-role policy rather than recomputed here, so
   * what we show a customer and what we send to STS cannot disagree.
   */
  private async describeTrustSetup(
    integration: Integration,
    options: RequestOptions,
  ): Promise<AwsTrustSetup> {
    return this.assumeRolePolicy.describeTrustSetup({
      integrationId: integration.id,
      scopeId:
        this.normalizeScopeId(await this.getCurrentScopeId?.()) ??
        this.normalizeScopeId(options.scopeId),
    });
  }

  private async previewOrganizationAccounts(
    integration: Integration,
    options: AwsOrganizationsAccountPreviewOptions,
  ): Promise<AwsResolvedAccountTarget[]> {
    const integrationConfig = parseAwsIntegrationConfig(integration.config);
    const targets = await previewOrganizationAccountsHelper(
      this.createAccountResolutionDeps(integration),
      integration,
      integrationConfig,
      options,
    );

    const scopeId =
      this.normalizeScopeId(await this.getCurrentScopeId?.()) ??
      this.normalizeScopeId(options.scopeId);

    // The resolver derives externalId from integration config, but the policy
    // is what actually gets sent. Report the policy's value or the preview
    // would show customers an external ID their role will never be assumed
    // with.
    const { externalId } = this.assumeRolePolicy.describeTrustSetup({
      integrationId: integration.id,
      scopeId,
    });

    return targets.map(target => ({ ...target, externalId }));
  }

  private async *requestConfiguredAccounts(
    integration: Integration,
    options: AwsConfiguredAccountsRequestPagesOptions,
  ): AsyncGenerator<PageResult> {
    const integrationConfig = parseAwsIntegrationConfig(integration.config);
    const targets = await previewOrganizationAccountsHelper(
      this.createAccountResolutionDeps(integration),
      integration,
      integrationConfig,
      {
        backendType: 'aws',
        requestKind: 'organizations-account-preview',
        signal: options.signal,
        scopeId: options.scopeId,
        beforeRequest: options.beforeRequest,
        onRequestLog: options.onRequestLog,
      },
    );

    yield {
      items: targets.map(toConfiguredAccountCatalogItem),
      pageIndex: 0,
    };
  }

  private async requestServiceApi(
    integration: Integration,
    options: AwsRequestApiOptions,
  ): Promise<unknown> {
    const resolved = resolveServiceApiRequestOptions(
      options,
      options.profile,
      options.region,
    );
    const integrationConfig = parseAwsIntegrationConfig(integration.config);
    const accountConfig =
      resolved.accountConfig ??
      (await this.resolveServiceApiAccountConfig(
        integration,
        integrationConfig,
        resolved.accountId,
        {
          signal: resolved.signal,
          scopeId: resolved.scopeId,
          beforeRequest: resolved.beforeRequest,
          onRequestLog: resolved.onRequestLog,
        },
      ));

    return requestServiceApiHelper(this.createServiceApiDeps(integration.id), {
      ...resolved,
      accountConfig,
    });
  }

  private async *requestServiceApiPages(
    integration: Integration,
    options: AwsServiceApiRequestPagesOptions,
  ): AsyncGenerator<PageResult> {
    const integrationConfig = parseAwsIntegrationConfig(integration.config);
    const accountTargets = await this.resolveAwsAccountTargets(
      integration,
      integrationConfig,
      options,
    );
    const serviceApiDeps = this.createServiceApiDeps(integration.id);
    let pageIndex = 0;
    let successfulTargets = 0;
    const failedErrors: string[] = [];

    for (const accountTarget of accountTargets) {
      const regionsToQuery =
        options.regions && options.regions.length > 0
          ? options.regions
          : [accountTarget.region ?? 'us-east-1'];
      for (const region of regionsToQuery) {
        try {
          const resolved: ResolvedAwsServiceRequestOptions = {
            ...resolveServiceApiRequestOptions(
              options,
              accountTarget.accountId,
              region,
            ),
            source: this.withAwsAccountSourceTag(
              options.source,
              accountTarget.accountId,
            ),
            accountConfig: {
              accountId: accountTarget.accountId,
              roleName: accountTarget.roleName,
              externalId: accountTarget.externalId,
            },
          };
          for await (const items of requestResolvedServiceApiPagesHelper(
            serviceApiDeps,
            resolved,
          )) {
            yield {
              items: items.map(item =>
                item && typeof item === 'object' && !Array.isArray(item)
                  ? {
                      ...item,
                      _aws: { accountId: accountTarget.accountId, region },
                    }
                  : {
                      value: item,
                      _aws: { accountId: accountTarget.accountId, region },
                    },
              ),
              pageIndex,
            };
            pageIndex++;
          }
          successfulTargets++;
        } catch (error) {
          if (isOperationCancelledError(error)) {
            throw error;
          }
          failedErrors.push(
            error instanceof Error ? error.message : String(error),
          );
          this.warnSkippedAccountRequest({
            mode: 'service-api',
            accountId: accountTarget.accountId,
            region,
            target: `${options.service}:${options.operation}`,
            error,
          });
        }
      }
    }

    if (successfulTargets === 0 && failedErrors.length > 0) {
      throw new Error(
        formatAllAwsTargetsFailedError('Service API', failedErrors),
      );
    }
  }

  private async requestResource(
    integration: Integration,
    options: RequestOptions,
  ): Promise<unknown> {
    const parsed = parseAwsRequestResourceOptions(options);

    const operation = parsed.operation ?? 'get';
    const {
      resourceType,
      accountId,
      accountConfig,
      region,
      signal,
      stsRegion,
    } = parsed;

    const client = await this.createCloudControlClient(
      {
        accountId,
        roleName: accountConfig?.roleName,
        externalId: accountConfig?.externalId,
      },
      region,
      integration.id,
      stsRegion,
      options.scopeId,
    );

    await parsed.beforeRequest?.();
    const startTime = Date.now();

    try {
      if (operation !== 'get') {
        throw new Error('only get operation is supported');
      }

      if (!parsed.identifier) {
        throw new Error('identifier is required for get operation');
      }
      const response = await this.withRetry(
        () =>
          client.send(
            new GetResourceCommand({
              TypeName: resourceType,
              Identifier: parsed.identifier,
            }),
          ),
        signal,
      );
      const result: unknown = response.ResourceDescription?.Properties
        ? JSON.parse(response.ResourceDescription.Properties)
        : undefined;

      const duration = Date.now() - startTime;
      parsed.onRequestLog?.({
        id: uuid(),
        timestamp: new Date(startTime).toISOString(),
        source: parsed.source ?? '',
        target: parsed.identifier
          ? `${resourceType}/${parsed.identifier}`
          : resourceType,
        operation: `${operation.charAt(0).toUpperCase()}${operation.slice(
          1,
        )}Resource`,
        duration,
        responseBody: result,
      });

      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      parsed.onRequestLog?.({
        id: uuid(),
        timestamp: new Date(startTime).toISOString(),
        source: parsed.source ?? '',
        target: parsed.identifier
          ? `${resourceType}/${parsed.identifier}`
          : resourceType,
        operation: `${operation.charAt(0).toUpperCase()}${operation.slice(
          1,
        )}Resource`,
        duration,
        error: err instanceof Error ? err.message : String(err),
        status: statusStringFromAwsFailure(err),
      });
      throw err;
    }
  }

  async *requestPages(
    integration: Integration,
    options: RequestOptions,
  ): AsyncGenerator<PageResult> {
    const parsed = parseAwsRequestPagesOptions(options);
    if (parsed.mode === 'configured-accounts') {
      yield* this.requestConfiguredAccounts(integration, parsed);
      return;
    }
    if (parsed.mode === 'service-api') {
      yield* this.requestServiceApiPages(integration, parsed);
      return;
    }
    const { resourceType, regions } = parsed;
    const renderedResourceModel = parsed.resourceModel
      ? renderTemplate(parsed.resourceModel)
      : undefined;
    const signal = parsed.signal;

    if (!resourceType) {
      throw new Error('Resource Type is required');
    }

    const integrationConfig = parseAwsIntegrationConfig(integration.config);
    const accountTargets = await this.resolveAwsAccountTargets(
      integration,
      integrationConfig,
      parsed,
    );

    let pageIndex = 0;
    let successfulTargets = 0;
    const failedErrors: string[] = [];

    for (const accountTarget of accountTargets) {
      const { accountId } = accountTarget;
      const roleName = parsed.roleName || accountTarget.roleName;
      const externalId = parsed.externalId || accountTarget.externalId;
      const stsRegion = parsed.authRegion;

      const regionsToQuery =
        regions && regions.length > 0
          ? regions
          : [accountTarget.region ?? 'us-east-1'];

      this.logger.info(`Processing AWS account: ${accountId}`);

      for (const region of regionsToQuery) {
        try {
          const sourceWithAccount = this.withAwsAccountSourceTag(
            parsed.source,
            accountId,
          );
          const client = await this.createCloudControlClient(
            { accountId, roleName, externalId },
            region,
            integration.id,
            stsRegion,
            parsed.scopeId,
          );

          this.logger.info(`Listing ${resourceType} resources in ${region}`);

          let nextToken: string | undefined;

          do {
            if (signal?.aborted) {
              throw new Error('Operation cancelled');
            }

            await parsed.beforeRequest?.();
            const listStartTime = Date.now();
            const currentToken = nextToken;

            let response;
            try {
              response = UNSUPPORTED_LIST_RESOURCE_TYPES.has(resourceType)
                ? await this.listViaServiceEndpoint(integration, {
                    resourceType,
                    accountId,
                    region,
                    signal,
                    source: sourceWithAccount,
                  })
                : await this.withRetry(
                    () =>
                      client.send(
                        new ListResourcesCommand({
                          TypeName: resourceType,
                          NextToken: currentToken,
                          MaxResults: 50,
                          ...(renderedResourceModel && {
                            ResourceModel: renderedResourceModel,
                          }),
                        }),
                      ),
                    signal,
                  );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              const name = err instanceof Error ? err.name : 'UnknownError';
              parsed.onRequestLog?.({
                id: uuid(),
                timestamp: new Date(listStartTime).toISOString(),
                source: sourceWithAccount,
                target: `${resourceType} [account:${accountId}]`,
                operation: 'ListResources',
                duration: Date.now() - listStartTime,
                error: `${name}: ${message}`,
                status: statusStringFromAwsFailure(err),
              });
              throw new Error(
                `AWS CloudControl request failed for ${resourceType} in account ${accountId} (${region}): ${name}: ${message}`,
              );
            }
            const listDuration = Date.now() - listStartTime;

            const resourceDescriptions = response.ResourceDescriptions ?? [];

            this.logger.info(
              `Fetched ${resourceDescriptions.length} resource identifiers (${listDuration}ms)`,
            );

            parsed.onRequestLog?.({
              id: uuid(),
              timestamp: new Date(listStartTime).toISOString(),
              source: sourceWithAccount,
              target: `${resourceType} [account:${accountId}]`,
              operation: 'ListResources',
              duration: listDuration,
              responseBody: {
                count: resourceDescriptions.length,
                nextToken: response.NextToken,
              },
            });

            const pageItems: unknown[] = [];

            for (const resourceDesc of resourceDescriptions) {
              if (signal?.aborted) {
                throw new Error('Operation cancelled');
              }

              if (resourceDesc.Identifier) {
                try {
                  const getOptions: AwsRequestResourceOptions = {
                    backendType: 'aws',
                    mode: 'cloud-control',
                    requestKind: 'cloud-control-resource',
                    resourceType,
                    accountId,
                    accountConfig: { accountId, roleName, externalId },
                    region,
                    operation: 'get',
                    identifier: resourceDesc.Identifier,
                    source: sourceWithAccount,
                    signal: parsed.signal,
                    onRequestLog: parsed.onRequestLog,
                    beforeRequest: parsed.beforeRequest,
                    stsRegion,
                    scopeId: parsed.scopeId,
                  };
                  const properties = await this.requestResource(
                    integration,
                    getOptions,
                  );

                  pageItems.push({
                    id: resourceDesc.Identifier,
                    identifier: resourceDesc.Identifier,
                    resourceType,
                    accountId,
                    region,
                    properties: properties ?? {},
                  });
                } catch (e: unknown) {
                  const message = e instanceof Error ? e.message : String(e);
                  const status = statusStringFromAwsFailure(e);
                  this.logger.warn(
                    `Failed to get details for resource ${resourceDesc.Identifier}${status ? ` (HTTP ${status})` : ''}: ${message}`,
                  );
                  pageItems.push({
                    id: resourceDesc.Identifier,
                    identifier: resourceDesc.Identifier,
                    resourceType,
                    accountId,
                    region,
                    properties: {},
                  });
                }
              }
            }

            yield { items: pageItems, pageIndex };
            pageIndex++;

            nextToken = response.NextToken;

            if (nextToken) {
              this.logger.info(`Fetching next page of resources...`);
            }
          } while (nextToken);
          successfulTargets++;
        } catch (error) {
          if (isOperationCancelledError(error)) {
            throw error;
          }
          failedErrors.push(
            error instanceof Error ? error.message : String(error),
          );
          this.warnSkippedAccountRequest({
            mode: 'cloud-control',
            accountId,
            region,
            target: resourceType,
            error,
          });
        }
      }

      this.logger.info(`Completed account ${accountId}`);
    }

    if (successfulTargets === 0 && failedErrors.length > 0) {
      throw new Error(
        formatAllAwsTargetsFailedError('Cloud Control', failedErrors),
      );
    }

    this.logger.info(
      `Completed: fetched resources from ${accountTargets.length} accounts`,
    );
  }

  private async createCloudControlClient(
    accountConfig: {
      accountId: string;
      roleName?: string;
      externalId?: string;
    },
    region: string,
    integrationId: string,
    stsRegion?: string,
    scopeId?: string,
  ): Promise<CloudControlClient> {
    const normalizedScopeId = this.normalizeScopeId(scopeId);
    const cacheKey = `${accountConfig.accountId}:${region}:${integrationId}:${
      accountConfig.roleName ?? ''
    }:${stsRegion ?? ''}:${normalizedScopeId ?? ''}`;
    const cached = this.clientCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const credentials = await this.createCredentialsProvider(
      accountConfig,
      stsRegion || region,
      integrationId,
      normalizedScopeId,
    );
    const client = new CloudControlClient({ credentials, region });
    this.clientCache.set(cacheKey, client);
    return client;
  }

  private async listViaServiceEndpoint(
    integration: Integration,
    options: {
      resourceType: string;
      accountId: string;
      region: string;
      signal?: AbortSignal;
      source?: string;
      onRequestLog?: RequestLogCallback;
    },
  ): Promise<{
    ResourceDescriptions: ResourceDescription[];
    NextToken?: string;
  }> {
    const config = UNSUPPORTED_LIST_RESOURCE_TYPES.get(options.resourceType);
    if (!config) {
      throw new Error(
        `Resource type ${options.resourceType} is not registered for unsupported list handling`,
      );
    }

    const requestOptions: AwsRequestApiOptions = {
      backendType: 'aws',
      mode: 'service-api',
      requestKind: 'service-api-request',
      method: config.request.method,
      profile: options.accountId,
      service: config.request.service,
      region: options.region,
      path: config.request.path,
      headers: config.request.headers,
      body: config.request.body,
      signal: options.signal,
      source: options.source,
      onRequestLog: options.onRequestLog,
    };
    const response = await this.request(integration, requestOptions);

    return {
      ResourceDescriptions: config.mapResponse(response),
    };
  }
}
