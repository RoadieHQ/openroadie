/*
 * Copyright 2025 Larder Software Limited
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

import {
  DiscoveryService,
  type InternalFetchApi,
} from '@roadiehq/extensions-api';
import { EventsService } from '@roadiehq/backend-defaults';
import { RegisteredNodeType } from '../engine';
import {
  buildDatastoreSource,
  chainedSourceNode,
  integrationSourceNode,
} from './sources';
import { filterNode, flatmapNode, mapNode, buildMergeNode } from './transforms';
import { buildDatastoreSink } from './sinks';
import { scheduleTriggerNode } from './triggers';
import { CatalogDatastoreService } from '@roadiehq/catalog-datastore-node';
import type { CatalogDatastoreApi } from '@roadiehq/catalog-datastore-common';

interface BuildNodesOptions {
  datastore: CatalogDatastoreService;
  discovery: DiscoveryService;
  events: EventsService;
  catalogDatastoreClient?: Pick<
    CatalogDatastoreApi,
    'listIndexConfigurations' | 'createIndexConfiguration'
  >;
  /** Service-identity fetch for internal calls (`internalFetchServiceRef.asService()`), never the ambient caller's credentials. */
  fetchApi: InternalFetchApi;
}

const builtInNodes: Array<
  RegisteredNodeType | ((opts: BuildNodesOptions) => RegisteredNodeType)
> = [
  scheduleTriggerNode,
  integrationSourceNode,
  buildDatastoreSource,
  chainedSourceNode,
  filterNode,
  mapNode,
  flatmapNode,
  buildMergeNode,
  buildDatastoreSink,
];

export const buildNodes = async (
  opts: BuildNodesOptions,
): Promise<RegisteredNodeType[]> => {
  return builtInNodes.map(node => {
    if (typeof node === 'function') {
      return node(opts);
    }
    return node;
  });
};

export * from './sources';
export * from './transforms';
export * from './sinks';
export * from './triggers';
