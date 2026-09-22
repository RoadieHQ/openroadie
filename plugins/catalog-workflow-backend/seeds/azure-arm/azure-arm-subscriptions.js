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
  name: 'Azure subscriptions',
  description:
    'List Azure subscriptions visible to the service principal via Azure Resource Manager.',
  integrationSlug: 'azure-arm',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-subscriptions',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/subscriptions?api-version=2022-12-01',
            method: 'GET',
            arrayExpression: 'value',
            objectIdExpression: '$string(subscriptionId)',
            pagination: {
              type: 'body-link',
              nextLinkExpression: 'nextLink',
              perPageParam: '$top',
              perPage: 100,
            },
          },
          'List subscriptions',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: '$string(subscriptionId)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-subscriptions'),
        edge('e2', 'list-subscriptions', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
