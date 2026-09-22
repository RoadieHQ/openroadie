/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { DatasourceEvents } from './DatasourceEvents';
import { WebhookEmitter } from './WebhookEmitter';
import type { WebhookSubscription } from '../database/WebhookSubscriptionDao';
import type { WebhookSubscriptionDao } from '../database/WebhookSubscriptionDao';
import { SIGNATURE_HEADER, signBody } from './signing';
import { resetSharedDatasourceEventsForTesting } from './sharedState';

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
} as unknown as ConstructorParameters<typeof WebhookEmitter>[0]['logger'];

function fakeDao(subscriptions: WebhookSubscription[]): WebhookSubscriptionDao {
  return {
    list: async (workspaceId: string) =>
      subscriptions.filter(
        subscription => subscription.workspaceId === workspaceId,
      ),
  } as unknown as WebhookSubscriptionDao;
}

const datasourceId = '00000000-0000-0000-0000-000000000001';

describe('WebhookEmitter', () => {
  afterEach(() => {
    resetSharedDatasourceEventsForTesting();
  });

  it('drops pending deliveries after their workspace is deleted', async () => {
    const events = new DatasourceEvents();
    const fetchImpl = vi.fn<typeof fetch>();
    const subscriptionDao = fakeDao([]);
    const list = vi.spyOn(subscriptionDao, 'list');
    const emitter = new WebhookEmitter({
      logger: noopLogger,
      events,
      subscriptionDao,
      fetchImpl,
      workspaceExists: vi.fn().mockResolvedValue(false),
    });

    events.emitChanged(datasourceId, 'workspace-deleted');
    await emitter.flushNow();
    emitter.stop();

    expect(list).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('drops a delivery when its workspace is deleted during subscription lookup', async () => {
    const events = new DatasourceEvents();
    const fetchImpl = vi.fn<typeof fetch>();
    const workspaceExists = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const emitter = new WebhookEmitter({
      logger: noopLogger,
      events,
      subscriptionDao: fakeDao([
        {
          id: 'sub-1',
          workspaceId: 'workspace-deleted',
          url: 'https://example.test/hook',
          secret: 'secret-1',
          filters: {},
          createdAt: '',
          updatedAt: '',
        },
      ]),
      fetchImpl,
      workspaceExists,
    });

    events.emitChanged(datasourceId, 'workspace-deleted');
    await emitter.flushNow();
    emitter.stop();

    expect(workspaceExists).toHaveBeenCalledTimes(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('stops retrying when the workspace is deleted', async () => {
    const events = new DatasourceEvents();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const workspaceExists = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const emitter = new WebhookEmitter({
      logger: noopLogger,
      events,
      subscriptionDao: fakeDao([
        {
          id: 'sub-1',
          workspaceId: 'workspace-deleted',
          url: 'https://example.test/hook',
          secret: 'secret-1',
          filters: {},
          createdAt: '',
          updatedAt: '',
        },
      ]),
      fetchImpl,
      workspaceExists,
      retryDelaysMs: [1, 1],
    });

    events.emitChanged(datasourceId, 'workspace-deleted');
    await emitter.flushNow();
    emitter.stop();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of events for the same datasource into a single fire', async () => {
    const calls: Array<{ url: string; body: string; sig: string }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      // eslint-disable-next-line security/detect-object-injection
      const sig = headers[SIGNATURE_HEADER];
      calls.push({ url, body: init.body as string, sig });
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    const events = new DatasourceEvents();
    const emitter = new WebhookEmitter({
      logger: noopLogger,
      events,
      subscriptionDao: fakeDao([
        {
          id: 'sub-1',
          workspaceId: '00000000-0000-4000-8000-000000000001',
          url: 'https://example.test/hook',
          secret: 'secret-1',
          filters: { pluginId: 'datasources' },
          createdAt: '',
          updatedAt: '',
        },
      ]),
      fetchImpl,
      debounceMs: 50,
    });

    for (let i = 0; i < 10; i += 1) events.emitChanged(datasourceId);
    await new Promise(r => setTimeout(r, 120));
    emitter.stop();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://example.test/hook');
    expect(calls[0].sig).toBe(signBody('secret-1', calls[0].body));
    const payload = JSON.parse(calls[0].body);
    expect(payload).toMatchObject({
      event: 'datasource-updated',
      metadata: { datasourceId, status: 'success' },
    });
    expect(typeof payload.timestamp).toBe('string');
  });

  it("delivers an event only to the event workspace's subscriptions", async () => {
    const workspaceA = '00000000-0000-4000-8000-000000000001';
    const workspaceB = '00000000-0000-4000-8000-000000000002';
    const deliveredUrls: string[] = [];
    const fetchImpl = (async (url: string) => {
      deliveredUrls.push(url);
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const events = new DatasourceEvents();
    const emitter = new WebhookEmitter({
      logger: noopLogger,
      events,
      subscriptionDao: fakeDao([
        {
          id: 'sub-a',
          workspaceId: workspaceA,
          url: 'https://workspace-a.example.test/hook',
          secret: 'secret-a',
          filters: {},
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'sub-b',
          workspaceId: workspaceB,
          url: 'https://workspace-b.example.test/hook',
          secret: 'secret-b',
          filters: {},
          createdAt: '',
          updatedAt: '',
        },
      ]),
      fetchImpl,
      debounceMs: 1,
    });

    events.emitChanged(datasourceId, workspaceA);
    await emitter.flushNow();
    emitter.stop();

    expect(deliveredUrls).toEqual(['https://workspace-a.example.test/hook']);
  });

  it('does not retry 401 responses', async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return new Response(null, { status: 401 });
    }) as unknown as typeof fetch;

    const events = new DatasourceEvents();
    const emitter = new WebhookEmitter({
      logger: noopLogger,
      events,
      subscriptionDao: fakeDao([
        {
          id: 'sub-1',
          workspaceId: '00000000-0000-4000-8000-000000000001',
          url: 'https://example.test/hook',
          secret: 's',
          filters: {},
          createdAt: '',
          updatedAt: '',
        },
      ]),
      fetchImpl,
      debounceMs: 1,
      retryDelaysMs: [1, 1, 1],
    });

    events.emitChanged(datasourceId);
    await new Promise(r => setTimeout(r, 50));
    emitter.stop();

    expect(attempts).toBe(1);
  });

  it('retries 5xx up to retryDelaysMs.length + 1 attempts then drops', async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return new Response(null, { status: 503 });
    }) as unknown as typeof fetch;

    const events = new DatasourceEvents();
    const emitter = new WebhookEmitter({
      logger: noopLogger,
      events,
      subscriptionDao: fakeDao([
        {
          id: 'sub-1',
          workspaceId: '00000000-0000-4000-8000-000000000001',
          url: 'https://example.test/hook',
          secret: 's',
          filters: {},
          createdAt: '',
          updatedAt: '',
        },
      ]),
      fetchImpl,
      debounceMs: 1,
      retryDelaysMs: [1, 2, 3],
    });

    events.emitChanged(datasourceId);
    await new Promise(r => setTimeout(r, 80));
    emitter.stop();

    expect(attempts).toBe(4);
  });

  it('skips subscriptions whose pluginId filter does not match datasources', async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    const events = new DatasourceEvents();
    const emitter = new WebhookEmitter({
      logger: noopLogger,
      events,
      subscriptionDao: fakeDao([
        {
          id: 'unrelated',
          workspaceId: '00000000-0000-4000-8000-000000000001',
          url: 'https://example.test/other',
          secret: 's',
          filters: { pluginId: 'something-else' },
          createdAt: '',
          updatedAt: '',
        },
      ]),
      fetchImpl,
      debounceMs: 1,
    });

    events.emitChanged(datasourceId);
    await new Promise(r => setTimeout(r, 30));
    emitter.stop();

    expect(attempts).toBe(0);
  });
});
