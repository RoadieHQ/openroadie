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
  name: 'Microsoft Teams members (per team)',
  description:
    'List members for each Microsoft Teams team via Microsoft Graph. Each row is one team membership with the team in _parent and the Entra ID user in userId. Requires the Team.ReadBasic.All and TeamMember.Read.All application permissions.',
  integrationSlug: 'microsoft-graph',

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
            path: '/v1.0/teams?$select=id,displayName,description,visibility',
            pathTemplate: '/v1.0/teams?$select={params}',
            pathParams: {
              params: 'id,displayName,description,visibility',
            },
            params: 'id,displayName,description,visibility',
            method: 'GET',
            arrayExpression: 'value',
            objectIdExpression: '$string(id)',
            pagination: {
              type: 'body-link',
              nextLinkExpression: '$."@odata.nextLink"',
              perPageParam: '$top',
              perPage: 100,
            },
          },
          'List teams',
        ),
        chainedSourceNode(
          'list-members',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/v1.0/teams/{{id}}/members',
            method: 'GET',
            arrayExpression: 'value',
            objectIdExpression: '$string(id)',
            resultMode: 'flatten',
            pagination: {
              type: 'body-link',
              nextLinkExpression: '$."@odata.nextLink"',
              perPageParam: '$top',
              perPage: 100,
            },
          },
          'List members per team',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          {
            id_selector: '$string(_parent.id) & ":" & $string(id)',
            items_selector: '$',
          },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-teams'),
        edge('e2', 'list-teams', 'list-members'),
        edge('e3', 'list-members', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
