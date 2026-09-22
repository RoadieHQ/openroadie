/*
 * Copyright 2026 Larder Software Limited
 */
const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../../builders');

module.exports = {
  name: 'GitHub open pull requests',
  description:
    'Search GitHub for open pull requests authored by the configured token user. Showcases pagination and a JSONata array selector.',
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
          'search-prs',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/search/issues?q=is:pr+is:open+author:@me',
            method: 'GET',
            arrayExpression: 'items',
            objectIdExpression: 'id',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'Search open PRs',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: '$string(id)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'search-prs'),
        edge('e2', 'search-prs', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
