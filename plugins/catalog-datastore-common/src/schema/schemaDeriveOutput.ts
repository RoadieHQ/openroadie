import { JsonValue } from '@roadiehq/types';
import { JsonSchema } from './schemaTypes';
import { isSchemaObject, mergeEnumValues } from './schemaMerge';
import {
  resolveCompositeSchema,
  resolveSourceFieldSchema,
} from './schemaResolution';
import { getShape } from './schemaInference';

const FINGERPRINT_SAMPLE_LIMIT = 50;

function buildValueFingerprints(
  items: JsonValue[],
  maxSamples: number = FINGERPRINT_SAMPLE_LIMIT,
): Map<string, string[]> {
  const fieldValues = new Map<string, string[]>();
  const limit = Math.min(items.length, maxSamples);

  for (let i = 0; i < limit; i++) {
    const item = items[i];
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue;
    }
    for (const [key, val] of Object.entries(item)) {
      const serialized = JSON.stringify(val);
      let arr = fieldValues.get(key);
      if (!arr) {
        arr = [];
        fieldValues.set(key, arr);
      }
      arr.push(serialized);
    }
  }

  return fieldValues;
}

function fingerprintsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

const METADATA_KEYS = [
  'title',
  'description',
  'format',
  'nullable',
  'default',
  'example',
  'examples',
] as const;

function mergeSourceMetadata(
  source: JsonSchema,
  output: JsonSchema,
): JsonSchema {
  const merged: JsonSchema = { ...output };

  if (source.enum !== undefined) {
    merged.enum = mergeEnumValues(source.enum, merged.enum);
  }

  for (const key of METADATA_KEYS) {
    if (source[key] !== undefined && merged[key] === undefined) {
      merged[key] = source[key];
    }
  }

  if (
    source.type === 'object' &&
    output.type === 'object' &&
    source.properties &&
    output.properties
  ) {
    const srcProps = source.properties as Record<string, JsonValue>;
    const outSubProps = {
      ...(output.properties as Record<string, JsonValue>),
    };

    for (const [k, outProp] of Object.entries(outSubProps)) {
      const srcProp = srcProps[k];
      if (isSchemaObject(srcProp) && isSchemaObject(outProp)) {
        outSubProps[k] = mergeSourceMetadata(srcProp, outProp);
      }
    }

    merged.properties = outSubProps;

    const srcRequired = Array.isArray(source.required)
      ? (source.required as string[])
      : [];
    if (srcRequired.length > 0) {
      const presentKeys = new Set(Object.keys(outSubProps));
      const kept = srcRequired.filter(k => presentKeys.has(k));
      if (kept.length > 0) {
        merged.required = kept;
      }
    }
  }

  if (
    source.type === 'array' &&
    output.type === 'array' &&
    isSchemaObject(source.items as JsonValue) &&
    isSchemaObject(output.items as JsonValue)
  ) {
    merged.items = mergeSourceMetadata(
      source.items as JsonSchema,
      output.items as JsonSchema,
    );
  }

  return merged;
}

export function deriveOutputSchema(
  sourceSchema: JsonValue | null | undefined,
  sourceData: JsonValue[],
  outputData: JsonValue[],
): JsonValue {
  const outputShape = getShape(outputData) as JsonSchema;

  if (
    !sourceSchema ||
    typeof sourceSchema !== 'object' ||
    Array.isArray(sourceSchema)
  ) {
    return outputShape;
  }

  const srcSchema = resolveCompositeSchema(sourceSchema as JsonSchema);
  if (outputShape.type !== 'object' || !outputShape.properties) {
    return outputShape;
  }
  if (srcSchema.type !== 'object' && srcSchema.type !== 'array') {
    return outputShape;
  }

  const sharedFingerprintSampleLimit = Math.min(
    sourceData.length,
    outputData.length,
    FINGERPRINT_SAMPLE_LIMIT,
  );
  const sourceFingerprints = buildValueFingerprints(
    sourceData,
    sharedFingerprintSampleLimit,
  );
  const outputFingerprints = buildValueFingerprints(
    outputData,
    sharedFingerprintSampleLimit,
  );
  const outProps = {
    ...(outputShape.properties as Record<string, JsonValue>),
  };

  const mergeOutputProp = (
    outKey: string,
    sourceProp: JsonSchema,
    outputProp: JsonSchema,
  ): void => {
    outProps[outKey] = mergeSourceMetadata(sourceProp, outputProp);
  };

  for (const [outKey, outFp] of outputFingerprints) {
    if (!outFp || outFp.length === 0) {
      continue;
    }

    const outProp = outProps[outKey];
    if (!isSchemaObject(outProp)) {
      continue;
    }

    let mergedWithSource = false;
    for (const [srcKey, srcFp] of sourceFingerprints) {
      if (!srcFp || !fingerprintsMatch(srcFp, outFp)) {
        continue;
      }

      const srcProp = resolveSourceFieldSchema(srcSchema, srcKey, outProp);
      if (!srcProp) {
        continue;
      }

      mergeOutputProp(outKey, srcProp, outProp);
      mergedWithSource = true;
      break;
    }

    if (mergedWithSource) {
      continue;
    }

    const fallbackProp = resolveSourceFieldSchema(srcSchema, outKey, outProp);
    if (!fallbackProp) {
      continue;
    }

    mergeOutputProp(outKey, fallbackProp, outProp);
  }

  const parentProp = outProps._parent;
  if (isSchemaObject(parentProp) && parentProp.type === 'object') {
    const parentValues: JsonValue[] = [];
    for (const item of outputData) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const p = (item as Record<string, unknown>)._parent;
        if (typeof p === 'object' && p !== null && !Array.isArray(p)) {
          parentValues.push(p as JsonValue);
        }
      }
    }
    if (parentValues.length > 0) {
      outProps._parent = deriveOutputSchema(
        sourceSchema,
        sourceData,
        parentValues,
      );
    }
  }

  const adProp = outProps._additionalData;
  if (isSchemaObject(adProp) && adProp.type === 'object' && adProp.properties) {
    const adProps = {
      ...(adProp.properties as Record<string, JsonValue>),
    };
    let changed = false;
    for (const [key, keySchema] of Object.entries(adProps)) {
      if (
        !isSchemaObject(keySchema) ||
        keySchema.type !== 'array' ||
        !isSchemaObject(keySchema.items as JsonValue)
      ) {
        continue;
      }
      const nestedItems: JsonValue[] = [];
      for (const item of outputData) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          continue;
        }
        const ad = (item as Record<string, unknown>)._additionalData;
        if (typeof ad !== 'object' || ad === null || Array.isArray(ad)) {
          continue;
        }
        const arr = (ad as Record<string, unknown>)[key];
        if (Array.isArray(arr)) {
          for (const el of arr) {
            nestedItems.push(el as JsonValue);
          }
        }
      }
      if (nestedItems.length > 0) {
        const derivedItemSchema = deriveOutputSchema(
          sourceSchema,
          sourceData,
          nestedItems,
        );
        adProps[key] = { type: 'array', items: derivedItemSchema };
        changed = true;
      }
    }
    if (changed) {
      outProps._additionalData = { ...adProp, properties: adProps };
    }
  }

  const result: JsonSchema = { ...outputShape, properties: outProps };

  if (srcSchema.type === 'object' && Array.isArray(srcSchema.required)) {
    const outKeys = new Set(Object.keys(outProps));
    const kept = (srcSchema.required as string[]).filter(k => outKeys.has(k));
    if (kept.length > 0) {
      result.required = kept;
    }
  }

  return result;
}
