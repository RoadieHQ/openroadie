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
  name: 'PagerDuty incidents',
  description:
    'List recent PagerDuty incidents (any status) and store them in the datastore.',
  integrationSlug: 'pagerduty',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 1, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-incidents',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/incidents?statuses%5B%5D=triggered&statuses%5B%5D=acknowledged&statuses%5B%5D=resolved',
            method: 'GET',
            // PagerDuty responses are { incidents: [...], more, offset, ... }
            arrayExpression: 'incidents',
            objectIdExpression: 'id',
            pagination: {
              type: 'offset',
              offsetParam: 'offset',
              limitParam: 'limit',
              limit: 100,
            },
          },
          'List incidents',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-incidents'),
        edge('e2', 'list-incidents', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
