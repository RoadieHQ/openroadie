import { JsonValue } from '@roadiehq/types';
import { JsonSchema, MAX_ITEMS_TO_SAMPLE } from './schemaTypes';
import { mergeJsonSchemas } from './schemaMerge';

// eslint-disable-next-line security/detect-unsafe-regex
export const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*$/;
export const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const URI_RE = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\/[^\s]+$/;
const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

function detectStringFormat(value: string): string | undefined {
  if (ISO_DATETIME_RE.test(value)) {
    return 'date-time';
  }
  if (ISO_DATE_ONLY_RE.test(value)) {
    return 'date';
  }
  if (URI_RE.test(value)) {
    return 'uri';
  }
  if (EMAIL_RE.test(value)) {
    return 'email';
  }
  return undefined;
}

function getJsonSchemaOfValue(value: unknown): JsonSchema {
  if (value === null || value === undefined) {
    return { type: 'null' };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { type: 'array', items: {} };
    }
    const limit = Math.min(value.length, MAX_ITEMS_TO_SAMPLE);
    let itemSchema = getJsonSchemaOfValue(value[0]);
    for (let i = 1; i < limit; i++) {
      itemSchema = mergeJsonSchemas(itemSchema, getJsonSchemaOfValue(value[i]));
    }
    return { type: 'array', items: itemSchema };
  }
  if (typeof value === 'object') {
    const properties: Record<string, JsonValue> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      properties[key] = getJsonSchemaOfValue(
        (value as Record<string, unknown>)[key],
      );
    }
    return { type: 'object', properties };
  }
  if (typeof value === 'string') {
    const format = detectStringFormat(value);
    const result: JsonSchema = { type: 'string' };
    if (format) {
      result.format = format;
    }
    return result;
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { type: 'integer' };
    }
    return { type: 'number' };
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean' };
  }
  return {};
}

export function getShape(items: JsonValue[]): JsonValue {
  if (!Array.isArray(items)) {
    return {};
  }
  if (items.length === 0) {
    return {};
  }
  const limit = Math.min(items.length, MAX_ITEMS_TO_SAMPLE);

  let schema = getJsonSchemaOfValue(items[0]);
  for (let i = 1; i < limit; i++) {
    schema = mergeJsonSchemas(schema, getJsonSchemaOfValue(items[i]));
  }

  return schema;
}

export function computeSchemaHash(shape: JsonValue): string {
  const serialized = JSON.stringify(shape);
  const len = serialized.length;
  let hash = 0;
  for (let i = 0; i < len; i++) {
    const char = serialized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `sh_${(hash >>> 0).toString(36)}`;
}

export function generateSchemaDescription(
  datasourceName: string,
  _shape: JsonValue,
): string {
  return datasourceName;
}
