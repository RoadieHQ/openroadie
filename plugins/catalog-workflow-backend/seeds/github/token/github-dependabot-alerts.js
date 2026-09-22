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
  name: 'GitHub Dependabot alerts (per repo)',
  description:
    'List open Dependabot alerts for each repository. Chains from repos to /repos/:owner/:repo/dependabot/alerts.',
  integrationSlug: 'github-token',
  build(integrationId) {
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
          'list-alerts',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/repos/{{full_name}}/dependabot/alerts?state=open',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: '$string(number)',
            resultMode: 'flatten',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'List Dependabot alerts per repo',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: '$string(number)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-repos'),
        edge('e2', 'list-repos', 'list-alerts'),
        edge('e3', 'list-alerts', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
