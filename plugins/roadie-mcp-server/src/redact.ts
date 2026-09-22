/*
 * Copyright 2026 Larder Software Ltd.
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
const SENSITIVE_KEYS = new Set([
  'authorization',
  'token',
  'secret',
  'password',
]);

export function redactSensitiveValues(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!input) return undefined;
  return redactValue(input) as Record<string, unknown>;
}

/**
 * Recursively redact sensitive keys from any JSON-serialisable value. Unlike
 * {@link redactSensitiveValues} this also walks arrays, so it can be used for
 * tool output (which is typically an array of content blocks).
 */
export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[`${key}`] = SENSITIVE_KEYS.has(key.toLowerCase())
        ? '[REDACTED]'
        : redactValue(val);
    }
    return result;
  }
  return value;
}
