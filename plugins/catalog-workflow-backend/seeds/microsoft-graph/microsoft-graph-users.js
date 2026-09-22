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

const ENRICH_USER_GROUP_MEMBERSHIPS = `$map($, function($u) {
  (
    $groups := $u._additionalData.microsoftgraphgroup ? $u._additionalData.microsoftgraphgroup : [];
    $merge([$u, {
      "memberOf": $groups,
      "memberOfGroupIds": $map($groups, function($g) { $string($g.id) })
    }])
  )
})`;

module.exports = {
  name: 'Entra ID users',
  description:
    'List Entra ID users via Microsoft Graph, enriching each user with direct group memberships and group IDs.',
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
          'list-users',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/v1.0/users?$select=id,displayName,userPrincipalName,mail,accountEnabled,jobTitle,department,officeLocation',
            pathTemplate: '/v1.0/users?$select={params}',
            pathParams: {
              params:
                'id,displayName,userPrincipalName,mail,accountEnabled,jobTitle,department,officeLocation',
            },
            params:
              'id,displayName,userPrincipalName,mail,accountEnabled,jobTitle,department,officeLocation',
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
          'List users',
        ),
        chainedSourceNode(
          'list-user-groups',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/v1.0/users/{{id}}/memberOf/microsoft.graph.group',
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
          'List groups per user',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: '$string(id)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-users'),
        edge('e2', 'list-users', 'list-user-groups'),
        edge('e3', 'list-user-groups', 'sink', ENRICH_USER_GROUP_MEMBERSHIPS),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
