import { JsonValue } from '@roadiehq/types';
import { ParsedPaginationHint, SpecParser, ParsedPathSchema } from './types';

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
];

function getOpenApi3BasePath(spec: Record<string, unknown>): string {
  const servers = spec.servers;
  if (!Array.isArray(servers) || servers.length === 0) {
    return '';
  }

  const firstServer = servers[0] as Record<string, unknown> | undefined;
  const url = firstServer?.url;
  if (typeof url !== 'string' || url.length === 0) {
    return '';
  }

  try {
    return new URL(url, 'http://placeholder').pathname;
  } catch {
    return '';
  }
}

function getSwagger2BasePath(spec: Record<string, unknown>): string {
  const basePath = spec.basePath;
  return typeof basePath === 'string' ? basePath : '';
}

function withBasePath(basePath: string, pathPattern: string): string {
  let base = '';
  if (basePath && basePath !== '/') {
    base = basePath.startsWith('/') ? basePath : `/${basePath}`;
  }
  const path = pathPattern.startsWith('/') ? pathPattern : `/${pathPattern}`;

  if (!base) {
    return path;
  }
  if (path === base || path.startsWith(`${base}/`)) {
    return path;
  }

  return `${base}${path}`;
}

function getSuccessResponses(
  responses: Record<string, unknown>,
): Record<string, unknown>[] {
  return Object.entries(responses)
    .filter(([code]) => /^2\d\d$/.test(code))
    .map(([, response]) => response)
    .filter(
      (response): response is Record<string, unknown> =>
        !!response && typeof response === 'object',
    );
}

function extractSchemaFromContent(
  content: Record<string, unknown>,
): JsonValue | undefined {
  const preferredMediaTypes = [
    'application/json',
    'application/vnd.api+json',
    '*/*',
  ];

  for (const mediaType of preferredMediaTypes) {
    const mediaTypeContent = content[mediaType] as
      | Record<string, unknown>
      | undefined;
    if (mediaTypeContent?.schema) {
      return mediaTypeContent.schema as JsonValue;
    }
  }

  for (const [mediaType, mediaTypeContent] of Object.entries(content)) {
    if (!mediaType.includes('+json')) {
      continue;
    }

    const mediaTypeObject = mediaTypeContent as Record<string, unknown>;
    if (mediaTypeObject?.schema) {
      return mediaTypeObject.schema as JsonValue;
    }
  }

  return undefined;
}

function extractResponseSchema3x(
  operation: Record<string, unknown>,
): JsonValue | undefined {
  const responses = operation.responses as Record<string, unknown> | undefined;
  if (!responses) {
    return undefined;
  }

  for (const response of getSuccessResponses(responses)) {
    const content = response.content as Record<string, unknown> | undefined;
    if (!content) {
      continue;
    }

    const schema = extractSchemaFromContent(content);
    if (schema) {
      return schema;
    }
  }

  return undefined;
}

function extractResponseSchema2x(
  operation: Record<string, unknown>,
): JsonValue | undefined {
  const responses = operation.responses as Record<string, unknown> | undefined;
  if (!responses) {
    return undefined;
  }

  for (const response of getSuccessResponses(responses)) {
    if (response?.schema) {
      return response.schema as JsonValue;
    }
  }

  return undefined;
}

function getDefinitionsMap(
  spec: Record<string, unknown>,
): Record<string, unknown> {
  const defs = spec.definitions;
  if (defs && typeof defs === 'object' && !Array.isArray(defs)) {
    return defs as Record<string, unknown>;
  }
  const components = spec.components;
  if (
    components &&
    typeof components === 'object' &&
    !Array.isArray(components)
  ) {
    const schemas = (components as Record<string, unknown>).schemas;
    if (schemas && typeof schemas === 'object' && !Array.isArray(schemas)) {
      return schemas as Record<string, unknown>;
    }
  }
  return {};
}

function resolveRefName(ref: string): string | undefined {
  if (ref.startsWith('#/definitions/')) {
    return ref.slice('#/definitions/'.length);
  }
  if (ref.startsWith('#/components/schemas/')) {
    return ref.slice('#/components/schemas/'.length);
  }
  return undefined;
}

function resolveRefs(
  schema: JsonValue,
  definitions: Record<string, unknown>,
  resolving: Set<string>,
): JsonValue {
  if (typeof schema !== 'object' || schema === null) {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(item =>
      resolveRefs(item as JsonValue, definitions, resolving),
    );
  }

  const schemaObj = schema as Record<string, unknown>;
  const ref = schemaObj.$ref;

  if (typeof ref === 'string') {
    const defName = resolveRefName(ref);
    if (defName && !resolving.has(defName)) {
      const resolved = definitions[defName];
      if (
        resolved !== undefined &&
        resolved !== null &&
        typeof resolved === 'object'
      ) {
        const next = new Set(resolving);
        next.add(defName);
        return resolveRefs(resolved as JsonValue, definitions, next);
      }
    }
    return schema;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schemaObj)) {
    result[key] = resolveRefs(value as JsonValue, definitions, resolving);
  }
  return result as JsonValue;
}

interface QueryParameter {
  name: string;
  defaultValue?: number;
  maxValue?: number;
}

interface RequiredQueryDefault {
  name: string;
  value: string;
}

function getPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function getParameterDefaultValue(
  parameter: Record<string, unknown>,
): number | undefined {
  const schema = parameter.schema as Record<string, unknown> | undefined;
  return getPositiveNumber(schema?.default ?? parameter.default);
}

function getParameterMaxValue(
  parameter: Record<string, unknown>,
): number | undefined {
  const schema = parameter.schema as Record<string, unknown> | undefined;
  const schemaMaximum = getPositiveNumber(schema?.maximum);
  const parameterMaximum = getPositiveNumber(parameter.maximum);
  const enumValues = [
    ...(Array.isArray(schema?.enum) ? schema.enum : []),
    ...(Array.isArray(parameter.enum) ? parameter.enum : []),
  ]
    .map(value => getPositiveNumber(value))
    .filter((value): value is number => value !== undefined);
  const enumMaximum =
    enumValues.length > 0 ? Math.max(...enumValues) : undefined;

  const maximum = [schemaMaximum, parameterMaximum, enumMaximum].reduce<
    number | undefined
  >((max, current) => {
    if (current === undefined) {
      return max;
    }
    if (max === undefined) {
      return current;
    }
    return current > max ? current : max;
  }, undefined);
  if (maximum !== undefined) {
    return maximum;
  }
  return undefined;
}

function extractQueryParameters(
  pathObj: Record<string, unknown>,
  operation: Record<string, unknown>,
): QueryParameter[] {
  const pathParameters = Array.isArray(pathObj.parameters)
    ? pathObj.parameters
    : [];
  const operationParameters = Array.isArray(operation.parameters)
    ? operation.parameters
    : [];
  const allParameters = [...pathParameters, ...operationParameters];
  const queryParameters = allParameters.filter(parameter => {
    if (!parameter || typeof parameter !== 'object') {
      return false;
    }
    const inValue = (parameter as Record<string, unknown>).in;
    return inValue === 'query';
  }) as Record<string, unknown>[];

  const deduped = new Map<string, QueryParameter>();
  for (const parameter of queryParameters) {
    const name = parameter.name;
    if (typeof name !== 'string' || !name) {
      continue;
    }
    deduped.set(name.toLowerCase(), {
      name,
      defaultValue: getParameterDefaultValue(parameter),
      maxValue: getParameterMaxValue(parameter),
    });
  }

  return Array.from(deduped.values());
}

function getRequiredQueryDefaults(
  pathObj: Record<string, unknown>,
  operation: Record<string, unknown>,
): RequiredQueryDefault[] {
  const pathParameters = Array.isArray(pathObj.parameters)
    ? pathObj.parameters
    : [];
  const operationParameters = Array.isArray(operation.parameters)
    ? operation.parameters
    : [];
  const allParameters = [...pathParameters, ...operationParameters];

  const result: RequiredQueryDefault[] = [];
  const seen = new Set<string>();

  for (const param of allParameters) {
    if (!param || typeof param !== 'object') {
      continue;
    }
    const p = param as Record<string, unknown>;

    if (p.in !== 'query' || !p.required) {
      continue;
    }

    const name = typeof p.name === 'string' ? p.name : undefined;
    if (!name || seen.has(name.toLowerCase())) {
      continue;
    }
    seen.add(name.toLowerCase());

    const schema = p.schema as Record<string, unknown> | undefined;

    const example = p.example ?? schema?.example;
    const defaultVal = p.default ?? schema?.default;
    const enumVals = schema?.enum ?? p.enum;

    let value: string | undefined;
    if (example !== undefined && example !== null) {
      value = String(example);
    } else if (defaultVal !== undefined && defaultVal !== null) {
      value = String(defaultVal);
    } else if (Array.isArray(enumVals) && enumVals.length > 0) {
      value = String(enumVals[enumVals.length - 1]);
    }

    if (value) {
      result.push({ name, value });
    }
  }

  return result;
}

function findParameter(
  params: QueryParameter[],
  candidates: string[],
): QueryParameter | undefined {
  const candidateSet = new Set(candidates.map(c => c.toLowerCase()));
  return params.find(param => candidateSet.has(param.name.toLowerCase()));
}

function hasLinkHeaderInSuccessResponses(
  operation: Record<string, unknown>,
): boolean {
  const responses = operation.responses as Record<string, unknown> | undefined;
  if (!responses) {
    return false;
  }
  for (const response of getSuccessResponses(responses)) {
    const headers = response.headers as Record<string, unknown> | undefined;
    if (!headers) {
      continue;
    }
    const hasLink = Object.keys(headers).some(
      headerName => headerName.toLowerCase() === 'link',
    );
    if (hasLink) {
      return true;
    }
  }
  return false;
}

function inferPaginationHint(
  operation: Record<string, unknown>,
  params: QueryParameter[],
): ParsedPaginationHint | undefined {
  const perPage = findParameter(params, ['per_page']);
  const page = findParameter(params, ['page', 'page_number', 'pagenumber']);
  const beforeAfter = findParameter(params, ['before', 'after']);
  const since = findParameter(params, ['since']);
  const hasLinkHeader = hasLinkHeaderInSuccessResponses(operation);
  if (hasLinkHeader || (perPage && (page || beforeAfter || since))) {
    return {
      type: 'link',
      perPageParam: perPage?.name,
      perPage: perPage?.maxValue ?? 100,
    };
  }

  const cursor = findParameter(params, [
    'cursor',
    'after',
    'before',
    'next_cursor',
    'page_token',
    'starting_after',
    'ending_before',
    'continuation_token',
  ]);
  if (cursor) {
    return {
      type: 'cursor',
      cursorParam: cursor.name,
    };
  }

  const offset = findParameter(params, ['offset', 'start', 'skip']);
  const limit = findParameter(params, [
    'limit',
    'count',
    'per_page',
    'page_size',
  ]);
  if (offset && limit) {
    return {
      type: 'offset',
      offsetParam: offset.name,
      limitParam: limit.name,
      limit: limit.maxValue ?? 100,
    };
  }

  if (page) {
    const pageSize = findParameter(params, [
      'per_page',
      'perpage',
      'page_size',
      'pagesize',
      'limit',
      'count',
    ]);
    return {
      type: 'page',
      pageParam: page.name,
      perPageParam: pageSize?.name,
      perPage: pageSize?.maxValue ?? 100,
      startPage: page.defaultValue,
    };
  }

  return undefined;
}

export class OpenApiSpecParser implements SpecParser {
  canParse(spec: Record<string, unknown>): boolean {
    return !!(spec.openapi || spec.swagger);
  }

  parse(spec: Record<string, unknown>): ParsedPathSchema[] {
    const isV2 = !!spec.swagger;
    const paths = spec.paths as Record<string, unknown> | undefined;
    const basePath = isV2
      ? getSwagger2BasePath(spec)
      : getOpenApi3BasePath(spec);
    if (!paths) {
      return [];
    }

    const definitions = getDefinitionsMap(spec);
    const results: ParsedPathSchema[] = [];

    for (const [pathPattern, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== 'object') {
        continue;
      }

      const fullPathPattern = withBasePath(basePath, pathPattern);
      const pathObj = pathItem as Record<string, unknown>;

      for (const method of HTTP_METHODS) {
        const operation = pathObj[method] as
          | Record<string, unknown>
          | undefined;
        if (!operation) {
          continue;
        }

        const rawSchema = isV2
          ? extractResponseSchema2x(operation)
          : extractResponseSchema3x(operation);
        const schema = rawSchema
          ? resolveRefs(rawSchema, definitions, new Set())
          : undefined;

        if (schema) {
          const upperMethod = method.toUpperCase();
          const queryParams = extractQueryParameters(pathObj, operation);
          const requiredDefaults = getRequiredQueryDefaults(pathObj, operation);

          let pathPatternWithRequired = fullPathPattern;
          if (requiredDefaults.length > 0) {
            const separator = fullPathPattern.includes('?') ? '&' : '?';
            const queryStr = requiredDefaults
              .map(p => `${p.name}=${encodeURIComponent(p.value)}`)
              .join('&');
            pathPatternWithRequired = `${fullPathPattern}${separator}${queryStr}`;
          }

          const existing = results.find(
            r =>
              r.pathPattern === pathPatternWithRequired &&
              r.method === upperMethod,
          );
          if (!existing) {
            let description: string | undefined;
            if (typeof operation.summary === 'string') {
              description = operation.summary;
            } else if (typeof operation.description === 'string') {
              description = operation.description;
            }
            const paginationHint = inferPaginationHint(operation, queryParams);
            results.push({
              pathPattern: pathPatternWithRequired,
              method: upperMethod,
              jsonSchema: schema,
              description,
              ...(paginationHint ? { paginationHint } : {}),
            });
          }
        }
      }
    }

    return results;
  }
}
