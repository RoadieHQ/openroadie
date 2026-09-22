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
import { JsonObject, JsonValue } from '@roadiehq/types';

export const isJsonObjectArray = (
  input: unknown,
): input is Required<JsonObject>[] => {
  if (!Array.isArray(input)) {
    return false;
  }

  return input.every((item): item is JsonObject => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return false;
    }

    // Ensure all values are valid JsonValue (recursive)
    const isJsonValue = (v: unknown): v is Required<JsonValue> => {
      if (
        v === null ||
        typeof v === 'string' ||
        typeof v === 'number' ||
        typeof v === 'boolean'
      ) {
        return true;
      }
      if (Array.isArray(v)) {
        return v.every(isJsonValue);
      }
      if (typeof v === 'object') {
        return Object.values(v as Record<string, unknown>).every(isJsonValue);
      }
      return false;
    };

    return Object.values(item as Record<string, unknown>).every(isJsonValue);
  });
};
