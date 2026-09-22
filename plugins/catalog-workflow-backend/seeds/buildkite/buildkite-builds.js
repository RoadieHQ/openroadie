const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Buildkite builds (per pipeline)',
  description:
    'List builds for each pipeline by chaining organizations to pipelines to per-pipeline builds. Jobs are excluded to keep records small.',
  integrationSlug: 'buildkite',

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
            path: '/v2/organizations',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'id',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'List organizations',
        ),
        chainedSourceNode(
          'list-pipelines',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/v2/organizations/{{slug}}/pipelines',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'id',
            resultMode: 'flatten',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'List pipelines per org',
        ),
        chainedSourceNode(
          'list-builds',
          { x: 840, y: 0 },
          {
            integrationId,
            path: '/v2/organizations/{{_parent.slug}}/pipelines/{{slug}}/builds?exclude_jobs=true',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'id',
            resultMode: 'flatten',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'List builds per pipeline',
        ),
        datastoreSinkNode(
          'sink',
          { x: 1120, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-organizations'),
        edge('e2', 'list-organizations', 'list-pipelines'),
        edge('e3', 'list-pipelines', 'list-builds'),
        edge('e4', 'list-builds', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.7 },
    };
  },
};
