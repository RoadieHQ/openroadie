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

/**
 * @roadiehq/backend-test-utils - Test helpers for Roadie backends
 *
 * This package provides utilities for testing Roadie backend plugins,
 * including mock services and test database management.
 */

export { mockServices } from './mockServices';
export { TestDatabases } from './testDatabases';
export { startTestBackend } from './startTestBackend';

export type { ServiceMock, TestDatabaseId } from './types';
export type {
  ExtendedHttpServer,
  TestBackend,
  TestBackendOptions,
} from './startTestBackend';
