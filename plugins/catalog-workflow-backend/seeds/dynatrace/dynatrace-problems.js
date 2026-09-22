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
  name: 'Dynatrace problems (last 30 days)',
  description:
    'List detected problems from the Dynatrace Problems API v2 over the last 30 days, including status, severity, and impact level.',
  integrationSlug: 'dynatrace',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 1, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-problems',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/api/v2/problems',
            method: 'GET',
            queryParams: {
              from: 'now-30d',
              pageSize: '500',
            },
            arrayExpression: 'problems',
            objectIdExpression: 'problemId',
          },
          'List problems',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'problemId', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-problems'),
        edge('e2', 'list-problems', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
