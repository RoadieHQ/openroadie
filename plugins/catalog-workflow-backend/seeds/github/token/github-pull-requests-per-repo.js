/*
 * Copyright 2026 Larder Software Limited
 */
const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../../builders');

module.exports = {
  name: 'GitHub pull requests (per repo)',
  description:
    'List open pull requests for each repository. Chains from repos to /repos/:owner/:repo/pulls.',
  integrationSlug: 'github-token',
  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 1, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-repos',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/user/repos',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'full_name',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'List repositories',
        ),
        chainedSourceNode(
          'list-prs',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/repos/{{full_name}}/pulls?state=open',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: '$string(id)',
            resultMode: 'flatten',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'List PRs per repo',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: '$string(id)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-repos'),
        edge('e2', 'list-repos', 'list-prs'),
        edge('e3', 'list-prs', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
