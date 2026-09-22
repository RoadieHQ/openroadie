export const entityChangeTopics = {
  actions: 'openroadie.actions.changed',
  capabilities: 'openroadie.capabilities.changed',
  workflows: 'openroadie.workflows.changed',
} as const;

export type EntityChangeOperation =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'restored';

export interface EntityChangeEventPayload {
  id: string;
  operation: EntityChangeOperation;
  scopeId: string;
  workspaceId: string;
}
