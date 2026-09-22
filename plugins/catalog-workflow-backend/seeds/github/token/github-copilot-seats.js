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
  name: 'GitHub Copilot seats',
  description:
    'List Copilot seat assignments across all organizations the token can access. Chains from orgs to /orgs/:org/copilot/billing/seats; requires a Copilot Business or Enterprise subscription on the org.',
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
          'list-copilot-seats',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/orgs/{{login}}/copilot/billing/seats',
            method: 'GET',
            arrayExpression: 'seats',
            // pending seats have a null assignee
            objectIdExpression:
              "assignee.login ? assignee.login : 'pending-' & created_at",
            resultMode: 'flatten',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 100,
            },
          },
          'List Copilot seats per org',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: '_parent.login & ":" & id', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-orgs'),
        edge('e2', 'list-orgs', 'list-copilot-seats'),
        edge('e3', 'list-copilot-seats', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
