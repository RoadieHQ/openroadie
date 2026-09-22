/* Copyright 2025 Larder Software Ltd.
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
import { createToolsetRef } from '@roadiehq/ai-node';

export const richEntityMcpClientToolsetRef = createToolsetRef({
  id: 'rich-catalog-entity',
});

export const roadieMdxMcpClientRef = createToolsetRef({
  id: 'roadie-mdx',
});

export const apiDocsQueryMcpClientToolsetRef = createToolsetRef({
  id: 'api-docs-query',
});

export const backendConfigModuleMcpClientToolsetRef = createToolsetRef({
  id: 'backend-config-module',
});

export const catalogDecoratorsModuleMcpClientToolsetRef = createToolsetRef({
  id: 'catalog-decorators-module',
});

export const scaffolderUseMcpClientToolsetRef = createToolsetRef({
  id: 'scaffolder-use',
});

export const techInsightsFactsMcpClientToolsetRef = createToolsetRef({
  id: 'tech-insights-facts',
});

export const templateCreateMcpClientToolsetRef = createToolsetRef({
  id: 'template-create',
});

export const docsSearchMcpClientToolsetRef = createToolsetRef({
  id: 'docs-search',
});

export const catalogDatastoreModuleMcpClientToolsetRef = createToolsetRef({
  id: 'catalog-datastore-module',
});
