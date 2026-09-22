export interface SchemaField {
  name: string;
  type: string;
  rawValue?: unknown;
}

/** Top-level fields for graph nodes / rule picker (nested expansion uses recursive helpers below). */
export function extractSchemaFields(schema: unknown): SchemaField[] {
  if (typeof schema === 'object' && schema !== null && !Array.isArray(schema)) {
    const rec = schema as Record<string, unknown>;
    const props = rec.properties;
    const source =
      typeof props === 'object' && props !== null && !Array.isArray(props)
        ? (props as Record<string, unknown>)
        : rec;
    return Object.entries(source).map(([name, value]) => ({
      name,
      type: topLevelSchemaValueType(value),
      rawValue: value,
    }));
  }
  return [];
}

function topLevelSchemaValueType(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return 'array';
    }
    const rec = value as Record<string, unknown>;
    if (typeof rec.type === 'string') {
      return rec.type;
    }
    return 'object';
  }
  return 'unknown';
}

export interface FlattenedSchemaField {
  name: string;
  path: string;
  type: string;
}

const SCHEMA_METADATA_KEYS = new Set([
  '$ref',
  'additionalProperties',
  'allOf',
  'anyOf',
  'const',
  'default',
  'description',
  'discriminator',
  'enum',
  'example',
  'examples',
  'format',
  'items',
  'nullable',
  'oneOf',
  'prefixItems',
  'properties',
  'required',
  'title',
  'type',
]);

const SCHEMA_STRUCTURAL_KEYS = new Set([
  '$ref',
  'additionalProperties',
  'allOf',
  'anyOf',
  'items',
  'oneOf',
  'prefixItems',
  'properties',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveFieldType(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (isRecord(value)) {
    if (typeof value.type === 'string') {
      return value.type;
    }
    if ('items' in value) {
      return 'array';
    }
    return 'object';
  }
  return 'unknown';
}

function mapFieldsFromRecord(record: Record<string, unknown>): SchemaField[] {
  return Object.entries(record).map(([name, value]) => ({
    name,
    type: resolveFieldType(value),
    rawValue: value,
  }));
}

function extractFieldsFromSchemaProperties(rawValue: unknown): SchemaField[] {
  if (!isRecord(rawValue)) {
    return [];
  }
  const properties = rawValue.properties;
  return isRecord(properties) ? mapFieldsFromRecord(properties) : [];
}

function extractFieldsFromArrayItems(rawValue: unknown): SchemaField[] {
  if (!isRecord(rawValue)) {
    return [];
  }
  const items = rawValue.items;
  if (Array.isArray(items)) {
    const firstObjectItem = items.find(isRecord);
    return firstObjectItem ? extractChildFields(firstObjectItem) : [];
  }
  if (isRecord(items)) {
    const fromProperties = extractFieldsFromSchemaProperties(items);
    if (fromProperties.length > 0) {
      return fromProperties;
    }
    return extractChildFields(items);
  }
  return [];
}

function extractFieldsFromLegacyObject(rawValue: unknown): SchemaField[] {
  if (!isRecord(rawValue)) {
    return [];
  }

  const entries = Object.entries(rawValue);
  const keys = entries.map(([key]) => key);
  const hasOnlySchemaKeys = keys.every(key => SCHEMA_METADATA_KEYS.has(key));
  const hasStructuralKey = keys.some(key => SCHEMA_STRUCTURAL_KEYS.has(key));
  const hasTypeKey = typeof rawValue.type === 'string';
  // A record of nothing but schema keys that declares a `type` is a schema
  // wrapper, not data — including the bare `{ type: 'string' }` that describes
  // the items of an array of primitives. Reading that as a legacy object would
  // offer `$.images.type` in the picker: a field that isn't in the data.
  const looksLikeSchemaWrapper =
    hasOnlySchemaKeys && (hasStructuralKey || hasTypeKey);

  const plainEntries = looksLikeSchemaWrapper
    ? entries.filter(([key]) => !SCHEMA_METADATA_KEYS.has(key))
    : entries;

  if (plainEntries.length === 0) {
    return [];
  }
  return plainEntries.map(([name, value]) => ({
    name,
    type: resolveFieldType(value),
    rawValue: value,
  }));
}

function extractChildFields(rawValue: unknown): SchemaField[] {
  if (Array.isArray(rawValue)) {
    const firstObjectItem = rawValue.find(item => isRecord(item));
    return firstObjectItem ? extractChildFields(firstObjectItem) : [];
  }

  const fromProperties = extractFieldsFromSchemaProperties(rawValue);
  if (fromProperties.length > 0) {
    return fromProperties;
  }

  const fromItems = extractFieldsFromArrayItems(rawValue);
  if (fromItems.length > 0) {
    return fromItems;
  }

  return extractFieldsFromLegacyObject(rawValue);
}

/** Child fields for one JSON Schema `array` / object container (used by the relationships graph). */
export function extractSchemaFieldChildren(rawValue: unknown): SchemaField[] {
  return extractChildFields(rawValue);
}

function containerBaseType(field: SchemaField): string {
  return field.type.replace(/\?$/, '');
}

function nestedSchemaFields(field: SchemaField): SchemaField[] {
  if (containerBaseType(field) === 'object') {
    return extractSchemaFields(field.rawValue ?? {});
  }
  if (containerBaseType(field) === 'array') {
    return extractSchemaFieldChildren(field.rawValue ?? null);
  }
  return [];
}

/**
 * Builds a JSONata path for a nested schema path selected on the graph
 * (e.g. `_additionalData.members.login` → `$._additionalData.members[*].login`).
 */
export function relationshipJoinExprFromGraphPath(
  rootFields: SchemaField[],
  dottedPath: string,
): string | null {
  const segments = dottedPath.split('.').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  let bucket = rootFields;
  let expr = '$';
  const lastIndex = segments.length - 1;

  let index = 0;
  for (const seg of segments) {
    const field = bucket.find(f => f.name === seg);
    if (!field) {
      return null;
    }
    expr += `.${seg}`;
    if (index === lastIndex) {
      break;
    }
    const isArraySegment = containerBaseType(field) === 'array';
    bucket = nestedSchemaFields(field);
    if (bucket.length === 0) {
      return null;
    }
    if (isArraySegment) {
      expr += '[*]';
    }
    index += 1;
  }
  return expr;
}

function isStringLike(field: SchemaField): boolean {
  const baseType = field.type.replace(/\?$/, '');
  return baseType === 'string' || baseType === 'array' || baseType === 'mixed';
}

function isContainerType(field: SchemaField): boolean {
  const baseType = field.type.replace(/\?$/, '');
  return baseType === 'object' || baseType === 'array' || baseType === 'mixed';
}

export function flattenSchemaFields(
  fields: SchemaField[],
  prefix = '',
): FlattenedSchemaField[] {
  const result: FlattenedSchemaField[] = [];

  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    if (isStringLike(field)) {
      result.push({ name: path, path: `$.${path}`, type: field.type });
    }

    if (!isContainerType(field)) {
      continue;
    }

    const children = extractChildFields(field.rawValue);
    if (children.length > 0) {
      result.push(...flattenSchemaFields(children, path));
    }
  }

  return result;
}

export function isKnownFieldPath(path: string, fields: SchemaField[]): boolean {
  return flattenSchemaFields(fields).some(field => field.path === path);
}
