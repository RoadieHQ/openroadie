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
  name: 'Bitbucket Cloud pull requests (per repo)',
  description:
    'List open pull requests for each repository across all visible workspaces. Chains workspaces to repositories to /2.0/repositories/{workspace}/{repo_slug}/pullrequests.',
  integrationSlug: 'bitbucket-cloud',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 1, frequencyUnit: 'hours' },
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
          'list-repos',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/2.0/repositories/{{slug}}',
            method: 'GET',
            arrayExpression: 'values',
            objectIdExpression: 'full_name',
            resultMode: 'flatten',
            pagination: {
              type: 'body-link',
              nextLinkExpression: 'next',
              perPageParam: 'pagelen',
              perPage: 100,
            },
          },
          'List repositories per workspace',
        ),
        chainedSourceNode(
          'list-prs',
          { x: 840, y: 0 },
          {
            integrationId,
            path: '/2.0/repositories/{{full_name}}/pullrequests?state=OPEN',
            method: 'GET',
            arrayExpression: 'values',
            objectIdExpression: '$string(id)',
            resultMode: 'flatten',
            pagination: {
              type: 'body-link',
              nextLinkExpression: 'next',
              perPageParam: 'pagelen',
              perPage: 50,
            },
          },
          'List PRs per repo',
        ),
        datastoreSinkNode(
          'sink',
          { x: 1120, y: 0 },
          {
            // Bitbucket pull request ids are a per-repository sequence, so
            // qualify with the parent repository for a globally unique key.
            id_selector: '_parent.full_name & ":" & $string(id)',
            items_selector: '$',
          },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-workspaces'),
        edge('e2', 'list-workspaces', 'list-repos'),
        edge('e3', 'list-repos', 'list-prs'),
        edge('e4', 'list-prs', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
