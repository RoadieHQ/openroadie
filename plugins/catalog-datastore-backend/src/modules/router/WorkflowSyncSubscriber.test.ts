import { mockServices } from '@roadiehq/backend-test-utils';
import type {
  EventsService,
  EventsServiceSubscribeOptions,
} from '@roadiehq/backend-defaults';
import { WORKFLOW_DATASTORE_SYNC_TOPIC } from '@roadiehq/catalog-workflow-common';
import { WorkflowSyncSubscriber } from './WorkflowSyncSubscriber';

describe('WorkflowSyncSubscriber', () => {
  let subscription: EventsServiceSubscribeOptions | undefined;
  let onSync: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let workspaceExists: ReturnType<
    typeof vi.fn<(id: string) => Promise<boolean>>
  >;
  let runInScope: ReturnType<
    typeof vi.fn<
      (
        scopeId: string | undefined,
        action: () => Promise<void>,
      ) => Promise<void>
    >
  >;

  const events = {
    subscribe: vi.fn(async (options: EventsServiceSubscribeOptions) => {
      subscription = options;
    }),
    publish: vi.fn(),
  } as unknown as EventsService;

  beforeEach(async () => {
    subscription = undefined;
    onSync = vi.fn().mockResolvedValue(undefined);
    workspaceExists = vi.fn().mockResolvedValue(true);
    runInScope = vi.fn(async (_scopeId, action) => action());
    const subscriber = new WorkflowSyncSubscriber({
      events,
      logger: mockServices.logger.mock(),
      onSync,
      workspaceExists,
      runInScope,
    });
    await subscriber.subscribe();
  });

  it('subscribes to the workflow datastore sync topic', () => {
    expect(subscription?.topics).toEqual([WORKFLOW_DATASTORE_SYNC_TOPIC]);
  });

  it('forwards the datasource id and delta from a sync event', async () => {
    await subscription!.onEvent({
      topic: WORKFLOW_DATASTORE_SYNC_TOPIC,
      eventPayload: {
        scopeId: 'tenant-1',
        datasourceId: 'ds-1',
        workflowId: 'ds-1',
        workflowName: 'DS 1',
        itemCount: 3,
        deleted: 1,
        updated: 2,
        inserted: 0,
      },
    });
    expect(runInScope).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(onSync).toHaveBeenCalledWith('ds-1', {
      deleted: 1,
      updated: 2,
      inserted: 0,
    });
  });

  it('treats missing delta counts as zero', async () => {
    await subscription!.onEvent({
      topic: WORKFLOW_DATASTORE_SYNC_TOPIC,
      eventPayload: { datasourceId: 'ds-1', workflowId: 'ds-1' },
    });
    expect(onSync).toHaveBeenCalledWith('ds-1', {
      deleted: 0,
      updated: 0,
      inserted: 0,
    });
  });

  it('forwards the workspace from a sync event', async () => {
    await subscription!.onEvent({
      topic: WORKFLOW_DATASTORE_SYNC_TOPIC,
      eventPayload: {
        datasourceId: 'ds-1',
        workflowId: 'ds-1',
        workspaceId: 'workspace-1',
      },
    });
    expect(onSync).toHaveBeenCalledWith(
      'ds-1',
      { deleted: 0, updated: 0, inserted: 0 },
      'workspace-1',
    );
  });

  it('ignores queued events after their workspace is deleted', async () => {
    workspaceExists.mockResolvedValueOnce(false);

    await subscription!.onEvent({
      topic: WORKFLOW_DATASTORE_SYNC_TOPIC,
      eventPayload: {
        datasourceId: 'ds-1',
        workflowId: 'ds-1',
        workspaceId: 'workspace-1',
      },
    });

    expect(onSync).not.toHaveBeenCalled();
  });

  it('ignores events on other topics and malformed payloads', async () => {
    await subscription!.onEvent({
      topic: 'some.other.topic',
      eventPayload: { datasourceId: 'ds-1' },
    });
    await subscription!.onEvent({
      topic: WORKFLOW_DATASTORE_SYNC_TOPIC,
      eventPayload: { nope: true },
    });
    expect(onSync).not.toHaveBeenCalled();
  });

  it('swallows onSync failures so the event bus keeps delivering', async () => {
    onSync.mockRejectedValueOnce(new Error('boom'));
    await expect(
      subscription!.onEvent({
        topic: WORKFLOW_DATASTORE_SYNC_TOPIC,
        eventPayload: { datasourceId: 'ds-1', workflowId: 'ds-1' },
      }),
    ).resolves.toBeUndefined();
  });
});
