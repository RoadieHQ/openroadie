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
  name: 'LaunchDarkly metrics',
  description:
    'List metrics (custom events and experiments) across all projects. Chains from projects to /api/v2/metrics/:projectKey.',
  integrationSlug: 'launchdarkly',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-projects',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/api/v2/projects',
            method: 'GET',
            arrayExpression: 'items',
            objectIdExpression: 'key',
          },
          'List projects',
        ),
        chainedSourceNode(
          'list-metrics',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/api/v2/metrics/{{key}}',
            method: 'GET',
            arrayExpression: 'items',
            objectIdExpression: 'key',
            resultMode: 'flatten',
          },
          'List metrics per project',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: 'key', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-projects'),
        edge('e2', 'list-projects', 'list-metrics'),
        edge('e3', 'list-metrics', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
