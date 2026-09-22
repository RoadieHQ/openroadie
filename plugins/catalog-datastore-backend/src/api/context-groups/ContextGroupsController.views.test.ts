import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { ContextGroupsController } from './ContextGroupsController';
import {
  ContextGroupDao,
  ViewNotFoundError,
  ViewValidationError,
} from '../../database';
import { v4 as uuid } from 'uuid';
import { allowAllScopeService } from '@roadiehq/scopes';

describe('ContextGroupsController views', () => {
  const workspaceId = '00000000-0000-4000-8000-000000000001';
  let app: express.Application;
  let mockDao: {
    getRule: Mock;
    getRuleBySlug: Mock;
    getGroup: Mock;
    listViews: Mock;
    getViewByName: Mock;
    createView: Mock;
    updateView: Mock;
    deleteView: Mock;
    renderBundle: Mock;
    renderTemplate: Mock;
    getGroupWithMembers: Mock;
    getRuleSlugForGroup: Mock;
    listGroups: Mock;
    getRuleDocumentKeys: Mock;
    findSampleGroupIdForDatasource: Mock;
    listGroupRelationTypes: Mock;
    enrichRule: Mock;
  };

  const ruleId = uuid();
  const groupId = uuid();
  const viewId = uuid();

  const mockRule = { id: ruleId, name: 'Rule', slug: 'rule' };
  const mockView = {
    id: viewId,
    ruleId,
    name: 'default',
    description: 'Shows everything.',
    template: '{{ group.name }}',
    isDefault: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    mockDao = {
      getRule: vi.fn().mockResolvedValue(mockRule),
      getRuleBySlug: vi.fn().mockResolvedValue(mockRule),
      getGroup: vi.fn().mockResolvedValue({ id: groupId, ruleId }),
      listViews: vi.fn().mockResolvedValue([mockView]),
      getViewByName: vi.fn().mockResolvedValue(undefined),
      createView: vi.fn().mockResolvedValue(mockView),
      updateView: vi.fn().mockResolvedValue(mockView),
      deleteView: vi.fn().mockResolvedValue(undefined),
      renderBundle: vi.fn().mockResolvedValue({
        groupId,
        ruleId,
        ruleName: 'Rule',
        view: { name: 'default', description: null },
        availableViews: [
          { name: 'default', description: null, isDefault: true },
        ],
        rendered: '# Brian Fletcher',
      }),
      renderTemplate: vi.fn().mockResolvedValue({ rendered: 'preview out' }),
      getGroupWithMembers: vi.fn().mockResolvedValue({
        id: groupId,
        members: [],
        datasources: [],
      }),
      getRuleSlugForGroup: vi.fn().mockResolvedValue('rule'),
      listGroups: vi
        .fn()
        .mockResolvedValue({ items: [{ id: groupId, ruleId }], total: 1 }),
      getRuleDocumentKeys: vi
        .fn()
        .mockResolvedValue([{ datasourceId: 'ds-1', key: 'github_users' }]),
      findSampleGroupIdForDatasource: vi.fn().mockResolvedValue(groupId),
      listGroupRelationTypes: vi.fn().mockResolvedValue([
        {
          datasourceId: 'ds-1',
          relationshipType: 'owns',
          targetDatasourceId: 'ds-2',
          count: 3,
        },
        {
          datasourceId: 'ds-1',
          relationshipType: 'owns',
          targetDatasourceId: 'ds-3',
          count: 1,
        },
        {
          datasourceId: 'ds-other',
          relationshipType: 'ignored',
          targetDatasourceId: 'ds-2',
          count: 9,
        },
      ]),
      enrichRule: vi.fn().mockResolvedValue({
        ...mockRule,
        datasources: [
          {
            datasourceId: 'ds-1',
            status: { displayName: 'GitHub Users' },
          },
        ],
      }),
    };

    const controller = new ContextGroupsController({
      contextGroupDao: mockDao as unknown as ContextGroupDao,
      objectDao: {
        sampleForSuggestions: vi.fn().mockResolvedValue({
          items: [{ object: { login: 'bf', id: 1, bio: 'hi' } }],
        }),
      } as unknown as import('../../database').ObjectDao,
      scopeService: allowAllScopeService,
    });
    app = express();
    app.use('/context-groups', await controller.getRouter());
  });

  describe('GET /rules/:id/views', () => {
    it('lists views for a rule', async () => {
      const res = await request(app).get(
        `/context-groups/rules/${ruleId}/views`,
      );
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe('default');
    });

    it('404s for an unknown rule', async () => {
      mockDao.getRule.mockResolvedValue(undefined);
      const res = await request(app).get(
        `/context-groups/rules/${ruleId}/views`,
      );
      expect(res.status).toBe(404);
    });

    it('resolves a rule slug like the groups listing does', async () => {
      const res = await request(app).get('/context-groups/rules/my-slug/views');
      expect(res.status).toBe(200);
      expect(mockDao.getRuleBySlug).toHaveBeenCalledWith(
        'my-slug',
        workspaceId,
      );
      expect(res.body.ruleId).toBe(ruleId);
    });
  });

  describe('POST /rules/:id/views', () => {
    it('creates a view', async () => {
      const res = await request(app)
        .post(`/context-groups/rules/${ruleId}/views`)
        .send({ name: 'activity', template: '{{ group.name }}' });
      expect(res.status).toBe(201);
      expect(mockDao.createView).toHaveBeenCalledWith(
        ruleId,
        {
          name: 'activity',
          description: undefined,
          template: '{{ group.name }}',
          isDefault: undefined,
        },
        workspaceId,
      );
    });

    it('requires a template', async () => {
      const res = await request(app)
        .post(`/context-groups/rules/${ruleId}/views`)
        .send({ name: 'activity' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/template is required/);
    });

    it('409s on duplicate names', async () => {
      mockDao.getViewByName.mockResolvedValue(mockView);
      const res = await request(app)
        .post(`/context-groups/rules/${ruleId}/views`)
        .send({ name: 'default', template: 'x' });
      expect(res.status).toBe(409);
    });

    it('maps template validation failures to 400 with issues', async () => {
      mockDao.createView.mockRejectedValue(
        new ViewValidationError([
          { message: 'invalid value expression', line: 2, col: 6 },
        ]),
      );
      const res = await request(app)
        .post(`/context-groups/rules/${ruleId}/views`)
        .send({ name: 'broken', template: '{% if %}' });
      expect(res.status).toBe(400);
      expect(res.body.issues[0].line).toBe(2);
    });
  });

  describe('PATCH /views/:id', () => {
    it('updates a view', async () => {
      const res = await request(app)
        .patch(`/context-groups/views/${viewId}`)
        .send({ template: 'new template' });
      expect(res.status).toBe(200);
      expect(mockDao.updateView).toHaveBeenCalledWith(
        viewId,
        {
          name: undefined,
          description: undefined,
          template: 'new template',
          isDefault: undefined,
        },
        workspaceId,
      );
    });

    it('404s for an unknown view', async () => {
      mockDao.updateView.mockResolvedValue(undefined);
      const res = await request(app)
        .patch(`/context-groups/views/${viewId}`)
        .send({ template: 'x' });
      expect(res.status).toBe(404);
    });

    it('maps default-unset rejections to 400', async () => {
      mockDao.updateView.mockRejectedValue(
        new ViewValidationError([{ message: 'promote another view instead' }]),
      );
      const res = await request(app)
        .patch(`/context-groups/views/${viewId}`)
        .send({ isDefault: false });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /views/:id', () => {
    it('deletes a view', async () => {
      const res = await request(app).delete(`/context-groups/views/${viewId}`);
      expect(res.status).toBe(204);
    });

    it('maps default-deletion rejections to 400', async () => {
      mockDao.deleteView.mockRejectedValue(
        new ViewValidationError([
          { message: 'The default view cannot be deleted' },
        ]),
      );
      const res = await request(app).delete(`/context-groups/views/${viewId}`);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /rules/:id/views/render-preview', () => {
    it('renders a draft template against a group', async () => {
      const res = await request(app)
        .post(`/context-groups/rules/${ruleId}/views/render-preview`)
        .send({ template: '{{ group.name }}', groupId });
      expect(res.status).toBe(200);
      expect(res.body.rendered).toBe('preview out');
      expect(mockDao.renderTemplate).toHaveBeenCalledWith(
        groupId,
        '{{ group.name }}',
        { memberLimit: undefined, workspaceId },
      );
    });

    it('404s when the group belongs to a different rule', async () => {
      mockDao.getGroup.mockResolvedValue({ id: groupId, ruleId: uuid() });
      const res = await request(app)
        .post(`/context-groups/rules/${ruleId}/views/render-preview`)
        .send({ template: 'x', groupId });
      expect(res.status).toBe(404);
    });

    it('maps parse failures to 400 with issues', async () => {
      mockDao.renderTemplate.mockRejectedValue(
        new ViewValidationError([{ message: 'bad template', line: 1 }]),
      );
      const res = await request(app)
        .post(`/context-groups/rules/${ruleId}/views/render-preview`)
        .send({ template: '{% if %}', groupId });
      expect(res.status).toBe(400);
      expect(res.body.issues).toHaveLength(1);
    });

    it('maps render-time failures to 400', async () => {
      mockDao.renderTemplate.mockRejectedValue(
        new Error('Template render exceeded 2000ms'),
      );
      const res = await request(app)
        .post(`/context-groups/rules/${ruleId}/views/render-preview`)
        .send({ template: 'x', groupId });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/exceeded/);
    });
  });

  describe('GET /rules/:id/view-schema', () => {
    it('returns a source per document key, with fields, presets and relationship types', async () => {
      const res = await request(app).get(
        `/context-groups/rules/${ruleId}/view-schema`,
      );

      expect(res.status).toBe(200);
      expect(res.body.sampleGroupId).toBe(groupId);
      expect(res.body.sources).toHaveLength(1);
      expect(mockDao.getRuleDocumentKeys).toHaveBeenCalledWith(
        mockRule,
        workspaceId,
      );

      const [source] = res.body.sources;
      expect(source.key).toBe('github_users');
      expect(source.datasourceId).toBe('ds-1');
      // The label comes from the live datasource lookup, not the document key.
      expect(source.label).toBe('GitHub Users');
      expect(source.fields.map((f: { path: string }) => f.path)).toContain(
        'login',
      );
      expect(source.presets).toHaveProperty('identifiers');
      // Rows for the same type but different targets fold into one entry, and
      // another data source's relationships don't leak in.
      expect(source.relationshipTypes).toEqual([
        { type: 'owns', count: 4, targetDatasourceIds: ['ds-2', 'ds-3'] },
      ]);
    });

    it('offers every datasource in the rule, not just the sampled group’s', async () => {
      // A rule without cross-source relationships materializes single-source
      // groups; the schema must still cover all sources, each reading its
      // relationship types off a group that actually contains it.
      const otherGroupId = uuid();
      mockDao.getRuleDocumentKeys.mockResolvedValue([
        { datasourceId: 'ds-1', key: 'github_users' },
        { datasourceId: 'ds-2', key: 'shortcut_projects' },
      ]);
      mockDao.enrichRule.mockResolvedValue({
        ...mockRule,
        datasources: [
          { datasourceId: 'ds-1', status: { displayName: 'GitHub Users' } },
          {
            datasourceId: 'ds-2',
            status: { displayName: 'Shortcut Projects' },
          },
        ],
      });
      mockDao.findSampleGroupIdForDatasource.mockImplementation(
        (_ruleId: string, datasourceId: string) =>
          Promise.resolve(datasourceId === 'ds-1' ? groupId : otherGroupId),
      );
      mockDao.listGroupRelationTypes.mockImplementation((id: string) =>
        Promise.resolve(
          id === otherGroupId
            ? [
                {
                  datasourceId: 'ds-2',
                  relationshipType: 'contains',
                  targetDatasourceId: 'ds-1',
                  count: 2,
                },
              ]
            : [
                {
                  datasourceId: 'ds-1',
                  relationshipType: 'owns',
                  targetDatasourceId: 'ds-2',
                  count: 3,
                },
              ],
        ),
      );

      const res = await request(app).get(
        `/context-groups/rules/${ruleId}/view-schema`,
      );

      expect(res.status).toBe(200);
      expect(
        res.body.sources.map((s: { key: string; label: string }) => [
          s.key,
          s.label,
        ]),
      ).toEqual([
        ['github_users', 'GitHub Users'],
        ['shortcut_projects', 'Shortcut Projects'],
      ]);
      expect(res.body.sources[1].relationshipTypes).toEqual([
        { type: 'contains', count: 2, targetDatasourceIds: ['ds-1'] },
      ]);
    });

    it('still offers the rule’s sources when nothing is materialized', async () => {
      mockDao.listGroups.mockResolvedValue({ items: [], total: 0 });
      mockDao.findSampleGroupIdForDatasource.mockResolvedValue(undefined);
      const res = await request(app).get(
        `/context-groups/rules/${ruleId}/view-schema`,
      );
      expect(res.status).toBe(200);
      expect(res.body.sampleGroupId).toBeNull();
      expect(res.body.sources).toHaveLength(1);
      expect(res.body.sources[0].key).toBe('github_users');
      expect(res.body.sources[0].relationshipTypes).toEqual([]);
      expect(mockDao.listGroupRelationTypes).not.toHaveBeenCalled();
    });

    it('falls back to the stored seed name when datasource enrichment fails', async () => {
      mockDao.enrichRule.mockRejectedValue(new Error('workflow service down'));
      mockDao.getRule.mockResolvedValue({
        ...mockRule,
        datasources: [{ datasourceId: 'ds-1', seedName: 'github-users-seed' }],
      });

      const res = await request(app).get(
        `/context-groups/rules/${ruleId}/view-schema`,
      );

      expect(res.status).toBe(200);
      expect(res.body.sources[0].label).toBe('github-users-seed');
    });

    it('404s for an unknown rule', async () => {
      mockDao.getRule.mockResolvedValue(undefined);
      const res = await request(app).get(
        `/context-groups/rules/${ruleId}/view-schema`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('GET /groups/:id/bundle?view=', () => {
    it('renders the named view', async () => {
      const res = await request(app).get(
        `/context-groups/groups/${groupId}/bundle?view=activity`,
      );
      expect(res.status).toBe(200);
      expect(res.body.rendered).toBe('# Brian Fletcher');
      expect(mockDao.renderBundle).toHaveBeenCalledWith(groupId, {
        view: 'activity',
        memberLimit: undefined,
        workspaceId,
      });
      expect(mockDao.getGroupWithMembers).not.toHaveBeenCalled();
    });

    it('renders the default view for a bare view param', async () => {
      const res = await request(app).get(
        `/context-groups/groups/${groupId}/bundle?view=`,
      );
      expect(res.status).toBe(200);
      expect(mockDao.renderBundle).toHaveBeenCalledWith(groupId, {
        view: undefined,
        memberLimit: undefined,
        workspaceId,
      });
    });

    it('404s for an unknown view name', async () => {
      mockDao.renderBundle.mockRejectedValue(new ViewNotFoundError('nope'));
      const res = await request(app).get(
        `/context-groups/groups/${groupId}/bundle?view=nope`,
      );
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/nope/);
    });

    it('keeps the legacy structured bundle when no view is requested', async () => {
      const res = await request(app).get(
        `/context-groups/groups/${groupId}/bundle`,
      );
      expect(res.status).toBe(200);
      expect(mockDao.getGroupWithMembers).toHaveBeenCalled();
      expect(mockDao.renderBundle).not.toHaveBeenCalled();
    });
  });
});
