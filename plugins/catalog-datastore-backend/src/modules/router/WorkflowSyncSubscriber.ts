import type { EventsService, EventParams } from '@roadiehq/backend-defaults';
import {
  runWithoutRequestContext,
  type LoggerService,
} from '@roadiehq/extensions-api';
import {
  WORKFLOW_DATASTORE_SYNC_TOPIC,
  type DatastoreSyncEventPayload,
} from '@roadiehq/catalog-workflow-common';
import type { PublishDelta } from '@roadiehq/catalog-datastore-node';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import type { ScopeRunner } from '@roadiehq/integrations-node';

export interface WorkflowSyncSubscriberOptions {
  events: EventsService;
  logger: LoggerService;
  onSync: (
    datasourceId: string,
    delta: PublishDelta,
    workspaceId?: string,
  ) => Promise<void>;
  workspaceExists?: (workspaceId: string) => Promise<boolean>;
  runInScope?: ScopeRunner['runInScope'];
}

function isDatastoreSyncEventPayload(
  payload: unknown,
): payload is DatastoreSyncEventPayload {
  return (
    !!payload &&
    typeof payload === 'object' &&
    'datasourceId' in payload &&
    typeof payload.datasourceId === 'string' &&
    (!('workspaceId' in payload) ||
      payload.workspaceId === undefined ||
      typeof payload.workspaceId === 'string') &&
    (!('scopeId' in payload) ||
      payload.scopeId === undefined ||
      typeof payload.scopeId === 'string')
  );
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Bridges workflow-run publishes into this plugin's post-publish side effects
 * (sc-34243). A data source execution writes to the datastore through the
 * paged engine's StagedPublisher — not through `replaceDatasourceItems` — so
 * without this subscription a run would never re-apply relationship rules,
 * emit datasource-changed (context groups, webhooks), or record the activity
 * marker. The sync-topic event fires on every publish and carries the delta;
 * `onSync` gates the side effects on it.
 */
export class WorkflowSyncSubscriber {
  private readonly events: EventsService;
  private readonly logger: LoggerService;
  private readonly onSync: (
    datasourceId: string,
    delta: PublishDelta,
    workspaceId?: string,
  ) => Promise<void>;
  private readonly workspaceExists: (workspaceId: string) => Promise<boolean>;
  private readonly runInScope: ScopeRunner['runInScope'];

  constructor(options: WorkflowSyncSubscriberOptions) {
    this.events = options.events;
    this.logger = options.logger.child({ name: 'WorkflowSyncSubscriber' });
    this.onSync = options.onSync;
    this.workspaceExists =
      options.workspaceExists ??
      (async workspaceId => workspaceId === DEFAULT_WORKSPACE_ID);
    this.runInScope =
      options.runInScope ?? (async (_scopeId, action) => action());
  }

  async subscribe(): Promise<void> {
    await this.events.subscribe({
      id: 'catalog-datastore-workflow-sync',
      topics: [WORKFLOW_DATASTORE_SYNC_TOPIC],
      onEvent: event => this.onEvent(event),
    });
  }

  private async onEvent(event: EventParams): Promise<void> {
    if (event.topic !== WORKFLOW_DATASTORE_SYNC_TOPIC) {
      return;
    }
    if (!isDatastoreSyncEventPayload(event.eventPayload)) {
      this.logger.warn('Ignoring datastore sync event with invalid payload');
      return;
    }
    const payload = event.eventPayload;
    await runWithoutRequestContext(() =>
      this.runInScope(payload.scopeId, () => this.processPayload(payload)),
    );
  }

  private async processPayload(
    payload: DatastoreSyncEventPayload,
  ): Promise<void> {
    const workspaceId = payload.workspaceId ?? DEFAULT_WORKSPACE_ID;
    if (!(await this.workspaceExists(workspaceId))) {
      return;
    }
    try {
      const delta = {
        deleted: toCount(payload.deleted),
        updated: toCount(payload.updated),
        inserted: toCount(payload.inserted),
      };
      if (payload.workspaceId) {
        await this.onSync(payload.datasourceId, delta, payload.workspaceId);
      } else {
        await this.onSync(payload.datasourceId, delta);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to run post-publish side effects for datasource ${payload.datasourceId}: ${message}`,
      );
    }
  }
}
