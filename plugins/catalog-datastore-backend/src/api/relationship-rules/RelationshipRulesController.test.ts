import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuid } from 'uuid';
import { RelationshipRulesController } from './RelationshipRulesController';
import {
  RelationshipRuleDao,
  RelationshipDao,
  DatastoreRepository,
  SuggestionVerdictDao,
} from '../../database';
import { HttpAuthService } from '@roadiehq/extensions-api';
import { allowAllScopeService } from '@roadiehq/scopes';

const scopeService = allowAllScopeService;

describe('RelationshipRulesController', () => {
  let app: express.Application;
  let mockRelationshipRuleDao: {
    listRelationshipRules: Mock;
    listRelationshipRulesByDatasourceIds: Mock;
    createRelationshipRule: Mock;
    getRelationshipRule: Mock;
    updateRelationshipRule: Mock;
    updateRelationshipRuleState: Mock;
    transitionStateWithPairLock: Mock;
    summarizeRules: Mock;
  };
  let mockRelationshipDao: {
    listRelationshipsByRuleId: Mock;
    deleteByRuleId: Mock;
    summarizeRelationships: Mock;
  };
  let mockDatastoreService: {
    deleteRelationshipRule: Mock;
    deleteRelationshipsByRuleId: Mock;
    applyRelationshipRule: Mock;
    previewRelationshipRule: Mock;
  };
  let mockHttpAuth: {
    credentials: Mock;
  };
  let mockSuggestionVerdictDao: {
    appendVerdict: Mock;
  };
  const sourceDatasourceId = '550e8400-e29b-41d4-a716-446655440000';
  const targetDatasourceId = '660e8400-e29b-41d4-a716-446655440000';
  const ruleId = '770e8400-e29b-41d4-a716-446655440000';
  const workspaceId = '880e8400-e29b-41d4-a716-446655440000';

  beforeEach(async () => {
    mockRelationshipRuleDao = {
      listRelationshipRules: vi.fn(),
      // Single-snapshot mirror discovery for the approve guard defaults to
      // "no candidates on this datasource pair". Tests exercising a mirror set
      // it explicitly.
      listRelationshipRulesByDatasourceIds: vi.fn().mockResolvedValue([]),
      createRelationshipRule: vi.fn(),
      getRelationshipRule: vi.fn(),
      updateRelationshipRule: vi.fn(),
      updateRelationshipRuleState: vi.fn(),
      transitionStateWithPairLock: vi.fn(),
      summarizeRules: vi.fn(),
    };

    // By default the pair-locked approve flip delegates to the CAS mock, so the
    // existing approve/bulk tests exercise their success/conflict/throw paths
    // through the same `updateRelationshipRuleState` expectations they always
    // have. Tests that need the mirror-active conflict override this per-case.
    mockRelationshipRuleDao.transitionStateWithPairLock.mockImplementation(
      async (params: {
        id: string;
        toState: string;
        expectedState: string;
        reviewReason?: string | null;
      }) => {
        const rule = await mockRelationshipRuleDao.updateRelationshipRuleState(
          params.id,
          params.toState,
          {
            reviewReason: params.reviewReason,
            expectedState: params.expectedState,
          },
        );
        return rule
          ? { status: 'updated', rule }
          : { status: 'conflict', reason: 'stale-self' };
      },
    );

    mockRelationshipDao = {
      listRelationshipsByRuleId: vi.fn(),
      deleteByRuleId: vi.fn().mockResolvedValue(0),
      summarizeRelationships: vi.fn(),
    };

    mockDatastoreService = {
      deleteRelationshipRule: vi.fn(),
      deleteRelationshipsByRuleId: vi.fn().mockResolvedValue(0),
      applyRelationshipRule: vi.fn(),
      previewRelationshipRule: vi.fn(),
    };

    mockHttpAuth = {
      credentials: vi.fn().mockResolvedValue({
        principal: { type: 'user', userId: 'testuser' },
      }),
    };

    mockSuggestionVerdictDao = { appendVerdict: vi.fn().mockResolvedValue({}) };

    const controller = new RelationshipRulesController({
      relationshipRuleDao:
        mockRelationshipRuleDao as unknown as RelationshipRuleDao,
      relationshipDao: mockRelationshipDao as unknown as RelationshipDao,
      datastoreRepository:
        mockDatastoreService as unknown as DatastoreRepository,
      httpAuth: mockHttpAuth as unknown as HttpAuthService,
      scopeService,
      suggestionVerdictDao:
        mockSuggestionVerdictDao as unknown as SuggestionVerdictDao,
      getWorkspaceId: () => workspaceId,
    });
    const router = await controller.getRouter();
    app = express();
    app.use('/relationship-rules', router);
  });

  /** listRelationshipRules filters state in SQL, so the mock has to answer per
   *  state — an 'active' lookup must not see the suggested rules. */
  function mockRulesByState(byState: Record<string, unknown[]>) {
    mockRelationshipRuleDao.listRelationshipRules.mockImplementation(
      async (opts: { state?: string } = {}) => {
        const items = byState[`${opts.state ?? ''}`] ?? [];
        return { items, total: items.length };
      },
    );
  }

  describe('GET /', () => {
    it('returns rules and forwards pagination/filter params', async () => {
      const mockResult = { items: [], total: 0 };
      mockRelationshipRuleDao.listRelationshipRules.mockResolvedValue(
        mockResult,
      );

      const response = await request(app).get(
        '/relationship-rules?limit=20&offset=5&origin=generated&state=inactive&reviewReason=manual-dismiss',
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
      expect(
        mockRelationshipRuleDao.listRelationshipRules,
      ).toHaveBeenCalledWith({
        limit: 20,
        offset: 5,
        origin: 'generated',
        state: 'inactive',
        reviewReason: 'manual-dismiss',
        workspaceId,
      });
    });
  });

  describe('POST /', () => {
    it('returns 400 when required fields are missing', async () => {
      const response = await request(app).post('/relationship-rules').send({
        name: 'Missing required fields',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });

    it('returns 400 for invalid sourceDatasourceId format', async () => {
      const response = await request(app).post('/relationship-rules').send({
        name: 'Rule',
        sourceDatasourceId: 'not-a-uuid',
        targetDatasourceId,
        sourceFieldExpression: 'metadata.name',
        targetFieldExpression: 'metadata.name',
        relationshipType: 'depends_on',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('sourceDatasourceId');
    });

    it('creates a rule with optional fields', async () => {
      const createdRule = {
        id: ruleId,
        name: 'Match by component name',
        description: 'Links components with matching names',
        sourceDatasourceId,
        targetDatasourceId,
        sourceFieldExpression: 'metadata.name',
        targetFieldExpression: 'metadata.name',
        sourceFilterExpression: 'kind = "Component"',
        targetFilterExpression: 'kind = "Resource"',
        relationshipType: 'depends_on',
        matchStrategy: 'exact',
        origin: 'testuser',
        state: 'active',
        createdAt: '2026-02-17T12:00:00.000Z',
        updatedAt: '2026-02-17T12:00:00.000Z',
      };
      mockRelationshipRuleDao.createRelationshipRule.mockResolvedValue(
        createdRule,
      );

      const response = await request(app).post('/relationship-rules').send({
        name: 'Match by component name',
        description: 'Links components with matching names',
        sourceDatasourceId,
        targetDatasourceId,
        sourceFieldExpression: 'metadata.name',
        targetFieldExpression: 'metadata.name',
        sourceFilterExpression: 'kind = "Component"',
        targetFilterExpression: 'kind = "Resource"',
        relationshipType: 'depends_on',
        matchStrategy: 'exact',
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(createdRule);
      expect(
        mockRelationshipRuleDao.createRelationshipRule,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Match by component name',
          description: 'Links components with matching names',
          sourceDatasourceId,
          targetDatasourceId,
          sourceFieldExpression: 'metadata.name',
          targetFieldExpression: 'metadata.name',
          sourceFilterExpression: 'kind = "Component"',
          targetFilterExpression: 'kind = "Resource"',
          relationshipType: 'depends_on',
          matchStrategy: 'exact',
        }),
        { origin: 'testuser', workspaceId },
      );
    });

    it('forwards state when creating a suggested rule', async () => {
      mockRelationshipRuleDao.createRelationshipRule.mockResolvedValue({
        id: ruleId,
        state: 'suggested',
      });

      const response = await request(app).post('/relationship-rules').send({
        name: 'Match by component name',
        sourceDatasourceId,
        targetDatasourceId,
        sourceFieldExpression: 'metadata.name',
        targetFieldExpression: 'metadata.name',
        relationshipType: 'depends_on',
        state: 'suggested',
      });

      expect(response.status).toBe(201);
      expect(
        mockRelationshipRuleDao.createRelationshipRule,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Match by component name' }),
        { origin: 'testuser', state: 'suggested', workspaceId },
      );
    });

    it('does not allow a user to spoof a seed origin', async () => {
      mockRelationshipRuleDao.createRelationshipRule.mockResolvedValue({
        id: ruleId,
        origin: 'testuser',
      });

      const response = await request(app).post('/relationship-rules').send({
        name: 'Match by component name',
        sourceDatasourceId,
        targetDatasourceId,
        sourceFieldExpression: 'metadata.name',
        targetFieldExpression: 'metadata.name',
        relationshipType: 'depends_on',
        origin: 'seed',
      });

      expect(response.status).toBe(201);
      expect(
        mockRelationshipRuleDao.createRelationshipRule,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Match by component name' }),
        { origin: 'testuser', workspaceId },
      );
    });

    it('allows a service caller to set origin', async () => {
      mockHttpAuth.credentials.mockResolvedValueOnce({
        principal: { type: 'service', subject: 'rst:1' },
      });
      mockRelationshipRuleDao.createRelationshipRule.mockResolvedValue({
        id: ruleId,
        origin: 'seed',
      });

      const response = await request(app).post('/relationship-rules').send({
        name: 'Match by component name',
        sourceDatasourceId,
        targetDatasourceId,
        sourceFieldExpression: 'metadata.name',
        targetFieldExpression: 'metadata.name',
        relationshipType: 'depends_on',
        origin: 'seed',
      });

      expect(response.status).toBe(201);
      expect(
        mockRelationshipRuleDao.createRelationshipRule,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Match by component name' }),
        { origin: 'seed', workspaceId },
      );
    });

    it('rejects an invalid state on create', async () => {
      const response = await request(app).post('/relationship-rules').send({
        name: 'Match by component name',
        sourceDatasourceId,
        targetDatasourceId,
        sourceFieldExpression: 'metadata.name',
        targetFieldExpression: 'metadata.name',
        relationshipType: 'depends_on',
        state: 'inactive',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid state');
      expect(
        mockRelationshipRuleDao.createRelationshipRule,
      ).not.toHaveBeenCalled();
    });
  });

  describe('GET /:id', () => {
    it('returns 400 for invalid UUID', async () => {
      const response = await request(app).get('/relationship-rules/not-a-uuid');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid rule ID format');
    });

    it('returns 404 when rule does not exist', async () => {
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(undefined);

      const response = await request(app).get(`/relationship-rules/${ruleId}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('Rule not found');
    });
  });

  describe('PATCH /:id', () => {
    it('returns 400 for invalid targetDatasourceId format', async () => {
      const response = await request(app)
        .patch(`/relationship-rules/${ruleId}`)
        .send({ targetDatasourceId: 'not-a-uuid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('targetDatasourceId');
    });

    it('returns 404 when rule does not exist', async () => {
      mockRelationshipRuleDao.updateRelationshipRule.mockResolvedValue(
        undefined,
      );

      const response = await request(app)
        .patch(`/relationship-rules/${ruleId}`)
        .send({ name: 'Updated name' });

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('Rule not found');
    });

    it('updates rule fields', async () => {
      const updatedRule = {
        id: ruleId,
        name: 'Updated name',
        description: null,
      };
      mockRelationshipRuleDao.updateRelationshipRule.mockResolvedValue(
        updatedRule,
      );

      const response = await request(app)
        .patch(`/relationship-rules/${ruleId}`)
        .send({
          name: 'Updated name',
          targetFilterExpression: 'kind = "System"',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(updatedRule);
      expect(
        mockRelationshipRuleDao.updateRelationshipRule,
      ).toHaveBeenCalledWith(
        ruleId,
        {
          name: 'Updated name',
          description: undefined,
          sourceDatasourceId: undefined,
          targetDatasourceId: undefined,
          sourceFieldExpression: undefined,
          targetFieldExpression: undefined,
          sourceFilterExpression: undefined,
          targetFilterExpression: 'kind = "System"',
          relationshipType: undefined,
          reciprocalRelationshipType: undefined,
          matchStrategy: undefined,
          strategy: undefined,
          integrationConfig: undefined,
        },
        workspaceId,
      );
    });
  });

  describe('PUT /:id', () => {
    const completeRule = {
      name: 'Owners',
      sourceDatasourceId,
      targetDatasourceId,
      sourceFieldExpression: 'owner',
      targetFieldExpression: 'email',
      relationshipType: 'ownedBy',
    };

    it('clears optional fields the body omits', async () => {
      mockRelationshipRuleDao.updateRelationshipRule.mockResolvedValue({
        id: ruleId,
      });

      const response = await request(app)
        .put(`/relationship-rules/${ruleId}`)
        .send(completeRule);

      expect(response.status).toBe(200);
      expect(
        mockRelationshipRuleDao.updateRelationshipRule,
      ).toHaveBeenCalledWith(
        ruleId,
        {
          ...completeRule,
          description: null,
          sourceFilterExpression: null,
          targetFilterExpression: null,
          reciprocalRelationshipType: null,
          integrationConfig: null,
          strategy: 'field-matching',
          matchStrategy: 'exact',
        },
        workspaceId,
      );
    });

    it('passes explicit optional values through', async () => {
      mockRelationshipRuleDao.updateRelationshipRule.mockResolvedValue({
        id: ruleId,
      });

      await request(app)
        .put(`/relationship-rules/${ruleId}`)
        .send({
          ...completeRule,
          description: 'kept',
          matchStrategy: 'contains',
          sourceFilterExpression: 'kind = "User"',
        });

      expect(
        mockRelationshipRuleDao.updateRelationshipRule,
      ).toHaveBeenCalledWith(
        ruleId,
        expect.objectContaining({
          description: 'kept',
          matchStrategy: 'contains',
          sourceFilterExpression: 'kind = "User"',
        }),
        workspaceId,
      );
    });

    it('names every missing required field', async () => {
      const response = await request(app)
        .put(`/relationship-rules/${ruleId}`)
        .send({ name: 'Owners' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('sourceDatasourceId');
      expect(response.body.error).toContain('relationshipType');
      expect(
        mockRelationshipRuleDao.updateRelationshipRule,
      ).not.toHaveBeenCalled();
    });

    it('rejects a non-uuid id before looking at the body', async () => {
      const response = await request(app)
        .put('/relationship-rules/not-a-uuid')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid rule ID format');
    });

    it('does not write state', async () => {
      mockRelationshipRuleDao.updateRelationshipRule.mockResolvedValue({
        id: ruleId,
      });

      await request(app)
        .put(`/relationship-rules/${ruleId}`)
        .send({ ...completeRule, state: 'active' });

      expect(
        mockRelationshipRuleDao.updateRelationshipRule,
      ).toHaveBeenCalledWith(
        ruleId,
        expect.not.objectContaining({ state: 'active' }),
        workspaceId,
      );
    });
  });

  describe('DELETE /:id', () => {
    it('returns 204 and deletes the rule', async () => {
      mockDatastoreService.deleteRelationshipRule.mockResolvedValue(undefined);

      const response = await request(app).delete(
        `/relationship-rules/${ruleId}`,
      );

      expect(response.status).toBe(204);
      expect(mockDatastoreService.deleteRelationshipRule).toHaveBeenCalledWith(
        ruleId,
        workspaceId,
      );
    });
  });

  describe('POST /:id/apply', () => {
    it('returns 404 when the rule does not exist', async () => {
      mockDatastoreService.applyRelationshipRule.mockRejectedValue(
        new Error(`Relationship rule ${ruleId} not found`),
      );

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/apply`,
      );

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });

    it('applies the rule and returns counters', async () => {
      const mockResult = { created: 2, deleted: 1 };
      mockDatastoreService.applyRelationshipRule.mockResolvedValue(mockResult);

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/apply`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
      expect(mockDatastoreService.applyRelationshipRule).toHaveBeenCalledWith(
        ruleId,
        { workspaceId },
      );
    });

    it('returns a JSON-serialized body when apply throws a plain object', async () => {
      mockDatastoreService.applyRelationshipRule.mockRejectedValue({
        code: 'S0202',
        position: 3,
        message: 'Expected ":", got "}"',
      });

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/apply`,
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Expected ":", got "}"');
      expect(response.body.error).not.toBe('[object Object]');
    });
  });

  describe('POST /:id/dry-run', () => {
    it('dry-runs the rule and returns candidates', async () => {
      const mockResult = {
        created: 1,
        deleted: 0,
        candidates: [
          {
            sourceObjectId: 'svc-a',
            destinationObjectId: 'user-a',
            relationshipType: 'resolvedTo',
            metadata: null,
          },
        ],
        skippedSources: [],
        truncated: false,
        sampled: 1,
      };
      mockDatastoreService.applyRelationshipRule.mockResolvedValue(mockResult);

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/dry-run?sampleLimit=10`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
      expect(mockDatastoreService.applyRelationshipRule).toHaveBeenCalledWith(
        ruleId,
        { dryRun: true, sampleLimit: 10, workspaceId },
      );
    });

    it('rejects a non-positive sampleLimit', async () => {
      const response = await request(app).post(
        `/relationship-rules/${ruleId}/dry-run?sampleLimit=0`,
      );

      expect(response.status).toBe(400);
      expect(mockDatastoreService.applyRelationshipRule).not.toHaveBeenCalled();
    });

    it('returns a useful message when dry-run throws a plain object', async () => {
      mockDatastoreService.applyRelationshipRule.mockRejectedValue({
        code: 'S0202',
        position: 3,
        message: 'Expected ":", got "}"',
      });

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/dry-run`,
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Expected ":", got "}"');
      expect(response.body.error).not.toBe('[object Object]');
    });
  });

  describe('POST /preview', () => {
    it('forwards an integration-backed preview to the repository', async () => {
      const integrationConfig = {
        integrationId: 'integration-1',
        path: '/lookup/{value}',
        responseMatchExpression: 'name',
      };
      mockDatastoreService.previewRelationshipRule.mockResolvedValue({
        items: [],
        total: 0,
        truncated: false,
        skippedSources: [],
      });

      const response = await request(app)
        .post(
          '/relationship-rules/preview?sampleLimit=5&sourceObjectId=source-specific',
        )
        .send({
          sourceDatasourceId,
          targetDatasourceId,
          sourceFieldExpression: 'git_sha',
          targetFieldExpression: 'metadata.name',
          relationshipType: 'deployedFromPullRequest',
          strategy: 'integration-backed',
          integrationConfig,
        });

      expect(response.status).toBe(200);
      expect(mockDatastoreService.previewRelationshipRule).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'integration-backed',
          integrationConfig,
          sampleLimit: 5,
          sourceObjectId: 'source-specific',
        }),
      );
    });

    it('forwards an exact source selector for field-matching previews', async () => {
      mockDatastoreService.previewRelationshipRule.mockResolvedValue({
        items: [],
        total: 0,
      });

      const response = await request(app)
        .post('/relationship-rules/preview?sourceObjectId=source-specific')
        .send({
          sourceDatasourceId,
          targetDatasourceId,
          sourceFieldExpression: 'owner',
          targetFieldExpression: 'name',
          relationshipType: 'ownedBy',
          strategy: 'field-matching',
        });

      expect(response.status).toBe(200);
      expect(mockDatastoreService.previewRelationshipRule).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'field-matching',
          sourceObjectId: 'source-specific',
        }),
      );
    });

    it('rejects an integration-backed preview without integrationConfig', async () => {
      const response = await request(app)
        .post('/relationship-rules/preview')
        .send({
          sourceDatasourceId,
          targetDatasourceId,
          sourceFieldExpression: 'git_sha',
          targetFieldExpression: 'metadata.name',
          relationshipType: 'deployedFromPullRequest',
          strategy: 'integration-backed',
        });

      expect(response.status).toBe(400);
      expect(
        mockDatastoreService.previewRelationshipRule,
      ).not.toHaveBeenCalled();
    });

    it('infers integration-backed preview when integrationConfig is sent without strategy', async () => {
      const integrationConfig = {
        integrationId: 'integration-1',
        path: '/lookup/{value}',
        responseMatchExpression: 'name',
      };
      mockDatastoreService.previewRelationshipRule.mockResolvedValue({
        items: [],
        total: 0,
      });

      const response = await request(app)
        .post('/relationship-rules/preview')
        .send({
          sourceDatasourceId,
          targetDatasourceId,
          sourceFieldExpression: 'git_sha',
          targetFieldExpression: 'metadata.name',
          relationshipType: 'deployedFromPullRequest',
          integrationConfig,
        });

      expect(response.status).toBe(200);
      expect(mockDatastoreService.previewRelationshipRule).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'integration-backed',
          integrationConfig,
        }),
      );
    });

    it('rejects integration-backed preview without targetFieldExpression', async () => {
      const response = await request(app)
        .post('/relationship-rules/preview')
        .send({
          sourceDatasourceId,
          targetDatasourceId,
          sourceFieldExpression: 'git_sha',
          relationshipType: 'deployedFromPullRequest',
          strategy: 'integration-backed',
          integrationConfig: {
            integrationId: 'integration-1',
            path: '/lookup/{value}',
            responseMatchExpression: 'name',
          },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('targetFieldExpression');
      expect(
        mockDatastoreService.previewRelationshipRule,
      ).not.toHaveBeenCalled();
    });

    it('rejects field-matching preview with integrationConfig', async () => {
      const response = await request(app)
        .post('/relationship-rules/preview')
        .send({
          sourceDatasourceId,
          targetDatasourceId,
          sourceFieldExpression: 'git_sha',
          relationshipType: 'deployedFromPullRequest',
          strategy: 'field-matching',
          integrationConfig: {
            integrationId: 'integration-1',
            path: '/lookup/{value}',
            responseMatchExpression: 'name',
          },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('field-matching');
      expect(
        mockDatastoreService.previewRelationshipRule,
      ).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric sampleLimit', async () => {
      const response = await request(app)
        .post('/relationship-rules/preview?sampleLimit=abc')
        .send({
          sourceDatasourceId,
          targetDatasourceId,
          sourceFieldExpression: 'owner',
          relationshipType: 'ownedBy',
        });

      expect(response.status).toBe(400);
      expect(
        mockDatastoreService.previewRelationshipRule,
      ).not.toHaveBeenCalled();
    });

    it('rejects a sampleLimit above the maximum of 50', async () => {
      const response = await request(app)
        .post('/relationship-rules/preview?sampleLimit=51')
        .send({
          sourceDatasourceId,
          targetDatasourceId,
          sourceFieldExpression: 'owner',
          relationshipType: 'ownedBy',
        });

      expect(response.status).toBe(400);
      expect(
        mockDatastoreService.previewRelationshipRule,
      ).not.toHaveBeenCalled();
    });

    it('returns a JSON-serialized body when preview throws a plain object', async () => {
      mockDatastoreService.previewRelationshipRule.mockRejectedValue({
        code: '42P01',
        detail: 'relation "datastore_objects" does not exist',
      });

      const response = await request(app)
        .post('/relationship-rules/preview')
        .send({
          sourceDatasourceId,
          targetDatasourceId,
          sourceFieldExpression: 'owner',
          targetFieldExpression: 'name',
          relationshipType: 'ownedBy',
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('42P01');
      expect(response.body.error).toContain('datastore_objects');
      expect(response.body.error).not.toBe('[object Object]');
    });
  });

  describe('POST /:id/approve', () => {
    it('transitions suggested to active', async () => {
      const rule = {
        id: ruleId,
        state: 'suggested',
        sourceDatasourceId,
        targetDatasourceId,
        relationshipType: 'depends_on',
        origin: 'generated',
      };
      const updated = { id: ruleId, state: 'active' };
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(rule);
      mockRelationshipRuleDao.listRelationshipRules.mockResolvedValue({
        items: [],
        total: 0,
      });
      mockRelationshipRuleDao.updateRelationshipRuleState.mockResolvedValue(
        updated,
      );

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/approve`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(updated);
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState,
      ).toHaveBeenCalledWith(ruleId, 'active', {
        reviewReason: null,
        expectedState: 'suggested',
      });
      expect(mockDatastoreService.applyRelationshipRule).toHaveBeenCalledWith(
        ruleId,
        expect.objectContaining({
          triggerSource: 'manual',
        }),
      );
    });

    it('returns 409 when rule is not suggested', async () => {
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue({
        id: ruleId,
        state: 'active',
      });

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/approve`,
      );

      expect(response.status).toBe(409);
      expect(response.body.error).toContain("currently 'active'");
    });

    it('returns 404 when rule does not exist', async () => {
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(undefined);

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/approve`,
      );

      expect(response.status).toBe(404);
    });

    it('returns 409 (not silent success) when the compare-and-swap loses a race', async () => {
      // The read sees 'suggested', but a concurrent transition moves the row
      // out of that state before our write — so the CAS matches 0 rows and the
      // DAO returns undefined. The handler must surface a 409, and must NOT
      // apply the rule (which would materialize edges for a rule that never
      // actually flipped active).
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue({
        id: ruleId,
        state: 'suggested',
        sourceDatasourceId,
        targetDatasourceId,
        relationshipType: 'depends_on',
        origin: 'generated',
      });
      mockRelationshipRuleDao.listRelationshipRules.mockResolvedValue({
        items: [],
        total: 0,
      });
      mockRelationshipRuleDao.updateRelationshipRuleState.mockResolvedValue(
        undefined,
      );

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/approve`,
      );

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('no longer in expected state');
      expect(mockDatastoreService.applyRelationshipRule).not.toHaveBeenCalled();
    });

    it('rolls the rule back to suggested when apply throws, so a retry can work', async () => {
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue({
        id: ruleId,
        state: 'suggested',
        sourceDatasourceId,
        targetDatasourceId,
        relationshipType: 'depends_on',
        origin: 'llm-discovered',
      });
      mockRelationshipRuleDao.listRelationshipRules.mockResolvedValue({
        items: [],
        total: 0,
      });
      mockRelationshipRuleDao.updateRelationshipRuleState.mockImplementation(
        async (id: string, state: string) => ({ id, state }),
      );
      mockDatastoreService.applyRelationshipRule.mockRejectedValue(
        new Error('apply blew up'),
      );

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/approve`,
      );

      // Non-2xx, and the rule is left 'suggested' rather than stranded 'active'
      // with no edges — the reverse only recovered via a manual apply.
      expect(response.status).toBe(500);
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState,
      ).toHaveBeenCalledWith(ruleId, 'active', {
        reviewReason: null,
        expectedState: 'suggested',
      });
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState,
      ).toHaveBeenCalledWith(ruleId, 'suggested', {
        reviewReason: null,
        workspaceId,
      });
    });

    it('returns 500 when transition fails', async () => {
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue({
        id: ruleId,
        state: 'suggested',
        sourceDatasourceId,
        targetDatasourceId,
        relationshipType: 'depends_on',
        origin: 'generated',
      });
      mockRelationshipRuleDao.listRelationshipRules.mockResolvedValue({
        items: [],
        total: 0,
      });
      mockRelationshipRuleDao.updateRelationshipRuleState.mockRejectedValue(
        new Error('boom'),
      );

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/approve`,
      );

      expect(response.status).toBe(500);
    });
  });

  describe('POST /:id/approve inverse suppression', () => {
    const inverseId = '880e8400-e29b-41d4-a716-446655440000';

    function suggestedRule(overrides: Record<string, unknown>) {
      return {
        id: ruleId,
        name: 'r',
        sourceDatasourceId,
        targetDatasourceId,
        sourceFieldExpression: '$.login',
        targetFieldExpression: '$.mention_name',
        relationshipType: 'sameAs',
        state: 'suggested',
        strategy: 'field-matching',
        matchStrategy: 'exact',
        origin: 'suggestion',
        createdAt: '2026-08-11T00:00:00Z',
        updatedAt: '2026-08-11T00:00:00Z',
        ...overrides,
      };
    }

    it('dismisses the mirrored suggestion when a rule is approved', async () => {
      const approved = suggestedRule({});
      const mirror = suggestedRule({
        id: inverseId,
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(approved);
      // The approve guard discovers the mirror in one datasource-scoped
      // snapshot; the trailing suppression re-scans the suggested set.
      mockRelationshipRuleDao.listRelationshipRulesByDatasourceIds.mockResolvedValue(
        [mirror],
      );
      // By the time this query runs, `approved` has already transitioned to
      // 'active' in the real DAO, so a 'suggested' filter no longer includes it.
      mockRulesByState({ suggested: [mirror] });
      mockRelationshipRuleDao.updateRelationshipRuleState.mockImplementation(
        async (id: string, state: string) => ({ ...approved, id, state }),
      );
      mockDatastoreService.applyRelationshipRule.mockResolvedValue({
        created: 3,
        deleted: 0,
      });

      const res = await request(app)
        .post(`/relationship-rules/${ruleId}/approve`)
        .send();

      expect(res.status).toBe(200);
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState,
      ).toHaveBeenCalledWith(ruleId, 'active', {
        reviewReason: null,
        expectedState: 'suggested',
      });
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState,
      ).toHaveBeenCalledWith(inverseId, 'inactive', {
        reviewReason: 'inverse-suppressed',
        workspaceId,
      });
    });

    it('returns 409 when an equivalent active rule already exists', async () => {
      const approved = suggestedRule({});
      const activeMirror = suggestedRule({
        id: inverseId,
        state: 'active',
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(approved);
      // The active mirror is present in the single discovery snapshot, so the
      // guard 409s before taking the lock.
      mockRelationshipRuleDao.listRelationshipRulesByDatasourceIds.mockResolvedValue(
        [activeMirror],
      );
      mockRulesByState({ active: [activeMirror] });

      const res = await request(app)
        .post(`/relationship-rules/${ruleId}/approve`)
        .send();

      expect(res.status).toBe(409);
      expect(res.body.error).toBe(
        `An equivalent active rule already exists (${inverseId})`,
      );
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState,
      ).not.toHaveBeenCalled();
      expect(mockDatastoreService.applyRelationshipRule).not.toHaveBeenCalled();
    });

    it('applies the rule even when suppressing its mirror throws', async () => {
      const approved = suggestedRule({});
      const mirror = suggestedRule({
        id: inverseId,
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(approved);
      mockRelationshipRuleDao.listRelationshipRulesByDatasourceIds.mockResolvedValue(
        [mirror],
      );
      mockRulesByState({ suggested: [mirror] });
      mockRelationshipRuleDao.updateRelationshipRuleState.mockImplementation(
        async (id: string, state: string) => {
          if (id === inverseId) throw new Error('suppress blew up');
          return { ...approved, id, state };
        },
      );
      mockDatastoreService.applyRelationshipRule.mockResolvedValue({
        created: 3,
        deleted: 0,
      });

      const res = await request(app)
        .post(`/relationship-rules/${ruleId}/approve`)
        .send();

      // The approve is done and cannot be retried (a retry would 409), so it
      // must not report a failure — and the rule's own edges must exist.
      expect(res.status).toBe(200);
      expect(mockDatastoreService.applyRelationshipRule).toHaveBeenCalledWith(
        ruleId,
        { triggerSource: 'manual', workspaceId },
      );
    });

    it('approves normally when the rule has no mirror', async () => {
      const approved = suggestedRule({});
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(approved);
      mockRulesByState({});
      mockRelationshipRuleDao.updateRelationshipRuleState.mockResolvedValue({
        ...approved,
        state: 'active',
      });
      mockDatastoreService.applyRelationshipRule.mockResolvedValue({
        created: 1,
        deleted: 0,
      });

      const res = await request(app)
        .post(`/relationship-rules/${ruleId}/approve`)
        .send();

      expect(res.status).toBe(200);
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState,
      ).toHaveBeenCalledTimes(1);
    });

    it('serializes the flip against the suggested mirror via the pair lock', async () => {
      const approved = suggestedRule({});
      const mirror = suggestedRule({
        id: inverseId,
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(approved);
      mockRelationshipRuleDao.listRelationshipRulesByDatasourceIds.mockResolvedValue(
        [mirror],
      );
      mockRulesByState({ suggested: [mirror] });
      mockRelationshipRuleDao.updateRelationshipRuleState.mockImplementation(
        async (id: string, state: string) => ({ ...approved, id, state }),
      );
      mockDatastoreService.applyRelationshipRule.mockResolvedValue({
        created: 1,
        deleted: 0,
      });

      const res = await request(app)
        .post(`/relationship-rules/${ruleId}/approve`)
        .send();

      expect(res.status).toBe(200);
      // The suggested mirror is locked alongside the rule so a concurrent
      // approve of the opposite direction can't also go active.
      expect(
        mockRelationshipRuleDao.transitionStateWithPairLock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          id: ruleId,
          toState: 'active',
          expectedState: 'suggested',
          blockingMirrorIds: [inverseId],
        }),
      );
    });

    it('discovers the mirror in a single all-state snapshot, not two per-state reads', async () => {
      // Regression guard for the crack a two-read (active-then-suggested)
      // discovery leaves: a mirror that flips active between the reads lands in
      // neither set, so the flip would lock only itself. One datasource-scoped
      // snapshot can't miss it.
      const approved = suggestedRule({});
      const mirror = suggestedRule({
        id: inverseId,
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(approved);
      mockRelationshipRuleDao.listRelationshipRulesByDatasourceIds.mockResolvedValue(
        [mirror],
      );
      mockRulesByState({ suggested: [mirror] });
      mockRelationshipRuleDao.updateRelationshipRuleState.mockImplementation(
        async (id: string, state: string) => ({ ...approved, id, state }),
      );
      mockDatastoreService.applyRelationshipRule.mockResolvedValue({
        created: 1,
        deleted: 0,
      });

      await request(app).post(`/relationship-rules/${ruleId}/approve`).send();

      expect(
        mockRelationshipRuleDao.listRelationshipRulesByDatasourceIds,
      ).toHaveBeenCalledWith([sourceDatasourceId, targetDatasourceId], {
        workspaceId,
      });
      expect(
        mockRelationshipRuleDao.transitionStateWithPairLock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ blockingMirrorIds: [inverseId] }),
      );
    });

    it('blocks on the live suggested mirror, not an inactive duplicate of the same pair', async () => {
      // Regression: an inactive duplicate sharing the mirror's content key must
      // not mask the still-suggested mirror. If it did, blockingMirrorIds would
      // be empty and both directions could go active.
      const approved = suggestedRule({});
      const staleDuplicate = suggestedRule({
        id: 'stale-dup',
        state: 'inactive',
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      const liveMirror = suggestedRule({
        id: inverseId,
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(approved);
      // Inactive duplicate first so a last-write-wins pick would return it.
      mockRelationshipRuleDao.listRelationshipRulesByDatasourceIds.mockResolvedValue(
        [staleDuplicate, liveMirror],
      );
      mockRelationshipRuleDao.updateRelationshipRuleState.mockImplementation(
        async (id: string, state: string) => ({ ...approved, id, state }),
      );
      mockDatastoreService.applyRelationshipRule.mockResolvedValue({
        created: 1,
        deleted: 0,
      });

      await request(app).post(`/relationship-rules/${ruleId}/approve`).send();

      expect(
        mockRelationshipRuleDao.transitionStateWithPairLock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ blockingMirrorIds: [inverseId] }),
      );
    });

    it('locks EVERY suggested mirror, not just one, when the pair has duplicates', async () => {
      // Two suggested rows for the opposite direction (a reset/re-suggested
      // copy). Locking only one lets a concurrent approve of the other lock a
      // disjoint pair and both go active. All suggested inverse ids must reach
      // the pair lock.
      const approved = suggestedRule({});
      const mirrorOne = suggestedRule({
        id: inverseId,
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      const mirrorTwo = suggestedRule({
        id: 'inverse-dup',
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(approved);
      mockRelationshipRuleDao.listRelationshipRulesByDatasourceIds.mockResolvedValue(
        [mirrorOne, mirrorTwo],
      );
      mockRelationshipRuleDao.updateRelationshipRuleState.mockImplementation(
        async (id: string, state: string) => ({ ...approved, id, state }),
      );
      mockDatastoreService.applyRelationshipRule.mockResolvedValue({
        created: 1,
        deleted: 0,
      });

      await request(app).post(`/relationship-rules/${ruleId}/approve`).send();

      const call =
        mockRelationshipRuleDao.transitionStateWithPairLock.mock.calls[0][0];
      expect([...call.blockingMirrorIds].sort()).toEqual(
        [inverseId, 'inverse-dup'].sort(),
      );
    });

    it('refuses (409) when an active mirror is hidden behind an inactive duplicate', async () => {
      // The active mirror must still 409 even when an inactive duplicate of the
      // same pair sorts ahead of it.
      const approved = suggestedRule({});
      const staleDuplicate = suggestedRule({
        id: 'stale-dup',
        state: 'inactive',
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      const activeMirror = suggestedRule({
        id: inverseId,
        state: 'active',
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(approved);
      mockRelationshipRuleDao.listRelationshipRulesByDatasourceIds.mockResolvedValue(
        [staleDuplicate, activeMirror],
      );

      const response = await request(app)
        .post(`/relationship-rules/${ruleId}/approve`)
        .send();

      expect(response.status).toBe(409);
      expect(
        mockRelationshipRuleDao.transitionStateWithPairLock,
      ).not.toHaveBeenCalled();
    });

    it('returns 409 (and does not apply) when the pair lock reports the mirror already active', async () => {
      const approved = suggestedRule({});
      const mirror = suggestedRule({
        id: inverseId,
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(approved);
      // The mirror is suggested at discovery — it only wins the race inside the
      // lock, so the conflict comes from the pair lock itself.
      mockRelationshipRuleDao.listRelationshipRulesByDatasourceIds.mockResolvedValue(
        [mirror],
      );
      mockRulesByState({ suggested: [mirror] });
      mockRelationshipRuleDao.transitionStateWithPairLock.mockResolvedValue({
        status: 'conflict',
        reason: 'mirror-active',
      });

      const res = await request(app)
        .post(`/relationship-rules/${ruleId}/approve`)
        .send();

      expect(res.status).toBe(409);
      expect(res.body.error).toBe(
        `An equivalent active rule already exists (${inverseId})`,
      );
      expect(mockDatastoreService.applyRelationshipRule).not.toHaveBeenCalled();
    });
  });

  describe('POST /approve (bulk)', () => {
    const idA = '770e8400-e29b-41d4-a716-446655440000';
    const idB = '880e8400-e29b-41d4-a716-446655440000';
    const idLone = '990e8400-e29b-41d4-a716-446655440000';

    function suggested(id: string, overrides: Record<string, unknown> = {}) {
      return {
        id,
        name: id,
        sourceDatasourceId,
        targetDatasourceId,
        sourceFieldExpression: '$.login',
        targetFieldExpression: '$.mention_name',
        relationshipType: 'sameAs',
        state: 'suggested',
        strategy: 'field-matching',
        matchStrategy: 'exact',
        origin: 'suggestion',
        createdAt: '2026-08-11T00:00:00Z',
        updatedAt: '2026-08-11T00:00:00Z',
        ...overrides,
      };
    }

    beforeEach(() => {
      mockDatastoreService.applyRelationshipRule.mockResolvedValue({
        created: 1,
        deleted: 0,
      });
      mockRelationshipRuleDao.updateRelationshipRuleState.mockImplementation(
        async (id: string, state: string) => ({ ...suggested(id), state }),
      );
    });

    it('approves the winner and dismisses the mirror in one call', async () => {
      const a = suggested(idA, { score: 0.9 });
      const b = suggested(idB, {
        score: 0.4,
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRulesByState({ suggested: [a, b] });
      mockRelationshipRuleDao.getRelationshipRule.mockImplementation(
        async (id: string) => (id === idA ? a : b),
      );

      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids: [idA, idB] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        approved: [idA],
        dismissedAsInverse: [idB],
        failed: [],
        inverseDismissFailed: [],
      });
      expect(mockDatastoreService.applyRelationshipRule).toHaveBeenCalledTimes(
        1,
      );
      // The snapshot must be the suggested set: a rule already flipped active
      // would drop out of it and never get paired with its mirror.
      expect(
        mockRelationshipRuleDao.listRelationshipRules,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'suggested', limit: 10000 }),
      );
    });

    it('keeps partial results and suppresses the winners mirrors when one apply throws', async () => {
      const a = suggested(idA, { score: 0.9 });
      const aMirror = suggested(idB, {
        score: 0.4,
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      const exploding = suggested(idLone, {
        sourceFieldExpression: '$.email',
        targetFieldExpression: '$.email',
      });
      mockRulesByState({ suggested: [a, aMirror, exploding] });
      const rules = new Map([
        [idA, a],
        [idB, aMirror],
        [idLone, exploding],
      ]);
      mockRelationshipRuleDao.getRelationshipRule.mockImplementation(
        async (id: string) => rules.get(id),
      );
      mockDatastoreService.applyRelationshipRule.mockImplementation(
        async (id: string) => {
          if (id === idLone) throw new Error('apply blew up');
          return { created: 1, deleted: 0 };
        },
      );

      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids: [idA, idLone] });

      expect(res.status).toBe(200);
      expect(res.body.approved).toEqual([idA]);
      expect(res.body.failed).toEqual([
        { id: idLone, reason: 'apply blew up' },
      ]);
      expect(res.body.dismissedAsInverse).toEqual([idB]);
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState,
      ).toHaveBeenCalledWith(idB, 'inactive', {
        reviewReason: 'inverse-suppressed',
        workspaceId,
      });
    });

    it('resets a rule to suggested when its apply throws, leaving its mirror retryable', async () => {
      const a = suggested(idA, { score: 0.9 });
      const aMirror = suggested(idB, {
        score: 0.4,
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRulesByState({ suggested: [a, aMirror] });
      const rules = new Map([
        [idA, a],
        [idB, aMirror],
      ]);
      mockRelationshipRuleDao.getRelationshipRule.mockImplementation(
        async (id: string) => rules.get(id),
      );
      mockDatastoreService.applyRelationshipRule.mockRejectedValue(
        new Error('apply blew up'),
      );

      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids: [idA] });

      expect(res.status).toBe(200);
      expect(res.body.approved).toEqual([]);
      expect(res.body.failed).toEqual([{ id: idA, reason: 'apply blew up' }]);
      // The winner is flipped active, then rolled back to suggested when apply
      // throws — so a retry sees 'suggested', not a wedged 'active'.
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState,
      ).toHaveBeenCalledWith(idA, 'active', {
        reviewReason: null,
        expectedState: 'suggested',
      });
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState,
      ).toHaveBeenCalledWith(idA, 'suggested', {
        reviewReason: null,
        workspaceId,
      });
      // The mirror is never dismissed, so it stays suggested and its own
      // approve is not blocked by a broken active winner.
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState,
      ).not.toHaveBeenCalledWith(idB, 'inactive', expect.anything());
    });

    it('reports an id whose mirror is already active instead of duplicating the edge', async () => {
      const a = suggested(idA);
      const activeMirror = suggested(idB, {
        state: 'active',
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRulesByState({ suggested: [a], active: [activeMirror] });
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(a);

      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids: [idA] });

      expect(res.status).toBe(200);
      expect(res.body.approved).toEqual([]);
      expect(res.body.failed).toEqual([
        {
          id: idA,
          reason: `An equivalent active rule already exists (${idB})`,
        },
      ]);
      expect(mockDatastoreService.applyRelationshipRule).not.toHaveBeenCalled();
    });

    it('de-duplicates repeated ids so one approve cannot also report a failure', async () => {
      const lone = suggested(idLone);
      mockRulesByState({ suggested: [lone] });
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(lone);

      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids: [idLone, idLone] });

      expect(res.status).toBe(200);
      expect(res.body.approved).toEqual([idLone]);
      expect(res.body.failed).toEqual([]);
      expect(mockDatastoreService.applyRelationshipRule).toHaveBeenCalledTimes(
        1,
      );
    });

    it('reports a non-suggested id in failed instead of failing the batch', async () => {
      const lone = suggested(idLone);
      const alreadyActive = suggested(idA, {
        state: 'active',
        sourceFieldExpression: '$.email',
      });
      mockRulesByState({ suggested: [lone] });
      mockRelationshipRuleDao.getRelationshipRule.mockImplementation(
        async (id: string) => (id === idLone ? lone : alreadyActive),
      );

      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids: [idLone, idA] });

      expect(res.status).toBe(200);
      expect(res.body.approved).toEqual([idLone]);
      expect(res.body.failed).toEqual([
        { id: idA, reason: "Rule is currently 'active', expected 'suggested'" },
      ]);
    });

    it('scans the active set once however many ids are approved', async () => {
      const ids = [idA, idB, idLone];
      const rules = new Map(
        ids.map((id, i) => [
          id,
          suggested(id, { sourceFieldExpression: `$.field${i}` }),
        ]),
      );
      mockRulesByState({ suggested: [...rules.values()] });
      mockRelationshipRuleDao.getRelationshipRule.mockImplementation(
        async (id: string) => rules.get(id),
      );

      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids });

      expect(res.status).toBe(200);
      expect(res.body.approved).toEqual(ids);
      // One scan for the whole batch, not one per id.
      const activeScans =
        mockRelationshipRuleDao.listRelationshipRules.mock.calls.filter(
          (call: unknown[]) =>
            (call[0] as { state?: string } | undefined)?.state === 'active',
        );
      expect(activeScans).toHaveLength(1);
    });

    it('refuses an id whose mirror was approved earlier in the same batch', async () => {
      const a = suggested(idA);
      const bMirrorOfA = suggested(idB, {
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      // Only A is in the snapshot the split is computed from, so B reaches the
      // loop unpaired — the active guard is the only thing that can refuse it.
      mockRulesByState({ suggested: [a] });
      const rules = new Map([
        [idA, a],
        [idB, bMirrorOfA],
      ]);
      mockRelationshipRuleDao.getRelationshipRule.mockImplementation(
        async (id: string) => rules.get(id),
      );

      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids: [idA, idB] });

      expect(res.status).toBe(200);
      expect(res.body.approved).toEqual([idA]);
      expect(res.body.failed).toEqual([
        {
          id: idB,
          reason: `An equivalent active rule already exists (${idA})`,
        },
      ]);
      expect(mockDatastoreService.applyRelationshipRule).toHaveBeenCalledTimes(
        1,
      );
    });

    it('reports the mirror, not the winner, when dismissing the mirror throws', async () => {
      const a = suggested(idA, { score: 0.9 });
      const aMirror = suggested(idB, {
        score: 0.4,
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRulesByState({ suggested: [a, aMirror] });
      const rules = new Map([
        [idA, a],
        [idB, aMirror],
      ]);
      mockRelationshipRuleDao.getRelationshipRule.mockImplementation(
        async (id: string) => rules.get(id),
      );
      mockRelationshipRuleDao.updateRelationshipRuleState.mockImplementation(
        async (id: string, state: string) => {
          if (id === idB) throw new Error('dismiss blew up');
          return { ...suggested(id), state };
        },
      );

      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids: [idA, idB] });

      expect(res.status).toBe(200);
      expect(res.body.approved).toEqual([idA]);
      expect(res.body.dismissedAsInverse).toEqual([]);
      expect(res.body.failed).toEqual([
        {
          id: idB,
          reason: `Could not dismiss as the inverse of approved rule ${idA}: dismiss blew up`,
        },
      ]);
      expect(res.body.failed.map((f: { id: string }) => f.id)).not.toContain(
        idA,
      );
    });

    it('accounts for a requested mirror when its winner fails to approve', async () => {
      const a = suggested(idA, { score: 0.9 });
      const aMirror = suggested(idB, {
        score: 0.4,
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRulesByState({ suggested: [a, aMirror] });
      const rules = new Map([
        [idA, a],
        [idB, aMirror],
      ]);
      mockRelationshipRuleDao.getRelationshipRule.mockImplementation(
        async (id: string) => rules.get(id),
      );
      mockDatastoreService.applyRelationshipRule.mockRejectedValue(
        new Error('apply blew up'),
      );

      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids: [idA, idB] });

      expect(res.status).toBe(200);
      expect(res.body.approved).toEqual([]);
      expect(res.body.dismissedAsInverse).toEqual([]);
      // Both requested ids are accounted for; neither silently vanishes.
      expect(res.body.failed.map((f: { id: string }) => f.id).sort()).toEqual(
        [idA, idB].sort(),
      );
      // The mirror is left suggested rather than destroyed for nothing.
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState,
      ).not.toHaveBeenCalledWith(idB, 'inactive', expect.anything());
    });

    it('keeps an unrequested mirrors dismissal failure out of failed', async () => {
      const a = suggested(idA, { score: 0.9 });
      const aMirror = suggested(idB, {
        score: 0.4,
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRulesByState({ suggested: [a, aMirror] });
      const rules = new Map([
        [idA, a],
        [idB, aMirror],
      ]);
      mockRelationshipRuleDao.getRelationshipRule.mockImplementation(
        async (id: string) => rules.get(id),
      );
      mockRelationshipRuleDao.updateRelationshipRuleState.mockImplementation(
        async (id: string, state: string) => {
          if (id === idB) throw new Error('dismiss blew up');
          return { ...suggested(id), state };
        },
      );

      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids: [idA] });

      expect(res.status).toBe(200);
      expect(res.body.approved).toEqual([idA]);
      // The caller asked about one id and it was approved: counting the
      // mirror's dismissal here would toast a failure for a clean approve.
      expect(res.body.failed).toEqual([]);
      expect(res.body.inverseDismissFailed).toEqual([
        {
          id: idB,
          reason: `Could not dismiss as the inverse of approved rule ${idA}: dismiss blew up`,
        },
      ]);
    });

    it('leaves an unrequested mirror unmentioned when its winner fails', async () => {
      const a = suggested(idA, { score: 0.9 });
      const aMirror = suggested(idB, {
        score: 0.4,
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: '$.mention_name',
        targetFieldExpression: '$.login',
      });
      mockRulesByState({ suggested: [a, aMirror] });
      const rules = new Map([
        [idA, a],
        [idB, aMirror],
      ]);
      mockRelationshipRuleDao.getRelationshipRule.mockImplementation(
        async (id: string) => rules.get(id),
      );
      mockDatastoreService.applyRelationshipRule.mockRejectedValue(
        new Error('apply blew up'),
      );

      // Only the winner is requested, and it fails — so the mirror's
      // suppression never earns itself, and the caller never named it.
      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids: [idA] });

      expect(res.status).toBe(200);
      expect(res.body.approved).toEqual([]);
      expect(res.body.failed).toEqual([{ id: idA, reason: 'apply blew up' }]);
      // An id the caller never asked about is left alone rather than reported.
      expect(res.body.dismissedAsInverse).toEqual([]);
      expect(res.body.inverseDismissFailed).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain(idB);
      // And it stays reviewable rather than being destroyed for nothing.
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState,
      ).not.toHaveBeenCalledWith(idB, 'inactive', expect.anything());
    });

    it('fails an id that disappears between the snapshot and its own fetch', async () => {
      const lone = suggested(idLone);
      // The split sees it in the suggested snapshot, but it is gone by the time
      // the loop re-reads it — deleted by another caller mid-batch.
      mockRulesByState({ suggested: [lone] });
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids: [idLone] });

      expect(res.status).toBe(200);
      expect(res.body.approved).toEqual([]);
      expect(res.body.failed).toEqual([
        { id: idLone, reason: 'Rule not found' },
      ]);
      expect(mockDatastoreService.applyRelationshipRule).not.toHaveBeenCalled();
    });

    it('rejects a body without an ids array', async () => {
      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({});
      expect(res.status).toBe(400);
    });

    it('rejects a malformed id', async () => {
      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids: ['nope'] });
      expect(res.status).toBe(400);
    });

    it('records an approve verdict for each generator-owned rule in a bulk approve', async () => {
      // Distinct, non-swapped field expressions so neither rule pairs as the
      // other's inverse — this test is about verdict recording, not mirroring.
      const a = suggested(idA, {
        origin: 'generated',
        strategy: 'field-matching',
        sourceFieldExpression: '$.fieldA',
        score: 0.9,
        confidenceBand: 'high',
        evidenceSummary: { distinctMatchedValueCount: 5 },
      });
      const b = suggested(idB, {
        origin: 'generated',
        strategy: 'field-matching',
        sourceFieldExpression: '$.fieldB',
        score: 0.6,
        confidenceBand: 'medium',
        evidenceSummary: { distinctMatchedValueCount: 2 },
      });
      mockRulesByState({ suggested: [a, b] });
      const rules = new Map([
        [idA, a],
        [idB, b],
      ]);
      mockRelationshipRuleDao.getRelationshipRule.mockImplementation(
        async (id: string) => rules.get(id),
      );

      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids: [idA, idB] });

      expect(res.status).toBe(200);
      expect(res.body.approved).toEqual([idA, idB]);
      expect(mockSuggestionVerdictDao.appendVerdict).toHaveBeenCalledTimes(2);
      expect(mockSuggestionVerdictDao.appendVerdict).toHaveBeenCalledWith(
        {
          ruleId: idA,
          action: 'approve',
          actor: 'testuser',
          score: 0.9,
          confidenceBand: 'high',
          evidenceSummary: { distinctMatchedValueCount: 5 },
          rankShown: null,
        },
        workspaceId,
      );
      expect(mockSuggestionVerdictDao.appendVerdict).toHaveBeenCalledWith(
        {
          ruleId: idB,
          action: 'approve',
          actor: 'testuser',
          score: 0.6,
          confidenceBand: 'medium',
          evidenceSummary: { distinctMatchedValueCount: 2 },
          rankShown: null,
        },
        workspaceId,
      );
    });

    it('does not record a verdict for a non-generator-owned rule approved in bulk', async () => {
      // suggested()'s default origin is 'suggestion', which is not
      // generator-owned (isGeneratorOwnedRule requires origin 'generated' and
      // strategy 'field-matching') — the gate should suppress appendVerdict.
      const lone = suggested(idLone);
      mockRulesByState({ suggested: [lone] });
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(lone);

      const res = await request(app)
        .post('/relationship-rules/approve')
        .send({ ids: [idLone] });

      expect(res.status).toBe(200);
      expect(res.body.approved).toEqual([idLone]);
      expect(mockSuggestionVerdictDao.appendVerdict).not.toHaveBeenCalled();
    });
  });

  describe('POST /:id/dismiss', () => {
    it('transitions suggested to inactive', async () => {
      const rule = { id: ruleId, state: 'suggested' };
      const updated = { id: ruleId, state: 'inactive' };
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(rule);
      mockRelationshipRuleDao.updateRelationshipRuleState.mockResolvedValue(
        updated,
      );

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/dismiss`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(updated);
    });

    it('returns 409 when rule is not suggested', async () => {
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue({
        id: ruleId,
        state: 'active',
      });

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/dismiss`,
      );

      expect(response.status).toBe(409);
    });
  });

  describe('POST /:id/disable', () => {
    it('transitions active to inactive', async () => {
      const rule = { id: ruleId, state: 'active' };
      const updated = { id: ruleId, state: 'inactive' };
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(rule);
      mockRelationshipRuleDao.updateRelationshipRuleState.mockResolvedValue(
        updated,
      );

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/disable`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(updated);
      // Via the repository so context groups re-materialize — never the raw
      // DAO delete, which would leave materialized groups stale.
      expect(
        mockDatastoreService.deleteRelationshipsByRuleId,
      ).toHaveBeenCalledWith(ruleId, workspaceId);
      expect(mockRelationshipDao.deleteByRuleId).not.toHaveBeenCalled();
    });

    it('returns 409 when rule is not active', async () => {
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue({
        id: ruleId,
        state: 'suggested',
      });

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/disable`,
      );

      expect(response.status).toBe(409);
    });
  });

  describe('POST /:id/reset', () => {
    it('transitions inactive to suggested', async () => {
      const rule = { id: ruleId, state: 'inactive' };
      const updated = { id: ruleId, state: 'suggested' };
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(rule);
      mockRelationshipRuleDao.updateRelationshipRuleState.mockResolvedValue(
        updated,
      );

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/reset`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(updated);
    });

    it('returns 409 when rule is not inactive', async () => {
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue({
        id: ruleId,
        state: 'active',
      });

      const response = await request(app).post(
        `/relationship-rules/${ruleId}/reset`,
      );

      expect(response.status).toBe(409);
    });
  });

  describe('PUT /:id/state', () => {
    /**
     * The DAO mock is stateless, so a two-hop walk needs the reads and the CAS
     * flips to advance together — otherwise the second hop sees the first hop's
     * source state and 409s. Returns the flip mock's call list for ordering
     * assertions.
     */
    function mockStateWalk(initial: string) {
      let current = initial;
      mockRelationshipRuleDao.getRelationshipRule.mockImplementation(
        async () => ({ id: ruleId, state: current }),
      );
      mockRelationshipRuleDao.updateRelationshipRuleState.mockImplementation(
        async (_id: string, toState: string) => {
          current = toState;
          return { id: ruleId, state: toState };
        },
      );
    }

    it('is a no-op 200 when the rule is already in the target state', async () => {
      const rule = { id: ruleId, state: 'active' };
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(rule);

      const response = await request(app)
        .put(`/relationship-rules/${ruleId}/state`)
        .send({ state: 'active' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(rule);
      // Re-applying an unchanged config must not churn the rule's edges.
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState,
      ).not.toHaveBeenCalled();
      expect(
        mockRelationshipRuleDao.transitionStateWithPairLock,
      ).not.toHaveBeenCalled();
      expect(mockDatastoreService.applyRelationshipRule).not.toHaveBeenCalled();
    });

    it('approves a suggested rule when asked for active', async () => {
      mockStateWalk('suggested');

      const response = await request(app)
        .put(`/relationship-rules/${ruleId}/state`)
        .send({ state: 'active' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ id: ruleId, state: 'active' });
      expect(mockDatastoreService.applyRelationshipRule).toHaveBeenCalledWith(
        ruleId,
        { triggerSource: 'manual', workspaceId },
      );
    });

    it('walks disable then reset to get from active to suggested', async () => {
      mockStateWalk('active');

      const response = await request(app)
        .put(`/relationship-rules/${ruleId}/state`)
        .send({ state: 'suggested' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ id: ruleId, state: 'suggested' });
      // There is no active -> suggested edge, so this must be two hops.
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState.mock.calls.map(
          call => call[1],
        ),
      ).toEqual(['inactive', 'suggested']);
    });

    it('walks reset then approve to get from inactive to active', async () => {
      mockStateWalk('inactive');

      const response = await request(app)
        .put(`/relationship-rules/${ruleId}/state`)
        .send({ state: 'active' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ id: ruleId, state: 'active' });
      expect(
        mockRelationshipRuleDao.updateRelationshipRuleState.mock.calls.map(
          call => call[1],
        ),
      ).toEqual(['suggested', 'active']);
    });

    it('reports the state actually reached when a second hop fails', async () => {
      // Hop one (active -> inactive) succeeds; hop two (reset) finds nothing to
      // flip. The rule is now inactive, and saying it is still active would send
      // a client back down a path it has already walked.
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue({
        id: ruleId,
        state: 'active',
      });
      mockRelationshipRuleDao.updateRelationshipRuleState
        .mockResolvedValueOnce({ id: ruleId, state: 'inactive' })
        .mockResolvedValueOnce(undefined);

      const response = await request(app)
        .put(`/relationship-rules/${ruleId}/state`)
        .send({ state: 'suggested' });

      expect(response.status).toBe(409);
      expect(response.body.state).toBe('inactive');
    });

    it('rejects an unknown state', async () => {
      const response = await request(app)
        .put(`/relationship-rules/${ruleId}/state`)
        .send({ state: 'enabled' });

      expect(response.status).toBe(400);
      expect(
        mockRelationshipRuleDao.getRelationshipRule,
      ).not.toHaveBeenCalled();
    });

    it('rejects a missing state', async () => {
      const response = await request(app)
        .put(`/relationship-rules/${ruleId}/state`)
        .send({});

      expect(response.status).toBe(400);
    });

    it('returns 400 for a non-uuid id', async () => {
      const response = await request(app)
        .put('/relationship-rules/not-a-uuid/state')
        .send({ state: 'active' });

      expect(response.status).toBe(400);
    });

    it('returns 404 when the rule does not exist', async () => {
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(undefined);

      const response = await request(app)
        .put(`/relationship-rules/${ruleId}/state`)
        .send({ state: 'active' });

      expect(response.status).toBe(404);
    });

    it('refuses to approve when an equivalent active rule exists', async () => {
      const rule = {
        id: ruleId,
        state: 'suggested',
        sourceDatasourceId,
        targetDatasourceId,
        sourceFieldExpression: 'a',
        targetFieldExpression: 'b',
        relationshipType: 'ownedBy',
        reciprocalRelationshipType: 'owns',
      };
      const mirror = {
        ...rule,
        id: uuid(),
        state: 'active',
        sourceDatasourceId: targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: 'b',
        targetFieldExpression: 'a',
        relationshipType: 'owns',
        reciprocalRelationshipType: 'ownedBy',
      };
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(rule);
      mockRelationshipRuleDao.listRelationshipRulesByDatasourceIds.mockResolvedValue(
        [rule, mirror],
      );

      const response = await request(app)
        .put(`/relationship-rules/${ruleId}/state`)
        .send({ state: 'active' });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain(mirror.id);
    });

    it('clears materialized relationships when moving to inactive', async () => {
      mockStateWalk('active');

      const response = await request(app)
        .put(`/relationship-rules/${ruleId}/state`)
        .send({ state: 'inactive' });

      expect(response.status).toBe(200);
      expect(
        mockDatastoreService.deleteRelationshipsByRuleId,
      ).toHaveBeenCalledWith(ruleId, workspaceId);
    });
  });

  describe('verdict recording', () => {
    const generatorRule = {
      id: ruleId,
      origin: 'generated',
      strategy: 'field-matching',
      state: 'suggested',
      score: 0.7,
      confidenceBand: 'medium',
      evidenceSummary: { distinctMatchedValueCount: 3 },
    };

    it('appends a dismiss verdict with actor and rankShown for a generator-owned rule', async () => {
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(
        generatorRule,
      );
      mockRelationshipRuleDao.updateRelationshipRuleState.mockResolvedValue({
        ...generatorRule,
        state: 'inactive',
      });

      await request(app)
        .post(`/relationship-rules/${ruleId}/dismiss`)
        .send({ rankShown: 2 })
        .expect(200);

      expect(mockSuggestionVerdictDao.appendVerdict).toHaveBeenCalledWith(
        {
          ruleId,
          action: 'dismiss',
          actor: 'testuser',
          score: 0.7,
          confidenceBand: 'medium',
          evidenceSummary: { distinctMatchedValueCount: 3 },
          rankShown: 2,
        },
        workspaceId,
      );
    });

    it('appends approve and reset verdicts with rankShown null when absent', async () => {
      // Approve consults the rule listing twice (active-mirror guard, then
      // inverse suppression); an unstubbed listing would 500 the transition.
      mockRulesByState({});
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(
        generatorRule,
      );
      mockRelationshipRuleDao.updateRelationshipRuleState.mockResolvedValue({
        ...generatorRule,
        state: 'active',
      });
      // The singular approve path arbitrates mirrors server-side: no active or
      // suggested inverse to suppress, and the apply succeeds.
      mockRulesByState({ active: [], suggested: [] });
      mockDatastoreService.applyRelationshipRule.mockResolvedValue({
        created: 0,
        deleted: 0,
      });
      await request(app)
        .post(`/relationship-rules/${ruleId}/approve`)
        .expect(200);
      expect(mockSuggestionVerdictDao.appendVerdict).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'approve', rankShown: null }),
        workspaceId,
      );

      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue({
        ...generatorRule,
        state: 'inactive',
      });
      mockRelationshipRuleDao.updateRelationshipRuleState.mockResolvedValue({
        ...generatorRule,
        state: 'suggested',
      });
      await request(app)
        .post(`/relationship-rules/${ruleId}/reset`)
        .expect(200);
      expect(mockSuggestionVerdictDao.appendVerdict).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'reset' }),
        workspaceId,
      );
    });

    it('records no verdict for non-generator rules or for disable', async () => {
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue({
        ...generatorRule,
        origin: 'manual',
      });
      mockRelationshipRuleDao.updateRelationshipRuleState.mockResolvedValue({
        ...generatorRule,
        origin: 'manual',
        state: 'inactive',
      });
      await request(app)
        .post(`/relationship-rules/${ruleId}/dismiss`)
        .expect(200);
      expect(mockSuggestionVerdictDao.appendVerdict).not.toHaveBeenCalled();

      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue({
        ...generatorRule,
        state: 'active',
      });
      mockRelationshipRuleDao.updateRelationshipRuleState.mockResolvedValue({
        ...generatorRule,
        state: 'inactive',
      });
      await request(app)
        .post(`/relationship-rules/${ruleId}/disable`)
        .expect(200);
      expect(mockSuggestionVerdictDao.appendVerdict).not.toHaveBeenCalled();
    });

    it('still succeeds when verdict recording fails', async () => {
      mockSuggestionVerdictDao.appendVerdict.mockRejectedValue(
        new Error('db down'),
      );
      mockRelationshipRuleDao.getRelationshipRule.mockResolvedValue(
        generatorRule,
      );
      mockRelationshipRuleDao.updateRelationshipRuleState.mockResolvedValue({
        ...generatorRule,
        state: 'inactive',
      });
      await request(app)
        .post(`/relationship-rules/${ruleId}/dismiss`)
        .expect(200);
    });
  });

  describe('GET /:id/relationships', () => {
    it('returns 400 for invalid UUID', async () => {
      const response = await request(app).get(
        '/relationship-rules/not-a-uuid/relationships',
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid rule ID format');
    });

    it('returns relationships for a rule and forwards pagination params', async () => {
      const mockResult = {
        items: [{ id: uuid(), relationshipType: 'depends_on' }],
        total: 1,
      };
      mockRelationshipDao.listRelationshipsByRuleId.mockResolvedValue(
        mockResult,
      );

      const response = await request(app).get(
        `/relationship-rules/${ruleId}/relationships?limit=25&offset=10`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
      expect(
        mockRelationshipDao.listRelationshipsByRuleId,
      ).toHaveBeenCalledWith(ruleId, {
        limit: 25,
        offset: 10,
        workspaceId,
      });
    });
  });
});
