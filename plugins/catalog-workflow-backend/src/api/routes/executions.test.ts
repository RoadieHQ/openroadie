import { vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { allowAllScopeService } from '@roadiehq/scopes';
import { mockServices } from '@roadiehq/backend-test-utils';
import type {
  WorkflowDefinition,
  WorkflowOutput,
} from '@roadiehq/catalog-workflow-common';
import { NotFoundError } from '@roadiehq/errors';
import { PagedExecutionService } from '@roadiehq/catalog-workflow-engine';
import { ExecutionService } from '../../services';
import { createExecutionsRouter } from './executions';

const workspaceId = '00000000-0000-4000-8000-000000000002';
const workflow = {
  id: 'workflow-1',
  name: 'Workflow',
  version: 1,
  workspaceId,
  nodes: [],
  edges: [],
} as unknown as WorkflowDefinition;
const output: WorkflowOutput = {
  sinks: [],
  stats: {
    nodesExecuted: 0,
    nodesFailed: 0,
    nodesSkipped: 0,
    durationMs: 1,
  },
};

function createHarness(executeDryRun: (options: any) => Promise<any>) {
  const executionDao = {
    getById: vi.fn(async (id: string) => {
      throw new NotFoundError(`Execution not found: ${id}`);
    }),
    getRequestLogs: vi.fn(async () => []),
  };
  const pagedExecutionService = new PagedExecutionService({
    executor: {
      executeAttempt: vi.fn(),
      executeDryRun: vi.fn(
        async (_definition: WorkflowDefinition, options: any) =>
          executeDryRun(options),
      ),
    } as any,
    executionDao: executionDao as any,
    attemptDao: { cancelActiveAttempt: vi.fn(async () => false) },
    logger: mockServices.logger.mock(),
  });
  const executionService = new ExecutionService({
    logger: mockServices.logger.mock(),
    executionDao: executionDao as any,
    workflowDao: {} as any,
    attemptDao: { displayAttempt: vi.fn(async () => null) } as any,
    eventDao: {} as any,
    executionService: pagedExecutionService,
  });
  const app = express();
  app.use(express.json());
  app.use(
    createExecutionsRouter({
      executionService,
      streamingService: {} as any,
      getUserId: async () => 'user:default/test',
      getOptionalScopeId: () => undefined,
      getWorkspaceId: () => workspaceId,
      scopeService: allowAllScopeService,
    }),
  );
  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(error.name === 'NotFoundError' ? 404 : 500).json({
        error: { message: error.message },
      });
    },
  );
  return { app, executionDao, pagedExecutionService };
}

describe('createExecutionsRouter dry runs', () => {
  it('returns request logs for an in-memory dry run without a database row', async () => {
    const { app, executionDao, pagedExecutionService } = createHarness(
      async options => {
        options.onEvent?.({
          type: 'http-request',
          executionId: options.executionId,
          nodeId: 'source',
          log: {
            id: 'request-1',
            executionId: options.executionId,
            nodeId: 'source',
            source: 'github',
            target: '/repos',
            operation: 'GET',
            duration: 12,
            timestamp: '2026-09-01T00:00:00.000Z',
          },
          timestamp: '2026-09-01T00:00:00.000Z',
        });
        return { output, nodeOutputs: [] };
      },
    );
    const executionId = await pagedExecutionService.executeDryRun(workflow, {
      triggerType: 'manual',
      dryRun: true,
    });
    await vi.waitFor(() =>
      expect(pagedExecutionService.getRequestLogs(executionId)).toHaveLength(1),
    );

    const response = await request(app).get(`/${executionId}/request-logs`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({ target: '/repos', operation: 'GET' }),
    ]);
    expect(executionDao.getById).not.toHaveBeenCalled();
  });

  it('cancels an in-memory dry run without a database row', async () => {
    const { app, executionDao, pagedExecutionService } = createHarness(
      options =>
        new Promise((_, reject) => {
          options.signal?.addEventListener('abort', () =>
            reject(new Error('Execution cancelled')),
          );
        }),
    );
    const executionId = await pagedExecutionService.executeDryRun(workflow, {
      triggerType: 'manual',
      dryRun: true,
    });

    const response = await request(app).post(`/${executionId}/cancel`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(executionDao.getById).not.toHaveBeenCalled();
  });
});
