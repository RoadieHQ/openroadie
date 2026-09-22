import type { LoggerService } from '@roadiehq/extensions-api';
import {
  entityChangeTopics,
  type EntityChangeOperation,
  type EventsService,
} from '@roadiehq/backend-defaults';
import type { CurrentScopeIdResolver } from '@roadiehq/integrations-node';

export async function publishWorkflowChange(options: {
  events: EventsService;
  logger: LoggerService;
  operation: EntityChangeOperation;
  id: string;
  workspaceId: string;
  currentScopeIdResolver: CurrentScopeIdResolver;
}) {
  try {
    const scopeId = await options.currentScopeIdResolver.getCurrentScopeId();
    await options.events.publish({
      topic: entityChangeTopics.workflows,
      eventPayload: {
        id: options.id,
        operation: options.operation,
        scopeId,
        workspaceId: options.workspaceId,
      },
    });
  } catch (error) {
    options.logger.warn(
      `Failed to publish ${options.operation} workflow event: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
