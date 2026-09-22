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

const ISSUES_QUERY = `query Issues($after: String) {
  issues(first: 50, after: $after, orderBy: updatedAt) {
    nodes {
      id
      identifier
      title
      priority
      priorityLabel
      estimate
      dueDate
      url
      createdAt
      updatedAt
      startedAt
      completedAt
      canceledAt
      state {
        id
        name
        type
      }
      assignee {
        id
        name
        email
      }
      team {
        id
        key
        name
      }
      project {
        id
        name
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

module.exports = {
  name: 'Linear issues',
  description:
    'List every issue in the Linear workspace with state, assignee, team, and project, and store them in the datastore.',
  integrationSlug: 'linear',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 1, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-issues',
          { x: 280, y: 0 },
          {
            integrationId,
            mode: 'graphql',
            path: '/graphql',
            method: 'POST',
            graphqlQuery: ISSUES_QUERY,
            arrayExpression: 'data.issues.nodes',
            objectIdExpression: 'id',
            pagination: {
              type: 'graphql-cursor',
              cursorVariable: 'after',
              nextCursorExpression: 'data.issues.pageInfo.endCursor',
              hasNextPageExpression: 'data.issues.pageInfo.hasNextPage',
            },
          },
          'List issues',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: '$.id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-issues'),
        edge('e2', 'list-issues', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
