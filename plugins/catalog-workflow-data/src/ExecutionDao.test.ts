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

import { TestDatabases } from '@roadiehq/backend-test-utils';
import { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { ExecutionDao } from './ExecutionDao';
import { WorkflowDao } from './WorkflowDao';
import { applyDatabaseMigrations } from './migrations';

const logger = {
  child: () => logger,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any;

const databases = TestDatabases.create();

describe('ExecutionDao workspace isolation', () => {
  let knex: Knex;
  let executionDao: ExecutionDao;
  let workflowDao: WorkflowDao;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applyDatabaseMigrations(knex);
    executionDao = new ExecutionDao({ knex, logger });
    workflowDao = new WorkflowDao({ knex, logger });
  }, 120_000);

  afterAll(async () => {
    await knex?.destroy();
  });

  it('keeps run history within the workflow workspace', async () => {
    const workspaceA = uuid();
    const workspaceB = uuid();
    const workflow = await workflowDao.create(
      {
        name: 'Scoped workflow',
        workflowType: 'data-ingestion',
        nodes: [],
        edges: [],
        enabled: true,
        createdBy: 'user-1',
      },
      undefined,
      workspaceA,
    );
    const execution = await executionDao.create({
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      workflowSnapshot: workflow,
      triggerType: 'manual',
      workspaceId: workspaceA,
    });

    expect(execution).toMatchObject({
      workspaceId: workspaceA,
      ownership: 'workspace',
    });

    await expect(
      executionDao.getById(execution.id, { workspaceId: workspaceB }),
    ).rejects.toThrow('Execution not found');
    await expect(
      executionDao.list({ workspaceId: workspaceB }),
    ).resolves.toMatchObject({ executions: [], total: 0 });
    await expect(
      executionDao.getById(execution.id, { workspaceId: workspaceA }),
    ).resolves.toMatchObject({ id: execution.id, workspaceId: workspaceA });
  });
});

describe('ExecutionDao request logs', () => {
  let knex: Knex;
  let dao: ExecutionDao;
  let executionId: string;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applyDatabaseMigrations(knex);
    dao = new ExecutionDao({ knex, logger });
  }, 120_000);

  beforeEach(async () => {
    await knex('catalog_workflows').del();
    const workflowId = uuid();
    executionId = uuid();
    await knex('catalog_workflows').insert({
      id: workflowId,
      name: 'Request log workflow',
      slug: 'request-log-workflow',
      workflow_type: 'data-ingestion',
      nodes: JSON.stringify([]),
      edges: JSON.stringify([]),
      enabled: false,
      version: 1,
      created_by: 'user-1',
      created_at: new Date(),
      updated_at: new Date(),
    });
    await knex('catalog_workflow_executions').insert({
      id: executionId,
      workflow_id: workflowId,
      workflow_version: 1,
      status: 'pending',
      trigger_type: 'manual',
      workflow_snapshot: JSON.stringify({ nodes: [], edges: [] }),
      created_at: new Date(),
    });
  });

  afterAll(async () => {
    await knex?.destroy();
  });

  it('persists request bodies and allowlisted response headers', async () => {
    const link = '<https://api.example.com/items?page=2>; rel="next"';

    await dao.addRequestLog({
      id: 'log-1',
      executionId,
      nodeId: 'node-1',
      source: 'source-integration',
      operation: 'POST',
      target: 'https://api.example.com/items',
      status: '200',
      duration: 12,
      requestBody: { page: 1 },
      responseBody: [{ id: '1' }],
      responseHeaders: { link },
      timestamp: '2026-07-15T10:00:00.000Z',
    });

    await expect(dao.getRequestLogs({ executionId })).resolves.toMatchObject([
      {
        requestBody: { page: 1 },
        responseHeaders: { link },
      },
    ]);
  });

  it('does not overwrite a cancelled execution with late worker updates', async () => {
    await dao.cancel(executionId);
    await dao.updateStatus(executionId, 'running');
    await dao.complete(executionId, {
      sinks: [],
      stats: {
        nodesExecuted: 0,
        nodesFailed: 0,
        nodesSkipped: 0,
        durationMs: 0,
      },
    });
    await dao.fail(executionId, 'late failure');

    const row = await knex('catalog_workflow_executions')
      .where('id', executionId)
      .first();
    expect(row.status).toBe('cancelled');
    expect(row.error).toBeNull();
  });
});

describe('ExecutionDao.getLatestSummaries', () => {
  let knex: Knex;
  let dao: ExecutionDao;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applyDatabaseMigrations(knex);
    dao = new ExecutionDao({ knex, logger });
  }, 120_000);

  afterAll(async () => {
    await knex?.destroy();
  });

  async function insertCompletedExecution(output: unknown): Promise<string> {
    const workflowId = uuid();
    await knex('catalog_workflows').insert({
      id: workflowId,
      name: `wf-${workflowId.slice(0, 8)}`,
      slug: `wf-${workflowId.slice(0, 8)}`,
      workflow_type: 'data-ingestion',
      nodes: JSON.stringify([]),
      edges: JSON.stringify([]),
      enabled: false,
      version: 1,
      created_by: 'user-1',
      created_at: new Date(),
      updated_at: new Date(),
    });
    await knex('catalog_workflow_executions').insert({
      id: uuid(),
      workflow_id: workflowId,
      workflow_version: 1,
      status: 'completed',
      trigger_type: 'manual',
      workflow_snapshot: JSON.stringify({ nodes: [], edges: [] }),
      output: JSON.stringify(output),
      created_at: new Date(),
      completed_at: new Date(),
    });
    return workflowId;
  }

  it('derives objectCount from paged sink summaries', async () => {
    const stats = {
      nodesExecuted: 2,
      nodesFailed: 0,
      nodesSkipped: 0,
      durationMs: 10,
    };
    const pagedWorkflowId = await insertCompletedExecution({
      sinks: [{ nodeId: 'sink', datasourceId: 'ds-1', itemCount: 42 }],
      stats,
    });

    const summaries = await dao.getLatestSummaries([pagedWorkflowId]);
    const byWorkflow = new Map(summaries.map(s => [s.workflowId, s]));
    expect(byWorkflow.get(pagedWorkflowId)?.objectCount).toBe(42);
  });

  it('includes the latest execution error', async () => {
    const workflowId = await insertCompletedExecution({});
    await knex('catalog_workflow_executions')
      .where('workflow_id', workflowId)
      .update({ status: 'failed', error: 'GitHub request failed' });

    const summaries = await dao.getLatestSummaries([workflowId]);

    expect(summaries).toEqual([
      expect.objectContaining({
        workflowId,
        status: 'failed',
        error: 'GitHub request failed',
      }),
    ]);
  });
});

describe('ExecutionDao attempt-scoped node executions', () => {
  let knex: Knex;
  let dao: ExecutionDao;
  let executionId: string;

  beforeAll(async () => {
    knex = await databases.init('POSTGRES_16');
    await applyDatabaseMigrations(knex);
    dao = new ExecutionDao({ knex, logger });
  }, 120_000);

  beforeEach(async () => {
    await knex('catalog_workflows').del();
    const workflowId = uuid();
    executionId = uuid();
    await knex('catalog_workflows').insert({
      id: workflowId,
      name: 'Attempt scoped workflow',
      slug: 'attempt-scoped-workflow',
      workflow_type: 'data-ingestion',
      nodes: JSON.stringify([]),
      edges: JSON.stringify([]),
      enabled: false,
      version: 1,
      created_by: 'user-1',
      created_at: new Date(),
      updated_at: new Date(),
    });
    await knex('catalog_workflow_executions').insert({
      id: executionId,
      workflow_id: workflowId,
      workflow_version: 1,
      status: 'pending',
      trigger_type: 'manual',
      workflow_snapshot: JSON.stringify({
        id: workflowId,
        name: 'Attempt scoped workflow',
        nodes: [],
        edges: [],
      }),
      created_at: new Date(),
    });
  });

  afterAll(async () => {
    await knex?.destroy();
  });

  it("keeps each attempt's rows isolated for the same node", async () => {
    const attemptA = uuid();
    const attemptB = uuid();

    await dao.createAttemptNodeExecution({
      executionId,
      attemptId: attemptA,
      nodeId: 'n1',
      executionOrder: 0,
    });
    await dao.createAttemptNodeExecution({
      executionId,
      attemptId: attemptB,
      nodeId: 'n1',
      executionOrder: 0,
    });

    await dao.updateAttemptNodeExecution(executionId, attemptA, 'n1', {
      status: 'completed',
      outputStats: { itemCount: 3, approxBytes: 120, sampleTruncated: false },
      outputSample: [{ id: 'a' }],
    });
    await dao.updateAttemptNodeExecution(executionId, attemptB, 'n1', {
      status: 'failed',
      error: 'boom',
    });

    const forA = await dao.getNodeExecutions(executionId, {
      attemptId: attemptA,
    });
    expect(forA).toHaveLength(1);
    expect(forA[0]).toMatchObject({
      nodeId: 'n1',
      attemptId: attemptA,
      status: 'completed',
      outputStats: { itemCount: 3, approxBytes: 120, sampleTruncated: false },
      outputSample: [{ id: 'a' }],
    });

    const forB = await dao.getNodeExecutions(executionId, {
      attemptId: attemptB,
    });
    expect(forB).toHaveLength(1);
    expect(forB[0]).toMatchObject({
      status: 'failed',
      error: 'boom',
    });
    expect(forB[0].outputStats).toBeUndefined();
  });

  it('rejects a duplicate row for the same attempt and node', async () => {
    const attemptId = uuid();
    await dao.createAttemptNodeExecution({
      executionId,
      attemptId,
      nodeId: 'n1',
      executionOrder: 0,
    });
    await expect(
      dao.createAttemptNodeExecution({
        executionId,
        attemptId,
        nodeId: 'n1',
        executionOrder: 0,
      }),
    ).rejects.toThrow();
  });

  it('getById filters node rows to the given attempt when attemptId is passed', async () => {
    const attemptA = uuid();
    const attemptB = uuid();

    await dao.createAttemptNodeExecution({
      executionId,
      attemptId: attemptA,
      nodeId: 'n1',
      executionOrder: 0,
    });
    await dao.createAttemptNodeExecution({
      executionId,
      attemptId: attemptB,
      nodeId: 'n1',
      executionOrder: 0,
    });
    await dao.updateAttemptNodeExecution(executionId, attemptA, 'n1', {
      status: 'completed',
    });
    await dao.updateAttemptNodeExecution(executionId, attemptB, 'n1', {
      status: 'failed',
      error: 'boom',
    });

    const execution = await dao.getById(executionId, { attemptId: attemptA });

    expect(execution.nodeExecutions).toHaveLength(1);
    expect(execution.nodeExecutions[0]).toMatchObject({
      nodeId: 'n1',
      attemptId: attemptA,
      status: 'completed',
    });
  });

  it('getById returns all node rows, including attemptless legacy rows, when attemptId is omitted', async () => {
    const attemptA = uuid();
    const attemptB = uuid();

    // Historical attempt-less rows predate the paged engine; no DAO method
    // writes them anymore, so insert one directly to prove getById still
    // surfaces them alongside attempt-scoped rows.
    await knex('catalog_workflow_node_executions').insert({
      id: uuid(),
      execution_id: executionId,
      node_id: 'legacy-node',
      status: 'pending',
      execution_order: 0,
    });
    await dao.createAttemptNodeExecution({
      executionId,
      attemptId: attemptA,
      nodeId: 'n1',
      executionOrder: 1,
    });
    await dao.createAttemptNodeExecution({
      executionId,
      attemptId: attemptB,
      nodeId: 'n1',
      executionOrder: 1,
    });

    const execution = await dao.getById(executionId);

    expect(execution.nodeExecutions).toHaveLength(3);
    const legacyRow = execution.nodeExecutions.find(
      n => n.nodeId === 'legacy-node',
    );
    expect(legacyRow).toBeDefined();
    expect(legacyRow?.attemptId).toBeUndefined();

    const attemptIds = execution.nodeExecutions
      .map(n => n.attemptId)
      .filter((id): id is string => id !== undefined)
      .sort();
    expect(attemptIds).toEqual([attemptA, attemptB].sort());
  });
});
