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
  name: 'GitHub organization members',
  description:
    'List members across all organizations the token can access. Chains from orgs to /orgs/:org/members, then enriches each member with their public profile (/users/:username) to pick up a public email where available.',
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
          'list-members',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/orgs/{{login}}/members',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'login',
            resultMode: 'flatten',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'List members per org',
        ),
        chainedSourceNode(
          'enrich-users',
          { x: 840, y: 0 },
          {
            integrationId,
            path: '/users/{{login}}',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: 'login',
            resultMode: 'flatten',
          },
          'Enrich with public profile',
        ),
        datastoreSinkNode(
          'sink',
          { x: 1120, y: 0 },
          { id_selector: 'login', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-orgs'),
        edge('e2', 'list-orgs', 'list-members'),
        edge('e3', 'list-members', 'enrich-users'),
        edge('e4', 'enrich-users', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
