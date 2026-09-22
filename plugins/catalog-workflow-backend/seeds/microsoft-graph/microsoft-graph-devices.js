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
  name: 'Entra ID devices',
  description:
    'List Entra ID devices via Microsoft Graph with ownership and compliance-related attributes to support endpoint inventory views.',
  integrationSlug: 'microsoft-graph',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 24, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-devices',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/v1.0/devices?$select=id,deviceId,displayName,operatingSystem,operatingSystemVersion,trustType,accountEnabled',
            pathTemplate: '/v1.0/devices?$select={params}',
            pathParams: {
              params:
                'id,deviceId,displayName,operatingSystem,operatingSystemVersion,trustType,accountEnabled',
            },
            params:
              'id,deviceId,displayName,operatingSystem,operatingSystemVersion,trustType,accountEnabled',
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
          'List devices',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: '$string(id)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-devices'),
        edge('e2', 'list-devices', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
