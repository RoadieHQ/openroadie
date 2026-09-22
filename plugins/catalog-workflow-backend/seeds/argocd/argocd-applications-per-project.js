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
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Argo CD applications (per project)',
  description:
    'List applications scoped per AppProject by chaining projects to /api/v1/applications?projects=<name>. Argo CD list endpoints return the full item set in one response (no pagination).',
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
          'list-projects',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/api/v1/projects',
            method: 'GET',
            arrayExpression: 'items',
            objectIdExpression: 'metadata.name',
          },
          'List projects',
        ),
        chainedSourceNode(
          'list-applications',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/api/v1/applications?projects={{metadata.name}}',
            method: 'GET',
            arrayExpression: 'items',
            objectIdExpression: 'metadata.name',
            resultMode: 'flatten',
          },
          'List applications per project',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: 'metadata.name', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-projects'),
        edge('e2', 'list-projects', 'list-applications'),
        edge('e3', 'list-applications', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
