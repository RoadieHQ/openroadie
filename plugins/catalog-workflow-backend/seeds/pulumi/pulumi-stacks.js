const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Pulumi stacks (all organizations)',
  description:
    'List stacks across all Pulumi organizations available to the token by discovering organizations from the authenticated user first.',
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
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          {
            id_selector:
              '$string(_parent.name) & ":" & $string(projectName) & "/" & $string(stackName)',
            items_selector: '$',
          },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-organizations'),
        edge('e2', 'list-organizations', 'list-stacks'),
        edge('e3', 'list-stacks', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
