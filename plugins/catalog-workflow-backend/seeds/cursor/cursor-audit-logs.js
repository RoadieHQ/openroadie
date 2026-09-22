const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Cursor audit logs (last 7 days)',
  description:
    'Team audit-log events (member changes, settings changes) for the last 7 days — the endpoint defaults its time window to the past 7 days.',
  integrationSlug: 'cursor',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-audit-logs',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/teams/audit-logs',
            method: 'GET',
            arrayExpression: 'events',
            objectIdExpression: '$string(event_id)',
            pagination: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'pageSize',
              perPage: 500,
            },
          },
          'List audit logs',
        ),
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: '$string(event_id)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-audit-logs'),
        edge('e2', 'list-audit-logs', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
