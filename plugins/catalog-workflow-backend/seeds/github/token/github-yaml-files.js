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
  name: 'GitHub YAML files',
  description:
    'Search for .yaml and .yml files within a GitHub organisation using the code search API.',
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
          'search-yaml-files',
          { x: 280, y: 0 },
          {
            integrationId,
            pathTemplate:
              '/search/code?q=extension:yaml+extension:yml+org:{org}',
            pathParams: { org: '' },
            path: '/search/code?q=extension:yaml+extension:yml+org:{org}',
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
          'Search .yaml/.yml files',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'html_url', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'search-yaml-files'),
        edge('e2', 'search-yaml-files', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
