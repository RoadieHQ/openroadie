/*
 * Copyright 2020 The Backstage Authors
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
 * packages/errors/src/errors/common.ts at v1.47.1, and modified.
 */

import { CustomErrorBase } from './CustomErrorBase';
import { isError } from './assertion';

/**
 * The given inputs are malformed and cannot be processed.
 */
export class InputError extends CustomErrorBase {
  name = 'InputError' as const;
}

/**
 * The request requires authentication, which was not properly supplied.
 */
export class AuthenticationError extends CustomErrorBase {
  name = 'AuthenticationError' as const;
}

/**
 * The authenticated caller is not allowed to perform this request.
 */
export class NotAllowedError extends CustomErrorBase {
  name = 'NotAllowedError' as const;
}

/**
 * The requested resource could not be found.
 */
export class NotFoundError extends CustomErrorBase {
  name = 'NotFoundError' as const;
}

/**
 * The request could not complete due to a conflict in the current state.
 */
export class ConflictError extends CustomErrorBase {
  name = 'ConflictError' as const;
}

/**
 * The requested resource has not changed since last request.
 */
export class NotModifiedError extends CustomErrorBase {
  name = 'NotModifiedError' as const;
}

/**
 * The server does not support the functionality required to fulfill the request.
 */
export class NotImplementedError extends CustomErrorBase {
  name = 'NotImplementedError' as const;
}

/**
 * The server is not ready to handle the request.
 */
export class ServiceUnavailableError extends CustomErrorBase {}

/**
 * An error that forwards an underlying cause with additional context.
 */
export class ForwardedError extends CustomErrorBase {
  constructor(message: string, cause: Error | unknown) {
    super(message, cause);
    this.name = isError(cause) ? cause.name : 'Error';
  }
}

export class HttpIntegrationResponseError extends CustomErrorBase {
  readonly name = 'HttpIntegrationResponseError' as const;
  readonly statusCode: number;
  readonly statusText: string;

  constructor(options: {
    statusCode: number;
    statusText: string;
    responseBody?: string;
  }) {
    const { statusCode, statusText, responseBody } = options;
    const snippet =
      responseBody && responseBody.length > 500
        ? `${responseBody.slice(0, 500)}…`
        : responseBody;
    super(
      `Request failed: ${statusCode} ${statusText}${snippet ? ` - ${snippet}` : ''}`,
    );
    this.statusCode = statusCode;
    this.statusText = statusText;
  }
}
