import { describe, expect, it, vi } from 'vitest';
import { InputError } from '@roadiehq/errors';
import { NODE_TYPES } from '@roadiehq/catalog-workflow-common';
import { WorkflowService } from './WorkflowService';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

function workflow(id: string, upstreamDatasourceId?: string) {
  return {
    id,
    name: id,
    slug: id,
    version: 1,
    workflowType: 'data-ingestion',
    enabled: true,
    edges: [],
    createdBy: 'me',
    createdAt: '',
    updatedAt: '',
    nodes: upstreamDatasourceId
      ? [
          {
            id: 'source-node',
            type: NODE_TYPES.SOURCE_DATASTORE,
            position: { x: 0, y: 0 },
            data: {
              label: 'From another data source',
              config: { datasourceId: upstreamDatasourceId },
            },
          },
        ]
      : [],
  };
}

describe('WorkflowService', () => {
  it('cleans merge staging data only in the workflow workspace', async () => {
    const workspaceId = '22222222-2222-4222-8222-222222222222';
    const workflowDao = {
      getById: vi.fn().mockResolvedValue({
        ...workflow('workflow-1'),
        nodes: [
          {
            id: 'merge-1',
            type: NODE_TYPES.TRANSFORM_MERGE,
            position: { x: 0, y: 0 },
            data: { label: 'Merge', config: {} },
          },
        ],
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const catalogDatastoreClient = {
      deleteAllIndexConfigurations: vi.fn().mockResolvedValue(undefined),
      deleteAllObjects: vi.fn().mockResolvedValue(undefined),
      materializeContextGroupsForDatasource: vi
        .fn()
        .mockResolvedValue(undefined),
    };
    const service = new WorkflowService({
      fetchApi: { fetch },
      logger,
      workflowDao: workflowDao as any,
      executionDao: {} as any,
      executionService: {} as any,
      catalogDatastoreClient,
    });

    await service.delete('workflow-1', workspaceId);

    expect(
      catalogDatastoreClient.deleteAllIndexConfigurations,
    ).toHaveBeenCalledWith(expect.any(String), workspaceId);
    expect(catalogDatastoreClient.deleteAllObjects).toHaveBeenCalledWith(
      expect.any(String),
      workspaceId,
    );
  });

  it('waits for dry-run completion events', async () => {
    const executionService = {
      executeDryRun: vi.fn().mockResolvedValue('exec-1'),
      notifyClientConnected: vi.fn(),
      getBufferedEvents: vi.fn().mockReturnValue([
        {
          type: 'execution-completed',
          executionId: 'exec-1',
          output: {
            stats: {
              nodesExecuted: 2,
              nodesFailed: 0,
              nodesSkipped: 0,
              durationMs: 10,
            },
          },
          timestamp: new Date().toISOString(),
        },
      ]),
      clearEventBuffer: vi.fn(),
    } as any;

    const service = new WorkflowService({
      fetchApi: { fetch },
      logger,
      workflowDao: {} as any,
      executionDao: {} as any,
      executionService,
    });

    const result = await service.executeDryRunAndWait({
      name: 'Dry run',
      workflowType: 'data-ingestion',
      nodes: [],
      edges: [],
      triggeredBy: 'ops-bot',
    });

    expect(executionService.notifyClientConnected).toHaveBeenCalledWith(
      'exec-1',
    );
    expect(result).toEqual(
      expect.objectContaining({
        executionId: 'exec-1',
        status: 'completed',
        output: expect.objectContaining({
          stats: expect.objectContaining({
            nodesFailed: 0,
          }),
        }),
      }),
    );
  });

  it('extracts failed node details from dry-run events', async () => {
    const executionService = {
      executeDryRun: vi.fn().mockResolvedValue('exec-2'),
      notifyClientConnected: vi.fn(),
      getBufferedEvents: vi.fn().mockReturnValue([
        {
          type: 'log',
          executionId: 'exec-2',
          nodeId: 'sink-1',
          level: 'error',
          message: 'JSONata id expression returned empty',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'node-error',
          executionId: 'exec-2',
          nodeId: 'sink-1',
          error: 'JSONata id expression returned empty',
          timestamp: new Date().toISOString(),
        },
        {
          type: 'execution-error',
          executionId: 'exec-2',
          error: '1 node(s) failed during execution',
          timestamp: new Date().toISOString(),
        },
      ]),
      clearEventBuffer: vi.fn(),
    } as any;

    const service = new WorkflowService({
      fetchApi: { fetch },
      logger,
      workflowDao: {} as any,
      executionDao: {} as any,
      executionService,
    });

    const result = await service.executeDryRunAndWait({
      name: 'Dry run',
      workflowType: 'data-ingestion',
      nodes: [
        {
          id: 'source-1',
          type: 'source-integration',
          position: { x: 0, y: 0 },
          data: {
            label: 'PagerDuty source',
            config: {},
          },
        },
        {
          id: 'sink-1',
          type: 'sink-datastore',
          position: { x: 200, y: 0 },
          data: {
            label: 'On-calls sink',
            config: {},
          },
        },
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'source-1',
          target: 'sink-1',
        },
      ],
      triggeredBy: 'ops-bot',
    });

    expect(result).toEqual({
      executionId: 'exec-2',
      status: 'failed',
      error: '1 node(s) failed during execution',
      failureReason: 'On-calls sink: JSONata id expression returned empty',
      failedNodes: [
        {
          nodeId: 'sink-1',
          nodeType: 'sink-datastore',
          nodeLabel: 'On-calls sink',
          error: 'JSONata id expression returned empty',
        },
      ],
      errorLogs: ['On-calls sink: JSONata id expression returned empty'],
    });
  });

  it('rejects self-referencing data source dependencies on update', async () => {
    const existing = workflow('a');
    const workflowDao = {
      getById: vi.fn().mockResolvedValue(existing),
      list: vi.fn().mockResolvedValue({
        workflows: [existing],
        total: 1,
      }),
      update: vi.fn(),
    };
    const service = new WorkflowService({
      fetchApi: { fetch },
      logger,
      workflowDao: workflowDao as any,
      executionDao: {} as any,
      executionService: {} as any,
    });

    await expect(
      service.update('a', { nodes: workflow('a', 'a').nodes }),
    ).rejects.toThrow(
      new InputError('data source dependency would create a cycle'),
    );
    expect(workflowDao.update).not.toHaveBeenCalled();
  });

  it('rejects data source dependency cycles on update', async () => {
    const existing = workflow('a');
    const workflowDao = {
      getById: vi.fn().mockResolvedValue(existing),
      list: vi.fn().mockResolvedValue({
        workflows: [existing, workflow('b', 'a')],
        total: 2,
      }),
      update: vi.fn(),
    };
    const service = new WorkflowService({
      fetchApi: { fetch },
      logger,
      workflowDao: workflowDao as any,
      executionDao: {} as any,
      executionService: {} as any,
    });

    await expect(
      service.update('a', { nodes: workflow('a', 'b').nodes }),
    ).rejects.toThrow(
      new InputError('data source dependency would create a cycle'),
    );
    expect(workflowDao.update).not.toHaveBeenCalled();
  });

  it('allows node-untouched updates on workflows already in a cycle', async () => {
    const existing = workflow('a', 'b');
    const workflowDao = {
      getById: vi.fn().mockResolvedValue(existing),
      list: vi.fn().mockResolvedValue({
        workflows: [existing, workflow('b', 'a')],
        total: 2,
      }),
      update: vi.fn().mockResolvedValue({ ...existing, enabled: false }),
    };
    const service = new WorkflowService({
      fetchApi: { fetch },
      logger,
      workflowDao: workflowDao as any,
      executionDao: {} as any,
      executionService: {} as any,
    });

    await expect(service.update('a', { enabled: false })).resolves.toEqual({
      ...existing,
      enabled: false,
    });
    expect(workflowDao.update).toHaveBeenCalled();
  });

  it('reports a depth overflow distinctly from a cycle', async () => {
    const chain = Array.from({ length: 12 }, (_, i) =>
      workflow(`w${i}`, i < 11 ? `w${i + 1}` : undefined),
    );
    const existing = chain[0];
    const workflowDao = {
      getById: vi.fn().mockResolvedValue(existing),
      list: vi.fn().mockResolvedValue({
        workflows: chain,
        total: chain.length,
      }),
      update: vi.fn(),
    };
    const service = new WorkflowService({
      fetchApi: { fetch },
      logger,
      workflowDao: workflowDao as any,
      executionDao: {} as any,
      executionService: {} as any,
    });

    await expect(
      service.update('w0', { nodes: workflow('w0', 'w1').nodes }),
    ).rejects.toThrow(
      new InputError(
        'data source dependency chain exceeds the maximum depth of 10',
      ),
    );
    expect(workflowDao.update).not.toHaveBeenCalled();
  });

  it('detects cycles through workflows beyond the first page', async () => {
    const existing = workflow('a');
    const pageOne = Array.from({ length: 1000 }, (_, i) =>
      i === 0 ? existing : workflow(`filler${i}`),
    );
    const pageTwo = [workflow('b', 'a')];
    const workflowDao = {
      getById: vi.fn().mockResolvedValue(existing),
      list: vi
        .fn()
        .mockResolvedValueOnce({ workflows: pageOne, total: 1001 })
        .mockResolvedValueOnce({ workflows: pageTwo, total: 1001 }),
      update: vi.fn(),
    };
    const service = new WorkflowService({
      fetchApi: { fetch },
      logger,
      workflowDao: workflowDao as any,
      executionDao: {} as any,
      executionService: {} as any,
    });

    await expect(
      service.update('a', { nodes: workflow('a', 'b').nodes }),
    ).rejects.toThrow(
      new InputError('data source dependency would create a cycle'),
    );
    expect(workflowDao.list).toHaveBeenCalledTimes(2);
    expect(workflowDao.update).not.toHaveBeenCalled();
  });

  it('accepts acyclic data source dependency chains on update', async () => {
    const existing = workflow('a');
    const updated = workflow('a', 'b');
    const workflowDao = {
      getById: vi.fn().mockResolvedValue(existing),
      list: vi.fn().mockResolvedValue({
        workflows: [existing, workflow('b')],
        total: 2,
      }),
      update: vi.fn().mockResolvedValue(updated),
    };
    const service = new WorkflowService({
      fetchApi: { fetch },
      logger,
      workflowDao: workflowDao as any,
      executionDao: {} as any,
      executionService: {} as any,
    });

    await expect(service.update('a', { nodes: updated.nodes })).resolves.toBe(
      updated,
    );
    expect(workflowDao.update).toHaveBeenCalled();
  });

  describe('execute', () => {
    const workflowDao = () =>
      ({
        getById: vi.fn().mockResolvedValue({ id: 'wf-1', name: 'My Source' }),
      }) as any;

    function service(overrides: {
      executionDao: any;
      scheduleStateDao: any;
    }): WorkflowService {
      return new WorkflowService({
        fetchApi: { fetch },
        logger: { info: vi.fn() } as any,
        workflowDao: workflowDao(),
        executionDao: overrides.executionDao,
        executionService: {} as any,
        scheduleStateDao: overrides.scheduleStateDao,
      });
    }

    it('reserves the slot, then creates the pending row with the same id and returns it', async () => {
      const executionDao = {
        create: vi.fn().mockImplementation(async (o: { id: string }) => ({
          id: o.id,
        })),
      } as any;
      const scheduleStateDao = {
        requestImmediateRun: vi.fn().mockResolvedValue('requested'),
      } as any;

      const result = await service({ executionDao, scheduleStateDao }).execute(
        'wf-1',
        { requestedBy: 'user:default/alice' },
      );

      // The same generated id reserves the slot, creates the row, and is
      // returned to the caller.
      const reservedId =
        scheduleStateDao.requestImmediateRun.mock.calls[0][0].executionId;
      expect(reservedId).toBeTruthy();
      expect(result).toEqual({ executionId: reservedId });
      expect(executionDao.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: reservedId,
          workflowId: 'wf-1',
          triggerType: 'manual',
          triggeredBy: 'user:default/alice',
          isDryRun: false,
        }),
      );
      // Reservation must precede row creation (so a conflict leaves no row).
      expect(
        scheduleStateDao.requestImmediateRun.mock.invocationCallOrder[0],
      ).toBeLessThan(executionDao.create.mock.invocationCallOrder[0]);
    });

    it('throws a conflict and creates no row when a run is already in progress', async () => {
      const executionDao = {
        create: vi.fn(),
      } as any;
      const scheduleStateDao = {
        requestImmediateRun: vi.fn().mockResolvedValue('already-running'),
      } as any;

      await expect(
        service({ executionDao, scheduleStateDao }).execute('wf-1', {
          requestedBy: 'user:default/alice',
        }),
      ).rejects.toThrow(/already in progress/);
      expect(executionDao.create).not.toHaveBeenCalled();
    });
  });
});
