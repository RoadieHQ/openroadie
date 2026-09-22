const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Anthropic API keys',
  description:
    'List all API keys in the Anthropic organization — status, creator, workspace, and expiry — via the Admin API.',
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
          'list-api-keys',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/v1/organizations/api_keys',
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
          'List API keys',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-api-keys'),
        edge('e2', 'list-api-keys', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
