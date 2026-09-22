const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'CircleCI workflows (all organizations)',
  description:
    'List workflows across all organizations the token can access by chaining collaborations to pipelines and then workflows.',
  integrationSlug: 'circleci',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 1, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-organizations',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/api/v2/me/collaborations',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'slug',
          },
          'List organizations',
        ),
        chainedSourceNode(
          'list-pipelines',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/api/v2/pipeline?org-slug={{slug}}',
            method: 'GET',
            arrayExpression: 'items',
            objectIdExpression: '$string(id)',
            resultMode: 'flatten',
            pagination: {
              type: 'cursor',
              cursorParam: 'page-token',
              nextCursorExpression: 'next_page_token',
            },
          },
          'List pipelines per org',
        ),
        chainedSourceNode(
          'list-workflows',
          { x: 840, y: 0 },
          {
            integrationId,
            path: '/api/v2/pipeline/{{id}}/workflow',
            method: 'GET',
            arrayExpression: 'items',
            objectIdExpression: '$string(id)',
            resultMode: 'flatten',
            pagination: {
              type: 'cursor',
              cursorParam: 'page-token',
              nextCursorExpression: 'next_page_token',
            },
          },
          'List workflows per pipeline',
        ),
        datastoreSinkNode(
          'sink',
          { x: 1120, y: 0 },
          { id_selector: '$string(id)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-organizations'),
        edge('e2', 'list-organizations', 'list-pipelines'),
        edge('e3', 'list-pipelines', 'list-workflows'),
        edge('e4', 'list-workflows', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.75 },
    };
  },
};
