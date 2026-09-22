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

module.exports = {
  name: 'Argo CD applications',
  description:
    'List all Argo CD applications visible to the token, including sync and health status. Argo CD list endpoints return the full item set in one response (no pagination).',
  integrationSlug: 'argocd',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 1, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-applications',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/api/v1/applications',
            method: 'GET',
            arrayExpression: 'items',
            objectIdExpression: 'metadata.name',
          },
          'List applications',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'metadata.name', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-applications'),
        edge('e2', 'list-applications', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
