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
  name: 'GitHub collaborators (per repo)',
  description:
    'List collaborators for each repository. Chains from repos to /repos/:owner/:repo/collaborators. Useful for access auditing.',
  integrationSlug: 'github-token',
  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
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
          'list-collaborators',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/repos/{{full_name}}/collaborators',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'login',
            resultMode: 'flatten',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'List collaborators per repo',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: 'login', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-repos'),
        edge('e2', 'list-repos', 'list-collaborators'),
        edge('e3', 'list-collaborators', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
