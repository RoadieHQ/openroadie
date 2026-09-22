const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Anthropic organization invites',
  description:
    'List pending, accepted, and expired invites to the Anthropic organization via the Admin API.',
  integrationSlug: 'anthropic',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 6, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-invites',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/v1/organizations/invites',
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
          'List invites',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-invites'),
        edge('e2', 'list-invites', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
