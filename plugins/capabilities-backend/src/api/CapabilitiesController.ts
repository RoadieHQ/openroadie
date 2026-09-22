import { Router, RequestHandler, json } from 'express';
import { validate as isUuid } from 'uuid';
import {
  SCOPES,
  SLUG_RE,
  resolveAllowedTargets,
  isTargetAllowed,
} from '@roadiehq/scopes';
import { isUniqueViolation } from '@roadiehq/errors';
import type { ScopeService } from '@roadiehq/scopes';
import type { LoggerService } from '@roadiehq/extensions-api';
import {
  entityChangeTopics,
  type EntityChangeOperation,
  type EventsService,
} from '@roadiehq/backend-defaults';
import { CapabilityDao } from '../database';
import type { WorkspaceService } from '@roadiehq/workspaces-backend';
import {
  defaultCurrentScopeIdResolver,
  type CurrentScopeIdResolver,
} from '@roadiehq/integrations-node';

/**
 * Derive a URL-safe slug from a free-text name. Mirrors the shared `SLUG_RE`
 * and the frontend's `slugify` so UI and backend agree on the derived value.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class CapabilitiesController {
  private capabilityDao: CapabilityDao;
  private scopeService: ScopeService;
  private events: EventsService;
  private logger: LoggerService;
  private currentScopeIdResolver: CurrentScopeIdResolver;
  private workspaceService: WorkspaceService;
  private workspaceIds = new WeakMap<object, string>();

  constructor(opts: {
    capabilityDao: CapabilityDao;
    scopeService: ScopeService;
    events: EventsService;
    logger: LoggerService;
    workspaceService: WorkspaceService;
    currentScopeIdResolver?: CurrentScopeIdResolver;
  }) {
    this.capabilityDao = opts.capabilityDao;
    this.scopeService = opts.scopeService;
    this.events = opts.events;
    this.logger = opts.logger;
    this.currentScopeIdResolver =
      opts.currentScopeIdResolver ?? defaultCurrentScopeIdResolver;
    this.workspaceService = opts.workspaceService;
  }

  private resolveWorkspace: RequestHandler = async (req, _res, next) => {
    try {
      this.workspaceIds.set(
        req,
        await this.workspaceService.resolveWorkspaceId(req),
      );
      next();
    } catch (error) {
      next(error);
    }
  };

  private workspaceId(req: object): string {
    const workspaceId = this.workspaceIds.get(req);
    if (!workspaceId) {
      throw new Error('Workspace middleware did not run');
    }
    return workspaceId;
  }

  private async publishChange(
    operation: EntityChangeOperation,
    id: string,
    workspaceId: string,
  ): Promise<void> {
    try {
      const scopeId = await this.currentScopeIdResolver.getCurrentScopeId();
      await this.events.publish({
        topic: entityChangeTopics.capabilities,
        eventPayload: { id, operation, scopeId, workspaceId },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to publish ${operation} capability event: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async getRouter() {
    const router = Router();
    const { scopeService } = this;
    const requireScopes = scopeService.requireScopes;
    const requireScopeFamily = scopeService.requireScopeFamily;

    router.use(this.resolveWorkspace);

    // list/search admit the whole `capability:query` family (incl. narrowed
    // `capability:query:<slug>` grants) and then filter rows to those targets.
    // Registered before `/:id` so `search` isn't captured as a capability id.
    router
      .route('/search')
      .get(requireScopeFamily(SCOPES.capability.query), this.search);

    router
      .route('/')
      .get(requireScopeFamily(SCOPES.capability.query), this.list)
      .post(requireScopes(SCOPES.capability.create), json(), this.create);

    // GET resolves by id or slug so `@capability:<slug>` references (and legacy
    // `@capability:<uuid>` ones) both work. PUT/DELETE stay id-only.
    // GET admits the whole `capability:get` family (incl. narrowed
    // `capability:get:<slug>` grants) at the guard, then `get` enforces the
    // grant covers the resolved capability by id or slug.
    router
      .route('/:idOrSlug')
      .get(requireScopeFamily(SCOPES.capability.get), this.get);
    router
      .route('/:id')
      .put(requireScopes(SCOPES.capability.create), json(), this.replace)
      .patch(requireScopes(SCOPES.capability.create), json(), this.update)
      .delete(requireScopes(SCOPES.capability.delete), this.delete);

    router
      .route('/:id/versions')
      .get(requireScopes(SCOPES.capability.query), this.listVersions);
    router
      .route('/:id/versions/:version')
      .get(requireScopes(SCOPES.capability.get), this.getVersion);
    router
      .route('/:id/versions/:version/restore')
      .post(requireScopes(SCOPES.capability.create), this.restoreVersion);

    return router;
  }

  list: RequestHandler = async (req, res) => {
    const { limit, offset } = req.query;

    try {
      const allowedIdentifiers = await resolveAllowedTargets(
        this.scopeService,
        req,
        SCOPES.capability.query,
      );
      const result = await this.capabilityDao.list({
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
        allowedIdentifiers,
        workspaceId: this.workspaceId(req),
      });
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  search: RequestHandler = async (req, res) => {
    const { q, limit, offset } = req.query;

    if (!q || typeof q !== 'string' || !q.trim()) {
      return res.status(400).json({ error: 'q (search query) is required' });
    }

    try {
      const allowedIdentifiers = await resolveAllowedTargets(
        this.scopeService,
        req,
        SCOPES.capability.query,
      );
      const result = await this.capabilityDao.search(q, {
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
        allowedIdentifiers,
        workspaceId: this.workspaceId(req),
      });
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  create: RequestHandler = async (req, res) => {
    const { name, description, instructions, slug: rawSlug } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }

    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'description is required' });
    }

    if (instructions === undefined || typeof instructions !== 'string') {
      return res.status(400).json({ error: 'instructions is required' });
    }

    if (rawSlug !== undefined && typeof rawSlug !== 'string') {
      return res.status(400).json({ error: 'slug must be a string' });
    }

    // An explicit slug is validated as-is; otherwise derive one from the name.
    const slug = rawSlug ? rawSlug : slugify(name);
    if (!SLUG_RE.test(slug)) {
      return res.status(400).json({
        error: rawSlug
          ? 'invalid slug'
          : 'Could not derive a valid slug from name; provide a slug',
      });
    }

    try {
      const result = await this.capabilityDao.create(
        name,
        description,
        instructions,
        slug,
        this.workspaceId(req),
      );
      await this.publishChange('created', result.id, this.workspaceId(req));
      return res.status(201).send(result);
    } catch (e: unknown) {
      if (isUniqueViolation(e)) {
        return res
          .status(409)
          .json({ error: `A capability with slug '${slug}' already exists` });
      }
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  get: RequestHandler = async (req, res) => {
    const { idOrSlug } = req.params;

    try {
      const result = await this.capabilityDao.getByIdOrSlug(
        idOrSlug,
        this.workspaceId(req),
      );
      if (!result) {
        return res.status(404).json({ error: 'Capability not found' });
      }
      // Fine-grained scope: the family guard admitted any get grant; enforce
      // the caller's grant covers this capability (by id or slug).
      if (
        !(await isTargetAllowed(this.scopeService, req, SCOPES.capability.get, [
          result.id,
          result.slug,
        ]))
      ) {
        return res.status(403).json({
          error: 'insufficient scope',
          missing: [`${SCOPES.capability.get}:${result.id}`],
        });
      }
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  update: RequestHandler = async (req, res) => {
    const { id } = req.params;
    const { name, description, instructions, slug } = req.body;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid capability ID' });
    }

    if (name !== undefined && typeof name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' });
    }

    if (description !== undefined && typeof description !== 'string') {
      return res.status(400).json({ error: 'description must be a string' });
    }

    if (instructions !== undefined && typeof instructions !== 'string') {
      return res.status(400).json({ error: 'instructions must be a string' });
    }

    if (slug !== undefined) {
      if (typeof slug !== 'string') {
        return res.status(400).json({ error: 'slug must be a string' });
      }
      if (!SLUG_RE.test(slug)) {
        return res.status(400).json({ error: 'invalid slug' });
      }
    }

    try {
      const result = await this.capabilityDao.update(
        id,
        {
          name,
          slug,
          description,
          instructions,
        },
        this.workspaceId(req),
      );
      if (!result) {
        return res.status(404).json({ error: 'Capability not found' });
      }
      await this.publishChange('updated', result.id, this.workspaceId(req));
      return res.send(result);
    } catch (e: unknown) {
      if (isUniqueViolation(e)) {
        return res
          .status(409)
          .json({ error: 'A capability with that slug already exists' });
      }
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  replace: RequestHandler = async (req, res, next) => {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid capability ID' });
    }

    const body = req.body ?? {};
    for (const field of ['name', 'description', 'instructions']) {
      if (typeof body[`${field}`] !== 'string') {
        return res.status(400).json({
          error: `${field} is required (PUT replaces the whole capability; use PATCH to change one field)`,
        });
      }
    }

    return this.update(req, res, next);
  };

  delete: RequestHandler = async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid capability ID' });
    }

    try {
      const deletedCount = await this.capabilityDao.delete(
        id,
        this.workspaceId(req),
      );
      if (deletedCount === 0) {
        return res.status(404).json({ error: 'Capability not found' });
      }
      await this.publishChange('deleted', id, this.workspaceId(req));
      return res.status(204).send();
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  listVersions: RequestHandler = async (req, res) => {
    const { id } = req.params;
    const { limit, offset } = req.query;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid capability ID' });
    }

    try {
      const result = await this.capabilityDao.listVersions(id, {
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
        workspaceId: this.workspaceId(req),
      });
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  getVersion: RequestHandler = async (req, res) => {
    const { id, version } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid capability ID' });
    }

    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      return res.status(400).json({ error: 'Invalid version number' });
    }

    try {
      const result = await this.capabilityDao.getVersion(
        id,
        versionNum,
        this.workspaceId(req),
      );
      if (!result) {
        return res.status(404).json({ error: 'Version not found' });
      }
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  restoreVersion: RequestHandler = async (req, res) => {
    const { id, version } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid capability ID' });
    }

    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      return res.status(400).json({ error: 'Invalid version number' });
    }

    try {
      const result = await this.capabilityDao.restoreVersion(
        id,
        versionNum,
        this.workspaceId(req),
      );
      if (!result) {
        return res
          .status(404)
          .json({ error: 'Capability or version not found' });
      }
      await this.publishChange('restored', result.id, this.workspaceId(req));
      return res.send(result);
    } catch (e: unknown) {
      return res
        .status(500)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }
  };
}
