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
  name: 'Bitbucket Cloud workspace members',
  description:
    'List the members of every visible Bitbucket Cloud workspace. Chains from workspaces to /2.0/workspaces/{workspace}/members. Useful for mapping people to repositories and pull requests.',
  integrationSlug: 'bitbucket-cloud',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-workspaces',
          { x: 280, y: 0 },
          {
            integrationId,
            // workspace listing rejects API-token auth (CHANGE-2770)
            path: '/2.0/workspaces/{{config.workspace}}',
            method: 'GET',
            arrayExpression: '[$]',
            objectIdExpression: 'slug',
          },
          'List workspaces',
        ),
        chainedSourceNode(
          'list-members',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/2.0/workspaces/{{slug}}/members',
            method: 'GET',
            arrayExpression: 'values',
            objectIdExpression: 'user.uuid',
            resultMode: 'flatten',
            pagination: {
              type: 'body-link',
              nextLinkExpression: 'next',
              perPageParam: 'pagelen',
              perPage: 100,
            },
          },
          'List members per workspace',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          {
            // Membership rows are unique per (workspace, user) pair.
            id_selector: 'workspace.slug & ":" & user.uuid',
            items_selector: '$',
          },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-workspaces'),
        edge('e2', 'list-workspaces', 'list-members'),
        edge('e3', 'list-members', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
