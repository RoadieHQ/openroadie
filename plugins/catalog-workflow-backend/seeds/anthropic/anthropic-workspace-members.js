const {
  scheduleTriggerNode,
  integrationSourceNode,
  chainedSourceNode,
  datastoreSinkNode,
  edge,
} = require('../builders');

module.exports = {
  name: 'Anthropic workspace members',
  description:
    'List members of every Anthropic workspace by chaining the workspace listing to the workspace members endpoint.',
  integrationSlug: 'anthropic',

  build(integrationId) {
    return {
      nodes: [
        scheduleTriggerNode(
          'trigger',
          { x: 0, y: 0 },
          { frequencyValue: 12, frequencyUnit: 'hours' },
        ),
        integrationSourceNode(
          'list-workspaces',
          { x: 280, y: 0 },
          {
            integrationId,
            path: '/v1/organizations/workspaces',
            method: 'GET',
            queryParams: { limit: '100', include_archived: 'false' },
            arrayExpression: 'data',
            objectIdExpression: 'id',
            pagination: {
              type: 'cursor',
              cursorParam: 'after_id',
              nextCursorExpression: 'has_more ? last_id : null',
            },
          },
          'List workspaces',
        ),
        chainedSourceNode(
          'list-workspace-members',
          { x: 560, y: 0 },
          {
            integrationId,
            path: '/v1/organizations/workspaces/{{id}}/members',
            method: 'GET',
            queryParams: { limit: '100' },
            // Workspace members have no id of their own; the
            // (workspace_id, user_id) pair is the documented identity.
            arrayExpression: 'data',
            objectIdExpression: "workspace_id & ':' & user_id",
            resultMode: 'flatten',
            pagination: {
              type: 'cursor',
              cursorParam: 'after_id',
              nextCursorExpression: 'has_more ? last_id : null',
            },
          },
          'List members per workspace',
        ),
        datastoreSinkNode(
          'sink',
          { x: 840, y: 0 },
          { id_selector: "workspace_id & ':' & user_id", items_selector: '$' },
        ),
      ],
      edges: [
        edge('e1', 'trigger', 'list-workspaces'),
        edge('e2', 'list-workspaces', 'list-workspace-members'),
        edge('e3', 'list-workspace-members', 'sink'),
      ],
      viewport: { x: 0, y: 0, zoom: 0.85 },
    };
  },
};
