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

const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');
const { K8S_LIST_PAGINATION } = require('./helpers');

module.exports = {
  name: 'Kubernetes services (all namespaces)',
  description:
    'List Services across all namespaces. Connects workloads to their in-cluster network identity via selectors and ports.',
  integrationSlug: 'kubernetes',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 1, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-services',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/api/v1/services',
            method: 'GET',
            queryParams: { limit: '500' },
            arrayExpression: 'items',
            objectIdExpression: 'metadata.uid',
            pagination: K8S_LIST_PAGINATION,
          },
          'List services',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'metadata.uid', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-services'),
        edge('e2', 'list-services', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
