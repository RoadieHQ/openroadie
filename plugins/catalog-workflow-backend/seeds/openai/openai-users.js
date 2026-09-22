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
  name: 'OpenAI organization users',
  description:
    'List every user in the OpenAI organization via the Admin API and store them in the datastore. Useful for mapping people to projects and API keys.',
  integrationSlug: 'openai',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-users',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/v1/organization/users',
            method: 'GET',
            queryParams: { limit: '100' },
            arrayExpression: 'data',
            objectIdExpression: 'id',
            pagination: {
              type: 'cursor',
              cursorParam: 'after',
              nextCursorExpression: 'has_more ? last_id : null',
            },
          },
          'List organization users',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-users'),
        edge('e2', 'list-users', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
