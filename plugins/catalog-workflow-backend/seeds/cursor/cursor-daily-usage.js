const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

// The daily-usage endpoint requires an explicit startDate/endDate window
// (epoch milliseconds, max 30 days). Seeds are static, so the window is
// computed at run time by a JSONata edge transform: the members call anchors
// the chain, the transform collapses its output into a single
// { startDate, endDate } item covering the last 7 days, and the chained
// source templates those values into the POST body.
const LAST_7_DAYS_WINDOW =
  '[{ "window": "last-7-days", "startDate": $millis() - 604800000, "endDate": $millis() }]';

module.exports = {
  name: 'Cursor daily usage (last 7 days)',
  description:
    'Per-member daily usage metrics (lines added, tabs accepted, agent/chat requests, most used model) for the last 7 days via the Admin API.',
  integrationSlug: 'cursor',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 1, frequencyUnit: 'days' },
        ),
        integrationSourceNode(
          'list-members',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/teams/members',
            method: 'GET',
            arrayExpression: 'teamMembers',
            objectIdExpression: '$string(id)',
          },
          'List team members',
        ),
        chainedSourceNode(
          'daily-usage',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/teams/daily-usage-data',
            method: 'POST',
            body: { startDate: '{{startDate}}', endDate: '{{endDate}}' },
            arrayExpression: 'data',
            objectIdExpression: '$string(userId) & "-" & day',
            resultMode: 'flatten',
          },
          'Fetch daily usage',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          {
            id_selector: '$string(userId) & "-" & day',
            items_selector: '$',
          },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-members'),
        edge('e2', 'list-members', 'daily-usage', LAST_7_DAYS_WINDOW),
        edge('e3', 'daily-usage', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
