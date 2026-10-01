import { LoggerService } from '@roadiehq/extensions-api';
import { ForwardedError, HttpIntegrationResponseError } from '@roadiehq/errors';
import { normalizePemCertificate, normalizePrivateKey } from '@roadiehq/types';
import jsonataSafe from '@roadiehq/jsonata-safe';
import {
  substituteSecrets,
  type SecretResolver,
  type SecretStoreService,
} from '@roadiehq/secrets-node';
import { v4 as uuid } from 'uuid';
import { Agent, fetch as undiciFetch } from 'undici';
import jwt from 'jsonwebtoken';
import {
  Integration,
  isHeaderAuthConfig,
  isBasicAuthConfig,
  isBearerTokenAuthConfig,
  isOAuth2ClientCredentialsAuthConfig,
  isOAuth2JwtBearerAuthConfig,
  PageResult,
  RequestOptions,
} from '../../index';
import type { IntegrationBackend } from '../index';
import {
  CursorPaginationConfig,
  HttpRequestOptions,
  OffsetPaginationConfig,
  PaginationConfig,
  isHttpRequestOptions,
} from './index';
import { renderTemplate } from '../../renderTemplate';
import { detectArrayInResponse } from '../../resolveArray';
import { assertSafeUrl, createSsrfGuardedLookup } from './ssrf-guard';
import {
  extractPdfText,
  hasPdfHeader,
  isPdfContentType,
  mayBeBinaryDocument,
} from './pdfText';
import { isXmlContentType, parseXmlBody } from './xmlBody';

const REQUEST_LOG_RESPONSE_HEADER_ALLOWLIST = new Set(['link']);

interface GraphqlError {
  message?: string;
  [key: string]: unknown;
}

// Root source nodes can reference integration config values (e.g. a Bitbucket
// workspace slug) since token auth cannot discover them via the API.
function resolveConfigPlaceholders(
  path: string,
  integration: Integration,
): string {
  return path.replace(/\{\{config\.([a-zA-Z0-9_-]+)\}\}/g, (_m, key) => {
    const value = integration.config?.[`${key}`];
    if (value === undefined || value === null || value === '') {
      throw new Error(
        `Path references {{config.${key}}} but the integration config has no "${key}" value`,
      );
    }
    return encodeURIComponent(String(value));
  });
}

function assertNoGraphqlErrors(
  data: unknown,
  method: string,
  url: string,
): void {
  if (!data || typeof data !== 'object') {
    return;
  }
  const errors = (data as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return;
  }
  const first = errors[0] as GraphqlError | undefined;
  const firstMessage =
    first && typeof first.message === 'string'
      ? first.message
      : 'Unknown error';
  const message = `GraphQL request to ${method} ${url} returned errors: ${firstMessage}`;
  const error = new Error(message);
  (error as Error & { cause?: unknown }).cause = errors;
  throw error;
}

export const normalizeCertificate = normalizePemCertificate;

export { normalizePrivateKey };

function parseLinkHeader(
  linkHeader: string | undefined,
): Record<
  string,
  { url: string; rel: string; params: Record<string, string> }
> {
  const links = new Map<
    string,
    { url: string; rel: string; params: Record<string, string> }
  >();
  if (!linkHeader) {
    return Object.fromEntries(links);
  }

  const parts = linkHeader.split(/,\s*(?=<)/);
  for (const part of parts) {
    const [target, ...paramParts] = part.split(';').map(value => value.trim());
    const targetMatch = target.match(/^<([^>]+)>$/);
    if (!targetMatch) {
      continue;
    }

    const params: Record<string, string> = {};
    let rels: string[] = [];

    for (const paramPart of paramParts) {
      const [rawKey, ...rawValueParts] = paramPart.split('=');
      if (!rawKey || rawValueParts.length === 0) {
        continue;
      }
      const key = rawKey.trim();
      const value = rawValueParts.join('=').trim().replace(/^"|"$/g, '');
      if (key === 'rel') {
        rels = value.split(/\s+/).filter(Boolean);
      } else {
        params[`${key}`] = value;
      }
    }

    for (const rel of rels) {
      links.set(rel, {
        url: targetMatch[1],
        rel,
        params,
      });
    }
  }

  return Object.fromEntries(links);
}

export interface HttpBackendOptions {
  logger: LoggerService;
  envVarAllowList?: Set<string>;
  getEnvVarAllowList?: (workspaceId?: string) => Promise<Set<string>>;
  secretStore: SecretStoreService;
  /**
   * When true, outbound requests are blocked from reaching localhost,
   * private RFC 1918 ranges, link-local addresses, cloud metadata
   * endpoints, and Kubernetes cluster-internal hostnames.
   * DNS-resolved addresses are also validated to prevent rebinding.
   */
  blockPrivateNetworks?: boolean;
  /**
   * Hostname patterns permitted to resolve to private IPs even when
   * `blockPrivateNetworks` is true.  Supports exact matches and
   * wildcard-prefix patterns (e.g. `*.eks.amazonaws.com`).
   *
   * Use this for platform-owned integrations whose hosts use
   * split-horizon DNS (EKS API servers, internal load balancers).
   */
  privateIpAllowedHosts?: string[];
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// Copy-on-write merge of pagination params into a nested body object, so the
// caller's body config is never mutated across pages.
function mergeParamsAtPath(
  body: Record<string, unknown>,
  path: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const segments = path.split('.');
  const root = { ...body };
  let target = root;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[`${i}`];
    const existing = target[`${segment}`];
    if (
      existing !== undefined &&
      (existing === null ||
        typeof existing !== 'object' ||
        Array.isArray(existing))
    ) {
      throw new Error(
        `Body pagination bodyParamsPath "${path}" points at a non-object value at "${segments.slice(0, i + 1).join('.')}"`,
      );
    }
    const next = { ...(existing as Record<string, unknown> | undefined) };
    target[`${segment}`] = next;
    target = next;
  }
  Object.assign(target, params);
  return root;
}

const INTEGRATION_SCOPE_CACHE_SEP = '\u001f';

export class HttpBackend implements IntegrationBackend {
  private readonly logger: LoggerService;
  private readonly getEnvVarAllowList: (
    workspaceId?: string,
  ) => Promise<Set<string>>;
  private readonly secretStore: SecretStoreService;
  private readonly oauth2TokenCache = new Map<string, CachedToken>();
  private readonly dispatcherCache = new Map<string, Agent>();
  private readonly blockPrivateNetworks: boolean;
  private readonly privateIpAllowedHosts: string[];
  private ssrfGuardDispatcher: Agent | undefined;

  constructor(options: HttpBackendOptions) {
    this.logger = options.logger;
    this.getEnvVarAllowList =
      options.getEnvVarAllowList ??
      (async () => options.envVarAllowList ?? new Set<string>());
    this.secretStore = options.secretStore;
    this.blockPrivateNetworks = options.blockPrivateNetworks ?? false;
    this.privateIpAllowedHosts = options.privateIpAllowedHosts ?? [];
  }

  private resolver(workspaceId?: string): SecretResolver {
    return this.secretStore.resolver({ workspaceId });
  }

  private async sub(value: string, workspaceId?: string): Promise<string> {
    return substituteSecrets(
      value,
      this.resolver(workspaceId),
      await this.getEnvVarAllowList(workspaceId),
    );
  }

  private normalizeScopeId(scopeId?: string): string | undefined {
    return scopeId ? scopeId : undefined;
  }

  private integrationScopeCacheKey(
    integrationId: string,
    scopeId: string | undefined,
  ): string {
    return `${integrationId}${INTEGRATION_SCOPE_CACHE_SEP}${
      this.normalizeScopeId(scopeId) ?? ''
    }`;
  }

  private async getCaCertificate(
    integration: Integration,
  ): Promise<string | undefined> {
    const caCert = integration.config?.caCertificate;
    if (typeof caCert !== 'string' || !caCert) {
      return undefined;
    }
    let resolved = await this.sub(caCert, integration.workspaceId);
    resolved = normalizeCertificate(resolved);
    if (resolved.startsWith('-----BEGIN')) {
      return resolved;
    }
    try {
      let decoded = Buffer.from(resolved, 'base64').toString('utf-8');
      decoded = normalizeCertificate(decoded);
      if (decoded.startsWith('-----BEGIN')) {
        return decoded;
      }
    } catch {
      // Not valid base64
    }
    return undefined;
  }

  private getSsrfGuardDispatcher(): Agent {
    if (!this.ssrfGuardDispatcher) {
      this.ssrfGuardDispatcher = new Agent({
        connect: {
          lookup: createSsrfGuardedLookup(this.privateIpAllowedHosts),
          autoSelectFamily: false,
        },
      });
    }
    return this.ssrfGuardDispatcher;
  }

  private async getDispatcher(
    integration: Integration,
    scopeId: string | undefined,
  ): Promise<Agent | undefined> {
    const cacheKey = this.integrationScopeCacheKey(integration.id, scopeId);
    const cached = this.dispatcherCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const caCertificate = await this.getCaCertificate(integration);

    if (!caCertificate && !this.blockPrivateNetworks) {
      return undefined;
    }

    const lookup = this.blockPrivateNetworks
      ? createSsrfGuardedLookup(this.privateIpAllowedHosts)
      : undefined;

    const autoSelectFamily = lookup ? false : undefined;
    const dispatcher = caCertificate
      ? new Agent({
          connect: {
            ca: caCertificate,
            rejectUnauthorized: true,
            lookup,
            autoSelectFamily,
          },
        })
      : new Agent({ connect: { lookup, autoSelectFamily } });
    this.dispatcherCache.set(cacheKey, dispatcher);
    return dispatcher;
  }

  clearCachedDispatcher(integrationId: string, scopeId?: string): void {
    if (scopeId !== undefined) {
      const key = this.integrationScopeCacheKey(integrationId, scopeId);
      const dispatcher = this.dispatcherCache.get(key);
      if (dispatcher) {
        dispatcher.close();
        this.dispatcherCache.delete(key);
      }
      return;
    }
    const prefix = `${integrationId}${INTEGRATION_SCOPE_CACHE_SEP}`;
    for (const key of [...this.dispatcherCache.keys()]) {
      if (key.startsWith(prefix)) {
        const d = this.dispatcherCache.get(key);
        if (d) {
          d.close();
        }
        this.dispatcherCache.delete(key);
      }
    }
  }

  private normalizeHeaders(
    headers?: Record<string, string> | Array<{ key: string; value: string }>,
  ): Record<string, string> {
    if (!headers) {
      return {};
    }
    if (!Array.isArray(headers)) {
      return headers;
    }
    const result: Record<string, string> = {};
    for (const h of headers) {
      if (h?.key) {
        result[h.key] = h.value ?? '';
      }
    }
    return result;
  }

  private async getDefaultHeaders(
    integration: Integration,
  ): Promise<Record<string, string>> {
    const configHeaders = integration.config?.headers;
    if (
      !configHeaders ||
      typeof configHeaders !== 'object' ||
      Array.isArray(configHeaders)
    ) {
      return {};
    }
    const result = new Map<string, string>();
    for (const [key, value] of Object.entries(
      configHeaders as Record<string, string>,
    )) {
      result.set(key, await this.sub(value, integration.workspaceId));
    }
    return Object.fromEntries(result);
  }

  private async applyAuthHeaders(
    integration: Integration,
    mergedHeaders: Record<string, string>,
    scopeId: string | undefined,
  ): Promise<void> {
    if (integration.authType === 'none' || !integration.authConfig) {
      return;
    }

    if (
      integration.authType === 'header' &&
      isHeaderAuthConfig(integration.authConfig)
    ) {
      const headerMap = new Map(Object.entries(mergedHeaders));
      for (const [headerName, headerValue] of Object.entries(
        integration.authConfig.headers,
      )) {
        headerMap.set(
          headerName,
          await this.sub(headerValue, integration.workspaceId),
        );
      }
      Object.assign(mergedHeaders, Object.fromEntries(headerMap));
    } else if (
      integration.authType === 'basic' &&
      isBasicAuthConfig(integration.authConfig)
    ) {
      const password = await this.sub(
        integration.authConfig.password,
        integration.workspaceId,
      );
      const username = integration.authConfig.username
        ? await this.sub(
            integration.authConfig.username,
            integration.workspaceId,
          )
        : '';
      const credentials = Buffer.from(`${username}:${password}`).toString(
        'base64',
      );
      mergedHeaders.Authorization = `Basic ${credentials}`;
    } else if (
      integration.authType === 'bearer-token' &&
      isBearerTokenAuthConfig(integration.authConfig)
    ) {
      const token = await this.sub(
        integration.authConfig.token,
        integration.workspaceId,
      );
      mergedHeaders.Authorization = `Bearer ${token}`;
    } else if (
      integration.authType === 'oauth2-client-credentials' &&
      isOAuth2ClientCredentialsAuthConfig(integration.authConfig)
    ) {
      const token = await this.getOAuth2Token(integration, scopeId);
      mergedHeaders.Authorization = `Bearer ${token}`;
    } else if (
      integration.authType === 'oauth2-jwt-bearer' &&
      isOAuth2JwtBearerAuthConfig(integration.authConfig)
    ) {
      const token = await this.getJwtBearerToken(integration, scopeId);
      mergedHeaders.Authorization = `Bearer ${token}`;
    }
  }

  private async getOAuth2Token(
    integration: Integration,
    scopeId: string | undefined,
  ): Promise<string> {
    const cacheKey = this.integrationScopeCacheKey(integration.id, scopeId);
    const cached = this.oauth2TokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.accessToken;
    }

    if (!isOAuth2ClientCredentialsAuthConfig(integration.authConfig)) {
      throw new Error('Invalid OAuth2 client credentials config');
    }

    const clientId = await this.sub(
      integration.authConfig.clientId,
      integration.workspaceId,
    );
    const clientSecret = await this.sub(
      integration.authConfig.clientSecret,
      integration.workspaceId,
    );
    const tokenUrl = await this.sub(
      integration.authConfig.tokenUrl,
      integration.workspaceId,
    );
    const scope = integration.authConfig.scope
      ? await this.sub(integration.authConfig.scope, integration.workspaceId)
      : undefined;
    const audience = integration.authConfig.audience
      ? await this.sub(integration.authConfig.audience, integration.workspaceId)
      : undefined;

    if (this.blockPrivateNetworks) {
      assertSafeUrl(tokenUrl);
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (scope) {
      body.set('scope', scope);
    }
    if (audience) {
      body.set('audience', audience);
    }

    const dispatcher = this.blockPrivateNetworks
      ? this.getSsrfGuardDispatcher()
      : undefined;

    const response = await undiciFetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      dispatcher,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `OAuth2 token request failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    const bufferMs = 60_000;
    this.oauth2TokenCache.set(cacheKey, {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000 - bufferMs,
    });

    return data.access_token;
  }

  private async getJwtBearerToken(
    integration: Integration,
    scopeId: string | undefined,
  ): Promise<string> {
    const cacheKey = this.integrationScopeCacheKey(integration.id, scopeId);
    const cached = this.oauth2TokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.accessToken;
    }

    if (!isOAuth2JwtBearerAuthConfig(integration.authConfig)) {
      throw new Error('Invalid OAuth2 JWT bearer config');
    }

    const issuer = await this.sub(
      integration.authConfig.issuer,
      integration.workspaceId,
    );
    const privateKey = normalizePrivateKey(
      await this.sub(
        integration.authConfig.privateKey,
        integration.workspaceId,
      ),
    );
    const tokenUrl = await this.sub(
      integration.authConfig.tokenUrl,
      integration.workspaceId,
    );
    const audience = integration.authConfig.audience
      ? await this.sub(integration.authConfig.audience, integration.workspaceId)
      : tokenUrl;
    const scope = integration.authConfig.scope
      ? await this.sub(integration.authConfig.scope, integration.workspaceId)
      : undefined;
    const subject = integration.authConfig.subject
      ? await this.sub(integration.authConfig.subject, integration.workspaceId)
      : undefined;

    const iat = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: issuer,
      aud: audience,
      iat,
      exp: iat + 3600,
    };
    if (scope) {
      claims.scope = scope;
    }
    if (subject) {
      claims.sub = subject;
    }

    const assertion = jwt.sign(claims, privateKey, { algorithm: 'RS256' });

    if (this.blockPrivateNetworks) {
      assertSafeUrl(tokenUrl);
    }

    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });

    const dispatcher = this.blockPrivateNetworks
      ? this.getSsrfGuardDispatcher()
      : undefined;

    const response = await undiciFetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      dispatcher,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `JWT bearer token request failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    const bufferMs = 60_000;
    this.oauth2TokenCache.set(cacheKey, {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000 - bufferMs,
    });

    return data.access_token;
  }

  clearCachedToken(integrationId: string, scopeId?: string): void {
    if (scopeId !== undefined) {
      this.oauth2TokenCache.delete(
        this.integrationScopeCacheKey(integrationId, scopeId),
      );
    } else {
      const prefix = `${integrationId}${INTEGRATION_SCOPE_CACHE_SEP}`;
      for (const key of [...this.oauth2TokenCache.keys()]) {
        if (key.startsWith(prefix)) {
          this.oauth2TokenCache.delete(key);
        }
      }
    }
    this.clearCachedDispatcher(integrationId, scopeId);
  }

  async request(
    integration: Integration,
    options: RequestOptions,
  ): Promise<unknown> {
    if (!isHttpRequestOptions(options)) {
      throw new Error(`HttpBackend does not support ${options.backendType}`);
    }
    let capturedHeaders: Record<string, string> = {};
    const requestOptions: HttpRequestOptions = {
      ...options,
      responseHeaders: h => {
        capturedHeaders = h;
        options.responseHeaders?.(h);
      },
    };
    await options.beforeRequest?.();
    const startTime = Date.now();
    let data: unknown;
    let status: number | undefined;
    try {
      const result = await this.doRequest(integration, requestOptions);
      data = result.data;
      status = result.status;
    } catch (err) {
      this.emitRequestLog(
        requestOptions,
        integration,
        startTime,
        undefined,
        String(err),
        this.statusStringFromRequestFailure(err),
      );
      throw err;
    }
    this.emitRequestLog(
      requestOptions,
      integration,
      startTime,
      data,
      undefined,
      String(status),
      capturedHeaders,
    );
    return data;
  }

  private async doRequest(
    integration: Integration,
    options: RequestOptions,
  ): Promise<{ data: unknown; status: number }> {
    if (!isHttpRequestOptions(options)) {
      throw new Error(`HttpBackend does not support ${options.backendType}`);
    }
    const { path, method = 'GET', body, signal } = options;
    const normalizedHeaders = this.normalizeHeaders(options.headers);

    const configuredPath = resolveConfigPlaceholders(path, integration);
    const baseUrl = `${integration.host}/${renderTemplate(
      configuredPath,
    ).replace(/^\//, '')}`;
    const mergedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(await this.getDefaultHeaders(integration)),
      ...normalizedHeaders,
    };

    await this.applyAuthHeaders(integration, mergedHeaders, options.scopeId);

    if (this.blockPrivateNetworks) {
      assertSafeUrl(baseUrl);
    }

    this.logger.debug(`Requesting: ${method} ${baseUrl}`);

    const dispatcher = await this.getDispatcher(integration, options.scopeId);
    this.logger.debug(
      `doRequest: dispatcher=${dispatcher ? 'custom Agent' : 'default'}`,
    );

    let response;
    try {
      response = await undiciFetch(baseUrl, {
        method,
        headers: mergedHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
        dispatcher,
      });
    } catch (error) {
      let rootCause = error;
      if (
        error instanceof Error &&
        'cause' in error &&
        error.cause instanceof Error
      ) {
        rootCause = error.cause;
      }
      throw new ForwardedError(
        `Request to ${method} ${baseUrl} failed`,
        rootCause,
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new HttpIntegrationResponseError({
        statusCode: response.status,
        statusText: response.statusText,
        responseBody: errorText,
      });
    }

    const responseHeaderMap = new Map<string, string>();
    response.headers.forEach((value, key) => {
      responseHeaderMap.set(key, value);
    });
    const responseHeaders: Record<string, string> =
      Object.fromEntries(responseHeaderMap);

    if (isHttpRequestOptions(options) && options.responseHeaders) {
      options.responseHeaders(responseHeaders);
    }

    const contentType = response.headers.get('content-type');
    let data: unknown;
    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else if (isXmlContentType(contentType)) {
      // Parsed so arrayPath / expressions reach the fields as they would a
      // JSON body; malformed XML stays the raw text.
      const text = await response.text();
      data = parseXmlBody(text) ?? text;
    } else if (
      isPdfContentType(contentType) ||
      mayBeBinaryDocument(contentType)
    ) {
      // Read as bytes: decoding a PDF as text would corrupt it, and servers
      // often label files octet-stream (or not at all), so sniff the header.
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (isPdfContentType(contentType) || hasPdfHeader(bytes)) {
        data = await extractPdfText(bytes, `${method} ${baseUrl}`);
      } else {
        data = new TextDecoder().decode(bytes);
        try {
          data = JSON.parse(data as string);
        } catch {
          // keep as string
        }
      }
    } else {
      data = await response.text();
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          // keep as string
        }
      }
    }

    if (options.isGraphQL) {
      assertNoGraphqlErrors(data, method, baseUrl);
    }

    return { data, status: response.status };
  }

  private toRelativePath(url: string): string {
    try {
      const nextUrl = new URL(url);
      return `${nextUrl.pathname}${nextUrl.search}`;
    } catch {
      return url;
    }
  }

  private buildPageOptions(
    options: HttpRequestOptions,
    currentPath: string,
    nextRequestMethod?: 'GET' | 'POST',
    responseHeaders?: (headers: Record<string, string>) => void,
  ): HttpRequestOptions {
    const pageOptions: HttpRequestOptions = {
      ...options,
      path: currentPath,
      responseHeaders,
    };

    if (nextRequestMethod) {
      pageOptions.method = nextRequestMethod;
      if (nextRequestMethod === 'GET') {
        pageOptions.body = undefined;
      }
    }

    return pageOptions;
  }

  private shouldFollowLink(
    link:
      | {
          url: string;
          rel: string;
          params: Record<string, string>;
        }
      | undefined,
    nextLinkCondition?: {
      param: string;
      equals?: string;
      notEquals?: string;
    },
  ): boolean {
    if (!link) {
      return false;
    }
    if (!nextLinkCondition) {
      return true;
    }
    const value = link.params[nextLinkCondition.param];
    if (value === undefined) {
      return false;
    }
    if (nextLinkCondition.equals !== undefined) {
      return value === nextLinkCondition.equals;
    }
    if (nextLinkCondition.notEquals !== undefined) {
      return value !== nextLinkCondition.notEquals;
    }
    return false;
  }

  async *requestPages(
    integration: Integration,
    options: RequestOptions,
  ): AsyncGenerator<PageResult> {
    if (!isHttpRequestOptions(options)) {
      throw new Error(`HttpBackend does not support ${options.backendType}`);
    }
    const { pagination, arrayPath } = options;

    if (!pagination || pagination.type === 'none') {
      if (options.disableImplicitPagination) {
        const { items } = await this.fetchPage(
          integration,
          options,
          options.path,
        );
        yield { items, pageIndex: 0 };
        return;
      }

      const MAX_AUTO_PAGES = 100;
      let currentPath: string | null = options.path;
      let pageIndex = 0;
      while (currentPath && pageIndex < MAX_AUTO_PAGES) {
        let capturedHeaders: Record<string, string> = {};
        const pageOptions: HttpRequestOptions = {
          ...options,
          path: currentPath,
          responseHeaders: h => {
            capturedHeaders = h;
            options.responseHeaders?.(h);
          },
        };
        await options.beforeRequest?.();
        const startTime = Date.now();
        let data: unknown;
        let status: number | undefined;
        try {
          const result = await this.doRequest(integration, pageOptions);
          data = result.data;
          status = result.status;
        } catch (err) {
          this.emitRequestLog(
            pageOptions,
            integration,
            startTime,
            undefined,
            String(err),
            this.statusStringFromRequestFailure(err),
          );
          throw err;
        }
        this.emitRequestLog(
          pageOptions,
          integration,
          startTime,
          data,
          undefined,
          String(status),
          capturedHeaders,
        );
        const items = arrayPath
          ? await this.extractItems(data, arrayPath)
          : [data];
        yield { items, pageIndex };
        pageIndex++;

        const links = parseLinkHeader(capturedHeaders.link);
        if (this.shouldFollowLink(links.next)) {
          currentPath = this.toRelativePath(links.next.url);
        } else {
          currentPath = null;
        }
      }
      if (currentPath && pageIndex >= MAX_AUTO_PAGES) {
        this.logger.warn(
          `Auto-pagination capped at ${MAX_AUTO_PAGES} pages for ${integration.name}; ` +
            `configure explicit pagination to fetch more.`,
        );
      }
      return;
    }

    yield* this.paginatePages(integration, options, pagination);
  }

  private async *paginatePages(
    integration: Integration,
    options: HttpRequestOptions,
    pagination: PaginationConfig,
  ): AsyncGenerator<PageResult> {
    switch (pagination.type) {
      case 'cursor':
        yield* this.cursorPages(integration, options, pagination);
        break;
      case 'page':
        yield* this.pagePages(integration, options, pagination);
        break;
      case 'offset':
        yield* this.offsetPages(integration, options, pagination);
        break;
      case 'link':
        yield* this.linkPages(integration, options, pagination);
        break;
      case 'body-link':
        yield* this.bodyLinkPages(integration, options, pagination);
        break;
      case 'graphql-cursor':
        yield* this.graphqlCursorPages(integration, options, pagination);
        break;
      default:
        break;
    }
  }

  private async *graphqlCursorPages(
    integration: Integration,
    options: HttpRequestOptions,
    pagination: {
      type: 'graphql-cursor';
      cursorVariable: string;
      nextCursorExpression: string;
      hasNextPageExpression?: string;
    },
  ): AsyncGenerator<PageResult> {
    const nextCursorExpr = jsonataSafe(pagination.nextCursorExpression);
    const hasNextPageExpr = pagination.hasNextPageExpression
      ? jsonataSafe(pagination.hasNextPageExpression)
      : undefined;

    const baseBody =
      options.body && typeof options.body === 'object'
        ? (options.body as Record<string, unknown>)
        : {};
    const baseVariables =
      baseBody.variables && typeof baseBody.variables === 'object'
        ? (baseBody.variables as Record<string, unknown>)
        : {};

    let cursor: string | null = null;
    let pageIndex = 0;

    for (;;) {
      let capturedHeaders: Record<string, string> = {};
      const variables: Record<string, unknown> = { ...baseVariables };
      if (cursor !== null) {
        variables[pagination.cursorVariable] = cursor;
      }

      const pageOptions: HttpRequestOptions = {
        ...options,
        body: { ...baseBody, variables },
        responseHeaders: h => {
          capturedHeaders = h;
          options.responseHeaders?.(h);
        },
      };

      await options.beforeRequest?.();
      const startTime = Date.now();
      let data: unknown;
      let status: number | undefined;
      try {
        const result = await this.doRequest(integration, pageOptions);
        data = result.data;
        status = result.status;
      } catch (err) {
        this.emitRequestLog(
          pageOptions,
          integration,
          startTime,
          undefined,
          String(err),
          this.statusStringFromRequestFailure(err),
        );
        throw err;
      }
      this.emitRequestLog(
        pageOptions,
        integration,
        startTime,
        data,
        undefined,
        String(status),
        capturedHeaders,
      );

      const items = await this.resolveItems(data, options.arrayPath);
      yield { items, pageIndex };
      pageIndex++;

      if (hasNextPageExpr) {
        const hasNextPage = await hasNextPageExpr.evaluate(data);
        if (!hasNextPage) {
          break;
        }
      }

      const nextCursor = await nextCursorExpr.evaluate(data);
      if (nextCursor == null || nextCursor === '') {
        break;
      }
      cursor = String(nextCursor);
    }
  }

  private async *cursorPages(
    integration: Integration,
    options: HttpRequestOptions,
    pagination: CursorPaginationConfig,
  ): AsyncGenerator<PageResult> {
    const nextCursorExpr = jsonataSafe(pagination.nextCursorExpression);
    let nextCursor: string | null = null;
    let pageIndex = 0;

    for (;;) {
      let pageOptions = options;
      let currentPath = options.path;

      if (nextCursor !== null) {
        if (pagination.paramLocation === 'body') {
          if ((options.method ?? 'GET') !== 'POST') {
            throw new Error('Body cursor pagination requires a POST request');
          }
          if (
            !options.body ||
            typeof options.body !== 'object' ||
            Array.isArray(options.body)
          ) {
            throw new Error(
              'Body cursor pagination requires a JSON object body',
            );
          }
          const params = {
            [pagination.cursorParam]: nextCursor,
          };
          const baseBody = options.body as Record<string, unknown>;
          pageOptions = {
            ...options,
            body: pagination.bodyParamsPath
              ? mergeParamsAtPath(baseBody, pagination.bodyParamsPath, params)
              : { ...baseBody, ...params },
          };
        } else {
          const urlObj = new URL(options.path, 'http://placeholder');
          urlObj.searchParams.set(pagination.cursorParam, nextCursor);
          currentPath = `${urlObj.pathname}${urlObj.search}`;
        }
      }

      const { data, items } = await this.fetchPage(
        integration,
        pageOptions,
        currentPath,
      );
      yield { items, pageIndex };
      pageIndex++;

      const extracted = await nextCursorExpr.evaluate(data);
      if (extracted == null || extracted === '') {
        break;
      }
      nextCursor = String(extracted);
    }
  }

  private async *pagePages(
    integration: Integration,
    options: HttpRequestOptions,
    pagination: {
      type: 'page';
      pageParam?: string;
      perPageParam?: string;
      perPage: number;
      startPage?: number;
    },
  ): AsyncGenerator<PageResult> {
    const pageParam = pagination.pageParam ?? 'page';
    const perPageParam = pagination.perPageParam ?? 'per_page';
    let currentPage = pagination.startPage ?? 1;
    let pageIndex = 0;

    for (;;) {
      const urlObj = new URL(options.path, 'http://placeholder');
      urlObj.searchParams.set(pageParam, String(currentPage));
      urlObj.searchParams.set(perPageParam, String(pagination.perPage));
      const currentPath = `${urlObj.pathname}${urlObj.search}`;

      const { items } = await this.fetchPage(integration, options, currentPath);
      yield { items, pageIndex };
      pageIndex++;

      if (items.length < pagination.perPage) {
        break;
      }
      currentPage++;
    }
  }

  private async *offsetPages(
    integration: Integration,
    options: HttpRequestOptions,
    pagination: OffsetPaginationConfig,
  ): AsyncGenerator<PageResult> {
    const offsetParam = pagination.offsetParam ?? 'offset';
    const limitParam = pagination.limitParam ?? 'limit';
    const totalExpr = pagination.totalExpression
      ? jsonataSafe(pagination.totalExpression)
      : undefined;
    let currentOffset = 0;
    let pageIndex = 0;

    for (;;) {
      let pageOptions = options;
      let currentPath = options.path;

      if (pagination.paramLocation === 'body') {
        if ((options.method ?? 'GET') !== 'POST') {
          throw new Error('Body offset pagination requires a POST request');
        }
        if (
          !options.body ||
          typeof options.body !== 'object' ||
          Array.isArray(options.body)
        ) {
          throw new Error('Body offset pagination requires a JSON object body');
        }
        const params = {
          [offsetParam]: currentOffset,
          [limitParam]: pagination.limit,
        };
        const baseBody = options.body as Record<string, unknown>;
        pageOptions = {
          ...options,
          body: pagination.bodyParamsPath
            ? mergeParamsAtPath(baseBody, pagination.bodyParamsPath, params)
            : { ...baseBody, ...params },
        };
      } else {
        const urlObj = new URL(options.path, 'http://placeholder');
        urlObj.searchParams.set(offsetParam, String(currentOffset));
        urlObj.searchParams.set(limitParam, String(pagination.limit));
        currentPath = `${urlObj.pathname}${urlObj.search}`;
      }

      const { data, items } = await this.fetchPage(
        integration,
        pageOptions,
        currentPath,
      );
      yield { items, pageIndex };
      pageIndex++;

      if (items.length === 0) {
        break;
      }
      currentOffset += items.length;
      if (totalExpr) {
        const total = await totalExpr.evaluate(data);
        if (total !== null && total !== undefined && total !== '') {
          const totalNumber = Number(total);
          if (!Number.isFinite(totalNumber)) {
            throw new Error(
              `Total expression "${pagination.totalExpression}" did not return a finite number`,
            );
          }
          if (currentOffset >= totalNumber) {
            break;
          }
        }
      }
    }
  }

  private async *linkPages(
    integration: Integration,
    options: HttpRequestOptions,
    pagination: {
      type: 'link';
      perPageParam?: string;
      perPage?: number;
      nextRequestMethod?: 'GET' | 'POST';
      nextLinkCondition?: {
        param: string;
        equals?: string;
        notEquals?: string;
      };
    },
  ): AsyncGenerator<PageResult> {
    const perPageParam = pagination.perPageParam ?? 'per_page';
    const perPage = pagination.perPage ?? 100;

    const urlObj = new URL(options.path, 'http://placeholder');
    if (perPage > 0) {
      urlObj.searchParams.set(perPageParam, String(perPage));
    }
    let currentPath: string | null = `${urlObj.pathname}${urlObj.search}`;
    let pageIndex = 0;

    while (currentPath) {
      let capturedHeaders: Record<string, string> = {};
      const pageOptions = this.buildPageOptions(
        options,
        currentPath,
        pageIndex > 0 ? pagination.nextRequestMethod : undefined,
        h => {
          capturedHeaders = h;
        },
      );

      await options.beforeRequest?.();
      const startTime = Date.now();
      let data: unknown;
      let status: number | undefined;
      try {
        const result = await this.doRequest(integration, pageOptions);
        data = result.data;
        status = result.status;
      } catch (err) {
        this.emitRequestLog(
          pageOptions,
          integration,
          startTime,
          undefined,
          String(err),
          this.statusStringFromRequestFailure(err),
        );
        throw err;
      }
      this.emitRequestLog(
        pageOptions,
        integration,
        startTime,
        data,
        undefined,
        String(status),
        capturedHeaders,
      );

      const items = await this.resolveItems(data, options.arrayPath);

      yield { items, pageIndex };
      pageIndex++;

      const links = parseLinkHeader(capturedHeaders.link);
      if (this.shouldFollowLink(links.next, pagination.nextLinkCondition)) {
        currentPath = this.toRelativePath(links.next.url);
      } else {
        currentPath = null;
      }
    }
  }

  private async *bodyLinkPages(
    integration: Integration,
    options: HttpRequestOptions,
    pagination: {
      type: 'body-link';
      nextLinkExpression: string;
      perPageParam?: string;
      perPage?: number;
      nextRequestMethod?: 'GET' | 'POST';
    },
  ): AsyncGenerator<PageResult> {
    const nextLinkExpr = jsonataSafe(pagination.nextLinkExpression);
    const perPageParam = pagination.perPageParam ?? 'per_page';
    const perPage = pagination.perPage ?? 100;

    const urlObj = new URL(options.path, 'http://placeholder');
    if (perPage > 0) {
      urlObj.searchParams.set(perPageParam, String(perPage));
    }
    let currentPath: string | null = `${urlObj.pathname}${urlObj.search}`;
    let pageIndex = 0;

    while (currentPath) {
      const pageOptions = this.buildPageOptions(
        options,
        currentPath,
        pageIndex > 0 ? pagination.nextRequestMethod : undefined,
      );
      const { data, items } = await this.fetchPage(
        integration,
        pageOptions,
        currentPath,
      );
      yield { items, pageIndex };
      pageIndex++;

      const nextLink = await nextLinkExpr.evaluate(data);
      if (nextLink != null && nextLink !== '' && typeof nextLink === 'string') {
        try {
          const nextUrl = new URL(nextLink);
          currentPath = `${nextUrl.pathname}${nextUrl.search}`;
        } catch {
          currentPath = nextLink;
        }
      } else {
        currentPath = null;
      }
    }
  }

  private async fetchPage(
    integration: Integration,
    options: HttpRequestOptions,
    currentPath: string,
  ): Promise<{ data: unknown; items: unknown[] }> {
    await options.beforeRequest?.();
    const startTime = Date.now();
    let capturedHeaders: Record<string, string> = {};
    const pageOptions: HttpRequestOptions = {
      ...options,
      path: currentPath,
      responseHeaders: h => {
        capturedHeaders = h;
        options.responseHeaders?.(h);
      },
    };
    let data: unknown;
    let status: number | undefined;
    try {
      const result = await this.doRequest(integration, pageOptions);
      data = result.data;
      status = result.status;
    } catch (err) {
      this.emitRequestLog(
        pageOptions,
        integration,
        startTime,
        undefined,
        String(err),
        this.statusStringFromRequestFailure(err),
      );
      throw err;
    }
    this.emitRequestLog(
      pageOptions,
      integration,
      startTime,
      data,
      undefined,
      String(status),
      capturedHeaders,
    );

    const items = await this.resolveItems(data, options.arrayPath);

    return { data, items };
  }

  private async resolveItems(
    data: unknown,
    arrayPath?: string,
  ): Promise<unknown[]> {
    if (arrayPath) {
      return this.extractItems(data, arrayPath);
    }
    return Array.isArray(data) ? data : [data];
  }

  private async extractItems(
    data: unknown,
    arrayPath: string,
  ): Promise<unknown[]> {
    const expr = jsonataSafe(arrayPath);
    const result = await expr.evaluate(data);
    if (Array.isArray(result)) {
      return result;
    }
    if (result == null) {
      return [];
    }
    if (typeof result === 'object') {
      const detected = await detectArrayInResponse(result, msg =>
        this.logger.info(msg),
      );
      if (detected) {
        return detected;
      }
      return [result];
    }
    throw new Error(
      `Array expression "${arrayPath}" did not return an array or object. Got type: ${typeof result}`,
    );
  }

  private statusStringFromRequestFailure(err: unknown): string | undefined {
    if (err instanceof HttpIntegrationResponseError) {
      return String(err.statusCode);
    }
    if (
      err &&
      typeof err === 'object' &&
      'statusCode' in err &&
      typeof (err as { statusCode: unknown }).statusCode === 'number'
    ) {
      const n = (err as { statusCode: number }).statusCode;
      if (Number.isInteger(n) && n >= 100 && n < 600) {
        return String(n);
      }
    }
    return undefined;
  }

  private emitRequestLog(
    options: HttpRequestOptions,
    integration: Integration,
    startTime: number,
    responseBody?: unknown,
    error?: string,
    status?: string,
    responseHeaders?: Record<string, string>,
  ): void {
    if (!options.onRequestLog) {
      return;
    }
    const host = integration.host.endsWith('/')
      ? integration.host.slice(0, -1)
      : integration.host;
    let resolvedPath = options.path;
    try {
      resolvedPath = resolveConfigPlaceholders(options.path, integration);
    } catch {
      // never fail a request over logging
    }
    const cleanPath = resolvedPath.startsWith('/')
      ? resolvedPath
      : `/${resolvedPath}`;
    options.onRequestLog({
      id: uuid(),
      timestamp: new Date(startTime).toISOString(),
      source: options.source ?? '',
      target: `${host}${cleanPath}`,
      operation: (options.method ?? 'GET').toUpperCase(),
      duration: Date.now() - startTime,
      status,
      requestBody: options.body,
      responseBody,
      responseHeaders: this.allowlistedResponseHeaders(responseHeaders),
      error,
    });
  }

  private allowlistedResponseHeaders(
    headers: Record<string, string> | undefined,
  ): Record<string, string> | undefined {
    if (!headers) {
      return undefined;
    }
    const allowed = Object.fromEntries(
      Object.entries(headers)
        .map(([key, value]) => [key.toLowerCase(), value] as const)
        .filter(([key]) => REQUEST_LOG_RESPONSE_HEADER_ALLOWLIST.has(key)),
    );
    return Object.keys(allowed).length > 0 ? allowed : undefined;
  }
}
