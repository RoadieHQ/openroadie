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
 * packages/errors/src/errors/assertion.ts at v1.47.1, and modified.
 */

import type { ErrorLike } from './types';

/**
 * Checks whether an unknown value is an ErrorLike object.
 */
export function isError(value: unknown): value is ErrorLike {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const maybe = value as ErrorLike;
  if (typeof maybe.name !== 'string' || maybe.name === '') {
    return false;
  }
  if (typeof maybe.message !== 'string') {
    return false;
  }

  return true;
}

/**
 * Asserts that an unknown value is an ErrorLike object.
 */
export function assertError(value: unknown): asserts value is ErrorLike {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Encountered invalid error, not an object, got '${value}'`);
  }

  const maybe = value as ErrorLike;
  if (typeof maybe.name !== 'string' || maybe.name === '') {
    throw new Error(`Encountered error object without a name, got '${value}'`);
  }
  if (typeof maybe.message !== 'string') {
    throw new Error(
      `Encountered error object without a message, got '${value}'`,
    );
  }
}
