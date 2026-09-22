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

import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@roadiehq/ui/alert';
import type {
  ExecutionLog,
  LargePayloadWarning,
} from '../../api/workflow/workflow-client';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseLargePayloadWarning(
  value: unknown,
): LargePayloadWarning | undefined {
  if (!isRecord(value) || value.code !== 'large-data-source-payload') {
    return undefined;
  }
  const {
    affectedObjectCount,
    oversizedValueCount,
    thresholdBytes,
    largestValueBytes,
    largestValuePath,
    kubernetesObjectsCleaned,
    bytesRemoved,
  } = value;
  if (
    typeof affectedObjectCount !== 'number' ||
    typeof oversizedValueCount !== 'number' ||
    typeof thresholdBytes !== 'number' ||
    typeof largestValueBytes !== 'number' ||
    typeof largestValuePath !== 'string' ||
    typeof kubernetesObjectsCleaned !== 'number' ||
    typeof bytesRemoved !== 'number'
  ) {
    return undefined;
  }
  return {
    code: 'large-data-source-payload',
    affectedObjectCount,
    oversizedValueCount,
    thresholdBytes,
    largestValueBytes,
    largestValuePath,
    kubernetesObjectsCleaned,
    bytesRemoved,
  };
}

export function largePayloadWarningFromLogs(
  logs: ExecutionLog[],
): LargePayloadWarning | undefined {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const warning = parseLargePayloadWarning(logs.at(index)?.metadata);
    if (warning) {
      return warning;
    }
  }
  return undefined;
}

export function formatPayloadBytes(bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
  return `${Math.ceil(bytes / 1_000)} KB`;
}

export function largePayloadWarningMessage(
  warning: LargePayloadWarning,
): string {
  const received = `${warning.oversizedValueCount} nested field${warning.oversizedValueCount === 1 ? '' : 's'} exceeded ${formatPayloadBytes(warning.thresholdBytes)} across ${warning.affectedObjectCount} object${warning.affectedObjectCount === 1 ? '' : 's'}. Largest: ${warning.largestValuePath} (${formatPayloadBytes(warning.largestValueBytes)}).`;
  if (warning.kubernetesObjectsCleaned === 0) {
    return received;
  }
  return `${received} Removed Kubernetes managedFields from ${warning.kubernetesObjectsCleaned} object${warning.kubernetesObjectsCleaned === 1 ? '' : 's'}, saving ${formatPayloadBytes(warning.bytesRemoved)} before storage.`;
}

export function LargePayloadAlert({
  warning,
}: {
  warning: LargePayloadWarning;
}) {
  return (
    <Alert variant="default" className="border-warning/40 bg-warning/10">
      <AlertTriangle className="size-4 text-warning" />
      <AlertTitle>Large payload detected</AlertTitle>
      <AlertDescription>{largePayloadWarningMessage(warning)}</AlertDescription>
    </Alert>
  );
}
