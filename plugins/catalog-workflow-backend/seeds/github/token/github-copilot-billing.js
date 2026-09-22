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
  name: 'GitHub Copilot billing summary',
  description:
    'Copilot subscription summary per organization: seat breakdown (total, active this cycle, pending invites/cancellations), plan type, and org-wide Copilot policies. One record per org; requires a Copilot Business or Enterprise subscription.',
  integrationSlug: 'github-token',
  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 24, frequencyUnit: 'hours' },
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
          'get-copilot-billing',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/orgs/{{login}}/copilot/billing',
            method: 'GET',
            arrayExpression: '$',
            objectIdExpression: "'copilot-billing'",
            resultMode: 'flatten',
          },
          'Get Copilot billing per org',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: '_parent.login', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-orgs'),
        edge('e2', 'list-orgs', 'get-copilot-billing'),
        edge('e3', 'get-copilot-billing', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
