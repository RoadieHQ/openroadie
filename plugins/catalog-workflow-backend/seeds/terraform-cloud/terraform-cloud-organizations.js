const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Terraform Cloud organizations',
  description:
    'List all Terraform Cloud organizations accessible to the token.',
  integrationSlug: 'terraform-cloud',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-organizations',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/api/v2/organizations',
            method: 'GET',
            arrayExpression: 'data',
            objectIdExpression: 'id',
            pagination: {
              type: 'page',
              pageParam: 'page[number]',
              perPageParam: 'page[size]',
              perPage: 100,
            },
          },
          'List organizations',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-organizations'),
        edge('e2', 'list-organizations', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
