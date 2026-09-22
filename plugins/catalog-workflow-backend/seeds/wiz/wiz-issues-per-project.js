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

const PROJECTS_QUERY = `query ProjectsTable($filterBy: ProjectFilters, $first: Int, $after: String) {
  projects(filterBy: $filterBy, first: $first, after: $after) {
    nodes {
      id
      name
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

const ISSUES_QUERY = `query IssuesTable($filterBy: IssueFilters, $first: Int, $after: String) {
  issuesV2(filterBy: $filterBy, first: $first, after: $after) {
    nodes {
      id
      url
      type
      status
      severity
      createdAt
      entitySnapshot {
        id
        type
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
  name: 'Wiz issues (per project)',
  description:
    'List open Wiz issues per project by chaining the projects query to a project-filtered issuesV2 query. Each record carries its project in _parent.',
  integrationSlug: 'wiz',

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
        chainedSourceNode(
          'list-issues',
          { x: 560, y: 0 },
          {
            integrationId,
            mode: 'graphql',
            path: '/graphql',
            method: 'POST',
            graphql: {
              query: ISSUES_QUERY,
              variables: {
                first: 100,
                filterBy: {
                  status: ['OPEN', 'IN_PROGRESS'],
                  project: '{{id}}',
                },
              },
            },
            arrayExpression: 'data.issuesV2.nodes',
            objectIdExpression: 'id',
            resultMode: 'flatten',
            pagination: {
              type: 'graphql-cursor',
              cursorVariable: 'after',
              nextCursorExpression: 'data.issuesV2.pageInfo.endCursor',
              hasNextPageExpression: 'data.issuesV2.pageInfo.hasNextPage',
            },
          },
          'List issues per project',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          {
            // An issue can belong to several projects, so scope the record id
            // by the parent project to keep sink ids unique.
            id_selector: '$string(_parent.id) & ":" & id',
            items_selector: '$',
          },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-projects'),
        edge('e2', 'list-projects', 'list-issues'),
        edge('e3', 'list-issues', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
