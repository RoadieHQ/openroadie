const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Anthropic organization members',
  description:
    'List all members of the Anthropic organization with their org-level roles via the Admin API.',
  integrationSlug: 'anthropic',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-members',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/v1/organizations/users',
            method: 'GET',
            queryParams: { limit: '100' },
            arrayExpression: 'data',
            objectIdExpression: 'id',
            pagination: {
              type: 'cursor',
              cursorParam: 'after_id',
              nextCursorExpression: 'has_more ? last_id : null',
            },
          },
          'List organization members',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-members'),
        edge('e2', 'list-members', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
