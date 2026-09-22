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

const PROJECTS_QUERY = `query ProjectsTable($filterBy: ProjectFilters, $first: Int, $after: String) {
  projects(filterBy: $filterBy, first: $first, after: $after) {
    nodes {
      id
      name
      isFolder
      archived
      businessUnit
      description
      projectOwners {
        id
        name
        email
      }
      securityChampions {
        id
        name
        email
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

module.exports = {
  name: 'Wiz projects',
  description:
    'List Wiz projects via the GraphQL API, including owners and security champions. Useful for mapping teams to their security posture.',
  integrationSlug: 'wiz',

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
            mode: 'graphql',
            path: '/graphql',
            method: 'POST',
            graphql: {
              query: PROJECTS_QUERY,
              variables: {
                first: 100,
                filterBy: { includeArchived: false },
              },
            },
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
          { id_selector: 'id', items_selector: '$' },
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
