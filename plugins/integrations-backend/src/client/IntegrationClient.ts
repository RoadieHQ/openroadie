import { LoggerService } from '@roadiehq/extensions-api';
import { Config } from '@roadiehq/config';
import { Knex } from 'knex';
import {
  Integration,
  IntegrationClient as IIntegrationClient,
  BackendType,
  PaginationType,
  CursorPaginationConfig,
  PagePaginationConfig,
  OffsetPaginationConfig,
  LinkHeaderPaginationConfig,
  BodyLinkPaginationConfig,
  NoPaginationConfig,
  PaginationConfig,
  PageResult,
  RequestOptions,
  HttpRequestOptions,
  HttpBackend,
  AwsBackend,
  IntegrationBackend,
  AwsAccountConfig,
  AwsAssumeRolePolicy,
} from '@roadiehq/integrations-node';
import type { SecretStoreService } from '@roadiehq/secrets-node';
import type { SecretsMetadataService } from '@roadiehq/secrets-settings-backend';
import { RateLimiter } from './RateLimiterTypes';
import { PostgresRateLimiter } from './PostgresRateLimiter';
import { buildEnvVarAllowList } from '../utils/envVarAllowList';
import { getGithubRestApiBaseUrl } from '../utils/githubHost';
import { IntegrationDao } from '../database/IntegrationDao';
import { GithubAppDao } from '../database/GithubAppDao';
import { GithubAppInstallationDao } from '../database/GithubAppInstallationDao';
import { LocalGitHubAppTokenProvider } from '../github/LocalGitHubAppTokenProvider';
import { KmsGitHubAppTokenProvider } from '../github/KmsGitHubAppTokenProvider';
import { getIntegrationConfigurationError } from '../service/integrationReadiness';

export type {
  PaginationType,
  CursorPaginationConfig,
  PagePaginationConfig,
  OffsetPaginationConfig,
  LinkHeaderPaginationConfig,
  BodyLinkPaginationConfig,
  NoPaginationConfig,
  PaginationConfig,
  PageResult,
  RequestOptions,
  HttpRequestOptions,
};

interface ResolveCacheEntry {
  integration: Integration;
  expiresAt: number;
}

export interface IntegrationClientOptions {
  logger: LoggerService;
  config: Config;
  knex: Knex;
  integrationDao: IntegrationDao;
  githubAppDao?: GithubAppDao;
  githubAppInstallationDao?: GithubAppInstallationDao;
  localTokenMinter?: LocalGitHubAppTokenProvider;
  kmsTokenMinter?: KmsGitHubAppTokenProvider;
  /**
   * Secret store used to resolve GitHub App private keys and HTTP auth
   * substitutions on the request hot path. Scope is discovered inside
   * the resolver via ALS in scoped mode.
   */
  secretStore: SecretStoreService;
  /**
   * TTL for the resolve cache in milliseconds. Defaults to 30000 (30s) or
   * the value of `INTEGRATION_RESOLVE_CACHE_TTL_MS` if set. Lower values
   * mean changes propagate across replicas faster; higher values mean
   * fewer DB round-trips.
   */
  resolveCacheTtlMs?: number;
  secretsMetadataService?: SecretsMetadataService;
  /**
   * When true, outbound integration HTTP requests are blocked from
   * reaching localhost, private RFC 1918 ranges, link-local addresses,
   * cloud metadata endpoints, and Kubernetes cluster-internal hostnames.
   * Enable in production to prevent SSRF.
   */
  blockPrivateNetworks?: boolean;
  /**
   * Hostname patterns permitted to resolve to private IPs even when
   * `blockPrivateNetworks` is true.  Supports exact matches and
   * wildcard-prefix patterns (e.g. `*.eks.amazonaws.com`).
   */
  privateIpAllowedHosts?: string[];
  /**
   * Governs which IAM roles the AWS backend may assume and what it presents
   * when assuming them. Omit for single-tenant deployments; multi-tenant
   * deployments must supply a strict policy, or every tenant's requests go out
   * as the same IAM principal with a tenant-supplied external ID.
   */
  awsAssumeRolePolicy?: AwsAssumeRolePolicy;
  /**
   * Resolves the in-flight request's scope from server-side context, for the
   * AWS assume-role policy. See `AwsBackendOptions.getCurrentScopeId`.
   */
  getCurrentScopeId?: () => string | undefined | Promise<string | undefined>;
}

/**
 * IntegrationClient is stateless with respect to integration configuration:
 * every `request()` / `requestPages()` resolves the integration via
 * `IntegrationDao` rather than relying on a process-wide registration
 * map. A short-lived cache amortises DB lookups within a single replica
 * without making the cache authoritative.
 *
 * Rate limiters (Postgres-backed token buckets) are cached lazily per
 * integration id; instance creation is cheap because the authoritative
 * bucket state lives in Postgres.
 */
export class IntegrationClient implements IIntegrationClient {
  private readonly logger: LoggerService;
  private readonly knex: Knex;
  private readonly backends: Map<string, IntegrationBackend>;
  private readonly integrationDao: IntegrationDao;
  private readonly githubAppDao?: GithubAppDao;
  private readonly githubAppInstallationDao?: GithubAppInstallationDao;
  private readonly localTokenMinter?: LocalGitHubAppTokenProvider;
  private readonly kmsTokenMinter?: KmsGitHubAppTokenProvider;
  private readonly resolveCacheTtlMs: number;
  private readonly resolveCache = new Map<string, ResolveCacheEntry>();
  private readonly rateLimiters = new Map<string, RateLimiter>();
  private readonly secretStore: SecretStoreService;
  private readonly envVarAllowList: Set<string>;
  private readonly secretsMetadataService?: SecretsMetadataService;

  constructor(options: IntegrationClientOptions) {
    this.logger = options.logger.child({ name: 'IntegrationClient' });
    this.knex = options.knex;
    this.integrationDao = options.integrationDao;
    this.githubAppDao = options.githubAppDao;
    this.githubAppInstallationDao = options.githubAppInstallationDao;
    this.localTokenMinter = options.localTokenMinter;
    this.kmsTokenMinter = options.kmsTokenMinter;
    this.secretStore = options.secretStore;
    this.secretsMetadataService = options.secretsMetadataService;
    this.resolveCacheTtlMs =
      options.resolveCacheTtlMs ??
      parseInt(process.env.INTEGRATION_RESOLVE_CACHE_TTL_MS ?? '30000', 10);

    this.envVarAllowList = new Set(
      buildEnvVarAllowList(options.config, this.logger),
    );

    this.backends = new Map<BackendType, IntegrationBackend>([
      [
        'http',
        new HttpBackend({
          logger: this.logger,
          secretStore: this.secretStore,
          getEnvVarAllowList: workspaceId =>
            this.getEnvVarAllowList(workspaceId),
          blockPrivateNetworks: options.blockPrivateNetworks,
          privateIpAllowedHosts: options.privateIpAllowedHosts,
        }),
      ],
      [
        'aws',
        new AwsBackend({
          logger: this.logger,
          assumeRolePolicy: options.awsAssumeRolePolicy,
          getCurrentScopeId: options.getCurrentScopeId,
        }),
      ],
    ]);

    this.logger.info(
      'IntegrationClient initialized with DB-backed resolution and PostgreSQL rate limiting',
    );
  }

  async destroy(): Promise<void> {
    for (const [, limiter] of this.rateLimiters) {
      await limiter.destroy();
    }
    this.rateLimiters.clear();
    this.resolveCache.clear();
  }

  private async getEnvVarAllowList(workspaceId?: string): Promise<Set<string>> {
    const metadataNames =
      (await this.secretsMetadataService?.getSecretInternalNames(
        workspaceId,
      )) ?? [];
    return new Set([...this.envVarAllowList, ...metadataNames]);
  }

  async getIntegration(
    integrationId: string,
    workspaceId?: string,
  ): Promise<Integration | undefined> {
    return this.resolveIntegration(integrationId, workspaceId, undefined);
  }

  async listIntegrations(workspaceId?: string): Promise<Integration[]> {
    const result = await this.integrationDao.list({
      limit: 10000,
      workspaceId,
    });
    return result.integrations;
  }

  async unregisterIntegration(integrationId: string): Promise<void> {
    for (const key of [...this.resolveCache.keys()]) {
      if (key.endsWith(`::${integrationId}`)) {
        this.resolveCache.delete(key);
      }
    }

    const limiter = this.rateLimiters.get(integrationId);
    if (limiter) {
      await limiter.destroy();
      this.rateLimiters.delete(integrationId);
    }

    const httpBackend = this.backends.get('http');
    if (httpBackend instanceof HttpBackend) {
      httpBackend.clearCachedToken(integrationId);
    }
  }

  private cacheKey(
    workspaceId: string | undefined,
    scopeId: string | undefined,
    integrationId: string,
  ): string {
    return `${workspaceId ?? 'default'}::${scopeId ?? 'default'}::${integrationId}`;
  }

  private async resolveIntegration(
    integrationId: string,
    workspaceId: string | undefined,
    scopeId: string | undefined,
  ): Promise<Integration | undefined> {
    const key = this.cacheKey(workspaceId, scopeId, integrationId);
    const now = Date.now();
    const cached = this.resolveCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.integration;
    }

    try {
      const integration = await this.integrationDao.getById(
        integrationId,
        workspaceId,
      );
      this.resolveCache.set(key, {
        integration,
        expiresAt: now + this.resolveCacheTtlMs,
      });
      return integration;
    } catch (err: unknown) {
      if (err instanceof Error && /not found/i.test(err.message) && cached) {
        this.resolveCache.delete(key);
      }
      if (err instanceof Error && /not found/i.test(err.message)) {
        return undefined;
      }
      throw err;
    }
  }

  private getRateLimiter(integration: Integration): RateLimiter {
    const existing = this.rateLimiters.get(integration.id);
    if (existing) return existing;

    const requestsPerSecond =
      integration.requestsPerSecond ??
      (integration.requestsPerHour ?? 36000) / 3600;

    const burstSize =
      integration.burstCapacity ??
      Math.max(1, Math.floor((integration.requestsPerHour ?? 36000) / 60));

    const limiter = new PostgresRateLimiter({
      knex: this.knex,
      integrationId: integration.id,
      integrationName: integration.name,
      requestsPerSecond,
      burst: burstSize,
    });
    this.rateLimiters.set(integration.id, limiter);
    this.logger.debug(
      `Created rate limiter for ${integration.name} (${requestsPerSecond} req/s, burst: ${burstSize})`,
    );
    return limiter;
  }

  private resolveRequestOptions(
    integration: Integration,
    options: RequestOptions,
  ): RequestOptions {
    if (options.backendType !== 'aws' || !('accountId' in options)) {
      return options;
    }

    const profiles =
      (integration.config?.profiles as Record<string, AwsAccountConfig>) ?? {};
    const accountId = (options as Record<string, unknown>).accountId as string;
    const profile = profiles[accountId];

    return {
      ...options,
      accountConfig: profile ?? { accountId },
    } as RequestOptions;
  }

  private getBackend(backendType: string): IntegrationBackend {
    const backend = this.backends.get(backendType);
    if (!backend) {
      throw new Error(`Unsupported backend type: ${backendType}`);
    }
    return backend;
  }

  private static readonly ORG_PATH_PREFIXES = new Set([
    'repos',
    'orgs',
    'users',
  ]);

  private static pathNameAndQuery(path: string): {
    pathname: string;
    queryString?: string;
  } {
    const [pathname, queryString] = path.split('?', 2);
    return { pathname, queryString };
  }

  private static isGithubAppJwtPath(path: string | undefined): boolean {
    if (!path) {
      return false;
    }
    const pathname = IntegrationClient.pathNameAndQuery(path).pathname.replace(
      /^\/+/,
      '',
    );
    return pathname === 'app' || pathname.startsWith('app/');
  }

  private static isGithubInstallationPath(path: string | undefined): boolean {
    if (!path) {
      return false;
    }
    const pathname = IntegrationClient.pathNameAndQuery(path).pathname.replace(
      /^\/+/,
      '',
    );
    return pathname === 'installation' || pathname.startsWith('installation/');
  }

  private parseInstallationIdFromPath(path: string): number | undefined {
    const { queryString } = IntegrationClient.pathNameAndQuery(path);
    if (!queryString) {
      return undefined;
    }
    const raw = new URLSearchParams(queryString).get('installation_id');
    if (!raw) {
      return undefined;
    }
    const installationId = Number(raw);
    return Number.isFinite(installationId) && installationId > 0
      ? installationId
      : undefined;
  }

  private parseOrgFromPath(path: string): string | undefined {
    const { pathname, queryString } = IntegrationClient.pathNameAndQuery(path);
    const segments = pathname.replace(/^\/+/, '').split('/');

    if (segments[1] && IntegrationClient.ORG_PATH_PREFIXES.has(segments[0])) {
      return segments[1];
    }

    if (queryString) {
      const params = new URLSearchParams(queryString);
      const owner = params.get('owner');
      if (owner) {
        return owner;
      }
      const q = params.get('q');
      if (q) {
        const orgMatch = q.match(/(?:^|\s)(?:org|user):(\S+)/);
        if (orgMatch) {
          return orgMatch[1];
        }
        const repoMatch = q.match(/(?:^|\s)repo:([^/\s+]+)/);
        if (repoMatch) {
          return repoMatch[1];
        }
      }
    }

    return undefined;
  }

  // Variable names commonly used in GitHub GraphQL queries to identify the
  // owning org/user. Checked in priority order.
  private static readonly GRAPHQL_ORG_VARIABLE_KEYS = [
    'login',
    'org',
    'organization',
    'owner',
  ];

  private parseOrgFromGraphqlBody(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') {
      return undefined;
    }
    const { variables, query } = body as {
      variables?: unknown;
      query?: unknown;
    };

    if (variables && typeof variables === 'object') {
      const vars = variables as Record<string, unknown>;
      for (const key of IntegrationClient.GRAPHQL_ORG_VARIABLE_KEYS) {
        const value = vars[key];
        if (typeof value === 'string' && value) {
          return value;
        }
      }
    }

    if (typeof query === 'string') {
      const match = query.match(
        /\b(?:organization|user|repositoryOwner)\s*\(\s*login\s*:\s*"([^"]+)"/,
      );
      if (match) {
        return match[1];
      }
      const repoMatch = query.match(
        /\brepository\s*\([^)]*\bowner\s*:\s*"([^"]+)"/,
      );
      if (repoMatch) {
        return repoMatch[1];
      }
    }

    return undefined;
  }

  private parseOrgFromRequest(options: RequestOptions): string | undefined {
    const httpOptions = options as {
      path?: string;
      body?: unknown;
      isGraphQL?: boolean;
    };
    if (httpOptions.isGraphQL) {
      const fromBody = this.parseOrgFromGraphqlBody(httpOptions.body);
      if (fromBody) {
        return fromBody;
      }
    }
    return httpOptions.path
      ? this.parseOrgFromPath(httpOptions.path)
      : undefined;
  }

  private async mintGithubAppJwt(
    app: {
      appId: string;
      privateKeyRef?: string;
      kmsKeyId?: string;
    },
    workspaceId?: string,
  ): Promise<string | undefined> {
    if (app.kmsKeyId && this.kmsTokenMinter) {
      return this.kmsTokenMinter.generateAppJWT(app.appId, app.kmsKeyId);
    }
    if (app.privateKeyRef && this.localTokenMinter) {
      const { [app.privateKeyRef]: privateKeyPem } = await this.secretStore
        .resolver({ workspaceId })
        .resolve([app.privateKeyRef]);
      if (!privateKeyPem) {
        throw new Error(
          `GitHub App private key secret not set: ${app.privateKeyRef}`,
        );
      }
      return LocalGitHubAppTokenProvider.generateAppJWT(
        app.appId,
        privateKeyPem,
      );
    }
    return undefined;
  }

  private async mintGithubInstallationToken(
    app: {
      appId: string;
      privateKeyRef?: string;
      kmsKeyId?: string;
    },
    installationId: number,
    githubApiBaseUrl: string,
    workspaceId?: string,
  ): Promise<string | undefined> {
    if (app.kmsKeyId && this.kmsTokenMinter) {
      return this.kmsTokenMinter.getInstallationToken(
        app.appId,
        installationId,
        app.kmsKeyId,
        githubApiBaseUrl,
      );
    }
    if (app.privateKeyRef && this.localTokenMinter) {
      const { [app.privateKeyRef]: privateKeyPem } = await this.secretStore
        .resolver({ workspaceId })
        .resolve([app.privateKeyRef]);
      if (!privateKeyPem) {
        throw new Error(
          `GitHub App private key secret not set: ${app.privateKeyRef}`,
        );
      }
      return this.localTokenMinter.getInstallationToken(
        app.appId,
        installationId,
        privateKeyPem,
        githubApiBaseUrl,
      );
    }
    return undefined;
  }

  private withBearerToken(
    integration: Integration,
    token: string,
  ): Integration {
    return {
      ...integration,
      authType: 'bearer-token',
      authConfig: { token },
    };
  }

  private stripInstallationIdQueryParam(
    options: RequestOptions,
  ): RequestOptions {
    const httpOptions = options as HttpRequestOptions;
    if (httpOptions.backendType !== 'http' || !httpOptions.path) {
      return options;
    }
    const { pathname, queryString } = IntegrationClient.pathNameAndQuery(
      httpOptions.path,
    );
    if (!queryString) {
      return options;
    }
    const params = new URLSearchParams(queryString);
    if (!params.has('installation_id')) {
      return options;
    }
    params.delete('installation_id');
    const remaining = params.toString();
    const stripped: HttpRequestOptions = {
      ...httpOptions,
      path: remaining ? `${pathname}?${remaining}` : pathname,
    };
    return stripped;
  }

  private async resolveGithubAppIntegration(
    integration: Integration,
    options: RequestOptions,
  ): Promise<Integration> {
    if (!this.githubAppDao || !this.githubAppInstallationDao) {
      return integration;
    }

    if (!integration.extensions?.githubApps?.length) {
      return integration;
    }

    const app = await this.githubAppDao.getByIntegrationIdAndPurpose(
      integration.id,
      'data-source',
    );
    if (!app) {
      return integration;
    }

    const httpOptions = options as HttpRequestOptions;
    const path =
      httpOptions.backendType === 'http' ? httpOptions.path : undefined;
    const githubApiBaseUrl = getGithubRestApiBaseUrl(integration.host);

    if (IntegrationClient.isGithubAppJwtPath(path)) {
      const jwt = await this.mintGithubAppJwt(app, integration.workspaceId);
      if (!jwt) {
        this.logger.debug(
          'No token minter available for GitHub App JWT; falling back to header token',
        );
        return integration;
      }
      return this.withBearerToken(integration, jwt);
    }

    const installationIdFromQuery = path
      ? this.parseInstallationIdFromPath(path)
      : undefined;
    if (installationIdFromQuery !== undefined) {
      const token = await this.mintGithubInstallationToken(
        app,
        installationIdFromQuery,
        githubApiBaseUrl,
        integration.workspaceId,
      );
      if (!token) {
        this.logger.debug(
          'No token minter available for GitHub App; falling back to header token',
        );
        return integration;
      }
      return this.withBearerToken(integration, token);
    }

    const org = this.parseOrgFromRequest(options);
    if (org) {
      const installation = await this.githubAppInstallationDao.getByOrg(
        app.appId,
        app.host,
        org,
      );
      if (!installation) {
        this.logger.debug(
          `No GitHub App installation for org "${org}"; falling back to header token`,
        );
        return integration;
      }
      const token = await this.mintGithubInstallationToken(
        app,
        installation.installationId,
        githubApiBaseUrl,
        integration.workspaceId,
      );
      if (!token) {
        this.logger.debug(
          'No token minter available for GitHub App; falling back to header token',
        );
        return integration;
      }
      return this.withBearerToken(integration, token);
    }

    if (IntegrationClient.isGithubInstallationPath(path)) {
      const installations = await this.githubAppInstallationDao.listAll(
        app.appId,
        app.host ?? 'github.com',
      );
      if (installations.length === 1) {
        const token = await this.mintGithubInstallationToken(
          app,
          installations[0].installationId,
          githubApiBaseUrl,
          integration.workspaceId,
        );
        if (!token) {
          this.logger.debug(
            'No token minter available for GitHub App; falling back to header token',
          );
          return integration;
        }
        return this.withBearerToken(integration, token);
      }
      this.logger.debug(
        installations.length === 0
          ? 'Could not parse org from request and no GitHub App installations are recorded; falling back to header token'
          : `Could not parse org from request and found ${installations.length} GitHub App installations; falling back to header token`,
      );
      return integration;
    }

    this.logger.debug(
      'Could not parse org from request; falling back to header token',
    );
    return integration;
  }

  async request(
    integrationId: string,
    options: RequestOptions,
  ): Promise<unknown> {
    const integration = await this.resolveIntegration(
      integrationId,
      options.workspaceId,
      options.scopeId,
    );
    if (!integration) {
      throw new Error(`Integration not found: ${integrationId}`);
    }
    const configurationError = await getIntegrationConfigurationError(
      integration,
      {
        secretStore: this.secretStore,
      },
    );
    if (configurationError) {
      throw new Error(configurationError);
    }

    const rateLimiter = this.getRateLimiter(integration);
    await rateLimiter.acquire();

    const resolved = await this.resolveGithubAppIntegration(
      integration,
      options,
    );
    const resolvedOptions = this.resolveRequestOptions(
      resolved,
      this.stripInstallationIdQueryParam(options),
    );

    return this.getBackend(options.backendType).request(
      resolved,
      resolvedOptions,
    );
  }

  async *requestPages(
    integrationId: string,
    options: RequestOptions,
  ): AsyncGenerator<PageResult> {
    const integration = await this.resolveIntegration(
      integrationId,
      options.workspaceId,
      options.scopeId,
    );
    if (!integration) {
      throw new Error(`Integration not found: ${integrationId}`);
    }
    const configurationError = await getIntegrationConfigurationError(
      integration,
      {
        secretStore: this.secretStore,
      },
    );
    if (configurationError) {
      throw new Error(configurationError);
    }

    const rateLimiter = this.getRateLimiter(integration);
    const resolved = await this.resolveGithubAppIntegration(
      integration,
      options,
    );
    const beforeRequest = () => rateLimiter.acquire();

    yield* this.getBackend(options.backendType).requestPages(resolved, {
      ...this.stripInstallationIdQueryParam(options),
      beforeRequest,
    });
  }
}
