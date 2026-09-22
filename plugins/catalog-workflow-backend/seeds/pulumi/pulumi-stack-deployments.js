const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Pulumi stack deployments (all organizations)',
  description:
    'List stack deployments across all Pulumi organizations by chaining user organization discovery to stacks and then deployments.',
  integrationSlug: 'pulumi',

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
            path: '/api/user',
            method: 'GET',
            arrayExpression: 'organizations',
            objectIdExpression: 'name',
          },
          'List organizations',
        ),
        chainedSourceNode(
          'list-stacks',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/api/user/stacks?organization={{name}}',
            method: 'GET',
            arrayExpression: 'stacks',
            objectIdExpression: '`${projectName}/${stackName}`',
            resultMode: 'flatten',
            pagination: {
              type: 'cursor',
              cursorParam: 'continuationToken',
              nextCursorExpression: 'continuationToken',
            },
          },
          'List stacks per org',
        ),
        chainedSourceNode(
          'list-deployments',
          { x: 840, y: 0 },
          {
            integrationId,
            path: '/api/stacks/{{_parent.name}}/{{projectName}}/{{stackName}}/deployments',
            method: 'GET',
            arrayExpression: 'deployments',
            objectIdExpression: '$string(id)',
            resultMode: 'flatten',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'pageSize',
              perPage: 100,
              startPage: 1,
            },
          },
          'List deployments per stack',
        ),
        datastoreSinkNode(
          'sink',
          { x: 1120, y: 0 },
          {
            id_selector:
              '$string(_parent._parent.name) & ":" & $string(_parent.projectName) & "/" & $string(_parent.stackName) & ":" & $string(id)',
            items_selector: '$',
          },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-organizations'),
        edge('e2', 'list-organizations', 'list-stacks'),
        edge('e3', 'list-stacks', 'list-deployments'),
        edge('e4', 'list-deployments', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.75 },
    };
  },
};
