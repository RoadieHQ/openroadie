/*
 * Copyright 2026 Larder Software Limited
 */
const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../../builders');

module.exports = {
  name: 'GitHub teams',
  description:
    'List teams across all organizations the token can access, with each team enriched with its members.',
  integrationSlug: 'github-token',
  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-orgs',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/user/orgs',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'login',
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
          'list-teams',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/orgs/{{login}}/teams',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: '$string(id)',
            resultMode: 'flatten',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'List teams per org',
        ),
        chainedSourceNode(
          'list-members',
          { x: 840, y: 0 },
          {
            integrationId,
            path: '/orgs/{{_parent.login}}/teams/{{slug}}/members',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'login',
            resultMode: 'enrich',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'Add members to each team',
        ),
        datastoreSinkNode(
          'sink',
          { x: 1120, y: 0 },
          { id_selector: '$string(id)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-orgs'),
        edge('e2', 'list-orgs', 'list-teams'),
        edge('e3', 'list-teams', 'list-members'),
        edge('e4', 'list-members', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.75 },
    };
  },
};
