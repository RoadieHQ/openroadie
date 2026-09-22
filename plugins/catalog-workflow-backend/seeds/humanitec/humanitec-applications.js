const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Humanitec applications (organization discovery)',
  description:
    'List applications across all Humanitec organizations visible to the token by discovering organizations first.',
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
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          {
            id_selector: '$string(_parent.id) & ":" & id',
            items_selector: '$',
          },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-organizations'),
        edge('e2', 'list-organizations', 'list-applications'),
        edge('e3', 'list-applications', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
