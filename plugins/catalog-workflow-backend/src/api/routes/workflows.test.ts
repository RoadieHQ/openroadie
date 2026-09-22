import { vi, type Mock, type Mocked } from 'vitest';

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

import express from 'express';
import request from 'supertest';
import { createWorkflowsRouter } from './workflows';
import { WorkflowService } from '../../services';
import { allowAllScopeService } from '@roadiehq/scopes';
import { ConflictError } from '@roadiehq/errors';
import { entityChangeTopics } from '@roadiehq/backend-defaults';
import { mockServices } from '@roadiehq/backend-test-utils';

const scopeService = allowAllScopeService;
const workspaceId = '22222222-2222-4222-8222-222222222222';

const mockWorkflow = {
  id: 'workflow-1',
  name: 'Test Workflow',
  slug: 'test-workflow',
  description: 'A test workflow',
  workflowType: 'data-ingestion' as const,
  nodes: [],
  edges: [],
  enabled: false,
  version: 1,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  createdBy: 'user:default/test',
};

const mockExecution = {
  id: 'execution-1',
  workflowId: 'workflow-1',
  workflowVersion: 1,
  status: 'completed' as const,
  triggerType: 'manual' as const,
  triggeredBy: 'user:default/test',
  startedAt: '2025-01-01T00:00:00.000Z',
  completedAt: '2025-01-01T00:01:00.000Z',
  createdAt: '2025-01-01T00:00:00.000Z',
  nodeExecutions: [],
  workflowSnapshot: mockWorkflow,
};

type PublishMock = Mock<
  (params: { topic: string; eventPayload: unknown }) => Promise<void>
>;

describe('createWorkflowsRouter', () => {
  let app: express.Application;
  let mockWorkflowService: Mocked<WorkflowService>;
  let publish: PublishMock;

  beforeEach(() => {
    publish = vi.fn<PublishMock>().mockResolvedValue(undefined);
    mockWorkflowService = {
      list: vi.fn(),
      getById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      duplicate: vi.fn(),
      execute: vi.fn(),
      getLatestExecution: vi.fn(),
      listExecutions: vi.fn(),
    } as unknown as Mocked<WorkflowService>;

    const router = createWorkflowsRouter({
      workflowService: mockWorkflowService,
      getUserId: async () => 'user:default/test',
      getOptionalScopeId: () => undefined,
      getWorkspaceId: () => workspaceId,
      scopeService,
      events: mockServices.events.mock({ publish }),
      logger: mockServices.logger.mock(),
    });

    app = express();
    app.use(router);
    // Error middleware mirrors the parent router (see router.ts:126-154)
    app.use(
      (
        err: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        const statusMap: Record<string, number> = {
          NotFoundError: 404,
          InputError: 400,
          AuthenticationError: 401,
          NotAllowedError: 403,
          ConflictError: 409,
        };
        const status = statusMap[err.name] ?? 500;
        res.status(status).json({ error: { message: err.message } });
      },
    );
  });

  describe('GET /', () => {
    it('lists workflows', async () => {
      mockWorkflowService.list.mockResolvedValue({
        workflows: [mockWorkflow],
        total: 1,
        offset: 0,
        limit: 50,
      });

      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        data: [mockWorkflow],
        total: 1,
        offset: 0,
        limit: 50,
      });
    });

    it('filters by enabled status', async () => {
      mockWorkflowService.list.mockResolvedValue({
        workflows: [],
        total: 0,
        offset: 0,
        limit: 50,
      });

      await request(app).get('/?enabled=true');

      expect(mockWorkflowService.list).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true }),
        workspaceId,
      );
    });

    it('filters by workflowType', async () => {
      mockWorkflowService.list.mockResolvedValue({
        workflows: [],
        total: 0,
        offset: 0,
        limit: 50,
      });

      await request(app).get('/?workflowType=data-ingestion');

      expect(mockWorkflowService.list).toHaveBeenCalledWith(
        expect.objectContaining({ workflowType: 'data-ingestion' }),
        workspaceId,
      );
    });

    it('rejects invalid workflowType', async () => {
      const response = await request(app).get('/?workflowType=invalid');

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('Invalid workflowType');
    });

    it('rejects invalid limit parameter', async () => {
      const response = await request(app).get('/?limit=abc');

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('limit');
    });
  });

  describe('GET /:id', () => {
    it('returns workflow by id', async () => {
      mockWorkflowService.getById.mockResolvedValue(mockWorkflow);

      const response = await request(app).get('/workflow-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: mockWorkflow });
    });
  });

  describe('POST /', () => {
    it('creates a workflow', async () => {
      mockWorkflowService.create.mockResolvedValue(mockWorkflow);

      const response = await request(app).post('/').send({
        name: 'Test Workflow',
        description: 'A test workflow',
        workflowType: 'data-ingestion',
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ data: mockWorkflow });
      expect(mockWorkflowService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Workflow',
          description: 'A test workflow',
          createdBy: 'user:default/test',
        }),
        workspaceId,
      );
      expect(publish).toHaveBeenCalledWith({
        topic: entityChangeTopics.workflows,
        eventPayload: {
          id: mockWorkflow.id,
          operation: 'created',
          scopeId: 'default',
          workspaceId,
        },
      });
    });

    it('keeps a successful create successful when publishing fails', async () => {
      mockWorkflowService.create.mockResolvedValue(mockWorkflow);
      publish.mockRejectedValueOnce(new Error('broker unavailable'));

      const response = await request(app).post('/').send({
        name: 'Test Workflow',
        description: 'A test workflow',
        workflowType: 'data-ingestion',
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ data: mockWorkflow });
    });

    it('rejects a slug that could never be @-referenced', async () => {
      const response = await request(app).post('/').send({
        name: 'Test Workflow',
        slug: 'Bad_Slug',
        workflowType: 'data-ingestion',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toMatch(/Invalid slug/);
      expect(mockWorkflowService.create).not.toHaveBeenCalled();
    });
  });

  describe('PUT /:id', () => {
    const validId = '550e8400-e29b-41d4-a716-446655440000';

    it('replaces a workflow with a full body', async () => {
      const updatedWorkflow = { ...mockWorkflow, name: 'Updated Workflow' };
      mockWorkflowService.update.mockResolvedValue(updatedWorkflow);

      const response = await request(app)
        .put(`/${validId}`)
        .send({ name: 'Updated Workflow' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: updatedWorkflow });
      expect(mockWorkflowService.update).toHaveBeenCalledWith(
        validId,
        {
          name: 'Updated Workflow',
          description: '',
          nodes: [],
          edges: [],
          viewport: undefined,
          enabled: true,
        },
        workspaceId,
      );
      expect(publish).toHaveBeenCalledWith({
        topic: entityChangeTopics.workflows,
        eventPayload: {
          id: mockWorkflow.id,
          operation: 'updated',
          scopeId: 'default',
          workspaceId,
        },
      });
    });

    it('passes through provided optional fields', async () => {
      const updatedWorkflow = { ...mockWorkflow, slug: 'new-slug' };
      mockWorkflowService.update.mockResolvedValue(updatedWorkflow);

      const response = await request(app)
        .put(`/${validId}`)
        .send({
          name: 'Updated Workflow',
          slug: 'new-slug',
          description: 'desc',
          nodes: [{ id: 'n1' }],
          edges: [{ id: 'e1' }],
          enabled: false,
        });

      expect(response.status).toBe(200);
      expect(mockWorkflowService.update).toHaveBeenCalledWith(
        validId,
        {
          name: 'Updated Workflow',
          slug: 'new-slug',
          description: 'desc',
          nodes: [{ id: 'n1' }],
          edges: [{ id: 'e1' }],
          viewport: undefined,
          enabled: false,
        },
        workspaceId,
      );
    });

    it('rejects a non-UUID id', async () => {
      const response = await request(app)
        .put('/not-a-uuid')
        .send({ name: 'Test' });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe('Invalid workflow ID');
      expect(mockWorkflowService.update).not.toHaveBeenCalled();
    });

    it('rejects a missing name', async () => {
      const response = await request(app)
        .put(`/${validId}`)
        .send({ description: 'orphan' });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toMatch(/name is required/);
      expect(mockWorkflowService.update).not.toHaveBeenCalled();
    });

    it('rejects a non-string slug before reaching the service', async () => {
      const response = await request(app)
        .put(`/${validId}`)
        .send({ name: 'Test', slug: 42 });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe('slug must be a string');
      expect(mockWorkflowService.update).not.toHaveBeenCalled();
    });

    it('rejects a malformed slug before reaching the service', async () => {
      const response = await request(app)
        .put(`/${validId}`)
        .send({ name: 'Test', slug: 'Bad_Slug' });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toMatch(/Invalid slug/);
      expect(mockWorkflowService.update).not.toHaveBeenCalled();
    });

    it('surfaces a slug conflict as 409, not 500', async () => {
      mockWorkflowService.update.mockRejectedValue(
        new ConflictError('Workflow with slug "taken" already exists'),
      );

      const response = await request(app)
        .put(`/${validId}`)
        .send({ name: 'Test', slug: 'taken' });

      expect(response.status).toBe(409);
      expect(response.body.error.message).toMatch(/already exists/);
    });
  });

  describe('PATCH /:id', () => {
    it('merges only the keys present in the body', async () => {
      const updatedWorkflow = { ...mockWorkflow, name: 'Patched' };
      mockWorkflowService.update.mockResolvedValue(updatedWorkflow);

      const response = await request(app)
        .patch('/workflow-1')
        .send({ name: 'Patched' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: updatedWorkflow });
      expect(mockWorkflowService.update).toHaveBeenCalledWith(
        'workflow-1',
        { name: 'Patched' },
        workspaceId,
      );
    });

    it('updates a slug without requiring name', async () => {
      const updatedWorkflow = { ...mockWorkflow, slug: 'new-slug' };
      mockWorkflowService.update.mockResolvedValue(updatedWorkflow);

      const response = await request(app)
        .patch('/workflow-1')
        .send({ slug: 'new-slug' });

      expect(response.status).toBe(200);
      expect(mockWorkflowService.update).toHaveBeenCalledWith(
        'workflow-1',
        { slug: 'new-slug' },
        workspaceId,
      );
    });

    it('rejects a non-string name before reaching the service', async () => {
      const response = await request(app)
        .patch('/workflow-1')
        .send({ name: 7 });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe('name must be a string');
      expect(mockWorkflowService.update).not.toHaveBeenCalled();
    });

    it('rejects a malformed slug before reaching the service', async () => {
      const response = await request(app)
        .patch('/workflow-1')
        .send({ slug: 'Bad_Slug' });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toMatch(/Invalid slug/);
      expect(mockWorkflowService.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /:id', () => {
    it('deletes a workflow', async () => {
      mockWorkflowService.delete.mockResolvedValue();

      const response = await request(app).delete('/workflow-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(publish).toHaveBeenCalledWith({
        topic: entityChangeTopics.workflows,
        eventPayload: {
          id: mockWorkflow.id,
          operation: 'deleted',
          scopeId: 'default',
          workspaceId,
        },
      });
    });
  });

  describe('POST /:id/duplicate', () => {
    it('duplicates a workflow', async () => {
      const duplicatedWorkflow = { ...mockWorkflow, id: 'workflow-2' };
      mockWorkflowService.duplicate.mockResolvedValue(duplicatedWorkflow);

      const response = await request(app)
        .post('/workflow-1/duplicate')
        .send({ name: 'Duplicated Workflow' });

      expect(response.status).toBe(201);
      expect(mockWorkflowService.duplicate).toHaveBeenCalledWith(
        'workflow-1',
        'Duplicated Workflow',
        'user:default/test',
        workspaceId,
      );
      expect(publish).toHaveBeenCalledWith({
        topic: entityChangeTopics.workflows,
        eventPayload: {
          id: duplicatedWorkflow.id,
          operation: 'created',
          scopeId: 'default',
          workspaceId,
        },
      });
    });
  });

  describe('POST /:id/execute', () => {
    it('requests an immediate run attributed to the caller', async () => {
      mockWorkflowService.execute.mockResolvedValue({
        executionId: 'execution-1',
      });

      const response = await request(app).post('/workflow-1/execute');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ executionId: 'execution-1' });
      expect(mockWorkflowService.execute).toHaveBeenCalledWith('workflow-1', {
        requestedBy: 'user:default/test',
        workspaceId,
      });
    });
  });

  describe('GET /:id/executions/latest', () => {
    it('returns latest execution', async () => {
      mockWorkflowService.getLatestExecution.mockResolvedValue({
        execution: mockExecution,
        isStale: false,
      });

      const response = await request(app).get('/workflow-1/executions/latest');

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({
        execution: mockExecution,
        isStale: false,
      });
    });

    it('returns 404 when no executions exist', async () => {
      mockWorkflowService.getLatestExecution.mockResolvedValue(null);

      const response = await request(app).get('/workflow-1/executions/latest');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /:id/executions', () => {
    it('lists executions for a workflow', async () => {
      mockWorkflowService.listExecutions.mockResolvedValue({
        executions: [mockExecution],
        total: 1,
        offset: 0,
        limit: 50,
      });

      const response = await request(app).get('/workflow-1/executions');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        data: [mockExecution],
        total: 1,
        offset: 0,
        limit: 50,
      });
    });

    it('filters by status', async () => {
      mockWorkflowService.listExecutions.mockResolvedValue({
        executions: [],
        total: 0,
        offset: 0,
        limit: 50,
      });

      await request(app).get('/workflow-1/executions?status=completed');

      expect(mockWorkflowService.listExecutions).toHaveBeenCalledWith(
        'workflow-1',
        expect.objectContaining({ status: 'completed' }),
        workspaceId,
      );
    });
  });
});
