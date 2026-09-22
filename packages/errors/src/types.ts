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
 * packages/errors/src/serialization/response.ts at v1.47.1, and modified.
 */

import type { JsonObject } from '@roadiehq/types';

/**
 * An object that is shaped like an Error.
 */
export type ErrorLike = {
  name: string;
  message: string;
  stack?: string;
  [unknownKeys: string]: unknown;
};

/**
 * The serialized form of an Error.
 */
export type SerializedError = JsonObject & {
  name: string;
  message: string;
  stack?: string;
  code?: string;
};

/**
 * A standard shape of JSON data returned as the body of backend errors.
 */
export type ErrorResponseBody = {
  error: SerializedError;
  request?: {
    method: string;
    url: string;
  };
  response: {
    statusCode: number;
  };
};

/**
 * ConsumedResponse represents a Response that is known to have been consumed.
 */
export type ConsumedResponse = {
  readonly headers: {
    get(name: string): string | null;
  };
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
};
