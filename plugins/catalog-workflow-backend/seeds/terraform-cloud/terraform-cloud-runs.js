const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Terraform Cloud runs (all organizations)',
  description:
    'List runs across all Terraform Cloud organizations by chaining organization discovery to workspaces and then runs per workspace.',
  integrationSlug: 'terraform-cloud',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 6, frequencyUnit: 'hours' },
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
        chainedSourceNode(
          'list-workspaces',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/api/v2/organizations/{{attributes.name}}/workspaces',
            method: 'GET',
            arrayExpression: 'data',
            objectIdExpression: 'id',
            resultMode: 'flatten',
            pagination: {
              type: 'page',
              pageParam: 'page[number]',
              perPageParam: 'page[size]',
              perPage: 100,
            },
          },
          'List workspaces per org',
        ),
        chainedSourceNode(
          'list-runs',
          { x: 840, y: 0 },
          {
            integrationId,
            path: '/api/v2/workspaces/{{id}}/runs',
            method: 'GET',
            arrayExpression: 'data',
            objectIdExpression: 'id',
            resultMode: 'flatten',
            pagination: {
              type: 'page',
              pageParam: 'page[number]',
              perPageParam: 'page[size]',
              perPage: 100,
            },
          },
          'List runs per workspace',
        ),
        datastoreSinkNode(
          'sink',
          { x: 1120, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-organizations'),
        edge('e2', 'list-organizations', 'list-workspaces'),
        edge('e3', 'list-workspaces', 'list-runs'),
        edge('e4', 'list-runs', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.75 },
    };
  },
};
