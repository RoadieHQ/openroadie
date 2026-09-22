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

const PROJECTS_QUERY = `query Projects($after: String) {
  projects(first: 50, after: $after) {
    nodes {
      id
      name
      description
      slugId
      url
      progress
      health
      priorityLabel
      startDate
      targetDate
      startedAt
      completedAt
      canceledAt
      createdAt
      updatedAt
      status {
        id
        name
        type
      }
      lead {
        id
        name
        email
      }
      teams {
        nodes {
          id
          key
          name
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

module.exports = {
  name: 'Linear projects',
  description:
    'List every project in the Linear workspace, including status, health, lead, and owning teams, and store them in the datastore.',
  integrationSlug: 'linear',

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
            mode: 'graphql',
            path: '/graphql',
            method: 'POST',
            graphqlQuery: PROJECTS_QUERY,
            arrayExpression: 'data.projects.nodes',
            objectIdExpression: 'id',
            pagination: {
              type: 'graphql-cursor',
              cursorVariable: 'after',
              nextCursorExpression: 'data.projects.pageInfo.endCursor',
              hasNextPageExpression: 'data.projects.pageInfo.hasNextPage',
            },
          },
          'List projects',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: '$.id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-projects'),
        edge('e2', 'list-projects', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
