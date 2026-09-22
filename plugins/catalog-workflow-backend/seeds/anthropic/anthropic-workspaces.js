const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Anthropic workspaces',
  description:
    'List all non-archived workspaces in the Anthropic organization via the Admin API.',
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
          'list-workspaces',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/v1/organizations/workspaces',
            method: 'GET',
            queryParams: { limit: '100', include_archived: 'false' },
            arrayExpression: 'data',
            objectIdExpression: 'id',
            pagination: {
              type: 'cursor',
              cursorParam: 'after_id',
              nextCursorExpression: 'has_more ? last_id : null',
            },
          },
          'List workspaces',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-workspaces'),
        edge('e2', 'list-workspaces', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
