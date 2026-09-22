const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

const VERSION_CONTROL_RESOURCES_QUERY = `query VersionControlResources($filterBy: VersionControlResourceFilters, $first: Int, $after: String) {
  versionControlResources(filterBy: $filterBy, first: $first, after: $after) {
    nodes {
      id
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

module.exports = {
  name: 'Wiz version control resources',
  description:
    'List version-control resources known to Wiz via the GraphQL versionControlResources query.',
  integrationSlug: 'wiz',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-version-control-resources',
          { x: 280, y: 0 },
          {
            integrationId,
            mode: 'graphql',
            path: '/graphql',
            method: 'POST',
            graphql: {
              query: VERSION_CONTROL_RESOURCES_QUERY,
              variables: {
                first: 100,
                filterBy: {},
              },
            },
            arrayExpression: 'data.versionControlResources.nodes',
            objectIdExpression: 'id',
            pagination: {
              type: 'graphql-cursor',
              cursorVariable: 'after',
              nextCursorExpression:
                'data.versionControlResources.pageInfo.endCursor',
              hasNextPageExpression:
                'data.versionControlResources.pageInfo.hasNextPage',
            },
          },
          'List version control resources',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: 'id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-version-control-resources'),
        edge('e2', 'list-version-control-resources', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
