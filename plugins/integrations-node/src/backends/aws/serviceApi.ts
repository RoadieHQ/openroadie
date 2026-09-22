import { LoggerService } from '@roadiehq/extensions-api';
import jsonataSafe from '@roadiehq/jsonata-safe';
import { XMLParser } from 'fast-xml-parser';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';
import type { AwsCredentialIdentity } from '@smithy/types';
import { v4 as uuid } from 'uuid';
import type { AwsServiceProtocol } from '@roadiehq/types';
import type { RequestLogCallback } from '../../index';
import { detectArrayInResponse } from '../../resolveArray';
import type { PaginationConfig } from '../http';
import type {
  AwsAccountConfig,
  AwsRequestApiOptions,
  AwsServiceApiRequestPagesOptions,
} from './index';
import { getAwsServiceRequestDefaults } from './metadata';

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
});

export class AwsServiceApiError extends Error {
  readonly name = 'AwsServiceApiError' as const;
  readonly statusCode: number;
  readonly statusText: string;

  constructor(options: {
    statusCode: number;
    statusText: string;
    message: string;
  }) {
    super(options.message);
    this.statusCode = options.statusCode;
    this.statusText = options.statusText;
  }
}

export interface ResolvedAwsServiceRequestOptions {
  protocol?: AwsServiceProtocol;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  accountId: string;
  accountConfig?: AwsAccountConfig;
  service: string;
  operation?: string;
  region: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  hostname?: string;
  signingRegion?: string;
  signal?: AbortSignal;
  source?: string;
  onRequestLog?: RequestLogCallback;
  beforeRequest?: () => Promise<void>;
  arrayPath?: string;
  pagination?: PaginationConfig;
  scopeId?: string;
}

export interface AwsServiceApiDeps {
  logger: LoggerService;
  integrationId: string;
  createCredentialsProvider: (
    accountConfig: {
      accountId: string;
      roleName?: string;
      externalId?: string;
    },
    region: string,
    integrationId: string,
    scopeId?: string,
  ) => Promise<() => Promise<AwsCredentialIdentity>>;
  withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

function isHttpStatusCodeNumber(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 100 &&
    value < 600
  );
}

export function statusStringFromAwsFailure(err: unknown): string | undefined {
  if (err instanceof AwsServiceApiError) {
    return String(err.statusCode);
  }
  if (err && typeof err === 'object' && '$metadata' in err) {
    const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
    if (isHttpStatusCodeNumber(meta?.httpStatusCode)) {
      return String(meta.httpStatusCode);
    }
  }
  return undefined;
}

function isXmlProtocol(protocol?: AwsServiceProtocol): boolean {
  return (
    protocol === 'rest-xml' ||
    protocol === 'aws-query' ||
    protocol === 'ec2-query'
  );
}

function usesQueryProtocolFormPost(protocol?: AwsServiceProtocol): boolean {
  return protocol === 'aws-query' || protocol === 'ec2-query';
}

function defaultContentTypeForProtocol(
  protocol?: AwsServiceProtocol,
): string | undefined {
  switch (protocol) {
    case 'aws-json-1.0':
      return 'application/x-amz-json-1.0';
    case 'rest-json':
      return 'application/json';
    case 'rest-xml':
    case 'aws-query':
    case 'ec2-query':
      return undefined;
    case 'aws-json-1.1':
    default:
      return 'application/x-amz-json-1.1';
  }
}

function isJsonContentType(contentType: string): boolean {
  return (
    !contentType ||
    contentType.includes('application/json') ||
    contentType.includes('application/x-amz-json')
  );
}

function isXmlContentType(contentType: string): boolean {
  return contentType.includes('xml');
}

function parseXmlBody(body: string): unknown {
  return xmlParser.parse(body);
}

function findFirstStringValue(
  value: unknown,
  keys: string[],
  depth = 0,
): string | undefined {
  if (depth > 6 || value == null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstStringValue(item, keys, depth + 1);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const found = record[key];
      if (typeof found === 'string' && found.trim()) {
        return found;
      }
    }
    for (const nested of Object.values(record)) {
      const found = findFirstStringValue(nested, keys, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function parseLinkHeader(
  linkHeader: string | undefined,
): Partial<Record<'next', string>> {
  if (!linkHeader) {
    return {};
  }

  const links: Partial<Record<'next', string>> = {};
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (!match) {
      continue;
    }
    const [, url, rel] = match;
    if (rel === 'next') {
      links.next = url;
    }
  }
  return links;
}

async function executeNodeHttpsRequest(
  request: {
    hostname: string;
    method: string;
    path: string;
    headers: Record<string, unknown>;
    body?: unknown;
  },
  signal?: AbortSignal,
): Promise<{
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}> {
  const https = await import('node:https');
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(
      Object.entries(request.headers).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    const requestBody = request.body === undefined ? '' : String(request.body);
    const req = https.request(
      {
        hostname: request.hostname,
        method: request.method,
        path: request.path,
        headers: {
          ...headers,
          ...(requestBody
            ? { 'content-length': Buffer.byteLength(requestBody).toString() }
            : {}),
        },
      },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          signal?.removeEventListener('abort', onAbort);
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? '',
            headers: Object.fromEntries(
              Object.entries(response.headers).map(([key, value]) => [
                key,
                Array.isArray(value) ? value.join(', ') : (value ?? ''),
              ]),
            ),
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    const onAbort = () => {
      req.destroy(new Error('Operation cancelled'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', error => {
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    if (requestBody) {
      req.write(requestBody);
    }
    req.end();
  });
}

export function resolveServiceApiRequestOptions(
  options: AwsRequestApiOptions | AwsServiceApiRequestPagesOptions,
  accountId: string,
  region: string,
): ResolvedAwsServiceRequestOptions {
  const defaults = getAwsServiceRequestDefaults(
    options.service,
    options.operation,
  );
  const method = options.method ?? defaults?.method ?? 'POST';
  const path = options.path ?? defaults?.path;
  if (!path) {
    throw new Error(
      `AWS service request path is required for ${options.service}${
        options.operation ? `.${options.operation}` : ''
      }`,
    );
  }
  return {
    protocol: defaults?.protocol,
    method,
    accountId,
    service: options.service,
    operation: options.operation,
    region,
    path,
    headers: options.headers ?? defaults?.headers,
    body: options.body ?? defaults?.body,
    hostname: defaults?.hostname,
    signingRegion: defaults?.signingRegion ?? region,
    signal: options.signal,
    source: options.source,
    onRequestLog: options.onRequestLog,
    beforeRequest: options.beforeRequest,
    arrayPath:
      'arrayPath' in options
        ? (options.arrayPath ?? defaults?.arrayExpression)
        : defaults?.arrayExpression,
    pagination:
      'pagination' in options
        ? (options.pagination ?? defaults?.pagination)
        : defaults?.pagination,
    scopeId: options.scopeId,
  };
}

export function resolveServiceApiHostname(
  options: ResolvedAwsServiceRequestOptions,
): string {
  return (
    options.hostname ?? `${options.service}.${options.region}.amazonaws.com`
  );
}

export function buildServiceApiTarget(
  options: ResolvedAwsServiceRequestOptions,
): string {
  return `[account:${options.accountId}] ${resolveServiceApiHostname(options)}${options.path}`;
}

function parseServiceApiResponseData(
  body: string,
  contentType: string,
  options: ResolvedAwsServiceRequestOptions,
): unknown {
  if (!body) {
    return undefined;
  }
  if (isXmlProtocol(options.protocol) || isXmlContentType(contentType)) {
    return parseXmlBody(body);
  }
  if (isJsonContentType(contentType)) {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function formatServiceApiError(
  status: number,
  statusText: string,
  data: unknown,
  fallbackBody: string,
): string {
  const message = findFirstStringValue(data, ['Message', 'message']);
  const code = findFirstStringValue(data, ['Code', 'code', '__type']);
  const details = code && message ? `${code}: ${message}` : message;
  return `AWS request failed: ${status} ${statusText} - ${
    details ?? fallbackBody.trim()
  }`;
}

async function executeServiceApiRequest(
  deps: AwsServiceApiDeps,
  options: ResolvedAwsServiceRequestOptions,
): Promise<{
  data: unknown;
  headers: Record<string, string>;
  status: number;
}> {
  if (!options.accountConfig) {
    throw new Error(
      `AWS account "${options.accountId}" not found in integration config or AWS Organizations`,
    );
  }

  const credentialsProvider = await deps.createCredentialsProvider(
    options.accountConfig,
    options.region,
    deps.integrationId,
    options.scopeId,
  );
  const credentials = await credentialsProvider();

  const hostname = resolveServiceApiHostname(options);
  const url = new URL(`https://${hostname}${options.path}`);
  const requestBody =
    options.method === 'GET' || options.method === 'DELETE'
      ? undefined
      : options.body;
  const normalizedRequestBody = usesQueryProtocolFormPost(options.protocol)
    ? (requestBody ?? url.searchParams.toString())
    : requestBody;
  const defaultContentType = usesQueryProtocolFormPost(options.protocol)
    ? 'application/x-www-form-urlencoded; charset=utf-8'
    : defaultContentTypeForProtocol(options.protocol);
  const normalizedHeaders = {
    ...(normalizedRequestBody !== undefined &&
    defaultContentType &&
    !Object.keys(options.headers ?? {}).some(
      key => key.toLowerCase() === 'content-type',
    )
      ? { 'content-type': defaultContentType }
      : {}),
    ...(options.headers ?? {}),
  };

  const httpRequest = usesQueryProtocolFormPost(options.protocol)
    ? new HttpRequest({
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname,
        headers: {
          host: url.hostname,
          ...normalizedHeaders,
        },
        body: normalizedRequestBody,
      })
    : new HttpRequest({
        method: options.method,
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          host: url.hostname,
          ...normalizedHeaders,
        },
        body: normalizedRequestBody,
      });

  const signer = new SignatureV4({
    applyChecksum: !usesQueryProtocolFormPost(options.protocol),
    credentials,
    region: options.signingRegion ?? options.region,
    service: options.service,
    sha256: Sha256,
  });

  const signedRequest = await signer.sign(httpRequest);

  const response = await deps.withRetry(async () => {
    const rawResponse = usesQueryProtocolFormPost(options.protocol)
      ? await executeNodeHttpsRequest(signedRequest, options.signal)
      : await (async () => {
          // eslint-disable-next-line no-restricted-syntax -- external target: a SigV4-signed request to the AWS service endpoint, not an internal call.
          const fetchResponse = await fetch(
            `https://${signedRequest.hostname}${signedRequest.path}`,
            {
              method: signedRequest.method,
              headers: signedRequest.headers as Record<string, string>,
              body: signedRequest.body,
              signal: options.signal,
            },
          );

          const headerEntries: Array<[string, string]> = [];
          fetchResponse.headers?.forEach?.((value, key) => {
            headerEntries.push([key, value]);
          });
          return {
            status: fetchResponse.status,
            statusText: fetchResponse.statusText,
            headers: Object.fromEntries(headerEntries),
            body: await fetchResponse.text(),
          };
        })();
    const responseHeaders = rawResponse.headers;
    const contentType = responseHeaders['content-type'] ?? '';
    const prefersJson =
      !isXmlProtocol(options.protocol) && isJsonContentType(contentType);
    let responseBody = rawResponse.body;
    let data: unknown;
    if (prefersJson) {
      try {
        data = JSON.parse(responseBody);
        responseBody =
          typeof data === 'string' ? data : JSON.stringify(data ?? null);
      } catch {
        data = parseServiceApiResponseData(responseBody, contentType, options);
      }
    } else {
      data = parseServiceApiResponseData(responseBody, contentType, options);
    }
    const responseOk = rawResponse.status >= 200 && rawResponse.status < 300;
    if (!responseOk) {
      throw new AwsServiceApiError({
        statusCode: rawResponse.status,
        statusText: rawResponse.statusText,
        message: formatServiceApiError(
          rawResponse.status,
          rawResponse.statusText,
          data,
          responseBody,
        ),
      });
    }

    return {
      data,
      headers: responseHeaders,
      status: rawResponse.status,
    };
  }, options.signal);

  return response;
}

async function resolveServiceApiItems(
  logger: LoggerService,
  data: unknown,
  arrayPath?: string,
): Promise<unknown[]> {
  if (!arrayPath) {
    return Array.isArray(data) ? data : [data];
  }
  const expr = jsonataSafe(arrayPath);
  const result = await expr.evaluate(data);
  if (Array.isArray(result)) {
    return result;
  }
  if (result == null) {
    return [];
  }
  if (typeof result === 'object') {
    const detected = await detectArrayInResponse(result, message =>
      logger.info(message),
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

export async function requestServiceApi(
  deps: AwsServiceApiDeps,
  options: ResolvedAwsServiceRequestOptions,
): Promise<unknown> {
  await options.beforeRequest?.();
  const startTime = Date.now();
  try {
    const response = await executeServiceApiRequest(deps, options);
    options.onRequestLog?.({
      id: uuid(),
      timestamp: new Date(startTime).toISOString(),
      source: options.source ?? '',
      target: buildServiceApiTarget(options),
      operation: options.method,
      duration: Date.now() - startTime,
      requestBody: options.body,
      responseBody: response.data,
      status: String(response.status),
    });
    return response.data;
  } catch (err) {
    options.onRequestLog?.({
      id: uuid(),
      timestamp: new Date(startTime).toISOString(),
      source: options.source ?? '',
      target: buildServiceApiTarget(options),
      operation: options.method,
      duration: Date.now() - startTime,
      requestBody: options.body,
      error: err instanceof Error ? err.message : String(err),
      status: statusStringFromAwsFailure(err),
    });
    throw err;
  }
}

async function fetchServiceApiPage(
  deps: AwsServiceApiDeps,
  options: ResolvedAwsServiceRequestOptions,
): Promise<{
  data: unknown;
  items: unknown[];
  headers: Record<string, string>;
}> {
  await options.beforeRequest?.();
  const startTime = Date.now();
  try {
    const response = await executeServiceApiRequest(deps, options);
    const items = await resolveServiceApiItems(
      deps.logger,
      response.data,
      options.arrayPath,
    );
    options.onRequestLog?.({
      id: uuid(),
      timestamp: new Date(startTime).toISOString(),
      source: options.source ?? '',
      target: buildServiceApiTarget(options),
      operation: options.method,
      duration: Date.now() - startTime,
      requestBody: options.body,
      responseBody: response.data,
      status: String(response.status),
    });
    return { data: response.data, items, headers: response.headers };
  } catch (err) {
    options.onRequestLog?.({
      id: uuid(),
      timestamp: new Date(startTime).toISOString(),
      source: options.source ?? '',
      target: buildServiceApiTarget(options),
      operation: options.method,
      duration: Date.now() - startTime,
      requestBody: options.body,
      error: err instanceof Error ? err.message : String(err),
      status: statusStringFromAwsFailure(err),
    });
    throw err;
  }
}

function withUpdatedServiceApiFields(
  options: ResolvedAwsServiceRequestOptions,
  fields: Record<string, string | number>,
): ResolvedAwsServiceRequestOptions {
  if (Object.keys(fields).length === 0) {
    return options;
  }
  const useBody =
    options.method !== 'GET' &&
    options.method !== 'DELETE' &&
    !isXmlProtocol(options.protocol) &&
    (options.body !== undefined ||
      Object.keys(options.headers ?? {}).some(
        key => key.toLowerCase() === 'content-type',
      ));
  if (useBody) {
    let parsedBody: Record<string, unknown> = {};
    if (options.body) {
      try {
        const raw: unknown = JSON.parse(options.body);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new Error('AWS service request body must be a JSON object');
        }
        parsedBody = raw as Record<string, unknown>;
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
        throw new Error('AWS service request body must be valid JSON');
      }
    }
    const merged: Record<string, unknown> = { ...parsedBody, ...fields };
    return {
      ...options,
      body: JSON.stringify(merged),
    };
  }

  const url = new URL(options.path, 'http://placeholder');
  for (const [key, value] of Object.entries(fields)) {
    url.searchParams.set(key, String(value));
  }
  return {
    ...options,
    path: `${url.pathname}${url.search}`,
  };
}

function normalizeServiceApiPath(nextPath: string): string {
  try {
    const url = new URL(nextPath);
    return `${url.pathname}${url.search}`;
  } catch {
    return nextPath;
  }
}

export async function* requestResolvedServiceApiPages(
  deps: AwsServiceApiDeps,
  resolved: ResolvedAwsServiceRequestOptions,
): AsyncGenerator<unknown[]> {
  const pagination = resolved.pagination;
  if (!pagination || pagination.type === 'none') {
    const { items } = await fetchServiceApiPage(deps, resolved);
    yield items;
    return;
  }

  switch (pagination.type) {
    case 'cursor': {
      const nextCursorExpr = jsonataSafe(pagination.nextCursorExpression);
      let currentOptions = resolved;
      for (;;) {
        const { data, items } = await fetchServiceApiPage(deps, currentOptions);
        yield items;
        const nextCursor = await nextCursorExpr.evaluate(data);
        if (nextCursor == null || nextCursor === '') {
          break;
        }
        currentOptions = withUpdatedServiceApiFields(currentOptions, {
          [pagination.cursorParam]: String(nextCursor),
        });
      }
      return;
    }
    case 'page': {
      let currentPage = pagination.startPage ?? 1;
      for (;;) {
        const fields: Record<string, string | number> = {};
        if (pagination.pageParam) {
          fields[pagination.pageParam] = currentPage;
        }
        if (pagination.perPageParam) {
          fields[pagination.perPageParam] = pagination.perPage;
        }
        const pageOptions = withUpdatedServiceApiFields(resolved, fields);
        const { items } = await fetchServiceApiPage(deps, pageOptions);
        yield items;
        if (items.length < pagination.perPage) {
          break;
        }
        currentPage++;
      }
      return;
    }
    case 'offset': {
      let currentOffset = 0;
      for (;;) {
        const fields: Record<string, string | number> = {};
        if (pagination.offsetParam) {
          fields[pagination.offsetParam] = currentOffset;
        }
        if (pagination.limitParam) {
          fields[pagination.limitParam] = pagination.limit;
        }
        const pageOptions = withUpdatedServiceApiFields(resolved, fields);
        const { items } = await fetchServiceApiPage(deps, pageOptions);
        yield items;
        if (items.length < pagination.limit) {
          break;
        }
        currentOffset += pagination.limit;
      }
      return;
    }
    case 'link': {
      const initialOptions =
        pagination.perPage && pagination.perPage > 0 && pagination.perPageParam
          ? withUpdatedServiceApiFields(resolved, {
              [pagination.perPageParam]: pagination.perPage,
            })
          : resolved;
      let currentOptions: ResolvedAwsServiceRequestOptions | null =
        initialOptions;
      while (currentOptions) {
        const { items, headers } = await fetchServiceApiPage(
          deps,
          currentOptions,
        );
        yield items;
        const links = parseLinkHeader(headers.link);
        currentOptions = links.next
          ? {
              ...resolved,
              path: normalizeServiceApiPath(links.next),
            }
          : null;
      }
      return;
    }
    case 'body-link': {
      const nextLinkExpr = jsonataSafe(pagination.nextLinkExpression);
      let currentOptions =
        pagination.perPage && pagination.perPage > 0 && pagination.perPageParam
          ? withUpdatedServiceApiFields(resolved, {
              [pagination.perPageParam]: pagination.perPage,
            })
          : resolved;
      for (;;) {
        const { data, items } = await fetchServiceApiPage(deps, currentOptions);
        yield items;
        const nextLink = await nextLinkExpr.evaluate(data);
        if (typeof nextLink !== 'string' || nextLink === '') {
          break;
        }
        currentOptions = {
          ...resolved,
          path: normalizeServiceApiPath(nextLink),
        };
      }
      return;
    }
    case 'graphql-cursor':
      throw new Error('GraphQL cursor pagination is not supported for AWS');
    default:
      return;
  }
}
