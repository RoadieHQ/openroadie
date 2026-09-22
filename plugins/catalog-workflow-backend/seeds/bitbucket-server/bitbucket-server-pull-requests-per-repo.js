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

// Pull request ids are only unique within a repository, so the sink id
// prefixes the PR id with the target repo's project key and slug.
const PR_ID_EXPRESSION =
  'toRef.repository.project.key & "/" & toRef.repository.slug & ":" & $string(id)';

module.exports = {
  name: 'Bitbucket Server pull requests (per repo)',
  description:
    'List open pull requests for each repository. Chains from /repos to /projects/:projectKey/repos/:repositorySlug/pull-requests.',
  integrationSlug: 'bitbucket-server',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 1, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-repositories',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/rest/api/1.0/repos',
            method: 'GET',
            arrayExpression: 'values',
            objectIdExpression: 'project.key & "/" & slug',
            pagination: {
              type: 'offset',
              offsetParam: 'start',
              limitParam: 'limit',
              limit: 100,
            },
          },
          'List repositories',
        ),
        chainedSourceNode(
          'list-pull-requests',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/rest/api/1.0/projects/{{project.key}}/repos/{{slug}}/pull-requests?state=OPEN',
            method: 'GET',
            arrayExpression: 'values',
            objectIdExpression: PR_ID_EXPRESSION,
            resultMode: 'flatten',
            pagination: {
              type: 'offset',
              offsetParam: 'start',
              limitParam: 'limit',
              limit: 100,
            },
          },
          'List PRs per repo',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: PR_ID_EXPRESSION, items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-repositories'),
        edge('e2', 'list-repositories', 'list-pull-requests'),
        edge('e3', 'list-pull-requests', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
