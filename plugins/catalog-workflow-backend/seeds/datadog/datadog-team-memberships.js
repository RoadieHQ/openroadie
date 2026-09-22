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
  name: 'Datadog team memberships',
  description:
    'List memberships for every Datadog team by chaining the teams endpoint to per-team memberships.',
  integrationSlug: 'datadog',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-teams',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/api/v2/team',
            method: 'GET',
            arrayExpression: 'data',
            objectIdExpression: 'id',
            pagination: {
              type: 'page',
              pageParam: 'page[number]',
              perPageParam: 'page[size]',
              perPage: 100,
              startPage: 0,
            },
          },
          'List teams',
        ),
        chainedSourceNode(
          'list-memberships',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/api/v2/team/{{id}}/memberships',
            method: 'GET',
            arrayExpression: 'data',
            objectIdExpression: 'id',
            resultMode: 'flatten',
            pagination: {
              type: 'page',
              pageParam: 'page[number]',
              perPageParam: 'page[size]',
              perPage: 100,
              startPage: 0,
            },
          },
          'List memberships per team',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-teams'),
        edge('e2', 'list-teams', 'list-memberships'),
        edge('e3', 'list-memberships', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
