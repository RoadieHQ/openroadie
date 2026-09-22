import { JsonValue } from '@roadiehq/types';
import { JsonSchema } from './schemaTypes';
import {
  mergeVariantSchemas,
  mergeSchemas,
  isSchemaObject,
} from './schemaMerge';

function normalizeSchema(schema: JsonSchema): JsonSchema {
  const result: JsonSchema = { ...schema };

  if (Array.isArray(result.type)) {
    const nonNull = (result.type as string[]).filter(t => t !== 'null');
    if (nonNull.length === 1) {
      result.type = nonNull[0];
    } else if (nonNull.length > 1) {
      const onlyNumeric = nonNull.every(t => t === 'number' || t === 'integer');
      if (onlyNumeric) {
        result.type = nonNull.includes('number') ? 'number' : 'integer';
      } else {
        result.type = 'string';
      }
    }
  }

  if (result.const !== undefined) {
    if (!result.enum) {
      result.enum = [result.const];
    }
    if (typeof result.type !== 'string') {
      const constVal = result.const;
      if (typeof constVal === 'string') {
        result.type = 'string';
      } else if (typeof constVal === 'number') {
        result.type = Number.isInteger(constVal as number)
          ? 'integer'
          : 'number';
      } else if (typeof constVal === 'boolean') {
        result.type = 'boolean';
      }
    }
    delete result.const;
  }

  if (Array.isArray(result.prefixItems) && !result.items) {
    const prefix = result.prefixItems as JsonValue[];
    if (prefix.length > 0) {
      let merged = normalizeSchema(prefix[0] as JsonSchema);
      for (let i = 1; i < prefix.length; i++) {
        merged = mergeSchemas(
          merged,
          normalizeSchema(prefix[i] as JsonSchema),
          'variant',
        );
      }
      result.items = merged as JsonValue;
    }
    delete result.prefixItems;
  }

  if (
    result.properties &&
    typeof result.properties === 'object' &&
    !Array.isArray(result.properties)
  ) {
    const props = { ...(result.properties as Record<string, JsonValue>) };
    for (const [key, value] of Object.entries(props)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        props[key] = normalizeSchema(value as JsonSchema);
      }
    }
    result.properties = props;
  }

  if (
    result.items &&
    typeof result.items === 'object' &&
    !Array.isArray(result.items)
  ) {
    result.items = normalizeSchema(result.items as JsonSchema);
  }

  for (const keyword of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(result[keyword])) {
      result[keyword] = (result[keyword] as JsonValue[]).map(v => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          return normalizeSchema(v as JsonSchema) as JsonValue;
        }
        return v;
      });
    }
  }

  return result;
}

export function resolveCompositeSchema(schema: JsonSchema): JsonSchema {
  const normalized = normalizeSchema(schema);

  const variants = (normalized.oneOf ??
    normalized.anyOf ??
    normalized.allOf) as JsonValue[];
  if (!Array.isArray(variants) || variants.length === 0) {
    return normalized;
  }

  const objectVariants: JsonSchema[] = [];
  const arrayVariants: JsonSchema[] = [];

  for (const variant of variants) {
    if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
      continue;
    }
    const v = variant as JsonSchema;
    if (v.type === 'object' || (!v.type && v.properties)) {
      objectVariants.push(v);
    } else if (v.type === 'array') {
      arrayVariants.push(v);
    }
  }

  if (objectVariants.length > 0) {
    let merged = objectVariants[0];
    for (let i = 1; i < objectVariants.length; i++) {
      merged = mergeVariantSchemas(merged, objectVariants[i]);
    }

    if (normalized.properties || normalized.required) {
      const baseSchema: JsonSchema = { type: 'object' };
      if (normalized.properties) {
        baseSchema.properties = normalized.properties;
      }
      if (normalized.required) {
        baseSchema.required = normalized.required;
      }
      merged = mergeVariantSchemas(baseSchema, merged);
    }

    const discriminator = normalized.discriminator as JsonSchema | undefined;
    if (
      discriminator &&
      typeof discriminator.propertyName === 'string' &&
      discriminator.mapping &&
      typeof discriminator.mapping === 'object' &&
      !Array.isArray(discriminator.mapping)
    ) {
      const propName = discriminator.propertyName as string;
      const enumValues = Object.keys(
        discriminator.mapping as Record<string, unknown>,
      ).sort();
      if (merged.properties && enumValues.length > 0) {
        const props = {
          ...(merged.properties as Record<string, JsonValue>),
        };
        const existing = props[propName];
        if (isSchemaObject(existing)) {
          props[propName] = { ...existing, enum: enumValues };
        } else {
          props[propName] = { type: 'string', enum: enumValues };
        }
        merged = { ...merged, properties: props };
      }
    }

    return merged;
  }

  if (arrayVariants.length > 0) {
    let merged = arrayVariants[0];
    for (let i = 1; i < arrayVariants.length; i++) {
      merged = mergeVariantSchemas(merged, arrayVariants[i]);
    }
    return merged;
  }

  return normalized;
}

function isTypeCompatible(
  sourceType: JsonValue | undefined,
  outputType: JsonValue | undefined,
): boolean {
  if (typeof sourceType !== 'string' || typeof outputType !== 'string') {
    return true;
  }
  if (sourceType === outputType) {
    return true;
  }
  if (
    (sourceType === 'number' && outputType === 'integer') ||
    (sourceType === 'integer' && outputType === 'number')
  ) {
    return true;
  }
  return false;
}

function isSchemaCompatible(
  sourceProp: JsonSchema,
  outputProp: JsonSchema,
): boolean {
  return isTypeCompatible(sourceProp.type, outputProp.type);
}

function findUniquePropertySchema(
  schema: JsonSchema,
  key: string,
): JsonSchema | null {
  const matches: JsonSchema[] = [];

  const walk = (node: JsonSchema): void => {
    if (matches.length > 1) {
      return;
    }

    if (node.type === 'object' && node.properties) {
      const props = node.properties as Record<string, JsonValue>;
      const direct = props[key];
      if (isSchemaObject(direct)) {
        matches.push(direct);
        if (matches.length > 1) {
          return;
        }
      }
      for (const value of Object.values(props)) {
        if (!isSchemaObject(value)) {
          continue;
        }
        walk(value);
        if (matches.length > 1) {
          return;
        }
      }
      return;
    }

    if (node.type === 'array' && isSchemaObject(node.items as JsonValue)) {
      walk(node.items as JsonSchema);
    }
  };

  walk(schema);
  return matches.length === 1 ? matches[0] : null;
}

export function resolveSourceFieldSchema(
  schema: JsonSchema,
  field: string,
  outputProp: JsonSchema,
): JsonSchema | null {
  if (schema.type === 'object' && schema.properties) {
    const direct = (schema.properties as Record<string, JsonValue>)[field];
    if (isSchemaObject(direct) && isSchemaCompatible(direct, outputProp)) {
      return direct;
    }
  }

  const fallback = findUniquePropertySchema(schema, field);
  if (!fallback || !isSchemaCompatible(fallback, outputProp)) {
    return null;
  }
  return fallback;
}

export function resolveFallbackItemSchema(
  schema: JsonSchema,
): JsonValue | null {
  if (schema.type !== 'object' || !schema.properties) {
    return null;
  }

  const props = schema.properties as Record<string, JsonValue>;
  const candidates: JsonValue[] = [];

  for (const value of Object.values(props)) {
    if (!isSchemaObject(value)) {
      continue;
    }

    const resolved = resolveCompositeSchema(value as JsonSchema);

    if (
      resolved.type === 'array' &&
      resolved.items &&
      isSchemaObject(resolved.items as JsonValue)
    ) {
      const resolvedItems = resolveCompositeSchema(
        resolved.items as JsonSchema,
      );
      if (resolvedItems.type === 'object' || resolvedItems.properties) {
        candidates.push(resolvedItems as JsonValue);
        continue;
      }
    }
  }

  return candidates.length === 1 ? candidates[0] : null;
}

export function resolveItemSchema(
  responseSchema: JsonValue | null | undefined,
  arrayExpression: string | undefined,
): JsonValue | null {
  if (
    !responseSchema ||
    typeof responseSchema !== 'object' ||
    Array.isArray(responseSchema)
  ) {
    return null;
  }

  const schema = resolveCompositeSchema(responseSchema as JsonSchema);

  if (!arrayExpression || arrayExpression === '$') {
    if (schema.type === 'array' && schema.items) {
      return resolveCompositeSchema(schema.items as JsonSchema) as JsonValue;
    }
    if (schema.type === 'object') {
      const fallbackItemSchema = resolveFallbackItemSchema(schema);
      return fallbackItemSchema ?? (schema as JsonValue);
    }
    return null;
  }

  let path = arrayExpression;
  if (path.startsWith('$.')) {
    path = path.slice(2);
  } else if (path.startsWith('$')) {
    path = path.slice(1);
  }

  const segments = path.split('.').filter(Boolean);
  let current: JsonSchema = schema;

  for (const segment of segments) {
    current = resolveCompositeSchema(current);

    if (current.type === 'array' && current.items) {
      current = resolveCompositeSchema(current.items as JsonSchema);
    }

    if (current.type !== 'object' || !current.properties) {
      return null;
    }

    const props = current.properties as Record<string, JsonValue>;
    const next = props[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return null;
    }
    current = next as JsonSchema;
  }

  current = resolveCompositeSchema(current);

  if (current.type === 'array' && current.items) {
    return resolveCompositeSchema(current.items as JsonSchema) as JsonValue;
  }

  return current as JsonValue;
}
