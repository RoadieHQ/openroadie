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
  name: 'LaunchDarkly members',
  description:
    'List all account members in the LaunchDarkly organization including roles and team assignments.',
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
          'list-members',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/api/v2/members',
            method: 'GET',
            arrayExpression: 'items',
            objectIdExpression: '_id',
            pagination: {
              type: 'offset',
              offsetParam: 'offset',
              limitParam: 'limit',
              limit: 20,
            },
          },
          'List members',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: '_id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-members'),
        edge('e2', 'list-members', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
