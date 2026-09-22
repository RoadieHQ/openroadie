const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Cursor member spend',
  description:
    'Per-member spend for the current billing cycle (spend cents, fast premium requests, limits) via the Admin API.',
  integrationSlug: 'cursor',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 1, frequencyUnit: 'days' },
        ),
        integrationSourceNode(
          'list-spend',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/teams/spend',
            method: 'POST',
            // Pagination params live in the JSON body for this endpoint, so
            // the engine's query-string paginators cannot drive it. A single
            // large page covers teams up to 500 members; see seeds/cursor/API.md.
            body: { page: 1, pageSize: 500 },
            arrayExpression: 'teamMemberSpend',
            objectIdExpression: '$string(userId)',
          },
          'List member spend',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: '$string(userId)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-spend'),
        edge('e2', 'list-spend', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
