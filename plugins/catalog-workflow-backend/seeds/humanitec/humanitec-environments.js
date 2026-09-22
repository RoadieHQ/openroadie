const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Humanitec environments (organization discovery)',
  description:
    'List environments across all Humanitec organizations by chaining organization discovery to applications and then environments.',
  integrationSlug: 'humanitec',

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
            path: '/orgs',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'id',
          },
          'List organizations',
        ),
        chainedSourceNode(
          'list-applications',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/orgs/{{id}}/apps',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'id',
            resultMode: 'flatten',
          },
          'List applications per org',
        ),
        chainedSourceNode(
          'list-environments',
          { x: 840, y: 0 },
          {
            integrationId,
            path: '/orgs/{{_parent.id}}/apps/{{id}}/envs',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'id',
            resultMode: 'flatten',
          },
          'List environments per application',
        ),
        datastoreSinkNode(
          'sink',
          { x: 1120, y: 0 },
          {
            id_selector:
              '$string(_parent._parent.id) & ":" & $string(_parent.id) & ":" & id',
            items_selector: '$',
          },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-organizations'),
        edge('e2', 'list-organizations', 'list-applications'),
        edge('e3', 'list-applications', 'list-environments'),
        edge('e4', 'list-environments', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.75 },
    };
  },
};
