import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { ContextGroupsController } from './ContextGroupsController';
import { ContextGroupDao, ObjectDao } from '../../database';
import { v4 as uuid } from 'uuid';
import { allowAllScopeService, createScopeService } from '@roadiehq/scopes';
import { InputError } from '@roadiehq/errors';

const scopeService = allowAllScopeService;
const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

/** A unique-violation as knex passes it through from the `pg` driver. */
function pgUniqueViolation(constraint: string): Error {
  return Object.assign(
    new Error('duplicate key value violates unique constraint'),
    { code: '23505', constraint },
  );
}

describe('ContextGroupsController', () => {
  let app: express.Application;
  let mockDao: {
    listRules: Mock;
    enrichRules: Mock;
    createRule: Mock;
    enrichRule: Mock;
    getRule: Mock;
    updateRule: Mock;
    deleteRule: Mock;
    getRuleBySlug: Mock;
    materializeRule: Mock;
    materializeForDatasource: Mock;
    getGroupsWithMembers: Mock;
    previewRule: Mock;
    listGroups: Mock;
    getGroup: Mock;
    listGroupMembers: Mock;
    findGroupsByMember: Mock;
    listGroupTitlesForDatasource: Mock;
  };
  let mockObjectDao: { sampleForSuggestions: Mock };

  const testRuleId = uuid();
  const testGroupId = uuid();

  const mockRule = {
    id: testRuleId,
    name: 'Test Rule',
    slug: 'test-rule',
    description: null,
    datasources: [{ datasourceId: uuid() }],
    mergeRelationshipTypes: ['relates_to'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    mockDao = {
      listRules: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      enrichRules: vi.fn(async rules => rules),
      createRule: vi.fn().mockResolvedValue(mockRule),
      enrichRule: vi.fn(async rule => rule),
      getRule: vi.fn().mockResolvedValue(mockRule),
      updateRule: vi.fn().mockResolvedValue(mockRule),
      deleteRule: vi.fn().mockResolvedValue(undefined),
      getRuleBySlug: vi.fn().mockResolvedValue(mockRule),
      materializeRule: vi.fn().mockResolvedValue(undefined),
      materializeForDatasource: vi.fn().mockResolvedValue(undefined),
      getGroupsWithMembers: vi
        .fn()
        .mockResolvedValue({ groups: [], totalGroups: 0 }),
      previewRule: vi.fn().mockResolvedValue({ groups: [], totalGroups: 0 }),
      listGroups: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getGroup: vi.fn().mockResolvedValue(null),
      listGroupMembers: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      findGroupsByMember: vi.fn().mockResolvedValue([]),
      listGroupTitlesForDatasource: vi.fn().mockResolvedValue([]),
    };
    mockObjectDao = {
      sampleForSuggestions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    };

    const controller = new ContextGroupsController({
      contextGroupDao: mockDao as unknown as ContextGroupDao,
      objectDao: mockObjectDao as unknown as ObjectDao,
      scopeService,
    });
    const router = await controller.getRouter();
    app = express();
    app.use('/context-groups', router);
  });

  describe('GET /rules', () => {
    it('returns list of rules', async () => {
      mockDao.listRules.mockResolvedValue({
        items: [mockRule],
        total: 1,
      });

      const response = await request(app).get('/context-groups/rules');

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.total).toBe(1);
      expect(mockDao.enrichRules).toHaveBeenCalledWith(
        [mockRule],
        DEFAULT_WORKSPACE_ID,
      );
      expect(mockDao.enrichRule).not.toHaveBeenCalled();
    });

    it('supports pagination', async () => {
      const response = await request(app).get(
        '/context-groups/rules?limit=10&offset=5',
      );

      expect(response.status).toBe(200);
      expect(mockDao.listRules).toHaveBeenCalledWith({
        limit: 10,
        offset: 5,
        allowedIdentifiers: undefined,
        workspaceId: DEFAULT_WORKSPACE_ID,
      });
    });

    it('passes the request workspace to the DAO', async () => {
      const workspaceId = uuid();
      const controller = new ContextGroupsController({
        contextGroupDao: mockDao as unknown as ContextGroupDao,
        objectDao: mockObjectDao as unknown as ObjectDao,
        scopeService,
        getWorkspaceId: () => workspaceId,
      });
      const workspaceApp = express();
      workspaceApp.use('/context-groups', await controller.getRouter());

      const response = await request(workspaceApp).get('/context-groups/rules');

      expect(response.status).toBe(200);
      expect(mockDao.listRules).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId }),
      );
    });
  });

  describe('POST /rules', () => {
    it('creates a rule', async () => {
      const response = await request(app)
        .post('/context-groups/rules')
        .send({
          name: 'New Rule',
          datasources: [{ datasourceId: uuid() }],
          mergeRelationshipTypes: ['sameApplication'],
        });

      expect(response.status).toBe(201);
      expect(mockDao.createRule).toHaveBeenCalledWith(
        expect.objectContaining({
          mergeRelationshipTypes: ['sameApplication'],
        }),
        DEFAULT_WORKSPACE_ID,
      );
      expect(mockDao.materializeRule).toHaveBeenCalled();
    });

    it('returns 400 when name is missing', async () => {
      const response = await request(app).post('/context-groups/rules').send({
        datasources: [],
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('name');
    });

    it('returns 400 when datasources is not an array', async () => {
      const response = await request(app).post('/context-groups/rules').send({
        name: 'Test',
        datasources: 'not-an-array',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('datasources');
    });

    it('returns 400 when mergeRelationshipTypes is not an array', async () => {
      const response = await request(app)
        .post('/context-groups/rules')
        .send({
          name: 'Test',
          datasources: [{ datasourceId: uuid() }],
          mergeRelationshipTypes: 'not-an-array',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('mergeRelationshipTypes');
    });

    it('derives the slug from the name', async () => {
      await request(app)
        .post('/context-groups/rules')
        .send({
          name: 'Payments Team',
          datasources: [{ datasourceId: uuid() }],
        });

      // The controller derives, not the DAO — so the slug that gets
      // uniqueness-checked is the one reported back on a 409.
      expect(mockDao.createRule).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'payments-team' }),
        DEFAULT_WORKSPACE_ID,
      );
    });

    it('returns 400 for a slug that could never be @-referenced', async () => {
      const response = await request(app)
        .post('/context-groups/rules')
        .send({
          name: 'Test',
          slug: 'My_Group',
          datasources: [{ datasourceId: uuid() }],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/Invalid slug/);
      expect(mockDao.createRule).not.toHaveBeenCalled();
    });

    it('returns 400 when the name slugifies to nothing', async () => {
      const response = await request(app)
        .post('/context-groups/rules')
        .send({
          name: '日本語',
          datasources: [{ datasourceId: uuid() }],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/Could not derive a valid slug/);
      expect(mockDao.createRule).not.toHaveBeenCalled();
    });

    it('returns 409 naming the name on a name collision', async () => {
      mockDao.createRule.mockRejectedValue(
        pgUniqueViolation('context_group_rule_name_unique'),
      );

      const response = await request(app)
        .post('/context-groups/rules')
        .send({
          name: 'Duplicate',
          datasources: [{ datasourceId: uuid() }],
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('named "Duplicate"');
    });

    it('returns 409 naming the slug on a slug collision', async () => {
      // The table is unique on BOTH name and slug — a slug collision must not
      // be reported against the name.
      mockDao.createRule.mockRejectedValue(
        pgUniqueViolation('context_group_rule_slug_unique'),
      );

      const response = await request(app)
        .post('/context-groups/rules')
        .send({
          name: 'Fresh Name',
          slug: 'taken-slug',
          datasources: [{ datasourceId: uuid() }],
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('slug "taken-slug"');
      expect(response.body.error).not.toContain('Fresh Name');
    });
  });

  describe('invalid rule uuid validation', () => {
    it.each(['GET', 'PATCH', 'DELETE'] as const)(
      'returns 400 for %s /rules/not-a-uuid',
      async method => {
        const path = '/context-groups/rules/not-a-uuid';
        const response =
          method === 'GET'
            ? await request(app).get(path)
            : method === 'PATCH'
              ? await request(app).patch(path).send({ name: 'Test' })
              : await request(app).delete(path);

        expect(response.status).toBe(400);
      },
    );
  });

  describe('GET /rules/:id', () => {
    it('returns a rule by id', async () => {
      const response = await request(app).get(
        `/context-groups/rules/${testRuleId}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(testRuleId);
    });

    it('returns 404 for non-existent rule', async () => {
      mockDao.getRule.mockResolvedValue(undefined);

      const response = await request(app).get(
        `/context-groups/rules/${uuid()}`,
      );

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /rules/:id', () => {
    it('updates a rule', async () => {
      const response = await request(app)
        .patch(`/context-groups/rules/${testRuleId}`)
        .send({ name: 'Updated Name' });

      expect(response.status).toBe(200);
      expect(mockDao.updateRule).toHaveBeenCalledWith(
        testRuleId,
        expect.objectContaining({
          name: 'Updated Name',
          description: undefined,
          datasources: undefined,
          mergeRelationshipTypes: undefined,
        }),
        DEFAULT_WORKSPACE_ID,
      );
      expect(mockDao.materializeRule).toHaveBeenCalledWith(
        testRuleId,
        DEFAULT_WORKSPACE_ID,
      );
    });

    it('returns 400 when datasources is not an array', async () => {
      const response = await request(app)
        .patch(`/context-groups/rules/${testRuleId}`)
        .send({ datasources: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('datasources');
    });

    it('returns 400 when mergeRelationshipTypes is not an array', async () => {
      const response = await request(app)
        .patch(`/context-groups/rules/${testRuleId}`)
        .send({ mergeRelationshipTypes: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('mergeRelationshipTypes');
    });

    it('returns 400 for an empty slug', async () => {
      const response = await request(app)
        .patch(`/context-groups/rules/${testRuleId}`)
        .send({ slug: '' });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/Invalid slug/);
      expect(mockDao.updateRule).not.toHaveBeenCalled();
    });

    it('returns 400 for a malformed slug', async () => {
      const response = await request(app)
        .patch(`/context-groups/rules/${testRuleId}`)
        .send({ slug: 'Bad_Slug' });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/Invalid slug/);
      expect(mockDao.updateRule).not.toHaveBeenCalled();
    });

    it('returns 400 when name is not a string', async () => {
      const response = await request(app)
        .patch(`/context-groups/rules/${testRuleId}`)
        .send({ name: 7 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('name must be a string');
      expect(mockDao.updateRule).not.toHaveBeenCalled();
    });

    it('names the slug on a slug-only PATCH collision', async () => {
      // Regression: `name` is absent on a slug-only PATCH, which used to
      // produce `Context group rule "undefined" already exists`.
      mockDao.updateRule.mockRejectedValue(
        pgUniqueViolation('context_group_rule_slug_unique'),
      );

      const response = await request(app)
        .patch(`/context-groups/rules/${testRuleId}`)
        .send({ slug: 'taken' });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('slug "taken"');
      expect(response.body.error).not.toContain('undefined');
    });

    it('names the name on a name collision', async () => {
      mockDao.updateRule.mockRejectedValue(
        pgUniqueViolation('context_group_rule_name_unique'),
      );

      const response = await request(app)
        .patch(`/context-groups/rules/${testRuleId}`)
        .send({ name: 'Taken Name' });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('named "Taken Name"');
    });

    it('surfaces a DAO InputError as 400, not 500', async () => {
      mockDao.updateRule.mockRejectedValue(
        new InputError('Invalid context group slug "x"'),
      );

      const response = await request(app)
        .patch(`/context-groups/rules/${testRuleId}`)
        .send({ name: 'Fine' });

      expect(response.status).toBe(400);
    });

    it('returns 404 when rule not found', async () => {
      mockDao.updateRule.mockResolvedValue(undefined);

      const response = await request(app)
        .patch(`/context-groups/rules/${uuid()}`)
        .send({ name: 'Test' });

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /rules/:id', () => {
    it('clears optional fields the body omits', async () => {
      const response = await request(app)
        .put(`/context-groups/rules/${testRuleId}`)
        .send({ name: 'Replaced', datasources: [] });

      expect(response.status).toBe(200);
      expect(mockDao.updateRule).toHaveBeenCalledWith(
        testRuleId,
        {
          name: 'Replaced',
          slug: undefined,
          description: null,
          datasources: [],
          mergeRelationshipTypes: [],
          annotations: [],
          includeExternalRelations: false,
          seedVersion: undefined,
        },
        DEFAULT_WORKSPACE_ID,
      );
    });

    it('passes explicit values through untouched', async () => {
      const response = await request(app)
        .put(`/context-groups/rules/${testRuleId}`)
        .send({
          name: 'Replaced',
          description: 'kept',
          datasources: [],
          mergeRelationshipTypes: ['ownedBy'],
          includeExternalRelations: true,
        });

      expect(response.status).toBe(200);
      expect(mockDao.updateRule).toHaveBeenCalledWith(
        testRuleId,
        expect.objectContaining({
          description: 'kept',
          mergeRelationshipTypes: ['ownedBy'],
          includeExternalRelations: true,
        }),
        DEFAULT_WORKSPACE_ID,
      );
    });

    it('requires name', async () => {
      const response = await request(app)
        .put(`/context-groups/rules/${testRuleId}`)
        .send({ datasources: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('name is required');
      expect(mockDao.updateRule).not.toHaveBeenCalled();
    });

    it('requires datasources', async () => {
      const response = await request(app)
        .put(`/context-groups/rules/${testRuleId}`)
        .send({ name: 'Replaced' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('datasources is required');
      expect(mockDao.updateRule).not.toHaveBeenCalled();
    });

    it('rejects a non-uuid id before looking at the body', async () => {
      const response = await request(app)
        .put('/context-groups/rules/not-a-uuid')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid rule ID');
    });
  });

  describe('DELETE /rules/:id', () => {
    it('deletes a rule', async () => {
      const response = await request(app).delete(
        `/context-groups/rules/${testRuleId}`,
      );

      expect(response.status).toBe(204);
      expect(mockDao.deleteRule).toHaveBeenCalledWith(
        testRuleId,
        DEFAULT_WORKSPACE_ID,
      );
    });
  });

  describe('POST /rules/:id/materialize', () => {
    it('materializes a rule', async () => {
      const response = await request(app).post(
        `/context-groups/rules/${testRuleId}/materialize`,
      );

      expect(response.status).toBe(200);
      expect(mockDao.materializeRule).toHaveBeenCalledWith(
        testRuleId,
        DEFAULT_WORKSPACE_ID,
      );
    });

    it('returns 404 when rule not found', async () => {
      mockDao.getRule.mockResolvedValue(undefined);

      const response = await request(app).post(
        `/context-groups/rules/${uuid()}/materialize`,
      );

      expect(response.status).toBe(404);
    });
  });

  describe('POST /datasources/:datasourceId/materialize', () => {
    it('materializes all rules for a datasource', async () => {
      const datasourceId = uuid();
      const response = await request(app).post(
        `/context-groups/datasources/${datasourceId}/materialize`,
      );

      expect(response.status).toBe(200);
      expect(mockDao.materializeForDatasource).toHaveBeenCalledWith(
        datasourceId,
        DEFAULT_WORKSPACE_ID,
      );
    });

    it('returns 400 for invalid datasource id', async () => {
      const response = await request(app).post(
        '/context-groups/datasources/not-a-uuid/materialize',
      );

      expect(response.status).toBe(400);
    });

    it('runs through the injected scheduler sync instead of the DAO when provided', async () => {
      const syncDatasourceContextGroups = vi.fn().mockResolvedValue(undefined);
      const controller = new ContextGroupsController({
        contextGroupDao: mockDao as unknown as ContextGroupDao,
        objectDao: mockObjectDao as unknown as ObjectDao,
        scopeService,
        syncDatasourceContextGroups,
      });
      const syncApp = express();
      syncApp.use('/context-groups', await controller.getRouter());

      const datasourceId = uuid();
      const response = await request(syncApp).post(
        `/context-groups/datasources/${datasourceId}/materialize`,
      );

      expect(response.status).toBe(200);
      expect(syncDatasourceContextGroups).toHaveBeenCalledWith(
        datasourceId,
        DEFAULT_WORKSPACE_ID,
      );
      expect(mockDao.materializeForDatasource).not.toHaveBeenCalled();
    });

    it('returns 500 when the injected sync fails', async () => {
      const controller = new ContextGroupsController({
        contextGroupDao: mockDao as unknown as ContextGroupDao,
        objectDao: mockObjectDao as unknown as ObjectDao,
        scopeService,
        syncDatasourceContextGroups: vi
          .fn()
          .mockRejectedValue(new Error('rebuild failed')),
      });
      const syncApp = express();
      syncApp.use('/context-groups', await controller.getRouter());

      const response = await request(syncApp).post(
        `/context-groups/datasources/${uuid()}/materialize`,
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('rebuild failed');
    });
  });

  describe('GET /rules/:id/groups', () => {
    it('returns groups for a rule', async () => {
      mockDao.getGroupsWithMembers.mockResolvedValue({
        groups: [{ id: testGroupId, name: 'Group 1' }],
        totalGroups: 1,
      });

      const response = await request(app).get(
        `/context-groups/rules/${testRuleId}/groups`,
      );

      expect(response.status).toBe(200);
      expect(response.body.groups).toHaveLength(1);
      // A UUID path never needs slug resolution.
      expect(mockDao.getRuleBySlug).not.toHaveBeenCalled();
    });

    it('accepts a human-readable slug and resolves it to a rule id', async () => {
      mockDao.getRuleBySlug.mockResolvedValue({ ...mockRule, id: testRuleId });
      mockDao.getGroupsWithMembers.mockResolvedValue({
        groups: [{ id: testGroupId, name: 'Group 1' }],
        totalGroups: 1,
      });

      const response = await request(app).get(
        '/context-groups/rules/test-rule/groups',
      );

      expect(response.status).toBe(200);
      expect(mockDao.getRuleBySlug).toHaveBeenCalledWith(
        'test-rule',
        DEFAULT_WORKSPACE_ID,
      );
      // resolved id — never the raw slug — is what reaches the group lookup
      expect(mockDao.getGroupsWithMembers).toHaveBeenCalledWith(
        testRuleId,
        expect.anything(),
      );
    });

    it('404s an unresolved slug and never lists all groups (fall-through guard)', async () => {
      mockDao.getRuleBySlug.mockResolvedValue(undefined);

      const response = await request(app).get(
        '/context-groups/rules/does-not-exist/groups',
      );

      expect(response.status).toBe(404);
      expect(mockDao.getGroupsWithMembers).not.toHaveBeenCalled();
    });
  });

  describe('POST /preview', () => {
    it('returns preview groups', async () => {
      mockDao.previewRule.mockResolvedValue({
        groups: [{ id: 'preview-1', name: 'Preview Group' }],
        totalGroups: 1,
      });

      const response = await request(app)
        .post('/context-groups/preview')
        .send({
          datasources: [{ datasourceId: uuid() }],
        });

      expect(response.status).toBe(200);
      expect(response.body.groups).toHaveLength(1);
    });

    it('returns 400 when datasources is missing', async () => {
      const response = await request(app).post('/context-groups/preview').send({
        mergeRelationshipTypes: [],
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /field-profiles/:datasourceId', () => {
    it('returns fields and presets from sampled objects', async () => {
      const dsId = uuid();
      mockObjectDao.sampleForSuggestions.mockResolvedValue({
        items: [
          { object: { id: 'u1', name: 'Ada', status: 'active', secret: 'x' } },
          {
            object: { id: 'u2', name: 'Bob', status: 'inactive', secret: 'y' },
          },
        ],
        total: 2,
      });

      const res = await request(app).get(
        `/context-groups/field-profiles/${dsId}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.datasourceId).toBe(dsId);
      expect(Array.isArray(res.body.fields)).toBe(true);
      expect(res.body.presets).toHaveProperty('identifiers');
      expect(res.body.presets).toHaveProperty('essentials');
      expect(mockObjectDao.sampleForSuggestions).toHaveBeenCalledWith(
        dsId,
        undefined,
        DEFAULT_WORKSPACE_ID,
      );
    });

    it('400s on an invalid datasourceId', async () => {
      const res = await request(app).get(
        '/context-groups/field-profiles/not-a-uuid',
      );
      expect(res.status).toBe(400);
    });
  });

  describe('GET /groups', () => {
    it('returns list of groups', async () => {
      mockDao.listGroups.mockResolvedValue({
        items: [{ id: testGroupId, ruleId: testRuleId }],
        total: 1,
      });

      const response = await request(app).get('/context-groups/groups');

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
    });

    it('filters by ruleId', async () => {
      const response = await request(app).get(
        `/context-groups/groups?ruleId=${testRuleId}`,
      );

      expect(response.status).toBe(200);
      expect(mockDao.listGroups).toHaveBeenCalledWith({
        ruleId: testRuleId,
        limit: undefined,
        offset: undefined,
        allowedRuleSlugs: undefined,
        workspaceId: DEFAULT_WORKSPACE_ID,
      });
    });
  });

  describe('GET /groups/:id', () => {
    it('returns a group by id', async () => {
      mockDao.getGroup.mockResolvedValue({
        id: testGroupId,
        ruleId: testRuleId,
      });

      const response = await request(app).get(
        `/context-groups/groups/${testGroupId}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(testGroupId);
    });

    it('returns 404 for non-existent group', async () => {
      mockDao.getGroup.mockResolvedValue(null);

      const response = await request(app).get(
        `/context-groups/groups/${uuid()}`,
      );

      expect(response.status).toBe(404);
    });
  });

  describe('GET /groups/:id/members', () => {
    it('returns group members', async () => {
      mockDao.listGroupMembers.mockResolvedValue({
        items: [{ id: uuid(), contextGroupId: testGroupId }],
        total: 1,
      });

      const response = await request(app).get(
        `/context-groups/groups/${testGroupId}/members`,
      );

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
    });

    it('passes pagination through to the DAO', async () => {
      const response = await request(app).get(
        `/context-groups/groups/${testGroupId}/members?limit=5&offset=10`,
      );

      expect(response.status).toBe(200);
      expect(mockDao.listGroupMembers).toHaveBeenCalledWith(testGroupId, {
        limit: 5,
        offset: 10,
        workspaceId: DEFAULT_WORKSPACE_ID,
      });
    });
  });

  describe('GET /by-member', () => {
    it('finds groups by member', async () => {
      const datasourceId = uuid();
      mockDao.findGroupsByMember.mockResolvedValue([
        {
          groupId: testGroupId,
          ruleId: testRuleId,
          ruleName: 'Test Rule',
          ruleSlug: 'test-rule',
        },
      ]);

      const response = await request(app).get(
        `/context-groups/by-member?datasourceId=${datasourceId}&objectId=obj-1`,
      );

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
    });

    it('returns 400 when datasourceId is missing', async () => {
      const response = await request(app).get(
        '/context-groups/by-member?objectId=obj-1',
      );

      expect(response.status).toBe(400);
    });

    it('returns 400 when objectId is missing', async () => {
      const response = await request(app).get(
        `/context-groups/by-member?datasourceId=${uuid()}`,
      );

      expect(response.status).toBe(400);
    });
  });

  describe('GET /datasources/:datasourceId/titles', () => {
    it('returns group titles for a datasource', async () => {
      const datasourceId = uuid();
      mockDao.listGroupTitlesForDatasource.mockResolvedValue([
        'Teams: Alpha',
        'Teams: Beta',
      ]);

      const response = await request(app).get(
        `/context-groups/datasources/${datasourceId}/titles?q=alp&limit=5`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: ['Teams: Alpha', 'Teams: Beta'],
      });
      expect(mockDao.listGroupTitlesForDatasource).toHaveBeenCalledWith(
        datasourceId,
        {
          q: 'alp',
          limit: 5,
          allowedRuleSlugs: undefined,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      );
    });

    it('returns 400 for an invalid datasource id', async () => {
      const response = await request(app).get(
        '/context-groups/datasources/not-a-uuid/titles',
      );

      expect(response.status).toBe(400);
    });
  });
});

describe('ContextGroupsController scope narrowing', () => {
  const ruleSlug = 'team-a';
  const groupId = uuid();

  // Caller scoped to a single context group by rule slug.
  const narrowedScopeService = createScopeService(() => [
    `context-group:query:${ruleSlug}`,
  ]);

  let app: express.Application;
  let dao: {
    listRules: Mock;
    enrichRules: Mock;
    getRule: Mock;
    getGroup: Mock;
    getGroupWithMembers: Mock;
    getRuleSlugForGroup: Mock;
    listGroups: Mock;
    listGroupMembers: Mock;
    findGroupsByMember: Mock;
  };

  const buildApp = async (scopeService: typeof narrowedScopeService) => {
    const controller = new ContextGroupsController({
      contextGroupDao: dao as unknown as ContextGroupDao,
      // These tests exercise scope narrowing on the rule/group routes and never
      // reach the suggestion sampling that uses this dao.
      objectDao: {
        sampleForSuggestions: vi
          .fn()
          .mockResolvedValue({ items: [], total: 0 }),
      } as unknown as ObjectDao,
      scopeService,
    });
    const router = await controller.getRouter();
    const a = express();
    a.use('/context-groups', router);
    return a;
  };

  beforeEach(async () => {
    dao = {
      listRules: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      enrichRules: vi.fn(async rules => rules),
      getRule: vi
        .fn()
        .mockResolvedValue({ id: uuid(), slug: ruleSlug, name: 'Team A' }),
      getGroup: vi.fn().mockResolvedValue({ id: groupId, ruleId: uuid() }),
      getGroupWithMembers: vi.fn().mockResolvedValue({ id: groupId }),
      getRuleSlugForGroup: vi.fn().mockResolvedValue(ruleSlug),
      listGroups: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listGroupMembers: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      findGroupsByMember: vi.fn().mockResolvedValue([]),
    };
    app = await buildApp(narrowedScopeService);
  });

  it('passes the granted rule slug as listGroups allowedRuleSlugs', async () => {
    await request(app).get('/context-groups/groups');
    expect(dao.listGroups).toHaveBeenCalledWith(
      expect.objectContaining({ allowedRuleSlugs: [ruleSlug] }),
    );
  });

  it('passes the granted slug as listRules allowedIdentifiers', async () => {
    await request(app).get('/context-groups/rules');
    expect(dao.listRules).toHaveBeenCalledWith(
      expect.objectContaining({ allowedIdentifiers: [ruleSlug] }),
    );
  });

  it('serves a group bundle whose rule slug is granted', async () => {
    dao.getRuleSlugForGroup.mockResolvedValue(ruleSlug);
    const res = await request(app).get(
      `/context-groups/groups/${groupId}/bundle`,
    );
    expect(res.status).toBe(200);
  });

  it('404s a group bundle whose rule slug is not granted', async () => {
    dao.getRuleSlugForGroup.mockResolvedValue('other-team');
    const res = await request(app).get(
      `/context-groups/groups/${groupId}/bundle`,
    );
    expect(res.status).toBe(404);
  });

  it('passes a datasourceIds slice through to the DAO', async () => {
    dao.getRuleSlugForGroup.mockResolvedValue(ruleSlug);
    await request(app).get(
      `/context-groups/groups/${groupId}/bundle?datasourceIds=a,b`,
    );
    expect(dao.getGroupWithMembers).toHaveBeenCalledWith(groupId, {
      datasourceIds: ['a', 'b'],
      memberLimit: undefined,
      relationshipLimit: undefined,
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
  });

  it('omits the slice when no datasourceIds are given', async () => {
    dao.getRuleSlugForGroup.mockResolvedValue(ruleSlug);
    await request(app).get(`/context-groups/groups/${groupId}/bundle`);
    expect(dao.getGroupWithMembers).toHaveBeenCalledWith(groupId, {
      datasourceIds: undefined,
      memberLimit: undefined,
      relationshipLimit: undefined,
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
  });

  it('404s getRuleGroups for a rule outside the grant', async () => {
    dao.getRule.mockResolvedValue({ id: uuid(), slug: 'other-team' });
    const res = await request(app).get(
      `/context-groups/rules/${uuid()}/groups`,
    );
    expect(res.status).toBe(404);
  });

  it('filters by-member results to granted rule slugs', async () => {
    dao.findGroupsByMember.mockResolvedValue([
      {
        groupId: uuid(),
        ruleId: uuid(),
        ruleName: 'A',
        ruleSlug,
      },
      {
        groupId: uuid(),
        ruleId: uuid(),
        ruleName: 'B',
        ruleSlug: 'other-team',
      },
    ]);
    const res = await request(app).get(
      `/context-groups/by-member?datasourceId=${uuid()}&objectId=obj-1`,
    );
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].ruleSlug).toBe(ruleSlug);
  });

  it('does not restrict a caller holding the un-narrowed scope', async () => {
    app = await buildApp(createScopeService(() => ['context-group:query']));
    await request(app).get('/context-groups/groups');
    expect(dao.listGroups).toHaveBeenCalledWith(
      expect.objectContaining({ allowedRuleSlugs: undefined }),
    );
    // No per-item rule-slug lookup when unrestricted.
    expect(dao.getRuleSlugForGroup).not.toHaveBeenCalled();
  });
});
