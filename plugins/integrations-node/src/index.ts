/*
 * Copyright 2025 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createServiceRef } from '@roadiehq/extensions-api';
import type { JsonValue } from '@roadiehq/types';

export type IntegrationType =
  | 'scm'
  | 'ci-cd'
  | 'monitoring'
  | 'incident-management'
  | 'infrastructure'
  | 'security'
  | 'communication'
  | 'project-management'
  | 'analytics'
  | 'other';

export type AuthType =
  | 'header'
  | 'basic'
  | 'bearer-token'
  | 'github-app'
  | 'oauth2-client-credentials'
  | 'oauth2-jwt-bearer'
  | 'none'
  | (string & NonNullable<unknown>);

export type BackendType = 'http' | 'aws';

export interface HeaderAuthConfig {
  headers: Record<string, string>;
}

export interface BasicAuthConfig {
  username?: string;
  password: string;
}

export interface BearerTokenAuthConfig {
  token: string;
}

export interface OAuth2ClientCredentialsAuthConfig {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  audience?: string;
  scope?: string;
}

export interface OAuth2JwtBearerAuthConfig {
  issuer: string;
  privateKey: string;
  tokenUrl: string;
  audience?: string;
  scope?: string;
  subject?: string;
}

export type AuthConfig =
  | HeaderAuthConfig
  | BasicAuthConfig
  | BearerTokenAuthConfig
  | OAuth2ClientCredentialsAuthConfig
  | OAuth2JwtBearerAuthConfig
  | Record<string, unknown>
  | null;

export function isHeaderAuthConfig(
  config: AuthConfig,
): config is HeaderAuthConfig {
  return config !== null && 'headers' in config;
}

export function isBasicAuthConfig(
  config: AuthConfig,
): config is BasicAuthConfig {
  return config !== null && 'password' in config && !('headers' in config);
}

export function isBearerTokenAuthConfig(
  config: AuthConfig,
): config is BearerTokenAuthConfig {
  return config !== null && 'token' in config;
}

export function isOAuth2ClientCredentialsAuthConfig(
  config: AuthConfig,
): config is OAuth2ClientCredentialsAuthConfig {
  return config !== null && 'clientId' in config && 'tokenUrl' in config;
}

export function isOAuth2JwtBearerAuthConfig(
  config: AuthConfig,
): config is OAuth2JwtBearerAuthConfig {
  return config !== null && 'issuer' in config && 'privateKey' in config;
}

export interface GithubAppInfo {
  appId: string;
  host: string;
  purposes?: string[];
  slug?: string;
  htmlUrl?: string;
  description?: string;
  privateKeyRef?: string;
  clientSecretRef?: string;
  kmsKeyId?: string;
}

export interface Integration {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  name: string;
  slug: string;
  type: IntegrationType;
  host: string;
  authType: AuthType;
  authConfig: AuthConfig;
  requestsPerHour: number;
  requestsPerSecond?: number;
  burstCapacity?: number;
  backendType: BackendType;
  config: Record<string, unknown>;
  /**
   * True if this integration is ready to serve requests for the current
   * caller's scope. This includes both configuration validity and whether
   * every referenced secret resolves for the current scope.
   */
  readyForCurrentScope?: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Raw SVG from storage when set. API consumers may also receive `logoUrl`
   * (e.g. data URI) from HTTP clients; this field is the source of truth from
   * the database for list/detail payloads that include it.
   */
  logoSvg?: string;
  logoSlug?: string;
  /**
   * Path (relative to `host`) of the integration's GraphQL endpoint, when
   * the integration offers one. Used by the data-source editor to enable
   * GraphQL mode on Source nodes.
   */
  graphqlPath?: string | null;
  extensions?: {
    githubApps?: GithubAppInfo[];
    [key: string]: unknown;
  };
}

export interface PageResult {
  items: unknown[];
  pageIndex: number;
}

export interface RequestLog {
  id: string;
  timestamp: string;
  source: string;
  target: string;
  operation: string;
  duration: number;
  status?: string;
  requestBody?: unknown;
  responseBody?: unknown;
  responseHeaders?: Record<string, string>;
  error?: string;
}

export type RequestLogCallback = (log: RequestLog) => void;

export interface RequestOptions {
  backendType: BackendType;
  workspaceId?: string;
  signal?: AbortSignal;
  source?: string;
  onRequestLog?: RequestLogCallback;
  beforeRequest?: () => Promise<void>;
  /**
   * Optional cache-scope discriminator used by backends that cache per-key
   * resources such as OAuth2 access tokens, TLS dispatchers, or assumed
   * role sessions. Callers that want independent caches for the same
   * integration (e.g. under separate execution contexts) pass a distinct
   * string here; callers with no scoping needs leave it undefined.
   */
  scopeId?: string;
}

export interface IntegrationClient {
  request(integrationId: string, options: RequestOptions): Promise<unknown>;
  requestPages(
    integrationId: string,
    options: RequestOptions,
  ): AsyncGenerator<PageResult>;
  /**
   * Resolve an integration by id. Backed by an authoritative DB lookup
   * (with a short-lived in-memory cache) rather than an in-process
   * registration map, so CRUD operations and multi-replica deployments
   * see a consistent view.
   */
  getIntegration(
    integrationId: string,
    workspaceId?: string,
  ): Promise<Integration | undefined>;
  /**
   * Return all integrations, including their `readyForCurrentScope` flag.
   */
  listIntegrations(workspaceId?: string): Promise<Integration[]>;
  /**
   * Invalidate any cached state for the given integration id (resolve
   * cache, rate limiter, backend token/dispatcher caches). Call after a
   * destructive change (disable, delete, config update) so the next
   * request picks up the new state.
   */
  unregisterIntegration(integrationId: string): Promise<void>;
}

export { createInstrumentedIntegrationClient } from './InstrumentedIntegrationClient';
export { buildResults } from './buildResults';
export { renderTemplate } from './renderTemplate';

export {
  buildRequestOptions,
  deriveDataKey,
  isHttpRequestOptions,
  parseAwsRequestResourceOptions,
  parseAwsRequestPagesOptions,
} from './backends';
export type { IntegrationBackend } from './backends';
export * from './backends/http';
export * from './backends/aws';

export const integrationClientServiceRef = createServiceRef<IntegrationClient>({
  id: 'integrations.client',
  scope: 'root',
});

export {
  subjectScopeIndexServiceRef,
  noopSubjectScopeIndex,
} from './subjectScopeIndex';
export type { SubjectScopeIndex } from './subjectScopeIndex';
export {
  currentScopeIdServiceRef,
  defaultCurrentScopeIdResolver,
  DEFAULT_SCOPE_ID,
} from './currentScopeId';
export type { CurrentScopeIdResolver } from './currentScopeId';
export { scopeRunnerServiceRef, defaultScopeRunner } from './scope-runner';
export type { ScopeRunner } from './scope-runner';
export { scopedSchedulerServiceRef } from './scopedScheduler';
export type { ScopedScheduler } from './scopedScheduler';

export type ParsedPaginationHint =
  | {
      type: 'cursor';
      cursorParam: string;
    }
  | {
      type: 'link';
      perPageParam?: string;
      perPage?: number;
    }
  | {
      type: 'page';
      pageParam: string;
      perPageParam?: string;
      perPage?: number;
      startPage?: number;
    }
  | {
      type: 'offset';
      offsetParam: string;
      limitParam: string;
      limit?: number;
    };

export interface ParsedPathSchema {
  pathPattern: string;
  method: string;
  jsonSchema: JsonValue;
  description?: string;
  paginationHint?: ParsedPaginationHint;
}

export interface SpecParser {
  canParse(spec: Record<string, unknown>): boolean;
  parse(spec: Record<string, unknown>): ParsedPathSchema[];
}
