/*
 * Copyright 2024 Larder Software Ltd.
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

/**
 * Base class for custom errors that properly captures stack traces.
 */
export class CustomErrorBase extends Error {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * An error indicating a conflict, typically a 409 response.
 */
export class ConflictError extends CustomErrorBase {
  readonly name = 'ConflictError';
}

/**
 * An error indicating something was not found, typically a 404 response.
 */
export class NotFoundError extends CustomErrorBase {
  readonly name = 'NotFoundError';
}

/**
 * An error indicating bad input from the user, typically a 400 response.
 */
export class InputError extends CustomErrorBase {
  readonly name = 'InputError';
}

/**
 * An error that wraps another error, forwarding its message.
 */
export class ForwardedError extends CustomErrorBase {
  readonly name = 'ForwardedError';
  readonly cause: Error;

  constructor(message: string, cause: Error) {
    super(`${message}: ${cause.message}`);
    this.cause = cause;
  }
}

/**
 * Type guard to check if a value is an Error.
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

/**
 * Asserts that a value is an Error, throwing if not.
 */
export function assertError(value: unknown): asserts value is Error {
  if (!isError(value)) {
    throw new Error(`Expected error, got ${typeof value}`);
  }
}

/**
 * Converts an error to a string message.
 */
export function stringifyError(error: unknown): string {
  if (isError(error)) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

/**
 * Serialized error structure.
 */
export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
}

/**
 * Serializes an error to a plain object suitable for JSON.
 */
export function serializeError(
  error: Error,
  options?: { includeStack?: boolean },
): SerializedError {
  const { includeStack = false } = options ?? {};

  const serialized: SerializedError = {
    name: error.name,
    message: error.message,
  };

  if (includeStack && error.stack) {
    serialized.stack = error.stack;
  }

  if ('cause' in error && isError(error.cause)) {
    serialized.cause = serializeError(error.cause, options);
  }

  return serialized;
}
