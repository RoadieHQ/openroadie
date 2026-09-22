const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'CircleCI pipelines (all organizations)',
  description:
    'List pipelines across all organizations the token can access by discovering organization slugs from collaborations first.',
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
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: '$string(id)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-organizations'),
        edge('e2', 'list-organizations', 'list-pipelines'),
        edge('e3', 'list-pipelines', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
