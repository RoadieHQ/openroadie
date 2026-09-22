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

const TEAMS_QUERY = `query Teams($after: String) {
  teams(first: 50, after: $after) {
    nodes {
      id
      name
      key
      description
      color
      icon
      timezone
      issueCount
      cyclesEnabled
      triageEnabled
      createdAt
      updatedAt
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

module.exports = {
  name: 'Linear teams',
  description:
    'List every team in the Linear workspace and store them in the datastore. Teams are the containers for issues, cycles, and workflow states.',
  integrationSlug: 'linear',

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
            mode: 'graphql',
            path: '/graphql',
            method: 'POST',
            graphqlQuery: TEAMS_QUERY,
            arrayExpression: 'data.teams.nodes',
            objectIdExpression: 'id',
            pagination: {
              type: 'graphql-cursor',
              cursorVariable: 'after',
              nextCursorExpression: 'data.teams.pageInfo.endCursor',
              hasNextPageExpression: 'data.teams.pageInfo.hasNextPage',
            },
          },
          'List teams',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: '$.id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-teams'),
        edge('e2', 'list-teams', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
