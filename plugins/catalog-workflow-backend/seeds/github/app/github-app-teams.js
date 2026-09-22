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
} = require('../../builders');
const { PAGE_PAGINATION } = require('./installation-repos-builder');

module.exports = {
  name: 'GitHub App teams',
  description:
    'List teams for every organization where the app is installed, with each team enriched with its members.',
  integrationSlug: 'github-app',
  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-installations',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/app/installations',
            method: 'GET',
            arrayExpression: '$[account.type = "Organization"]',
            objectIdExpression: '$string(id)',
            pagination: PAGE_PAGINATION,
          },
          'List organization installations',
        ),
        chainedSourceNode(
          'list-teams',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/orgs/{{account.login}}/teams',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: '$string(id)',
            resultMode: 'flatten',
            pagination: PAGE_PAGINATION,
          },
          'List teams per organization',
        ),
        chainedSourceNode(
          'list-members',
          { x: 840, y: 0 },
          {
            integrationId,
            path: '/orgs/{{_parent.account.login}}/teams/{{slug}}/members',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'login',
            resultMode: 'enrich',
            pagination: PAGE_PAGINATION,
          },
          'Add members to each team',
        ),
        datastoreSinkNode(
          'sink',
          { x: 1120, y: 0 },
          { id_selector: '$string(id)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-installations'),
        edge('e2', 'list-installations', 'list-teams'),
        edge('e3', 'list-teams', 'list-members'),
        edge('e4', 'list-members', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.75 },
    };
  },
};
