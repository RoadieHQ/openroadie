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
  name: 'Google Workspace group members (per group)',
  description:
    'List members of every Google Workspace group by chaining the Admin SDK groups list to per-group members.',
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
        chainedSourceNode(
          'list-members',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/admin/directory/v1/groups/{{id}}/members?maxResults=200',
            method: 'GET',
            arrayExpression: 'members',
            objectIdExpression: 'id',
            resultMode: 'flatten',
            pagination: {
              type: 'cursor',
              cursorParam: 'pageToken',
              nextCursorExpression: 'nextPageToken',
            },
          },
          'List members per group',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: '_parent.id & ":" & id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-groups'),
        edge('e2', 'list-groups', 'list-members'),
        edge('e3', 'list-members', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
