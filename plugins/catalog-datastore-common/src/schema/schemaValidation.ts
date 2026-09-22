import { JsonValue } from '@roadiehq/types';
import Ajv from 'ajv';
import { JsonSchema } from './schemaTypes';
import { isSchemaObject } from './schemaMerge';

export interface SchemaValidationError {
  path: string;
  expected: string;
  actual: string;
  suggestion: string;
}

export interface SchemaCorrection {
  field: string;
  type: 'type_widened' | 'enum_extended';
  before: string;
  after: string;
}

export interface AutoFixResult {
  fixedSchema: JsonValue;
  corrections: SchemaCorrection[];
}

interface FieldValidationError {
  itemIndex: number;
  field: string;
  keyword: string;
  params: Record<string, unknown>;
  value: JsonValue | undefined;
}

const VALIDATION_SAMPLE_LIMIT = 100;

function normalizeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(v => normalizeJsonValue(v as JsonValue));
  }

  if (value && typeof value === 'object') {
    const sorted = Object.entries(value as Record<string, JsonValue>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return Object.fromEntries(
      sorted.map(([key, val]) => [key, normalizeJsonValue(val)]),
    ) as JsonValue;
  }

  return value;
}

function jsonValueSignature(value: JsonValue): string {
  return JSON.stringify(normalizeJsonValue(value));
}

function actualTypeOf(value: JsonValue | undefined): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value;
}

function runAjvValidation(
  items: JsonValue[],
  schema: JsonSchema,
): FieldValidationError[] {
  if (schema.type !== 'object' || !schema.properties) {
    return [];
  }

  const ajv = new Ajv({ allErrors: true, strictTypes: false });
  let validate;
  try {
    validate = ajv.compile({
      type: 'object',
      properties: schema.properties,
    });
  } catch {
    return [];
  }

  const results: FieldValidationError[] = [];
  const limit = Math.min(items.length, VALIDATION_SAMPLE_LIMIT);

  for (let i = 0; i < limit; i++) {
    const item = items[i];
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue;
    }

    const filtered: Record<string, JsonValue> = {};
    for (const [key, val] of Object.entries(item)) {
      if (val !== null && val !== undefined) {
        filtered[key] = val as JsonValue;
      }
    }

    if (!validate(filtered)) {
      for (const error of validate.errors ?? []) {
        const field = error.instancePath.replace(/^\//, '');
        if (!field || field.includes('/')) {
          continue;
        }
        results.push({
          itemIndex: i,
          field,
          keyword: error.keyword,
          params: error.params as Record<string, unknown>,
          value: filtered[field],
        });
      }
    }
  }

  return results;
}

export function validateAgainstSchema(
  items: JsonValue[],
  schema: JsonValue,
): SchemaValidationError[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [];
  }

  const results = runAjvValidation(items, schema as JsonSchema);
  const errors: SchemaValidationError[] = [];

  for (const r of results) {
    if (r.keyword === 'type') {
      const actual = actualTypeOf(r.value);
      errors.push({
        path: `[${r.itemIndex}].${r.field}`,
        expected: `type "${r.params.type}"`,
        actual: `type "${actual}"`,
        suggestion: `Update the map transform for field "${r.field}" or edit the confirmed schema to allow type "${actual}".`,
      });
    } else if (r.keyword === 'enum') {
      const allowed = r.params.allowedValues as JsonValue[];
      errors.push({
        path: `[${r.itemIndex}].${r.field}`,
        expected: `one of [${allowed.map(v => `"${v}"`).join(', ')}]`,
        actual: `"${r.value}"`,
        suggestion: `Update the map transform for field "${r.field}" or add "${r.value}" to the enum in the confirmed schema.`,
      });
    }
  }

  return errors;
}

export function autoFixSchema(
  items: JsonValue[],
  schema: JsonValue,
): AutoFixResult {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { fixedSchema: schema, corrections: [] };
  }

  const s = schema as JsonSchema;
  if (s.type !== 'object' || !s.properties) {
    return { fixedSchema: schema, corrections: [] };
  }

  const results = runAjvValidation(items, s);
  if (results.length === 0) {
    return { fixedSchema: schema, corrections: [] };
  }

  const fixed = JSON.parse(JSON.stringify(schema)) as JsonSchema;
  const props = fixed.properties as Record<string, JsonValue>;
  const corrections: SchemaCorrection[] = [];

  const typeCorrections = new Map<string, Set<string>>();
  const enumAdditions = new Map<string, Map<string, JsonValue>>();

  for (const r of results) {
    if (r.keyword === 'type') {
      const actual = actualTypeOf(r.value);
      let set = typeCorrections.get(r.field);
      if (!set) {
        set = new Set();
        typeCorrections.set(r.field, set);
      }
      set.add(actual);
    } else if (r.keyword === 'enum' && r.value !== undefined) {
      let valuesBySignature = enumAdditions.get(r.field);
      if (!valuesBySignature) {
        valuesBySignature = new Map();
        enumAdditions.set(r.field, valuesBySignature);
      }
      valuesBySignature.set(jsonValueSignature(r.value), r.value);
    }
  }

  for (const field of typeCorrections.keys()) {
    enumAdditions.delete(field);
  }

  for (const [field, actualTypes] of typeCorrections) {
    const prop = props[field];
    if (!isSchemaObject(prop)) {
      continue;
    }
    const oldType = (prop as JsonSchema).type as string;

    let newType: string;
    if (actualTypes.size === 1) {
      newType = [...actualTypes][0];
    } else {
      const onlyNumeric = [...actualTypes].every(
        t => t === 'number' || t === 'integer',
      );
      if (onlyNumeric) {
        newType = actualTypes.has('number') ? 'number' : 'integer';
      } else {
        newType = 'string';
      }
    }

    if (newType !== oldType) {
      (prop as Record<string, JsonValue>).type = newType;
      corrections.push({
        field,
        type: 'type_widened',
        before: oldType,
        after: newType,
      });
    }
  }

  for (const [field, valuesBySignature] of enumAdditions) {
    const prop = props[field];
    if (!isSchemaObject(prop)) {
      continue;
    }
    const propObj = prop as JsonSchema;

    if (Array.isArray(propObj.enum)) {
      const existingEnum = propObj.enum as JsonValue[];
      const existingSignatures = new Set(
        existingEnum.map(v => jsonValueSignature(v)),
      );
      const addedValues = [...valuesBySignature.entries()]
        .filter(([signature]) => !existingSignatures.has(signature))
        .map(([, value]) => value);
      if (addedValues.length > 0) {
        (prop as Record<string, JsonValue>).enum = [
          ...existingEnum,
          ...addedValues,
        ];
        corrections.push({
          field,
          type: 'enum_extended',
          before: existingEnum.map(v => `"${v}"`).join(', '),
          after: addedValues.map(v => `"${v}"`).join(', '),
        });
      }
    }
  }

  return { fixedSchema: fixed, corrections };
}
