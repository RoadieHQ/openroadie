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
  name: 'SonarQube branches (per project)',
  description:
    'List analyzed branches and their quality gate status for each project. Chains project discovery to /api/project_branches/list.',
  integrationSlug: 'sonarqube',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 6, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-projects',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/api/components/search',
            method: 'GET',
            queryParams: { qualifiers: 'TRK' },
            arrayExpression: 'components',
            objectIdExpression: 'key',
            pagination: {
              type: 'page',
              pageParam: 'p',
              perPageParam: 'ps',
              perPage: 100,
            },
          },
          'List projects',
        ),
        chainedSourceNode(
          'list-branches',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/api/project_branches/list?project={{key}}',
            method: 'GET',
            arrayExpression: 'branches',
            objectIdExpression: 'name',
            resultMode: 'flatten',
          },
          'List branches per project',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          {
            id_selector: '$string(_parent.key) & ":" & name',
            items_selector: '$',
          },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-projects'),
        edge('e2', 'list-projects', 'list-branches'),
        edge('e3', 'list-branches', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
