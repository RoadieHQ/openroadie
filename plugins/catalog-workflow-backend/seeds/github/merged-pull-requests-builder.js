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
const {
  installationReposPrefix,
  PAGE_PAGINATION,
} = require('./app/installation-repos-builder');

const normalizeMergedPullRequestsExpression = `
  $map(
    $[$exists(merge_commit_sha)],
    function($v) {
      {
        "id": $v._parent.full_name & "#" & $string($v.number),
        "repo_full_name": $v._parent.full_name,
        "repo_name": $v._parent.name,
        "repo_owner": $v._parent.owner.login,
        "number": $v.number,
        "title": $v.title,
        "state": $v.state,
        "author_login": $v.user.login,
        "merged_at": $v.merged_at,
        "updated_at": $v.updated_at,
        "merge_commit_sha": $v.merge_commit_sha,
        "git_sha": $substring($v.merge_commit_sha, 0, 7),
        "url": $v.html_url
      }
    }
  )
`;

function listMergedPrsNode(integrationId, x) {
  return chainedSourceNode(
    'list-prs',
    { x, y: 0 },
    {
      integrationId,
      path: '/repos/{{full_name}}/pulls?state=closed&sort=updated&direction=desc',
      method: 'GET',
      arrayExpression: '$',
      objectIdExpression: '$string(id)',
      resultMode: 'flatten',
      pagination: PAGE_PAGINATION,
    },
    'List merged pull requests per repo',
  );
}

/**
 * The GitHub App and token variants of the "merged pull requests (per repo)"
 * seed differ only in how repositories are listed; the PR-listing chain, sink,
 * edges, normalization expression and layout are identical.
 *
 * @param {{ listRepos: { path: string, arrayExpression: string, label: string } } | { fanOutInstallations: true }} options
 */
function buildMergedPullRequestsSeed(options) {
  return integrationId => {
    if (options.fanOutInstallations) {
      const { nodes: repoNodes, edges: repoEdges } =
        installationReposPrefix(integrationId);
      return {
        nodes: [
          scheduleTriggerNode(
            'trigger',
            { x: 0, y: 0 },
            { frequencyValue: 6, frequencyUnit: 'hours' },
          ),
          ...repoNodes,
          listMergedPrsNode(integrationId, 840),
          datastoreSinkNode(
            'sink',
            { x: 1120, y: 0 },
            { id_selector: 'id', items_selector: '$' },
          ),
        ],
        edges: [
          edge('e1', 'trigger', 'list-installations'),
          ...repoEdges,
          edge('e2', 'list-repos', 'list-prs'),
          edge('e3', 'list-prs', 'sink', normalizeMergedPullRequestsExpression),
        ],
        viewport: { x: 0, y: 0, zoom: 0.75 },
      };
    }

    const listRepos = options.listRepos;
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 6, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-repos',
          { x: 280, y: 0 },
          {
            integrationId,
            path: listRepos.path,
            method: 'GET',
            arrayExpression: listRepos.arrayExpression,
            objectIdExpression: 'full_name',
            pagination: PAGE_PAGINATION,
          },
          listRepos.label,
        ),
        listMergedPrsNode(integrationId, 560),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-repos'),
        edge('e2', 'list-repos', 'list-prs'),
        edge('e3', 'list-prs', 'sink', normalizeMergedPullRequestsExpression),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  };
}

module.exports = {
  normalizeMergedPullRequestsExpression,
  buildMergedPullRequestsSeed,
};
