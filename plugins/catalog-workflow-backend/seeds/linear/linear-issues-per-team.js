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

const TEAMS_QUERY = `query Teams($after: String) {
  teams(first: 50, after: $after) {
    nodes {
      id
      name
      key
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

const TEAM_ISSUES_QUERY = `query TeamIssues($after: String) {
  team(id: "{{id}}") {
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
  }
}`;

module.exports = {
  name: 'Linear issues (per team)',
  description:
    'List issues team by team. Chains from Linear teams to each team’s issue list, keeping the owning team in _parent.',
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
        chainedSourceNode(
          'list-team-issues',
          { x: 560, y: 0 },
          {
            integrationId,
            mode: 'graphql',
            path: '/graphql',
            method: 'POST',
            graphqlQuery: TEAM_ISSUES_QUERY,
            arrayExpression: 'data.team.issues.nodes',
            objectIdExpression: 'id',
            resultMode: 'flatten',
            pagination: {
              type: 'graphql-cursor',
              cursorVariable: 'after',
              nextCursorExpression: 'data.team.issues.pageInfo.endCursor',
              hasNextPageExpression: 'data.team.issues.pageInfo.hasNextPage',
            },
          },
          'List issues per team',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: '$.id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-teams'),
        edge('e2', 'list-teams', 'list-team-issues'),
        edge('e3', 'list-team-issues', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
