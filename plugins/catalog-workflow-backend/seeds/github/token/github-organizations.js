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
  name: 'GitHub organizations',
  description:
    'List organizations the configured GitHub token belongs to. Foundation for chained team and member data sources.',
  integrationSlug: 'github-token',
  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 24, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-orgs',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/user/orgs',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'login',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'List organizations',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'login', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-orgs'),
        edge('e2', 'list-orgs', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
