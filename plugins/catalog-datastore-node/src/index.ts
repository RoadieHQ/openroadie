/*
 * Copyright 2026 Larder Software Ltd.
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

import { createServiceRef } from '@roadiehq/extensions-api';
import { JsonObject, JsonValue } from '@roadiehq/types';
import type { DuplicateObjectIdStrategy } from '@roadiehq/catalog-datastore-common';
import type { PublishDelta } from './publish-core';

export { canonicalJsonHash } from './canonical-json-hash';
export {
  diffMergePublish,
  restampUnchangedSchemaIds,
  upsertSchemaVersion,
} from './publish-core';
export type { PublishSourceRelation, PublishDelta } from './publish-core';

export interface DatastoreItem {
  datasourceId: string;
  objectId: string;
  object: JsonObject;
}

export type { DuplicateObjectIdStrategy };

export interface CatalogDatastoreService {
  replaceDatasourceItems(
    datasourceId: string,
    items: DatastoreItem[],
    options?: {
      workspaceId?: string;
      datasourceName?: string;
      schema?: JsonValue;
      duplicateObjectIdStrategy?: DuplicateObjectIdStrategy;
    },
  ): Promise<PublishDelta & { itemCount: number }>;

  getDatasourceItems(
    datasourceId: string,
    options?: { workspaceId?: string; limit?: number; offset?: number },
  ): Promise<{ items: JsonObject[]; total: number }>;
}

export const catalogDatastoreServiceRef =
  createServiceRef<CatalogDatastoreService>({
    id: 'roadie.catalogDatastoreService',
    scope: 'plugin',
  });
