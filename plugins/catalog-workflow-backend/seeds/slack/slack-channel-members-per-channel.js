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
  name: 'Slack channel members (per channel)',
  description:
    'List member user IDs for each public Slack channel. Chains from conversations.list to conversations.members. Each row is one channel/user membership with the channel in _parent.',
  integrationSlug: 'slack',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 1, frequencyUnit: 'days' },
        ),
        integrationSourceNode(
          'list-channels',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/api/conversations.list',
            method: 'GET',
            queryParams: {
              types: 'public_channel',
              exclude_archived: 'true',
              limit: '200',
            },
            arrayExpression: 'channels',
            objectIdExpression: 'id',
            pagination: {
              type: 'cursor',
              cursorParam: 'cursor',
              nextCursorExpression: 'response_metadata.next_cursor',
            },
          },
          'List channels',
        ),
        chainedSourceNode(
          'list-members',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/api/conversations.members?channel={{id}}&limit=200',
            method: 'GET',
            // conversations.members returns bare user-ID strings; flatten mode
            // wraps each as { value: <user id>, _parent: <channel> }.
            arrayExpression: 'members',
            objectIdExpression: '$',
            resultMode: 'flatten',
            pagination: {
              type: 'cursor',
              cursorParam: 'cursor',
              nextCursorExpression: 'response_metadata.next_cursor',
            },
          },
          'List members per channel',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: "_parent.id & ':' & value", items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-channels'),
        edge('e2', 'list-channels', 'list-members'),
        edge('e3', 'list-members', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
