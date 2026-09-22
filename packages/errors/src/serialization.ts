/*
 * Copyright 2021 The Backstage Authors
 * Modifications copyright 2024 Larder Software Limited
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
 *
 * Derived from Backstage (https://github.com/backstage/backstage),
 * packages/errors/src/serialization/error.ts at v1.47.1, and modified.
 */

import {
  serializeError as serializeErrorLib,
  deserializeError as deserializeErrorLib,
} from 'serialize-error';
import { isError } from './assertion';
import type {
  SerializedError,
  ErrorResponseBody,
  ConsumedResponse,
} from './types';

/**
 * Serializes an error object to a JSON friendly form.
 */
export function serializeError(
  error: Error,
  options?: { includeStack?: boolean },
): SerializedError {
  const serialized = serializeErrorLib(error);
  const result: SerializedError = {
    name: 'Unknown',
    message: '<no reason given>',
    ...serialized,
  };

  if (!options?.includeStack) {
    delete result.stack;
    if (
      result.cause &&
      typeof result.cause === 'object' &&
      'stack' in result.cause
    ) {
      delete (result.cause as { stack?: string }).stack;
    }
  }

  return result;
}

/**
 * Deserializes a serialized error object back to an Error.
 */
export function deserializeError<T extends Error = Error>(
  data: SerializedError,
): T {
  const result = deserializeErrorLib(data) as T;
  if (!data.stack) {
    result.stack = undefined;
  }
  return result;
}

/**
 * Stringifies an error, including its name and message where available.
 */
export function stringifyError(error: unknown): string {
  if (isError(error)) {
    const str = String(error);
    return str !== '[object Object]' ? str : `${error.name}: ${error.message}`;
  }
  return `unknown error '${error}'`;
}

/**
 * Parses an error response body from a failed server request.
 */
export async function parseErrorResponseBody(
  response: ConsumedResponse & { text(): Promise<string> },
): Promise<ErrorResponseBody> {
  try {
    const text = await response.text();
    if (text) {
      if (
        response.headers.get('content-type')?.startsWith('application/json')
      ) {
        try {
          const body = JSON.parse(text);
          if (body.error && body.response) {
            return body;
          }
        } catch {
          // ignore parse errors
        }
      }
      return {
        error: {
          name: 'Error',
          message: `Request failed with status ${response.status} ${response.statusText}, ${text}`,
        },
        response: {
          statusCode: response.status,
        },
      };
    }
  } catch {
    // ignore errors
  }

  return {
    error: {
      name: 'Error',
      message: `Request failed with status ${response.status} ${response.statusText}`,
    },
    response: {
      statusCode: response.status,
    },
  };
}
