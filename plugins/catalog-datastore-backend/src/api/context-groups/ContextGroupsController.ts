import { Router, RequestHandler, json, type Request } from 'express';
import {
  SCOPES,
  SLUG_RE,
  resolveAllowedTargets,
  isTargetAllowed,
  type ScopeService,
} from '@roadiehq/scopes';
import {
  InputError,
  isUniqueViolation,
  uniqueViolationConstraint,
} from '@roadiehq/errors';
import {
  ContextGroupDao,
  ObjectDao,
  ContextGroupRule,
  ViewNotFoundError,
  ViewValidationError,
  slugify,
} from '../../database';
import { validate as isUuid } from 'uuid';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import { computeProjectionFieldProfiles } from './field-profiles';

function optionalNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

const MAX_TITLES_LIMIT = 100;
/**
 * Collapse per-target relationship rows into one entry per relationship type,
 * keeping the targets so the builder can offer field selection when a type
 * resolves to exactly one data source.
 */
function foldRelationTypes(
  rows: Array<{
    relationshipType: string;
    targetDatasourceId: string;
    count: number;
  }>,
): Array<{ type: string; count: number; targetDatasourceIds: string[] }> {
  const byType = new Map<
    string,
    { type: string; count: number; targetDatasourceIds: string[] }
  >();
  for (const row of rows) {
    const entry = byType.get(row.relationshipType) ?? {
      type: row.relationshipType,
      count: 0,
      targetDatasourceIds: [],
    };
    entry.count += row.count;
    if (!entry.targetDatasourceIds.includes(row.targetDatasourceId)) {
      entry.targetDatasourceIds.push(row.targetDatasourceId);
    }
    byType.set(row.relationshipType, entry);
  }
  return [...byType.values()].sort((a, b) => a.type.localeCompare(b.type));
}

export class ContextGroupsController {
  private contextGroupDao: ContextGroupDao;
  private objectDao: ObjectDao;
  private scopeService: ScopeService;
  private getWorkspaceId: (req: Request) => string | undefined;
  private syncDatasourceContextGroups?: (
    datasourceId: string,
    workspaceId: string,
  ) => Promise<void>;

  constructor(opts: {
    contextGroupDao: ContextGroupDao;
    objectDao: ObjectDao;
    scopeService: ScopeService;
    /** Runs the datasource rebuild through the sync scheduler so it absorbs
     *  the pending debounced rebuild instead of racing it (group ids would
     *  churn twice). Falls back to a direct DAO rebuild when absent. */
    syncDatasourceContextGroups?: (
      datasourceId: string,
      workspaceId: string,
    ) => Promise<void>;
    getWorkspaceId?: (req: Request) => string | undefined;
  }) {
    this.contextGroupDao = opts.contextGroupDao;
    this.objectDao = opts.objectDao;
    this.scopeService = opts.scopeService;
    this.syncDatasourceContextGroups = opts.syncDatasourceContextGroups;
    this.getWorkspaceId = opts.getWorkspaceId ?? (() => undefined);
  }

  async getRouter() {
    const router = Router();
    const { scopeService } = this;
    const requireScopes = scopeService.requireScopes;
    const requireScopeFamily = scopeService.requireScopeFamily;

    // The context-group listing admits the whole `context-group:query` family
    // and filters rows to the group slugs the caller was granted.
    router
      .route('/rules')
      .get(requireScopeFamily(SCOPES.contextGroup.query), this.listRules)
      .post(requireScopes(SCOPES.contextGroup.create), json(), this.createRule);

    router
      .route('/rules/:id')
      .get(requireScopeFamily(SCOPES.contextGroup.query), this.getRule)
      .put(requireScopes(SCOPES.contextGroup.create), json(), this.replaceRule)
      .patch(requireScopes(SCOPES.contextGroup.create), json(), this.updateRule)
      .delete(requireScopes(SCOPES.contextGroup.delete), this.deleteRule);

    // Per-instance execute (two-place): the family guard admits any
    // context-group:execute grant; the handler enforces the specific rule.
    router.post(
      '/rules/:id/materialize',
      requireScopeFamily(SCOPES.contextGroup.execute),
      this.materializeRule,
    );
    router.post(
      '/datasources/:datasourceId/materialize',
      requireScopes(SCOPES.contextGroup.execute),
      this.materializeDatasource,
    );

    router.get(
      '/rules/:id/groups',
      requireScopeFamily(SCOPES.contextGroup.query),
      this.getRuleGroups,
    );

    // Named views: Liquid templates rendered over the whole group
    // document at bundle-read time. Every rule has exactly one default.
    router
      .route('/rules/:id/views')
      .get(requireScopeFamily(SCOPES.contextGroup.query), this.listViews)
      .post(requireScopes(SCOPES.contextGroup.create), json(), this.createView);

    // Editor preview: render a draft template against a materialized group.
    router.post(
      '/rules/:id/views/render-preview',
      requireScopes(SCOPES.contextGroup.dryRun),
      json(),
      this.renderViewPreview,
    );

    router
      .route('/views/:id')
      .patch(requireScopes(SCOPES.contextGroup.create), json(), this.updateView)
      .delete(requireScopes(SCOPES.contextGroup.delete), this.deleteView);

    router.post(
      '/preview',
      requireScopes(SCOPES.contextGroup.dryRun),
      json(),
      this.previewRule,
    );

    // Design-time helper: the inferred field tree + profile signals + presets
    // that drive the projection picker for a datasource.
    router.get(
      '/field-profiles/:datasourceId',
      requireScopes(SCOPES.contextGroup.dryRun),
      this.getFieldProfiles,
    );

    // Design-time helper: everything the view builder needs for one rule —
    // the document keys its templates address, each source's field tree and
    // presets, and the relationship types available to expand.
    router.get(
      '/rules/:id/view-schema',
      requireScopes(SCOPES.contextGroup.dryRun),
      this.getViewSchema,
    );

    router
      .route('/groups')
      .get(requireScopeFamily(SCOPES.contextGroup.query), this.listGroups);

    router
      .route('/groups/:id')
      .get(requireScopeFamily(SCOPES.contextGroup.query), this.getGroup);

    router
      .route('/groups/:id/bundle')
      .get(requireScopeFamily(SCOPES.contextGroup.query), this.getGroupBundle);

    router
      .route('/groups/:id/members')
      .get(
        requireScopeFamily(SCOPES.contextGroup.query),
        this.listGroupMembers,
      );

    router
      .route('/by-member')
      .get(
        requireScopeFamily(SCOPES.contextGroup.query),
        this.findGroupsByMember,
      );

    router.get(
      '/datasources/:datasourceId/titles',
      requireScopeFamily(SCOPES.contextGroup.query),
      this.listGroupTitlesForDatasource,
    );

    return router;
  }

  /**
   * The rule slugs the caller may read, or `undefined` for no restriction (the
   * un-narrowed `context-group:query` or allow-all). Both the rule definitions
   * and everything a rule materialises (groups, members, bundles) are bounded
   * by this list, so a `context-group:query:<slug>` grant scopes a caller to a
   * single context group and its output.
   */
  private allowedRuleSlugs(req: Request) {
    return resolveAllowedTargets(
      this.scopeService,
      req,
      SCOPES.contextGroup.query,
    );
  }

  /**
   * Whether a materialised group is readable given the caller's allowed rule
   * slugs. `undefined` allowed means no restriction, so the group's rule slug is
   * only resolved (an extra query) when the caller is actually narrowed.
   */
  private async groupRuleAllowed(
    groupId: string,
    allowed: string[] | undefined,
    workspaceId?: string,
  ): Promise<boolean> {
    if (!allowed) {
      return true;
    }
    const slug = await this.contextGroupDao.getRuleSlugForGroup(
      groupId,
      workspaceId,
    );
    return slug !== undefined && allowed.includes(slug);
  }

  private workspaceId(req: Request): string {
    return this.getWorkspaceId(req) ?? DEFAULT_WORKSPACE_ID;
  }

  listRules: RequestHandler = async (req, res) => {
    const { limit, offset } = req.query;

    try {
      const allowedIdentifiers = await this.allowedRuleSlugs(req);
      const result = await this.contextGroupDao.listRules({
        workspaceId: this.workspaceId(req),
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
        allowedIdentifiers,
      });
      const items = await this.contextGroupDao.enrichRules(
        result.items,
        this.workspaceId(req),
      );
      return res.send({ ...result, items });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  createRule: RequestHandler = async (req, res) => {
    const {
      name,
      slug,
      description,
      datasources,
      mergeRelationshipTypes,
      annotations,
      includeExternalRelations,
      seedVersion,
    } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }

    if (slug !== undefined && typeof slug !== 'string') {
      return res.status(400).json({ error: 'slug must be a string' });
    }

    // Derive here rather than in the DAO so there is one derivation, and the
    // slug that gets uniqueness-checked is the one reported back on a 409.
    const explicitSlug = typeof slug === 'string' ? slug.trim() : '';
    const effectiveSlug = explicitSlug || slugify(name);
    if (!SLUG_RE.test(effectiveSlug)) {
      return res.status(400).json({
        error: explicitSlug
          ? 'Invalid slug: use lowercase letters, numbers and single hyphens'
          : 'Could not derive a valid slug from name; provide a slug',
      });
    }

    if (!Array.isArray(datasources)) {
      return res.status(400).json({ error: 'datasources must be an array' });
    }

    if (
      mergeRelationshipTypes !== undefined &&
      !Array.isArray(mergeRelationshipTypes)
    ) {
      return res
        .status(400)
        .json({ error: 'mergeRelationshipTypes must be an array' });
    }

    if (annotations !== undefined && !Array.isArray(annotations)) {
      return res.status(400).json({ error: 'annotations must be an array' });
    }

    if (
      includeExternalRelations !== undefined &&
      typeof includeExternalRelations !== 'boolean'
    ) {
      return res
        .status(400)
        .json({ error: 'includeExternalRelations must be a boolean' });
    }

    if (
      seedVersion !== undefined &&
      (!Number.isInteger(seedVersion) || seedVersion < 1)
    ) {
      return res
        .status(400)
        .json({ error: 'seedVersion must be a positive integer' });
    }

    try {
      const workspaceId = this.workspaceId(req);
      const result = await this.contextGroupDao.createRule(
        {
          name,
          slug: effectiveSlug,
          description,
          datasources,
          mergeRelationshipTypes,
          annotations,
          includeExternalRelations,
          seedVersion,
        },
        workspaceId,
      );

      await this.contextGroupDao.materializeRule(result.id, workspaceId);

      return res
        .status(201)
        .send(await this.contextGroupDao.enrichRule(result, workspaceId));
    } catch (e: unknown) {
      if (e instanceof InputError) {
        return res.status(400).json({ error: e.message });
      }
      if (isUniqueViolation(e)) {
        // `context_group_rule` is unique on BOTH name and slug — report the one
        // that actually collided.
        return res.status(409).json({
          error: uniqueViolationConstraint(e)?.includes('slug')
            ? `A context group with slug "${effectiveSlug}" already exists`
            : `A context group named "${name}" already exists`,
        });
      }
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  getRule: RequestHandler = async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid rule ID' });
    }

    try {
      const allowed = await this.allowedRuleSlugs(req);
      const result = await this.contextGroupDao.getRule(
        id,
        this.workspaceId(req),
      );
      // 404 rather than 403 for a disallowed rule so its existence isn't leaked.
      if (!result || (allowed && !allowed.includes(result.slug))) {
        return res.status(404).json({ error: 'Context group rule not found' });
      }
      return res.send(
        await this.contextGroupDao.enrichRule(result, this.workspaceId(req)),
      );
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  replaceRule: RequestHandler = async (req, res, next) => {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid rule ID' });
    }
    const body = req.body ?? {};
    if (typeof body.name !== 'string' || !body.name) {
      return res.status(400).json({
        error:
          'name is required (PUT replaces the whole context group; use PATCH to change one field)',
      });
    }
    if (!Array.isArray(body.datasources)) {
      return res.status(400).json({
        error:
          'datasources is required (PUT replaces the whole context group; use PATCH to change one field)',
      });
    }
    req.body = {
      ...body,
      description: body.description ?? null,
      mergeRelationshipTypes: body.mergeRelationshipTypes ?? [],
      annotations: body.annotations ?? [],
      includeExternalRelations: body.includeExternalRelations ?? false,
      seedVersion: body.seedVersion ?? undefined,
    };
    return this.updateRule(req, res, next);
  };

  updateRule: RequestHandler = async (req, res) => {
    const { id } = req.params;
    const {
      name,
      slug,
      description,
      datasources,
      mergeRelationshipTypes,
      annotations,
      includeExternalRelations,
      seedVersion,
    } = req.body;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid rule ID' });
    }

    if (name !== undefined && typeof name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' });
    }

    let nextSlug: string | undefined;
    if (slug !== undefined) {
      if (typeof slug !== 'string') {
        return res.status(400).json({ error: 'slug must be a string' });
      }
      nextSlug = slug.trim();
      // SLUG_RE rejects '' too, so the empty-slug hole closes for free.
      if (!SLUG_RE.test(nextSlug)) {
        return res.status(400).json({
          error:
            'Invalid slug: use lowercase letters, numbers and single hyphens',
        });
      }
    }

    if (datasources !== undefined && !Array.isArray(datasources)) {
      return res.status(400).json({ error: 'datasources must be an array' });
    }

    if (
      mergeRelationshipTypes !== undefined &&
      !Array.isArray(mergeRelationshipTypes)
    ) {
      return res
        .status(400)
        .json({ error: 'mergeRelationshipTypes must be an array' });
    }

    if (annotations !== undefined && !Array.isArray(annotations)) {
      return res.status(400).json({ error: 'annotations must be an array' });
    }

    if (
      includeExternalRelations !== undefined &&
      typeof includeExternalRelations !== 'boolean'
    ) {
      return res
        .status(400)
        .json({ error: 'includeExternalRelations must be a boolean' });
    }

    if (
      seedVersion !== undefined &&
      (!Number.isInteger(seedVersion) || seedVersion < 1)
    ) {
      return res
        .status(400)
        .json({ error: 'seedVersion must be a positive integer' });
    }

    try {
      const workspaceId = this.workspaceId(req);
      const result = await this.contextGroupDao.updateRule(
        id,
        {
          name,
          slug: nextSlug,
          description,
          datasources,
          mergeRelationshipTypes,
          annotations,
          includeExternalRelations,
          seedVersion,
        },
        workspaceId,
      );

      if (!result) {
        return res.status(404).json({ error: 'Context group rule not found' });
      }

      await this.contextGroupDao.materializeRule(id, workspaceId);

      return res.send(
        await this.contextGroupDao.enrichRule(result, workspaceId),
      );
    } catch (e: unknown) {
      if (e instanceof InputError) {
        return res.status(400).json({ error: e.message });
      }
      if (isUniqueViolation(e)) {
        // Unique on BOTH name and slug, and `name` is optional on a PATCH — so
        // neither column can be assumed, and a slug-only PATCH must not report
        // `"undefined" already exists`.
        if (uniqueViolationConstraint(e)?.includes('slug')) {
          return res.status(409).json({
            error: `A context group with slug "${nextSlug}" already exists`,
          });
        }
        return res.status(409).json({
          error:
            typeof name === 'string'
              ? `A context group named "${name}" already exists`
              : 'A context group with those details already exists',
        });
      }
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  deleteRule: RequestHandler = async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid rule ID' });
    }

    try {
      await this.contextGroupDao.deleteRule(id, this.workspaceId(req));
      return res.status(204).send();
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  materializeRule: RequestHandler = async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid rule ID' });
    }

    try {
      const workspaceId = this.workspaceId(req);
      const rule = await this.contextGroupDao.getRule(id, workspaceId);
      if (!rule) {
        return res.status(404).json({ error: 'Context group rule not found' });
      }

      // Fine-grained scope: enforce the caller's grant covers this rule.
      if (
        !(await isTargetAllowed(
          this.scopeService,
          req,
          SCOPES.contextGroup.execute,
          [rule.id, rule.slug],
        ))
      ) {
        return res.status(403).json({
          error: 'insufficient scope',
          missing: [`${SCOPES.contextGroup.execute}:${rule.slug}`],
        });
      }

      await this.contextGroupDao.materializeRule(id, workspaceId);
      return res.status(200).json({ message: 'Materialization complete' });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  materializeDatasource: RequestHandler = async (req, res) => {
    const { datasourceId } = req.params;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasource ID' });
    }

    try {
      const workspaceId = this.workspaceId(req);
      if (this.syncDatasourceContextGroups) {
        await this.syncDatasourceContextGroups(datasourceId, workspaceId);
      } else {
        await this.contextGroupDao.materializeForDatasource(
          datasourceId,
          workspaceId,
        );
      }
      return res.status(200).json({ message: 'Materialization complete' });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  getRuleGroups: RequestHandler = async (req, res) => {
    const { id: ruleRef } = req.params;
    const { limit, offset, q } = req.query;

    try {
      const workspaceId = this.workspaceId(req);
      // The path identifier is a rule UUID OR a human-readable slug (mirroring
      // get-capability). Resolve it to a concrete rule id first. A slug that
      // resolves to no rule must NOT fall through to getGroupsWithMembers — an
      // absent ruleId there would list every group — so it 404s like an unknown
      // UUID.
      let ruleId: string;
      let rule: ContextGroupRule | undefined;
      if (isUuid(ruleRef)) {
        ruleId = ruleRef;
      } else {
        rule = await this.contextGroupDao.getRuleBySlug(ruleRef, workspaceId);
        if (!rule) {
          return res
            .status(404)
            .json({ error: 'Context group rule not found' });
        }
        ruleId = rule.id;
      }

      const allowed = await this.allowedRuleSlugs(req);
      if (allowed) {
        rule =
          rule ?? (await this.contextGroupDao.getRule(ruleId, workspaceId));
        // 404 rather than 403 for a disallowed/unknown rule so its existence
        // isn't leaked.
        if (!rule || !allowed.includes(rule.slug)) {
          return res
            .status(404)
            .json({ error: 'Context group rule not found' });
        }
      }

      const result = await this.contextGroupDao.getGroupsWithMembers(ruleId, {
        workspaceId,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
        // Full-text member search: keeps only groups with a matching member.
        q: typeof q === 'string' && q.trim() ? q : undefined,
      });
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  previewRule: RequestHandler = async (req, res) => {
    const { datasources, mergeRelationshipTypes } = req.body;

    if (!Array.isArray(datasources)) {
      return res.status(400).json({ error: 'datasources must be an array' });
    }

    if (
      mergeRelationshipTypes !== undefined &&
      !Array.isArray(mergeRelationshipTypes)
    ) {
      return res
        .status(400)
        .json({ error: 'mergeRelationshipTypes must be an array' });
    }

    try {
      const result = await this.contextGroupDao.previewRule(
        {
          name: 'preview',
          datasources,
          mergeRelationshipTypes,
        },
        this.workspaceId(req),
      );
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  listGroups: RequestHandler = async (req, res) => {
    const { ruleId, limit, offset } = req.query;

    if (ruleId && !isUuid(ruleId as string)) {
      return res.status(400).json({ error: 'Invalid ruleId' });
    }

    try {
      const allowedRuleSlugs = await this.allowedRuleSlugs(req);
      const result = await this.contextGroupDao.listGroups({
        workspaceId: this.workspaceId(req),
        ruleId: ruleId as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
        allowedRuleSlugs,
      });
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  getGroup: RequestHandler = async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    try {
      const allowed = await this.allowedRuleSlugs(req);
      const workspaceId = this.workspaceId(req);
      const result = await this.contextGroupDao.getGroup(id, workspaceId);
      if (!result || !(await this.groupRuleAllowed(id, allowed, workspaceId))) {
        return res.status(404).json({ error: 'Context group not found' });
      }
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  getFieldProfiles: RequestHandler = async (req, res) => {
    const { datasourceId } = req.params;

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasourceId' });
    }

    try {
      const sample = await this.objectDao.sampleForSuggestions(
        datasourceId,
        undefined,
        this.workspaceId(req),
      );
      const { fields, presets } = computeProjectionFieldProfiles(
        sample.items.map(item => item.object),
      );
      return res.send({ datasourceId, fields, presets });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  getViewSchema: RequestHandler = async (req, res) => {
    // A rule UUID or its slug, mirroring listViews.
    const { id: ruleRef } = req.params;

    try {
      const workspaceId = this.workspaceId(req);
      const rule = isUuid(ruleRef)
        ? await this.contextGroupDao.getRule(ruleRef, workspaceId)
        : await this.contextGroupDao.getRuleBySlug(ruleRef, workspaceId);
      const allowed = await this.allowedRuleSlugs(req);
      if (!rule || (allowed && !allowed.includes(rule.slug))) {
        return res.status(404).json({ error: 'Context group rule not found' });
      }

      // Display names come from the live datasource lookup; fall back to the
      // rule's stored seed names when that service is unreachable, exactly as
      // the document key resolution does.
      let labelled = rule;
      try {
        labelled = await this.contextGroupDao.enrichRule(rule, workspaceId);
      } catch {
        // Best-effort — seedName below still applies.
      }
      const labelByDatasourceId = new Map<string, string>();
      for (const filter of labelled.datasources ?? []) {
        const datasourceId = filter.datasourceId || filter.status?.datasourceId;
        if (!datasourceId) continue;
        labelByDatasourceId.set(
          datasourceId,
          filter.status?.displayName ||
            filter.seedName ||
            filter.status?.seedName ||
            datasourceId,
        );
      }

      // Keys come from the rule itself — the same derivation the render-time
      // group document uses — so every datasource in the rule is offered. A
      // rule without cross-source relationships materializes single-source
      // groups, so no one sampled group would span all sources.
      const documentKeys = await this.contextGroupDao.getRuleDocumentKeys(
        rule,
        workspaceId,
      );

      // A sample group still anchors the starter-gallery previews.
      const groups = await this.contextGroupDao.listGroups({
        workspaceId,
        ruleId: rule.id,
        limit: 1,
      });
      const sampleGroupId = groups.items[0]?.id ?? null;

      // Relationship types are read off a group that actually contains the
      // source; sources sharing a sample group share the lookup.
      const relationTypesByGroupId = new Map<
        string,
        ReturnType<ContextGroupDao['listGroupRelationTypes']>
      >();
      const relationTypesFor = async (datasourceId: string) => {
        const groupId =
          await this.contextGroupDao.findSampleGroupIdForDatasource(
            rule.id,
            datasourceId,
            workspaceId,
          );
        if (!groupId) {
          return [];
        }
        let pending = relationTypesByGroupId.get(groupId);
        if (!pending) {
          pending = this.contextGroupDao.listGroupRelationTypes(
            groupId,
            workspaceId,
          );
          relationTypesByGroupId.set(groupId, pending);
        }
        return (await pending).filter(
          relation => relation.datasourceId === datasourceId,
        );
      };

      const sources = await Promise.all(
        documentKeys.map(async ({ datasourceId, key }) => {
          const sample = await this.objectDao.sampleForSuggestions(
            datasourceId,
            undefined,
            workspaceId,
          );
          const { fields, presets } = computeProjectionFieldProfiles(
            sample.items.map(item => item.object),
          );
          return {
            key,
            datasourceId,
            label: labelByDatasourceId.get(datasourceId) ?? key,
            fields,
            presets,
            relationshipTypes: foldRelationTypes(
              await relationTypesFor(datasourceId),
            ),
          };
        }),
      );

      return res.send({
        ruleId: rule.id,
        sampleGroupId,
        sources,
      });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  listViews: RequestHandler = async (req, res) => {
    // A rule UUID or its human-readable slug, mirroring getRuleGroups — MCP
    // callers usually hold the slug from a `@context-group:<slug>` reference.
    const { id: ruleRef } = req.params;

    try {
      const workspaceId = this.workspaceId(req);
      const rule = isUuid(ruleRef)
        ? await this.contextGroupDao.getRule(ruleRef, workspaceId)
        : await this.contextGroupDao.getRuleBySlug(ruleRef, workspaceId);
      const allowed = await this.allowedRuleSlugs(req);
      if (!rule || (allowed && !allowed.includes(rule.slug))) {
        return res.status(404).json({ error: 'Context group rule not found' });
      }
      const items = await this.contextGroupDao.listViews(rule.id, workspaceId);
      return res.send({ ruleId: rule.id, items });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  createView: RequestHandler = async (req, res) => {
    const { id } = req.params;
    const { name, description, template, isDefault } = req.body;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid rule ID' });
    }
    if (typeof name !== 'string' || !name) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (typeof template !== 'string' || !template) {
      return res.status(400).json({ error: 'template is required' });
    }
    if (description !== undefined && typeof description !== 'string') {
      return res.status(400).json({ error: 'description must be a string' });
    }
    if (isDefault !== undefined && typeof isDefault !== 'boolean') {
      return res.status(400).json({ error: 'isDefault must be a boolean' });
    }

    try {
      const workspaceId = this.workspaceId(req);
      const rule = await this.contextGroupDao.getRule(id, workspaceId);
      if (!rule) {
        return res.status(404).json({ error: 'Context group rule not found' });
      }
      const existing = await this.contextGroupDao.getViewByName(
        id,
        name,
        workspaceId,
      );
      if (existing) {
        return res.status(409).json({ error: `View "${name}" already exists` });
      }
      const created = await this.contextGroupDao.createView(
        id,
        {
          name,
          description,
          template,
          isDefault,
        },
        workspaceId,
      );
      return res.status(201).send(created);
    } catch (e: unknown) {
      if (e instanceof ViewValidationError) {
        return res.status(400).json({ error: e.message, issues: e.issues });
      }
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  updateView: RequestHandler = async (req, res) => {
    const { id } = req.params;
    const { name, description, template, isDefault } = req.body;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid view ID' });
    }
    if (name !== undefined && typeof name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' });
    }
    if (template !== undefined && typeof template !== 'string') {
      return res.status(400).json({ error: 'template must be a string' });
    }
    if (
      description !== undefined &&
      description !== null &&
      typeof description !== 'string'
    ) {
      return res.status(400).json({ error: 'description must be a string' });
    }
    if (isDefault !== undefined && typeof isDefault !== 'boolean') {
      return res.status(400).json({ error: 'isDefault must be a boolean' });
    }

    try {
      const updated = await this.contextGroupDao.updateView(
        id,
        {
          name,
          description,
          template,
          isDefault,
        },
        this.workspaceId(req),
      );
      if (!updated) {
        return res.status(404).json({ error: 'View not found' });
      }
      return res.send(updated);
    } catch (e: unknown) {
      if (e instanceof ViewValidationError) {
        return res.status(400).json({ error: e.message, issues: e.issues });
      }
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  deleteView: RequestHandler = async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid view ID' });
    }

    try {
      await this.contextGroupDao.deleteView(id, this.workspaceId(req));
      return res.status(204).send();
    } catch (e: unknown) {
      if (e instanceof ViewValidationError) {
        return res.status(400).json({ error: e.message, issues: e.issues });
      }
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  renderViewPreview: RequestHandler = async (req, res) => {
    const { id } = req.params;
    const { template, groupId, memberLimit } = req.body;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid rule ID' });
    }
    if (typeof template !== 'string' || !template) {
      return res.status(400).json({ error: 'template is required' });
    }
    if (typeof groupId !== 'string' || !isUuid(groupId)) {
      return res.status(400).json({ error: 'groupId must be a group UUID' });
    }
    if (
      memberLimit !== undefined &&
      (!Number.isInteger(memberLimit) || memberLimit < 0)
    ) {
      return res
        .status(400)
        .json({ error: 'memberLimit must be a non-negative integer' });
    }

    try {
      const workspaceId = this.workspaceId(req);
      const group = await this.contextGroupDao.getGroup(groupId, workspaceId);
      if (!group || group.ruleId !== id) {
        return res
          .status(404)
          .json({ error: 'Context group not found for this rule' });
      }
      const result = await this.contextGroupDao.renderTemplate(
        groupId,
        template,
        { memberLimit, workspaceId },
      );
      if (!result) {
        return res.status(404).json({ error: 'Context group not found' });
      }
      return res.send(result);
    } catch (e: unknown) {
      if (e instanceof ViewValidationError) {
        return res.status(400).json({ error: e.message, issues: e.issues });
      }
      // Render-time failures (budget exceeded, runtime template errors) are
      // the template's problem, not the server's.
      return res
        .status(400)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  getGroupBundle: RequestHandler = async (req, res) => {
    const { id } = req.params;
    const { memberLimit, relationshipLimit, datasourceIds, view } = req.query;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    // Rendered mode: `?view=<name>` (or bare `?view=` for the
    // rule's default) renders the group through a named Liquid view and
    // returns the document instead of the structured member payload.
    if (typeof view === 'string') {
      try {
        const workspaceId = this.workspaceId(req);
        const allowed = await this.allowedRuleSlugs(req);
        if (!(await this.groupRuleAllowed(id, allowed, workspaceId))) {
          return res.status(404).json({ error: 'Context group not found' });
        }
        const bundle = await this.contextGroupDao.renderBundle(id, {
          view: view || undefined,
          memberLimit: optionalNonNegativeInt(memberLimit),
          workspaceId,
        });
        if (!bundle) {
          return res.status(404).json({ error: 'Context group not found' });
        }
        return res.send(bundle);
      } catch (e: unknown) {
        if (e instanceof ViewNotFoundError) {
          return res.status(404).json({ error: e.message });
        }
        return res
          .status(500)
          .json({ error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Optional comma-separated slice: return only these datasources' members
    // (and external relations sourced from them) for progressive agent loading.
    const datasourceIdsFilter =
      typeof datasourceIds === 'string' && datasourceIds.length > 0
        ? datasourceIds
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : undefined;

    try {
      const workspaceId = this.workspaceId(req);
      const allowed = await this.allowedRuleSlugs(req);
      const result = await this.contextGroupDao.getGroupWithMembers(id, {
        workspaceId,
        memberLimit: optionalNonNegativeInt(memberLimit),
        relationshipLimit: optionalNonNegativeInt(relationshipLimit),
        datasourceIds: datasourceIdsFilter,
      });
      if (!result || !(await this.groupRuleAllowed(id, allowed, workspaceId))) {
        return res.status(404).json({ error: 'Context group not found' });
      }
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  listGroupMembers: RequestHandler = async (req, res) => {
    const { id } = req.params;
    const { limit, offset } = req.query;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    try {
      const workspaceId = this.workspaceId(req);
      const allowed = await this.allowedRuleSlugs(req);
      if (!(await this.groupRuleAllowed(id, allowed, workspaceId))) {
        return res.status(404).json({ error: 'Context group not found' });
      }
      const result = await this.contextGroupDao.listGroupMembers(id, {
        workspaceId,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      });
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  findGroupsByMember: RequestHandler = async (req, res) => {
    const { datasourceId, objectId } = req.query;

    if (!datasourceId || typeof datasourceId !== 'string') {
      return res.status(400).json({ error: 'datasourceId is required' });
    }

    if (!objectId || typeof objectId !== 'string') {
      return res.status(400).json({ error: 'objectId is required' });
    }

    try {
      const allowed = await this.allowedRuleSlugs(req);
      const result = await this.contextGroupDao.findGroupsByMember(
        datasourceId,
        objectId,
        this.workspaceId(req),
      );
      // Each membership carries its rule slug, so filter in place.
      const items = allowed
        ? result.filter(m => allowed.includes(m.ruleSlug))
        : result;
      return res.send({ items });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  listGroupTitlesForDatasource: RequestHandler = async (req, res) => {
    const { datasourceId } = req.params;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const limit = optionalNonNegativeInt(req.query.limit);

    if (!isUuid(datasourceId)) {
      return res.status(400).json({ error: 'Invalid datasource ID' });
    }

    try {
      const items = await this.contextGroupDao.listGroupTitlesForDatasource(
        datasourceId,
        {
          workspaceId: this.workspaceId(req),
          q,
          limit: limit ? Math.min(limit, MAX_TITLES_LIMIT) : undefined,
          allowedRuleSlugs: await this.allowedRuleSlugs(req),
        },
      );
      return res.send({ items });
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };
}
