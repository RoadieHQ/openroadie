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

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
};
import { InputError } from '@roadiehq/errors';
import { ExecutionService } from './ExecutionService';

const logger = mockLogger;
const workspaceId = '00000000-0000-4000-8000-000000000001';

function createMockExecutionDao() {
  return {
    list: vi.fn(),
    getById: vi.fn(),
    getNodeExecutions: vi.fn(),
    getRequestLogs: vi.fn(),
    getLogs: vi.fn().mockResolvedValue({ logs: [], total: 0 }),
  };
}

function createMockExecutionService() {
  return {
    cancel: vi.fn(),
    getRequestLogs: vi.fn(),
    isDryRun: vi.fn().mockReturnValue(false),
    execute: vi.fn(),
  };
}

function createMockWorkflowDao() {
  return {
    getById: vi.fn(),
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

describe('ExecutionService', () => {
  const mockExecutionDao = createMockExecutionDao();
  const mockWorkflowDao = createMockWorkflowDao();
  const mockExecutionService = createMockExecutionService();
  const mockAttemptDao = createMockAttemptDao();
  const mockEventDao = createMockEventDao();

  let service: ExecutionService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecutionDao.getById.mockReset();
    mockAttemptDao.displayAttempt.mockResolvedValue(null);
    mockEventDao.readSince.mockResolvedValue([]);
    mockExecutionDao.getLogs.mockResolvedValue({ logs: [], total: 0 });
    mockExecutionService.isDryRun.mockReturnValue(false);
    service = new ExecutionService({
      logger,
      executionDao: mockExecutionDao as any,
      workflowDao: mockWorkflowDao as any,
      attemptDao: mockAttemptDao as any,
      eventDao: mockEventDao as any,
      executionService: mockExecutionService as any,
    });
  });

  describe('list', () => {
    it('returns executions with pagination', async () => {
      const mockExecutions = [
        { id: 'exec-1', status: 'completed' },
        { id: 'exec-2', status: 'running' },
      ];
      mockExecutionDao.list.mockResolvedValue({
        executions: mockExecutions,
        total: 2,
      });

      const result = await service.list({ limit: 10, offset: 0 });

      expect(result.executions).toEqual(mockExecutions);
      expect(result.total).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
    });

    it('throws InputError for invalid status', async () => {
      await expect(service.list({ status: 'bogus' })).rejects.toThrow(
        InputError,
      );
    });

    it('accepts all valid statuses', async () => {
      mockExecutionDao.list.mockResolvedValue({ executions: [], total: 0 });

      const validStatuses = [
        'pending',
        'running',
        'completed',
        'failed',
        'cancelled',
      ];

      for (const status of validStatuses) {
        await service.list({ status });
        expect(mockExecutionDao.list).toHaveBeenCalledWith(
          expect.objectContaining({ status }),
        );
      }
    });
  });

  describe('getById', () => {
    it('returns execution by id', async () => {
      const mockExecution = { id: 'exec-1', status: 'completed' };
      mockExecutionDao.getById.mockResolvedValue(mockExecution);

      const result = await service.getById('exec-1');

      expect(result).toEqual(mockExecution);
      expect(mockExecutionDao.getById).toHaveBeenCalledWith('exec-1', {
        workspaceId,
      });
    });

    it('scopes node executions to the display attempt', async () => {
      mockAttemptDao.displayAttempt.mockResolvedValue({
        attemptId: 'attempt-1',
        state: 'completed',
      });
      mockExecutionDao.getById.mockResolvedValue({ id: 'exec-1' });

      await service.getById('exec-1');

      expect(mockExecutionDao.getById).toHaveBeenCalledWith('exec-1', {
        attemptId: 'attempt-1',
        workspaceId,
      });
    });
  });

  describe('cancel', () => {
    it('cancels execution', async () => {
      mockExecutionService.cancel.mockResolvedValue(undefined);

      await service.cancel('exec-1');

      expect(mockExecutionService.cancel).toHaveBeenCalledWith(
        'exec-1',
        workspaceId,
      );
    });

    it('cancels an in-memory dry run without requiring a database row', async () => {
      mockExecutionDao.getById.mockRejectedValue(
        new Error('Execution not found'),
      );
      mockExecutionService.isDryRun.mockReturnValue(true);

      await expect(service.cancel('dry-run-1')).resolves.toBeUndefined();

      expect(mockExecutionDao.getById).not.toHaveBeenCalled();
      expect(mockExecutionService.cancel).toHaveBeenCalledWith(
        'dry-run-1',
        workspaceId,
      );
    });
  });

  describe('getRequestLogs', () => {
    it('returns HTTP logs for execution', async () => {
      const mockLogs = [
        { target: 'https://api.example.com', status: 200 },
        { target: 'https://api.example.com/2', status: 201 },
      ];
      mockExecutionDao.getRequestLogs.mockResolvedValue([]);
      mockExecutionService.getRequestLogs.mockReturnValue(mockLogs);

      const result = await service.getRequestLogs('exec-1');

      expect(result).toEqual(mockLogs);
      expect(mockExecutionDao.getRequestLogs).toHaveBeenCalledWith({
        executionId: 'exec-1',
      });
      expect(mockExecutionService.getRequestLogs).toHaveBeenCalledWith(
        'exec-1',
      );
    });

    it('returns in-memory dry-run logs without requiring a database row', async () => {
      const dryRunLogs = [
        { target: 'https://api.example.com/preview', status: 200 },
      ];
      mockExecutionDao.getById.mockRejectedValue(
        new Error('Execution not found'),
      );
      mockExecutionService.isDryRun.mockReturnValue(true);
      mockExecutionService.getRequestLogs.mockReturnValue(dryRunLogs);

      await expect(service.getRequestLogs('dry-run-1')).resolves.toEqual(
        dryRunLogs,
      );

      expect(mockExecutionDao.getById).not.toHaveBeenCalled();
      expect(mockExecutionDao.getRequestLogs).not.toHaveBeenCalled();
    });
  });

  describe('getLogs', () => {
    const logEvent = (
      seq: number,
      overrides: Record<string, unknown> = {},
    ) => ({
      seq,
      event: {
        type: 'log',
        executionId: 'exec-1',
        nodeId: 'node-1',
        level: 'info',
        message: `message ${seq}`,
        timestamp: '2026-08-04T00:00:00.000Z',
        ...overrides,
      },
    });

    it('falls back to the legacy logs table when the execution has no attempt', async () => {
      const legacyLogs = [
        {
          id: 1,
          executionId: 'exec-1',
          nodeId: 'node-1',
          level: 'info',
          message: 'Legacy message',
          createdAt: '2026-08-04T00:00:00.000Z',
        },
      ];
      mockExecutionDao.getLogs.mockResolvedValue({
        logs: legacyLogs,
        total: 1,
      });

      const result = await service.getLogs({
        executionId: 'exec-1',
        nodeId: 'node-1',
        level: 'info',
        after: 0,
        limit: 50,
      });

      expect(result).toEqual({
        logs: legacyLogs,
        total: 1,
        offset: 0,
        limit: 50,
      });
      expect(mockExecutionDao.getLogs).toHaveBeenCalledWith({
        executionId: 'exec-1',
        nodeId: 'node-1',
        level: 'info',
        after: 0,
        limit: 50,
      });
      expect(mockEventDao.readSince).not.toHaveBeenCalled();
    });

    it('returns empty when the execution has no attempt and no legacy rows', async () => {
      mockExecutionDao.getLogs.mockResolvedValue({ logs: [], total: 0 });

      const result = await service.getLogs({ executionId: 'exec-1' });

      expect(result).toEqual({ logs: [], total: 0, offset: 0, limit: 100 });
      expect(mockExecutionDao.getLogs).toHaveBeenCalledWith({
        executionId: 'exec-1',
        nodeId: undefined,
        level: undefined,
        after: undefined,
        limit: undefined,
      });
      expect(mockEventDao.readSince).not.toHaveBeenCalled();
    });

    it('reads in-memory dry-run logs without requiring an execution row', async () => {
      mockExecutionService.isDryRun.mockReturnValue(true);
      mockExecutionDao.getLogs.mockResolvedValue({ logs: [], total: 0 });

      await service.getLogs({
        executionId: 'dry-run-1',
        workspaceId: 'workspace-a',
      });

      expect(mockExecutionService.isDryRun).toHaveBeenCalledWith(
        'dry-run-1',
        'workspace-a',
      );
      expect(mockExecutionDao.getById).not.toHaveBeenCalled();
      expect(mockExecutionDao.getLogs).toHaveBeenCalledWith({
        executionId: 'dry-run-1',
        nodeId: undefined,
        level: undefined,
        after: undefined,
        limit: undefined,
      });
    });

    it('reads log events from the display attempt', async () => {
      mockAttemptDao.displayAttempt.mockResolvedValue({
        attemptId: 'attempt-1',
        state: 'completed',
      });
      mockEventDao.readSince
        .mockResolvedValueOnce([
          { seq: 1, event: { type: 'node-started', executionId: 'exec-1' } },
          logEvent(2, { message: 'Started' }),
          logEvent(3, { message: 'Completed' }),
        ])
        .mockResolvedValue([]);

      const result = await service.getLogs({
        executionId: 'exec-1',
        limit: 100,
      });

      expect(result.logs).toEqual([
        {
          id: 2,
          executionId: 'exec-1',
          nodeId: 'node-1',
          level: 'info',
          message: 'Started',
          createdAt: '2026-08-04T00:00:00.000Z',
        },
        {
          id: 3,
          executionId: 'exec-1',
          nodeId: 'node-1',
          level: 'info',
          message: 'Completed',
          createdAt: '2026-08-04T00:00:00.000Z',
        },
      ]);
      expect(result.total).toBe(2);
      expect(result.limit).toBe(100);
      expect(mockEventDao.readSince).toHaveBeenCalledWith(
        'exec-1',
        'attempt-1',
        0,
      );
    });

    it('applies node, level, and after filters', async () => {
      mockAttemptDao.displayAttempt.mockResolvedValue({
        attemptId: 'attempt-1',
        state: 'completed',
      });
      mockEventDao.readSince
        .mockResolvedValueOnce([
          logEvent(1, { level: 'error' }),
          logEvent(2, { nodeId: 'node-2', level: 'error' }),
          logEvent(3, { level: 'info' }),
          logEvent(5, { level: 'error' }),
        ])
        .mockResolvedValue([]);

      const result = await service.getLogs({
        executionId: 'exec-1',
        nodeId: 'node-1',
        level: 'error',
        after: 1,
      });

      expect(result.logs.map(log => log.id)).toEqual([5]);
      expect(result.total).toBe(2);
    });
  });

  describe('retry', () => {
    it.each(['failed', 'cancelled'])('retries %s execution', async status => {
      mockExecutionDao.getById.mockResolvedValue({
        id: 'exec-1',
        workflowId: 'workflow-1',
        status,
      });
      mockWorkflowDao.getById.mockResolvedValue({ id: 'workflow-1' });
      mockExecutionService.execute.mockResolvedValue({ id: 'exec-2' });

      const result = await service.retry('exec-1', {
        triggeredBy: 'user:default/john',
      });

      expect(result.executionId).toBe('exec-2');
      expect(mockWorkflowDao.getById).toHaveBeenCalledWith(
        'workflow-1',
        undefined,
        workspaceId,
      );
      expect(mockExecutionService.execute).toHaveBeenCalledWith(
        { id: 'workflow-1' },
        {
          triggerType: 'manual',
          triggeredBy: 'user:default/john',
          dryRun: false,
          inputs: undefined,
          scopeId: undefined,
          workspaceId,
        },
      );
    });

    it('throws InputError for non-retryable status', async () => {
      mockExecutionDao.getById.mockResolvedValue({
        id: 'exec-1',
        workflowId: 'workflow-1',
        status: 'running',
      });

      await expect(
        service.retry('exec-1', { triggeredBy: 'user:default/john' }),
      ).rejects.toThrow(InputError);
    });

    it('throws InputError for completed execution', async () => {
      mockExecutionDao.getById.mockResolvedValue({
        id: 'exec-1',
        workflowId: 'workflow-1',
        status: 'completed',
      });

      await expect(
        service.retry('exec-1', { triggeredBy: 'user:default/john' }),
      ).rejects.toThrow(/Can only retry failed or cancelled/);
    });

    it('passes dryRun and inputs options', async () => {
      mockExecutionDao.getById.mockResolvedValue({
        id: 'exec-1',
        workflowId: 'workflow-1',
        status: 'failed',
      });
      mockWorkflowDao.getById.mockResolvedValue({ id: 'workflow-1' });
      mockExecutionService.execute.mockResolvedValue({ id: 'exec-2' });

      await service.retry('exec-1', {
        triggeredBy: 'user:default/john',
        dryRun: true,
        inputs: { key: 'value' },
      });

      expect(mockExecutionService.execute).toHaveBeenCalledWith(
        { id: 'workflow-1' },
        {
          triggerType: 'manual',
          triggeredBy: 'user:default/john',
          dryRun: true,
          inputs: { key: 'value' },
          scopeId: undefined,
          workspaceId,
        },
      );
    });
  });

  describe('getNodeExecutions', () => {
    it('returns node executions scoped to the display attempt', async () => {
      const mockNodeExecutions = [
        { nodeId: 'node-1', status: 'completed' },
        { nodeId: 'node-2', status: 'running' },
      ];
      mockAttemptDao.displayAttempt.mockResolvedValue({
        attemptId: 'attempt-1',
        state: 'active',
      });
      mockExecutionDao.getNodeExecutions.mockResolvedValue(mockNodeExecutions);

      const result = await service.getNodeExecutions('exec-1');

      expect(result).toEqual(mockNodeExecutions);
      expect(mockExecutionDao.getNodeExecutions).toHaveBeenCalledWith(
        'exec-1',
        { attemptId: 'attempt-1' },
      );
    });

    it('reads in-memory dry-run nodes without requiring an execution row', async () => {
      mockExecutionService.isDryRun.mockReturnValue(true);
      mockExecutionDao.getNodeExecutions.mockResolvedValue([]);

      await service.getNodeExecutions('dry-run-1', 'workspace-a');

      expect(mockExecutionService.isDryRun).toHaveBeenCalledWith(
        'dry-run-1',
        'workspace-a',
      );
      expect(mockExecutionDao.getById).not.toHaveBeenCalled();
      expect(mockExecutionDao.getNodeExecutions).toHaveBeenCalledWith(
        'dry-run-1',
        undefined,
      );
    });
  });
});
