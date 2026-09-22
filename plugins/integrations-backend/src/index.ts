/*
 * Copyright 2026 Larder Software Limited
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

export {
  integrationsPlugin as default,
  integrationsPlugin,
  integrationClientServiceRef,
} from './plugin';
export {
  integrationClientServiceFactory,
  integrationsRouterPlugin,
} from './modules';
export { createRouter } from './api/router';
export { GithubAppService } from './service/GithubAppService';
export type { GithubAppServiceOptions } from './service/GithubAppService';
export * from './database';
export { IntegrationClient } from './client/IntegrationClient';
export type {
  PaginationType,
  CursorPaginationConfig,
  PagePaginationConfig,
  OffsetPaginationConfig,
  LinkHeaderPaginationConfig,
  BodyLinkPaginationConfig,
  NoPaginationConfig,
  PaginationConfig,
  PageResult,
  RequestOptions,
  HttpRequestOptions,
} from './client/IntegrationClient';
export { SchemaProcessor } from './processors';
export type { SpecParser, ParsedPathSchema } from './processors';
