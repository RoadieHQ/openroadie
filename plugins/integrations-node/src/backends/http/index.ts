import type { RequestOptions } from '../../index';
import { parseHttpSourceConfig } from './schemas';

export type PaginationType =
  | 'none'
  | 'cursor'
  | 'page'
  | 'offset'
  | 'link'
  | 'body-link'
  | 'graphql-cursor';

export interface CursorPaginationConfig {
  type: 'cursor';
  cursorParam: string;
  nextCursorExpression: string;
  paramLocation?: 'query' | 'body';
  /**
   * Dot-separated path to the body object the cursor param is merged into
   * (e.g. `options` → `{ options: { $skipToken } }`). Only honored when
   * `paramLocation` is `body`; absent means the param merges at the top level.
   */
  bodyParamsPath?: string;
}

export interface PagePaginationConfig {
  type: 'page';
  pageParam?: string;
  perPageParam?: string;
  perPage: number;
  startPage?: number;
}

export interface OffsetPaginationConfig {
  type: 'offset';
  offsetParam?: string;
  limitParam?: string;
  limit: number;
  paramLocation?: 'query' | 'body';
  /**
   * Dot-separated path to the body object the offset/limit params are merged
   * into (e.g. `options` → `{ options: { $skip, $top } }`). Only honored when
   * `paramLocation` is `body`; absent means the params merge at the top level.
   */
  bodyParamsPath?: string;
  totalExpression?: string;
}

export interface LinkHeaderPaginationConfig {
  type: 'link';
  perPageParam?: string;
  perPage?: number;
  nextRequestMethod?: 'GET' | 'POST';
  nextLinkCondition?: {
    param: string;
    equals?: string;
    notEquals?: string;
  };
}

export interface BodyLinkPaginationConfig {
  type: 'body-link';
  nextLinkExpression: string;
  perPageParam?: string;
  perPage?: number;
  nextRequestMethod?: 'GET' | 'POST';
}

export interface NoPaginationConfig {
  type: 'none';
}

export interface GraphqlCursorPaginationConfig {
  type: 'graphql-cursor';
  cursorVariable: string;
  nextCursorExpression: string;
  hasNextPageExpression?: string;
}

export type PaginationConfig =
  | CursorPaginationConfig
  | PagePaginationConfig
  | OffsetPaginationConfig
  | LinkHeaderPaginationConfig
  | BodyLinkPaginationConfig
  | NoPaginationConfig
  | GraphqlCursorPaginationConfig;

export interface HttpRequestOptions extends RequestOptions {
  backendType: 'http';
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string> | Array<{ key: string; value: string }>;
  body?: unknown;
  pagination?: PaginationConfig;
  disableImplicitPagination?: boolean;
  arrayPath?: string;
  isGraphQL?: boolean;
  responseHeaders?: (headers: Record<string, string>) => void;
}

function mergeQueryParamsIntoPath(
  path: string,
  queryParams: Record<string, string> | undefined,
): string {
  if (!queryParams || Object.keys(queryParams).length === 0) {
    return path;
  }

  const url = new URL(path, 'http://placeholder');
  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}

// Recover HTTP source configs saved before the client normalized the editor's
// raw fields into the shape the schema expects. Chained sources historically
// persisted `bodyText`/`graphqlQuery` verbatim; `parseHttpSourceConfig` drops
// those unknown keys, so a POST went out with no body (upstream 400) and a
// GraphQL request with an empty query. Normalizing here fixes already-saved
// sources with no data migration — the body was never lost, only stored under
// the wrong key — and is a permanent backstop for any raw config that slips
// through. It is a no-op once `body`/`graphql` are already set.
export function recoverLegacyHttpConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (
    config.mode === 'graphql' &&
    config.graphql === undefined &&
    typeof config.graphqlQuery === 'string' &&
    config.graphqlQuery.trim()
  ) {
    let variables: Record<string, unknown> | undefined;
    if (
      typeof config.graphqlVariables === 'string' &&
      config.graphqlVariables.trim()
    ) {
      try {
        const parsed: unknown = JSON.parse(config.graphqlVariables);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          variables = parsed as Record<string, unknown>;
        }
      } catch {
        variables = undefined;
      }
    }
    return {
      ...config,
      graphql: {
        query: config.graphqlQuery,
        ...(variables && { variables }),
      },
    };
  }

  if (
    config.mode !== 'graphql' &&
    config.method === 'POST' &&
    config.body === undefined &&
    typeof config.bodyText === 'string'
  ) {
    const trimmed = config.bodyText.trim();
    if (trimmed) {
      try {
        return { ...config, body: JSON.parse(trimmed) };
      } catch {
        // Unparseable text — leave as-is; there's nothing better to send.
      }
    }
  }

  return config;
}

export function buildHttpRequestOptions(
  config: Record<string, unknown>,
  signal?: AbortSignal,
): { objectIdExpression: string; requestOptions: HttpRequestOptions } {
  const parsed = parseHttpSourceConfig(recoverLegacyHttpConfig(config));
  const isGraphQL = parsed.mode === 'graphql';
  const method = isGraphQL ? 'POST' : parsed.method;
  const body = isGraphQL
    ? {
        query: parsed.graphql?.query ?? '',
        ...(parsed.graphql?.variables !== undefined && {
          variables: parsed.graphql.variables,
        }),
      }
    : parsed.body;
  const path = mergeQueryParamsIntoPath(parsed.path, parsed.queryParams);
  return {
    objectIdExpression: parsed.objectIdExpression,
    requestOptions: {
      backendType: 'http',
      path,
      method,
      headers: parsed.headers,
      body,
      pagination: parsed.pagination,
      arrayPath: parsed.arrayExpression,
      isGraphQL,
      signal,
    },
  };
}

export function isHttpRequestOptions(
  options: RequestOptions,
): options is HttpRequestOptions {
  return options.backendType === 'http';
}

export function deriveHttpDataKey(config: Record<string, unknown>): string {
  if (typeof config.path !== 'string') {
    return 'data';
  }
  const parts = config.path.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? 'data';
  return last.replace(/[^a-zA-Z0-9]/g, '') || 'data';
}

export { HttpBackend } from './Backend';
export type { HttpBackendOptions } from './Backend';
export { httpSourceConfigSchema } from './schemas';
