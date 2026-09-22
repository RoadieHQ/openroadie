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
 * packages/frontend-plugin-api/src/apis/definitions/ErrorApi.ts at v1.47.1, and modified.
 */

import type { Observable } from '@roadiehq/types';

/**
 * Mirrors the JavaScript Error class.
 */
export type ErrorApiError = {
  name: string;
  message: string;
  stack?: string;
};

/**
 * Provides additional information about an error that was posted to the application.
 */
export type ErrorApiErrorContext = {
  /**
   * If set to true, this error should not be displayed to the user.
   *
   * @defaultValue false
   */
  hidden?: boolean;
};

/**
 * The error API is used to report errors to the app, and display them to the user.
 */
export type ErrorApi = {
  /**
   * Post an error for handling by the application.
   */
  post(error: ErrorApiError, context?: ErrorApiErrorContext): void;

  /**
   * Observe errors posted by other parts of the application.
   */
  error$(): Observable<{
    error: ErrorApiError;
    context?: ErrorApiErrorContext;
  }>;
};
