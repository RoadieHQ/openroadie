import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  coreServices,
  createBackendPlugin,
  type HttpAuthService,
  type LoggerService,
} from '@roadiehq/extensions-api';
import {
  entityChangeTopics,
  eventsServiceRef,
  type EntityChangeOperation,
  type EventParams,
  type EventsService,
} from '@roadiehq/backend-defaults';
import {
  currentScopeIdServiceRef,
  type CurrentScopeIdResolver,
} from '@roadiehq/integrations-node';
import {
  type WorkspaceService,
  workspaceServiceRef,
} from '@roadiehq/workspaces-backend';

export interface BrowserEntityChange {
  entity: 'actions' | 'capabilities' | 'workflows';
  operation: EntityChangeOperation;
  workspaceId: string;
}

interface ScopedEntityChange extends BrowserEntityChange {
  scopeId: string;
}

export function shouldDeliverEntityChange(
  change: ScopedEntityChange,
  scopeId: string,
  workspaceId: string,
): boolean {
  return change.scopeId === scopeId && change.workspaceId === workspaceId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEntityChangeOperation(
  value: unknown,
): value is EntityChangeOperation {
  return (
    value === 'created' ||
    value === 'updated' ||
    value === 'deleted' ||
    value === 'restored'
  );
}

export function toBrowserEntityChange(
  event: EventParams,
): ScopedEntityChange | undefined {
  if (
    !isRecord(event.eventPayload) ||
    !isEntityChangeOperation(event.eventPayload.operation) ||
    typeof event.eventPayload.scopeId !== 'string' ||
    typeof event.eventPayload.workspaceId !== 'string'
  ) {
    return undefined;
  }

  let entity: BrowserEntityChange['entity'];
  if (event.topic === entityChangeTopics.actions) {
    entity = 'actions';
  } else if (event.topic === entityChangeTopics.capabilities) {
    entity = 'capabilities';
  } else if (event.topic === entityChangeTopics.workflows) {
    entity = 'workflows';
  } else {
    return undefined;
  }

  return {
    entity,
    operation: event.eventPayload.operation,
    scopeId: event.eventPayload.scopeId,
    workspaceId: event.eventPayload.workspaceId,
  };
}

interface Connection {
  response: Response;
  heartbeat: ReturnType<typeof setInterval>;
  scopeId: string;
  workspaceId: string;
}

class EntityChangeConnections {
  private readonly connections = new Set<Connection>();

  private disconnect(connection: Connection) {
    clearInterval(connection.heartbeat);
    this.connections.delete(connection);
  }

  private writeHeartbeat(connection: Connection) {
    try {
      if (connection.response.destroyed || connection.response.writableEnded) {
        this.disconnect(connection);
        return;
      }
      connection.response.write(': keepalive\n\n');
    } catch {
      this.disconnect(connection);
    }
  }

  add(
    request: Request,
    response: Response,
    scopeId: string,
    workspaceId: string,
  ) {
    response.status(200);
    response.set({
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.write('event: ready\ndata: {}\n\n');

    const connection: Connection = {
      response,
      heartbeat: setInterval(() => this.writeHeartbeat(connection), 15_000),
      scopeId,
      workspaceId,
    };
    this.connections.add(connection);

    const disconnect = () => this.disconnect(connection);
    request.once('close', disconnect);
    response.once('error', disconnect);
  }

  publish(change: ScopedEntityChange) {
    const message = `event: entity-change\ndata: ${JSON.stringify({
      entity: change.entity,
      operation: change.operation,
      workspaceId: change.workspaceId,
    })}\n\n`;
    for (const connection of this.connections) {
      if (
        !shouldDeliverEntityChange(
          change,
          connection.scopeId,
          connection.workspaceId,
        )
      ) {
        continue;
      }
      try {
        connection.response.write(message);
      } catch {
        this.disconnect(connection);
      }
    }
  }

  close() {
    for (const connection of this.connections) {
      clearInterval(connection.heartbeat);
      connection.response.end();
    }
    this.connections.clear();
  }
}

export async function createEntityChangeStreamRouter(options: {
  events: EventsService;
  httpAuth: HttpAuthService;
  logger: LoggerService;
  workspaceService: WorkspaceService;
  currentScopeIdResolver: CurrentScopeIdResolver;
}) {
  const router = Router();
  const connections = new EntityChangeConnections();

  await options.events.subscribe({
    id: 'browser-stream',
    topics: [
      entityChangeTopics.actions,
      entityChangeTopics.capabilities,
      entityChangeTopics.workflows,
    ],
    onEvent: async event => {
      const change = toBrowserEntityChange(event);
      if (change) {
        connections.publish(change);
      }
    },
  });

  router.get('/stream', (request, response, next) => {
    Promise.all([
      options.httpAuth.credentials(request),
      options.workspaceService.resolveWorkspaceId(request),
      options.currentScopeIdResolver.getCurrentScopeId(),
    ])
      .then(([, workspaceId, scopeId]) =>
        connections.add(request, response, scopeId, workspaceId),
      )
      .catch(next);
  });

  options.logger.info('Entity change browser stream initialized');

  return {
    router,
    close: () => connections.close(),
  };
}

export const entityChangeStreamPlugin = createBackendPlugin({
  pluginId: 'entity-change-stream',
  register(env) {
    env.registerInit({
      deps: {
        events: eventsServiceRef,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        lifecycle: coreServices.lifecycle,
        logger: coreServices.logger,
        workspaceService: workspaceServiceRef,
        currentScopeIdResolver: currentScopeIdServiceRef,
      },
      async init({
        events,
        httpAuth,
        httpRouter,
        lifecycle,
        logger,
        workspaceService,
        currentScopeIdResolver,
      }) {
        const stream = await createEntityChangeStreamRouter({
          events,
          httpAuth,
          logger,
          workspaceService,
          currentScopeIdResolver,
        });
        httpRouter.use(stream.router);
        lifecycle.addShutdownHook(stream.close);
      },
    });
  },
});
