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

const PAGE_PAGINATION = {
  type: 'page',
  pageParam: 'page',
  perPageParam: 'per_page',
  perPage: 100,
};

/**
 * Shared installation → repositories fan-out used by GitHub App seeds.
 * Lists every app installation (App JWT), then lists repos for each
 * installation token selected via `installation_id`.
 */
function listInstallationsNode(nodeId, position, integrationId) {
  return integrationSourceNode(
    nodeId,
    position,
    {
      integrationId,
      path: '/app/installations',
      method: 'GET',
      arrayExpression: '$',
      objectIdExpression: '$string(id)',
      pagination: PAGE_PAGINATION,
    },
    'List app installations',
  );
}

function listInstallationReposNode(nodeId, position, integrationId) {
  return chainedSourceNode(
    nodeId,
    position,
    {
      integrationId,
      path: '/installation/repositories?installation_id={{id}}',
      method: 'GET',
      arrayExpression: 'repositories',
      objectIdExpression: 'full_name',
      resultMode: 'flatten',
      pagination: PAGE_PAGINATION,
    },
    'List installation repositories',
  );
}

function installationReposPrefix(integrationId, options = {}) {
  const installX = options.installX ?? 280;
  const reposX = options.reposX ?? 560;
  const y = options.y ?? 0;
  return {
    nodes: [
      listInstallationsNode(
        'list-installations',
        { x: installX, y },
        integrationId,
      ),
      listInstallationReposNode('list-repos', { x: reposX, y }, integrationId),
    ],
    edges: [edge('e-installations', 'list-installations', 'list-repos')],
  };
}

function buildGithubAppPerRepoSeed({
  name,
  description,
  frequencyValue,
  frequencyUnit = 'hours',
  childNodeId,
  childLabel,
  childConfig,
  sinkIdSelector,
  sinkItemsSelector = '$',
  transformEdgeExpression,
}) {
  return {
    name,
    description,
    integrationSlug: 'github-app',
    build(integrationId) {
      const { nodes: repoNodes, edges: repoEdges } =
        installationReposPrefix(integrationId);
      const edges = [
        edge('e1', 'trigger', 'list-installations'),
        ...repoEdges,
        edge('e2', 'list-repos', childNodeId),
        transformEdgeExpression
          ? edge('e3', childNodeId, 'sink', transformEdgeExpression)
          : edge('e3', childNodeId, 'sink'),
      ];
      return {
        nodes: [
          scheduleTriggerNode(
            'trigger',
            { x: 0, y: 0 },
            { frequencyValue, frequencyUnit },
          ),
          ...repoNodes,
          chainedSourceNode(
            childNodeId,
            { x: 840, y: 0 },
            { integrationId, ...childConfig },
            childLabel,
          ),
          datastoreSinkNode(
            'sink',
            { x: 1120, y: 0 },
            {
              id_selector: sinkIdSelector,
              items_selector: sinkItemsSelector,
            },
          ),
        ],
        edges,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      };
    },
  };
}

module.exports = {
  PAGE_PAGINATION,
  listInstallationsNode,
  listInstallationReposNode,
  installationReposPrefix,
  buildGithubAppPerRepoSeed,
};
