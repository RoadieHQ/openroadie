import { vi } from 'vitest';

/*
 * Copyright 2025 Larder Software Limited
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

import { StreamingService, StreamSession } from './StreamingService';

function createMockExecutionDao() {
  return {
    getById: vi.fn(),
    getLogs: vi.fn().mockResolvedValue({ logs: [], total: 0 }),
    getRequestLogs: vi.fn().mockResolvedValue([]),
  };
}

function createMockAttemptDao() {
  return {
    displayAttempt: vi.fn().mockResolvedValue(null),
  };
}

function createMockEventDao() {
  return {
    readSince: vi.fn().mockResolvedValue([]),
  };
}

function createMockExecutionService() {
  const unsubscribe = vi.fn();
  return {
    getBufferedEvents: vi.fn().mockReturnValue([]),
    subscribe: vi.fn().mockReturnValue(unsubscribe),
    unsubscribe,
    notifyClientConnected: vi.fn(),
    isDryRun: vi.fn().mockReturnValue(false),
    knowsExecution: vi.fn().mockReturnValue(false),
  };
}

function createMockSession(): StreamSession & {
  pushedEvents: Array<{ type: string; data: unknown }>;
} {
  const session = {
    isConnected: true,
    pushedEvents: [] as Array<{ type: string; data: unknown }>,
    push: vi.fn((data: unknown, eventType: string) => {
      session.pushedEvents.push({ type: eventType, data });
    }),
    onDisconnect: vi.fn(),
  };
  return session;
}

const startedEvent = {
  type: 'execution-started',
  executionId: 'exec-1',
  workflowId: 'wf-1',
  timestamp: '2026-01-01T00:00:00Z',
};
const nodeCompletedEvent = {
  type: 'node-completed',
  executionId: 'exec-1',
  nodeId: 'node-1',
  outputStats: { itemCount: 3, approxBytes: 30, sampleTruncated: false },
  timestamp: '2026-01-01T00:00:01Z',
};
const completedEvent = {
  type: 'execution-completed',
  executionId: 'exec-1',
  output: { sinks: [], stats: {} },
  timestamp: '2026-01-01T00:00:02Z',
};

describe('StreamingService', () => {
  const mockExecutionDao = createMockExecutionDao();
  const mockAttemptDao = createMockAttemptDao();
  const mockEventDao = createMockEventDao();
  const mockExecutionService = createMockExecutionService();

  let service: StreamingService;

  const buildService = (dbPollIntervalMs = 5) =>
    new StreamingService({
      executionDao: mockExecutionDao as any,
      attemptDao: mockAttemptDao as any,
      eventDao: mockEventDao as any,
      executionService: mockExecutionService as any,
      dbPollIntervalMs,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecutionService.isDryRun.mockReturnValue(false);
    mockExecutionService.getBufferedEvents.mockReturnValue([]);
    mockExecutionService.subscribe.mockReturnValue(
      mockExecutionService.unsubscribe,
    );
    mockAttemptDao.displayAttempt.mockResolvedValue(null);
    mockEventDao.readSince.mockResolvedValue([]);
    mockExecutionDao.getLogs.mockResolvedValue({ logs: [], total: 0 });
    mockExecutionDao.getRequestLogs.mockResolvedValue([]);
    service = buildService();
  });

  describe('persistent runs (durable events)', () => {
    it('sends connected first, then replays the attempt history and closes on the terminal event', async () => {
      mockAttemptDao.displayAttempt.mockResolvedValue({
        attemptId: 'attempt-1',
        state: 'completed',
      });
      mockEventDao.readSince
        .mockResolvedValueOnce([
          { seq: 1, event: startedEvent },
          { seq: 2, event: nodeCompletedEvent },
          { seq: 3, event: completedEvent },
        ])
        .mockResolvedValue([]);

      const session = createMockSession();
      await service.streamExecution('exec-1', session);

      expect(session.pushedEvents.map(e => e.type)).toEqual([
        'connected',
        'execution-started',
        'node-completed',
        'execution-completed',
        'close',
      ]);
      expect(mockEventDao.readSince).toHaveBeenCalledWith(
        'exec-1',
        'attempt-1',
        0,
      );
      expect(mockExecutionService.subscribe).not.toHaveBeenCalled();
      expect(mockExecutionService.notifyClientConnected).not.toHaveBeenCalled();
    });

    it('replays the full history again on reconnect after the terminal event', async () => {
      mockAttemptDao.displayAttempt.mockResolvedValue({
        attemptId: 'attempt-1',
        state: 'completed',
      });
      const history = [
        { seq: 1, event: startedEvent },
        { seq: 2, event: completedEvent },
      ];
      mockEventDao.readSince.mockResolvedValueOnce(history);
      const firstSession = createMockSession();
      await service.streamExecution('exec-1', firstSession);

      mockEventDao.readSince.mockResolvedValueOnce(history);
      const reconnected = createMockSession();
      await service.streamExecution('exec-1', reconnected);

      expect(reconnected.pushedEvents.map(e => e.type)).toEqual([
        'connected',
        'execution-started',
        'execution-completed',
        'close',
      ]);
    });

    it('re-dispatches from seq 0 when a newer display attempt takes over', async () => {
      mockExecutionDao.getById.mockResolvedValue({
        id: 'exec-1',
        status: 'running',
      });
      // resolveStreamMode consumes the first displayAttempt call.
      mockAttemptDao.displayAttempt
        .mockResolvedValueOnce({ attemptId: 'attempt-1', state: 'active' })
        .mockResolvedValueOnce({ attemptId: 'attempt-1', state: 'active' })
        .mockResolvedValue({ attemptId: 'attempt-2', state: 'active' });
      mockEventDao.readSince.mockImplementation(
        async (_executionId: string, attemptId: string, afterSeq: number) => {
          if (attemptId === 'attempt-1') {
            return afterSeq === 0 ? [{ seq: 1, event: startedEvent }] : [];
          }
          return afterSeq === 0
            ? [
                { seq: 1, event: startedEvent },
                { seq: 2, event: completedEvent },
              ]
            : [];
        },
      );

      const session = createMockSession();
      await service.streamExecution('exec-1', session);

      expect(session.pushedEvents.map(e => e.type)).toEqual([
        'connected',
        'execution-started',
        'execution-started',
        'execution-completed',
        'close',
      ]);
      expect(mockEventDao.readSince).toHaveBeenCalledWith(
        'exec-1',
        'attempt-2',
        0,
      );
    });

    it.each([
      ['completed', 'execution-completed'],
      ['failed', 'execution-error'],
      ['cancelled', 'execution-cancelled'],
    ])(
      'synthesizes %s terminal from the execution row when no attempt exists',
      async (status, eventType) => {
        mockExecutionDao.getById.mockResolvedValue({
          id: 'exec-1',
          workflowId: 'wf-1',
          status,
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T00:00:10Z',
          error: status === 'failed' ? 'Something went wrong' : undefined,
          nodeExecutions: [],
        });

        const session = createMockSession();
        await service.streamExecution('exec-1', session);

        expect(session.pushedEvents.map(e => e.type)).toEqual([
          'connected',
          'execution-started',
          eventType,
          'close',
        ]);

        const terminal = session.pushedEvents.find(e => e.type === eventType);
        expect(terminal).toBeDefined();
        expect(terminal?.data).toMatchObject({
          type: eventType,
          executionId: 'exec-1',
        });
        const last = session.pushedEvents[session.pushedEvents.length - 1];
        expect(last.type).toBe('close');
        expect(last.data).toEqual({ done: true });
      },
    );

    it('keeps polling while the run is live and closes once the terminal event lands', async () => {
      mockExecutionDao.getById.mockResolvedValue({
        id: 'exec-1',
        status: 'running',
      });
      mockAttemptDao.displayAttempt.mockResolvedValue({
        attemptId: 'attempt-1',
        state: 'active',
      });
      let polls = 0;
      mockEventDao.readSince.mockImplementation(
        async (_executionId: string, _attemptId: string, afterSeq: number) => {
          polls++;
          if (polls === 1) {
            return [{ seq: 1, event: startedEvent }];
          }
          if (polls >= 3 && afterSeq === 1) {
            return [{ seq: 2, event: completedEvent }];
          }
          return [];
        },
      );

      const session = createMockSession();
      await service.streamExecution('exec-1', session);

      expect(session.pushedEvents.map(e => e.type)).toEqual([
        'connected',
        'execution-started',
        'execution-completed',
        'close',
      ]);
    });

    it('stops polling when the session disconnects', async () => {
      const session = createMockSession();
      mockAttemptDao.displayAttempt.mockImplementation(async () => {
        session.isConnected = false;
        return { attemptId: 'attempt-1', state: 'active' };
      });
      mockExecutionDao.getById.mockResolvedValue({
        id: 'exec-1',
        status: 'running',
      });

      await service.streamExecution('exec-1', session);

      const types = session.pushedEvents.map(e => e.type);
      expect(types).not.toContain('close');
    });

    it('does not push events when the session is disconnected', async () => {
      mockExecutionDao.getById.mockResolvedValue({
        id: 'exec-1',
        status: 'completed',
        completedAt: '2025-01-01T00:00:00Z',
      });

      const session = createMockSession();
      session.isConnected = false;

      await service.streamExecution('exec-1', session);

      expect(session.push).not.toHaveBeenCalled();
    });

    it('ends the stream when the execution row is gone', async () => {
      mockExecutionDao.getById.mockRejectedValue(new Error('not found'));

      const session = createMockSession();
      await service.streamExecution('exec-1', session);

      expect(session.pushedEvents.map(e => e.type)).toEqual(['connected']);
    });
  });

  describe('attempt-less running runs (DB synthesis)', () => {
    it('synthesizes from the database once a running attempt-less run outlasts the grace period', async () => {
      mockAttemptDao.displayAttempt.mockResolvedValue(null);

      let calls = 0;
      mockExecutionDao.getById.mockImplementation(async () => {
        calls++;
        const status = calls >= 4 ? 'completed' : 'running';
        return {
          id: 'exec-1',
          workflowId: 'wf-1',
          status,
          startedAt: '2026-01-01T00:00:00Z',
          completedAt:
            status === 'completed' ? '2026-01-01T00:00:10Z' : undefined,
          nodeExecutions: [],
        };
      });

      const session = createMockSession();
      await service.streamExecution('exec-1', session);

      expect(mockExecutionService.subscribe).not.toHaveBeenCalled();
      expect(mockEventDao.readSince).not.toHaveBeenCalled();
      expect(calls).toBeGreaterThanOrEqual(4);
      expect(session.pushedEvents.map(e => e.type)).toEqual([
        'connected',
        'execution-started',
        'execution-completed',
        'close',
      ]);
    });
  });

  describe('dry-runs (in-memory)', () => {
    beforeEach(() => {
      mockExecutionService.isDryRun.mockReturnValue(true);
    });

    it('subscribes to live events and signals the client connection', async () => {
      const session = createMockSession();
      await service.streamExecution('exec-1', session);

      expect(mockExecutionService.subscribe).toHaveBeenCalledWith(
        'exec-1',
        expect.any(Function),
      );
      expect(mockExecutionService.notifyClientConnected).toHaveBeenCalledWith(
        'exec-1',
      );
      expect(session.onDisconnect).toHaveBeenCalledWith(expect.any(Function));
      expect(mockEventDao.readSince).not.toHaveBeenCalled();
    });

    it('replays buffered events', async () => {
      mockExecutionService.getBufferedEvents.mockReturnValue([
        startedEvent,
        nodeCompletedEvent,
      ]);

      const session = createMockSession();
      await service.streamExecution('exec-1', session);

      expect(session.pushedEvents).toContainEqual({
        type: 'execution-started',
        data: startedEvent,
      });
      expect(session.pushedEvents).toContainEqual({
        type: 'node-completed',
        data: nodeCompletedEvent,
      });
    });

    it('closes immediately when the buffer already holds a terminal event', async () => {
      mockExecutionService.getBufferedEvents.mockReturnValue([
        startedEvent,
        completedEvent,
      ]);

      const session = createMockSession();
      await service.streamExecution('exec-1', session);

      expect(mockExecutionService.unsubscribe).toHaveBeenCalled();
      const last = session.pushedEvents[session.pushedEvents.length - 1];
      expect(last.type).toBe('close');
      expect(mockExecutionService.notifyClientConnected).not.toHaveBeenCalled();
    });

    it('dedupes an event delivered both live and via the buffer', async () => {
      let liveHandler: ((event: unknown) => void) | undefined;
      mockExecutionService.subscribe.mockImplementation(
        (_id: string, handler: (event: unknown) => void) => {
          liveHandler = handler;
          return mockExecutionService.unsubscribe;
        },
      );
      mockExecutionService.getBufferedEvents.mockReturnValue([startedEvent]);

      const session = createMockSession();
      await service.streamExecution('exec-1', session);
      liveHandler?.(startedEvent);
      liveHandler?.(completedEvent);

      const startedCount = session.pushedEvents.filter(
        e => e.type === 'execution-started',
      ).length;
      expect(startedCount).toBe(1);
      expect(session.pushedEvents[session.pushedEvents.length - 1].type).toBe(
        'close',
      );
    });
  });
});
