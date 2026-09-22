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
  name: 'Google Workspace groups',
  description:
    'List all Google Workspace groups in the customer account via the Admin SDK Directory API.',
  integrationSlug: 'gcp-workspace',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-groups',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/admin/directory/v1/groups',
            method: 'GET',
            queryParams: { customer: 'my_customer', maxResults: '200' },
            arrayExpression: 'groups',
            objectIdExpression: 'id',
            pagination: {
              type: 'cursor',
              cursorParam: 'pageToken',
              nextCursorExpression: 'nextPageToken',
            },
          },
          'List groups',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-groups'),
        edge('e2', 'list-groups', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
