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
  name: 'GitLab deployments',
  description:
    'List the 50 most recent deployments per project (sorted by created_at). Chains from projects to /projects/:id/deployments.',
  integrationSlug: 'gitlab',

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
            path: '/api/v4/projects',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: '$string(id)',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'List projects',
        ),
        chainedSourceNode(
          'list-deployments',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/api/v4/projects/{{id}}/deployments?per_page=50&sort=desc&order_by=created_at',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: '$string(id)',
            resultMode: 'flatten',
            pagination: { type: 'none' },
          },
          'List recent deployments',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: '$string(id)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-projects'),
        edge('e2', 'list-projects', 'list-deployments'),
        edge('e3', 'list-deployments', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
