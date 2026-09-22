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
 * packages/errors/src/errors/ResponseError.ts at v1.47.1, and modified.
 */

import { deserializeError, parseErrorResponseBody } from './serialization';
import type { ErrorResponseBody, ConsumedResponse } from './types';

/**
 * An error thrown as the result of a failed server request.
 */
export class ResponseError extends Error {
  readonly response: ConsumedResponse;
  readonly body: ErrorResponseBody;
  readonly cause: Error;
  readonly statusCode: number;
  readonly statusText: string;

  static async fromResponse(
    response: ConsumedResponse & { text(): Promise<string> },
  ): Promise<ResponseError> {
    const data = await parseErrorResponseBody(response);
    const statusCode = data.response.statusCode || response.status;
    const statusText = response.statusText;
    const message = `Request failed with ${statusCode} ${statusText}`;
    const cause = deserializeError(data.error);

    return new ResponseError({
      message,
      response,
      data,
      cause,
      statusCode,
      statusText,
    });
  }

  private constructor(opts: {
    message: string;
    response: ConsumedResponse;
    data: ErrorResponseBody;
    cause: Error;
    statusCode: number;
    statusText: string;
  }) {
    super(opts.message);
    this.name = 'ResponseError';
    this.response = opts.response;
    this.body = opts.data;
    this.cause = opts.cause;
    this.statusCode = opts.statusCode;
    this.statusText = opts.statusText;
  }
}
