const {
  scheduleTriggerNode,
  integrationSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Cursor team members',
  description:
    'List every member of the Cursor team (name, email, role) via the Admin API.',
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
        datastoreSinkNode(
          'sink',
          { x: 560, y: 0 },
          { id_selector: '$string(id)', items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-members'),
        edge('e2', 'list-members', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
