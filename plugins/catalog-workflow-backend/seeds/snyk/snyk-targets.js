const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Snyk targets (all organizations)',
  description:
    'List targets across all Snyk organizations by chaining the REST org discovery endpoint to targets.',
  integrationSlug: 'snyk',

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
            path: '/rest/orgs',
            method: 'GET',
            queryParams: { version: '2025-11-05' },
            arrayExpression: 'data',
            objectIdExpression: 'id',
          },
          'List organizations',
        ),
        chainedSourceNode(
          'list-targets',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/rest/orgs/{{id}}/targets',
            method: 'GET',
            queryParams: { version: '2025-11-05' },
            arrayExpression: 'data',
            objectIdExpression: 'id',
            resultMode: 'flatten',
          },
          'List targets per org',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-organizations'),
        edge('e2', 'list-organizations', 'list-targets'),
        edge('e3', 'list-targets', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
