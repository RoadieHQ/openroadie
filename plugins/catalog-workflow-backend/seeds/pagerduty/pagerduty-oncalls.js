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
  name: 'PagerDuty on-calls',
  description:
    'List current on-call entries showing who is on-call for each escalation policy level.',
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
          'list-oncalls',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/oncalls',
            method: 'GET',
            arrayExpression: 'oncalls',
            objectIdExpression:
              '`${escalation_policy.id}-${escalation_level}-${user.id}`',
            pagination: {
              type: 'offset',
              offsetParam: 'offset',
              limitParam: 'limit',
              limit: 100,
            },
          },
          'List on-calls',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          {
            id_selector:
              '`${escalation_policy.id}-${escalation_level}-${user.id}`',
            items_selector: '$',
          },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-oncalls'),
        edge('e2', 'list-oncalls', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
