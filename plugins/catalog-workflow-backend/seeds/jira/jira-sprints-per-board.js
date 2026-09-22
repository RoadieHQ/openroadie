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
  name: 'Jira sprints (per scrum board)',
  description:
    'List sprints for each Jira scrum board. Chains from scrum boards to /rest/agile/1.0/board/{boardId}/sprint. Kanban boards are excluded because they have no sprints.',
  integrationSlug: 'jira',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-scrum-boards',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/rest/agile/1.0/board?type=scrum',
            method: 'GET',
            arrayExpression: 'values',
            objectIdExpression: '$string(id)',
            pagination: {
              type: 'offset',
              offsetParam: 'startAt',
              limitParam: 'maxResults',
              limit: 50,
            },
          },
          'List scrum boards',
        ),
        chainedSourceNode(
          'list-sprints',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/rest/agile/1.0/board/{{id}}/sprint',
            method: 'GET',
            arrayExpression: 'values',
            objectIdExpression: '$string(id)',
            resultMode: 'flatten',
            pagination: {
              type: 'offset',
              offsetParam: 'startAt',
              limitParam: 'maxResults',
              limit: 50,
            },
          },
          'List sprints per board',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: '$string(id)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-scrum-boards'),
        edge('e2', 'list-scrum-boards', 'list-sprints'),
        edge('e3', 'list-sprints', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
