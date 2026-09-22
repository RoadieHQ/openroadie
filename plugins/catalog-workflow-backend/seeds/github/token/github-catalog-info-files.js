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
  name: 'GitHub catalog-info.yaml files',
  description:
    'Search for catalog-info.yaml files within a GitHub organisation using the code search API.',
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
          'search-catalog-info',
          { x: 280, y: 0 },
          {
            integrationId,
            pathTemplate: '/search/code?q=filename:catalog-info.yaml+org:{org}',
            pathParams: { org: '' },
            path: '/search/code?q=filename:catalog-info.yaml+org:{org}',
            method: 'GET',
            arrayExpression: 'items',
            objectIdExpression: 'html_url',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'Search catalog-info.yaml',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'html_url', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'search-catalog-info'),
        edge('e2', 'search-catalog-info', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
