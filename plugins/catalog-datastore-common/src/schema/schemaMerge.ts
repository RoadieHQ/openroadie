import { JsonValue } from '@roadiehq/types';
import { JsonSchema, MergeStrategy } from './schemaTypes';

export function isSchemaObject(
  value: JsonValue | undefined,
): value is JsonSchema {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function mergeEnumValues(
  sourceEnum: JsonValue,
  inferredEnum: JsonValue,
): JsonValue {
  if (!Array.isArray(sourceEnum)) {
    return inferredEnum;
  }
  if (!Array.isArray(inferredEnum)) {
    return sourceEnum;
  }

  const merged: JsonValue[] = [];
  const seen = new Set<string>();

  for (const value of [...sourceEnum, ...inferredEnum]) {
    const key = JSON.stringify(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(value);
  }

  return merged;
}

function mergeFormats(
  a: string | undefined,
  b: string | undefined,
): string | undefined {
  if (a === b) {
    return a;
  }
  return undefined;
}

export function mergeJsonSchemas(a: JsonSchema, b: JsonSchema): JsonSchema {
  return mergeSchemas(a, b, 'json');
}

export function mergeVariantSchemas(a: JsonSchema, b: JsonSchema): JsonSchema {
  return mergeSchemas(a, b, 'variant');
}

export function mergeSchemas(
  a: JsonSchema,
  b: JsonSchema,
  strategy: MergeStrategy,
): JsonSchema {
  let aType = a.type as string | undefined;
  let bType = b.type as string | undefined;

  if (!aType && a.properties) {
    aType = 'object';
  }
  if (!bType && b.properties) {
    bType = 'object';
  }

  if (!aType || !bType) {
    if (strategy === 'variant') {
      return aType ? a : b;
    }
    return {};
  }

  if (aType !== bType) {
    if (
      (aType === 'integer' && bType === 'number') ||
      (aType === 'number' && bType === 'integer')
    ) {
      return { type: 'number' };
    }
    if (bType === 'null') {
      return a;
    }
    if (aType === 'null') {
      return b;
    }
    return {};
  }

  if (aType === 'object') {
    return mergeObjectSchemas(a, b, strategy);
  }

  if (aType === 'array') {
    const aItems = (a.items ?? {}) as JsonSchema;
    const bItems = (b.items ?? {}) as JsonSchema;
    return { type: 'array', items: mergeSchemas(aItems, bItems, strategy) };
  }

  if (strategy === 'variant') {
    return mergeVariantLeafSchema(a, b, aType);
  }

  if (aType !== 'string') {
    return a;
  }

  const format = mergeFormats(
    a.format as string | undefined,
    b.format as string | undefined,
  );
  const result: JsonSchema = { type: 'string' };
  if (format) {
    result.format = format;
  }
  return result;
}

function mergeVariantLeafSchema(
  a: JsonSchema,
  b: JsonSchema,
  type: string,
): JsonSchema {
  const result: JsonSchema = { type };

  const format = mergeFormats(
    a.format as string | undefined,
    b.format as string | undefined,
  );
  if (format) {
    result.format = format;
  }

  if (a.enum || b.enum) {
    const merged = mergeEnumValues(a.enum as JsonValue, b.enum as JsonValue);
    if (Array.isArray(merged) && merged.length > 0) {
      result.enum = merged;
    }
  }

  const description = (a.description ?? b.description) as string | undefined;
  if (description !== undefined) {
    result.description = description;
  }

  return result;
}

function mergeObjectSchemas(
  a: JsonSchema,
  b: JsonSchema,
  strategy: MergeStrategy,
): JsonSchema {
  const aProps = (a.properties ?? {}) as Record<string, JsonValue>;
  const bProps = (b.properties ?? {}) as Record<string, JsonValue>;

  const merged: Record<string, JsonValue> = {};
  const allKeys = new Set([...Object.keys(aProps), ...Object.keys(bProps)]);

  for (const key of [...allKeys].sort()) {
    const aVal = aProps[key] as JsonSchema | undefined;
    const bVal = bProps[key] as JsonSchema | undefined;
    if (aVal && bVal) {
      merged[key] = mergeSchemas(aVal, bVal, strategy);
    } else if (aVal) {
      merged[key] = aVal;
    } else if (bVal) {
      merged[key] = bVal;
    }
  }

  const result: JsonSchema = { type: 'object', properties: merged };

  const aRequired = Array.isArray(a.required) ? (a.required as string[]) : [];
  const bRequired = Array.isArray(b.required) ? (b.required as string[]) : [];
  const mergedRequired = [...new Set([...aRequired, ...bRequired])].sort();
  if (mergedRequired.length > 0) {
    result.required = mergedRequired;
  }

  return result;
}
