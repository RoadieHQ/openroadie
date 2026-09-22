/*
 * Copyright 2026 Larder Software Limited
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

import type { JsonObject, JsonValue } from '@roadiehq/types';
import type { LargePayloadWarning } from '@roadiehq/catalog-workflow-common';

export const LARGE_DATASTORE_VALUE_BYTES = 100_000;

interface OversizedNestedValue {
  path: string;
  bytes: number;
}

export interface PreparedDatastoreObject {
  object: JsonObject;
  originalBytes: number;
  storedBytes: number;
  oversizedNestedValues: OversizedNestedValue[];
  removedKubernetesManagedFields: boolean;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nestedPath(path: string, key: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
    return path ? `${path}.${key}` : key;
  }
  return `${path}[${JSON.stringify(key)}]`;
}

function analyzeJsonValue(
  value: JsonValue,
  path: string,
  isRoot = false,
): { bytes: number; oversizedNestedValues: OversizedNestedValue[] } {
  if (Array.isArray(value)) {
    const children = value.map((child, index) =>
      analyzeJsonValue(child, `${path}[${index}]`),
    );
    const bytes =
      2 +
      Math.max(0, value.length - 1) +
      children.reduce((total, child) => total + child.bytes, 0);
    const oversizedNestedValues = children.flatMap(
      child => child.oversizedNestedValues,
    );

    if (
      !isRoot &&
      bytes > LARGE_DATASTORE_VALUE_BYTES &&
      oversizedNestedValues.length === 0
    ) {
      oversizedNestedValues.push({ path, bytes });
    }
    return { bytes, oversizedNestedValues };
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).flatMap(([key, child]) =>
      child === undefined
        ? []
        : [
            {
              key,
              analysis: analyzeJsonValue(child, nestedPath(path, key)),
            },
          ],
    );
    const bytes =
      2 +
      Math.max(0, entries.length - 1) +
      entries.reduce(
        (total, entry) =>
          total +
          Buffer.byteLength(JSON.stringify(entry.key), 'utf8') +
          1 +
          entry.analysis.bytes,
        0,
      );
    const oversizedNestedValues = entries.flatMap(
      entry => entry.analysis.oversizedNestedValues,
    );

    if (
      !isRoot &&
      bytes > LARGE_DATASTORE_VALUE_BYTES &&
      oversizedNestedValues.length === 0
    ) {
      oversizedNestedValues.push({ path, bytes });
    }
    return { bytes, oversizedNestedValues };
  }

  const serialized = JSON.stringify(value);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  return {
    bytes,
    oversizedNestedValues:
      !isRoot && bytes > LARGE_DATASTORE_VALUE_BYTES ? [{ path, bytes }] : [],
  };
}

export function prepareDatastoreObject(
  object: JsonObject,
): PreparedDatastoreObject {
  const analysis = analyzeJsonValue(object, '', true);
  const originalBytes = analysis.bytes;
  const metadata = object.metadata;
  const isKubernetesObject =
    typeof object.apiVersion === 'string' &&
    typeof object.kind === 'string' &&
    isJsonObject(metadata);

  if (!isKubernetesObject || !('managedFields' in metadata)) {
    return {
      object,
      originalBytes,
      storedBytes: originalBytes,
      oversizedNestedValues: analysis.oversizedNestedValues,
      removedKubernetesManagedFields: false,
    };
  }

  const { managedFields: _managedFields, ...metadataWithoutManagedFields } =
    metadata;
  const preparedObject: JsonObject = {
    ...object,
    metadata: metadataWithoutManagedFields,
  };

  return {
    object: preparedObject,
    originalBytes,
    storedBytes: Buffer.byteLength(JSON.stringify(preparedObject), 'utf8'),
    oversizedNestedValues: analysis.oversizedNestedValues,
    removedKubernetesManagedFields: true,
  };
}

export interface DatastorePayloadDiagnostics {
  affectedObjectCount: number;
  oversizedValueCount: number;
  largestValueBytes: number;
  largestValuePath: string;
  kubernetesObjectsCleaned: number;
  bytesRemoved: number;
}

export function updateDatastorePayloadDiagnostics(
  diagnostics: DatastorePayloadDiagnostics,
  prepared: PreparedDatastoreObject,
): void {
  if (prepared.oversizedNestedValues.length > 0) {
    diagnostics.affectedObjectCount += 1;
    diagnostics.oversizedValueCount += prepared.oversizedNestedValues.length;
    for (const value of prepared.oversizedNestedValues) {
      if (value.bytes > diagnostics.largestValueBytes) {
        diagnostics.largestValueBytes = value.bytes;
        diagnostics.largestValuePath = value.path;
      }
    }
  }
  if (prepared.removedKubernetesManagedFields) {
    diagnostics.kubernetesObjectsCleaned += 1;
    diagnostics.bytesRemoved += prepared.originalBytes - prepared.storedBytes;
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
  return `${Math.ceil(bytes / 1_000)} KB`;
}

export async function logDatastorePayloadDiagnostics(
  diagnostics: DatastorePayloadDiagnostics,
  log: (
    level: 'info' | 'warn',
    message: string,
    metadata?: JsonObject,
  ) => Promise<void>,
): Promise<LargePayloadWarning | undefined> {
  const cleanup =
    diagnostics.kubernetesObjectsCleaned > 0
      ? ` Removed metadata.managedFields from ${diagnostics.kubernetesObjectsCleaned} Kubernetes object(s), reducing stored data by ${formatBytes(diagnostics.bytesRemoved)}.`
      : '';

  if (diagnostics.oversizedValueCount > 0) {
    const warning: LargePayloadWarning = {
      code: 'large-data-source-payload',
      affectedObjectCount: diagnostics.affectedObjectCount,
      oversizedValueCount: diagnostics.oversizedValueCount,
      thresholdBytes: LARGE_DATASTORE_VALUE_BYTES,
      largestValueBytes: diagnostics.largestValueBytes,
      largestValuePath: diagnostics.largestValuePath,
      kubernetesObjectsCleaned: diagnostics.kubernetesObjectsCleaned,
      bytesRemoved: diagnostics.bytesRemoved,
    };
    await log(
      'warn',
      `Large data-source payload: ${diagnostics.oversizedValueCount} nested field(s) exceeded ${formatBytes(LARGE_DATASTORE_VALUE_BYTES)} across ${diagnostics.affectedObjectCount} object(s); the largest was ${diagnostics.largestValuePath} at ${formatBytes(diagnostics.largestValueBytes)}.${cleanup}`,
      { ...warning },
    );
    return warning;
  }

  if (cleanup) {
    await log('info', cleanup.trim());
  }
  return undefined;
}
