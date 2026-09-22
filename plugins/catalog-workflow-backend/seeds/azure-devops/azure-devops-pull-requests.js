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
  name: 'Azure DevOps pull requests',
  description:
    'List pull requests across Azure DevOps projects. Requires an org-scoped host such as https://dev.azure.com/<organization>.',
  integrationSlug: 'azure-devops',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-projects',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/_apis/projects?api-version=7.0',
            method: 'GET',
            arrayExpression: 'value',
            objectIdExpression: '$string(id)',
            pagination: {
              type: 'offset',
              offsetParam: '$skip',
              limitParam: '$top',
              limit: 100,
            },
          },
          'List projects',
        ),
        chainedSourceNode(
          'list-pull-requests',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/{{id}}/_apis/git/pullrequests?searchCriteria.status=all&api-version=7.0',
            method: 'GET',
            arrayExpression: 'value',
            objectIdExpression: '$string(pullRequestId)',
            resultMode: 'flatten',
            pagination: {
              type: 'offset',
              offsetParam: '$skip',
              limitParam: '$top',
              limit: 100,
            },
          },
          'List PRs per project',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: '$string(pullRequestId)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-projects'),
        edge('e2', 'list-projects', 'list-pull-requests'),
        edge('e3', 'list-pull-requests', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
