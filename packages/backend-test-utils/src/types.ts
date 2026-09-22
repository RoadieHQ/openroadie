/*
 * Copyright 2025 Larder Software Ltd.
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

import type { ServiceFactory } from '@roadiehq/extensions-api';

/**
 * A type representing a mocked service with its implementation and factory.
 *
 * @public
 */
export type ServiceMock<TService> = {
  /**
   * The mocked service implementation.
   */
  mock(partialImpl?: Partial<TService>): TService;
  /**
   * Creates a service factory that returns this mock.
   */
  factory(options?: { data?: unknown }): ServiceFactory;
};

/**
 * The possible databases to test against.
 *
 * @public
 */
export type TestDatabaseId =
  | 'POSTGRES_17'
  | 'POSTGRES_16'
  | 'POSTGRES_15'
  | 'POSTGRES_13'
  | 'SQLITE_3';
